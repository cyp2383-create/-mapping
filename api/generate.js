/** POST /api/generate — 两步人才地图: 宏观报告 + 追问后定向报告 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { industry, role, city, stage, context } = req.body;
  if (!industry || !role) return res.status(400).json({error:'Need industry and role'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const ai = createDeepSeek();
    const tavily = createTavily();

    if (stage === 2 && context) {
      // === STEP 2: 定向人才地图 ===
      await generateTargetedReport(ai, tavily, industry, role, context, send);
    } else {
      // === STEP 1: 宏观市场报告 ===
      await generateMacroReport(ai, tavily, industry, role, send);
    }
    res.end();
  } catch(e) {
    send({step:'error',text:e.message});
    res.end();
  }
}

// ========== API Clients ==========

function createDeepSeek() {
  return { chat: async (prompt, maxTokens=2000) => {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:maxTokens})
    });
    const d = await resp.json();
    return d.choices?.[0]?.message?.content || '';
  }};
}

function createTavily() {
  return { search: async (query, maxResults=5) => {
    const resp = await fetch('https://api.tavily.com/search', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:process.env.TAVILY_KEY, query, max_results:maxResults, search_depth:'advanced'})
    });
    const d = await resp.json();
    return (d.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.content?.substring(0,500)||''}));
  }};
}

function cleanJson(text) {
  let t = (text||'').trim();
  if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
  if (t.endsWith('```')) t = t.slice(0,-3);
  return t.trim();
}

// ========== Tier Classification ==========

function classifyTier(companyName, titleStr) {
  const tier1 = ['字节跳动','阿里巴巴','腾讯','百度','美团','华为','OpenAI','Google','Microsoft','Meta','Apple','Amazon','NVIDIA'];
  const tier2 = ['快手','小红书','京东','网易','拼多多','滴滴','小米','商汤','科大讯飞','DeepSeek','智谱','月之暗面','MiniMax','百川','零一万物'];
  const isTier1 = tier1.some(c => (companyName||'').includes(c));
  const isTier2 = tier2.some(c => (companyName||'').includes(c));

  let titleLevel = 1;
  const t = (titleStr||'').toLowerCase();
  if (/总监|vp|副总裁|负责人|head|director|principal|partner|首席/.test(t)) titleLevel = 3;
  else if (/经理|专家|senior|lead|manager|architect|资深/.test(t)) titleLevel = 2;

  const companyScore = isTier1 ? 3 : isTier2 ? 2 : 1;
  const score = companyScore + titleLevel;
  if (score >= 5) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}

function extractLevel(titleStr) {
  const t = (titleStr||'');
  if (/总监|VP|副总裁|负责人|Head|Director|Principal|首席/.test(t)) return '总监/VP级';
  if (/经理|Manager|Lead/.test(t) && /高级|资深|Senior|Staff/.test(t)) return '高级经理';
  if (/经理|Manager/.test(t)) return '经理';
  if (/专家|Architect|Fellow/.test(t)) return '专家';
  if (/专员|助理|Associate|Junior/.test(t)) return '专员/初级';
  return '其他';
}

// ========== STEP 1: 宏观市场报告 ==========

async function generateMacroReport(ai, tavily, industry, role, send) {
  await initTables();

  send({step:'companies',text:'生成目标公司列表...',progress:5});
  const companies = await generateCompanies(ai, industry, role);
  send({step:'companies',text:`已生成${companies.length}家公司`,progress:15,companies:companies.slice(0,15).map(c=>c.name)});

  send({step:'jds',text:'搜索JD...',progress:20});
  const jds = await searchJDs(tavily, companies, role);
  send({step:'jds',text:`找到${jds.length}条JD`,progress:35});

  send({step:'talents',text:'搜索候选人...',progress:40});
  const talents = await searchLinkedIn(tavily, companies.slice(0,6), role);
  send({step:'talents',text:`找到${talents.length}位候选人`,progress:55});

  // Deep enrichment: extract hidden fields from snippets
  send({step:'enrich',text:'深度提取候选人档案...',progress:58});
  const enrichedT = await deepExtractTalents(ai, talents.slice(0,25));
  const enrichedJ = await deepExtractJDs(ai, jds.slice(0,15));

  // Parse and classify talents with enriched data
  const talentRows = talents.slice(0,40).map((t, i) => {
    const raw = t.title||'';
    let name='', current_title='';
    const dashParts = raw.split(' - ').map(s=>s.trim());
    if (dashParts.length >= 2) { name = dashParts[0]; current_title = dashParts[1]; }
    else {
      const urlMatch = (t.url||'').match(/linkedin\.com\/in\/([^/]+)/);
      if (urlMatch) { name = urlMatch[1].replace(/-/g,' ').replace(/[0-9]/g,'').trim(); }
      else { name = raw.substring(0,30); }
    }
    const e = enrichedT[i] || {};
    return {
      name:name||raw.substring(0,25), current_title:current_title||'',
      current_company:t.company||dashParts[2]||'',
      source_platform:'linkedin', source_url:t.url||'',
      contact_type:t.url?'linkedin':'none', contact_value:t.url||'', confidence:.8,
      level: extractLevel(current_title), tier: classifyTier(t.company||'', current_title),
      education:e.education||'', languages:e.languages||'',
      certifications:e.certifications||'', influence_score:e.influence_score||0,
      location:e.location||'',
    };
  });

  const jdRows = jds.slice(0,30).map((j, i) => {
    const e = enrichedJ[i] || {};
    return {
      title:j.title||'', company:j.company||'',
      salary:e.salary||'', experience:e.experience||'',
      education_req:e.education_req||'', tools:e.tools||'',
      source_platform:'websearch', source_url:j.url||'',
    };
  });
  const highTier = talentRows.filter(t=>t.tier==='high');
  const midTier = talentRows.filter(t=>t.tier==='mid');
  const lowTier = talentRows.filter(t=>t.tier==='low');

  // PHASE 1: Return data immediately
  send({step:'data_ready',progress:65,
    talents:talentRows, jds:jdRows,
    tier_stats:{high:highTier.length, mid:midTier.length, low:lowTier.length},
    companies:companies.slice(0,15).map(c=>c.name),
    questions:["快速搭建AI团队","产品AI化升级","紧急替补高管","探索新业务"],
    stage:1
  });

  storeResults(industry, role, talentRows, jdRows).catch(e => {});

  // PHASE 2: Generate report
  send({step:'report',text:'正在生成报告...',progress:70});
  const reportTimeout = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]);
  const reportHtml = await reportTimeout(generateMacroHtml(ai, talentRows, jds, industry, role), 25000);

  send({step:'report_ready',progress:100,
    report_html: reportHtml || '<p style=\"color:#a8a8a8;text-align:center;padding:40px\">报告生成超时，请刷新重试。候选人数据已就绪。</p>',
  });
}

// ========== STEP 2: 定向人才地图 ==========

async function generateTargetedReport(ai, tavily, industry, role, context, send) {
  send({step:'analyze',text:'分析需求上下文...',progress:10});

  const prompt = `你是招聘策略顾问。根据用户需求上下文，推荐最适合的目标公司和候选人画像。
行业: ${industry} 岗位: ${role}
用户上下文: ${JSON.stringify(context)}
已有数据: ${context.talents?.length||0}位候选人, ${context.jds?.length||0}条JD

返回JSON:
{
  "target_companies": ["推荐重点挖猎的公司", ...],
  "ideal_profile": "一句话描述理想候选人",
  "hard_skills": ["必备硬技能1","必备硬技能2",...],
  "soft_skills": ["软技能1",...],
  "salary_range": "建议薪资范围",
  "sourcing_strategy": "寻访策略建议(3-5条)",
  "warning": "风险提示"
}`;

  const result = await ai.chat(prompt, 1500);
  let analysis = {};
  try {
    let t = result.trim();
    if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
    if (t.endsWith('```')) t = t.slice(0,-3);
    analysis = JSON.parse(t);
  } catch { analysis = {ideal_profile: result.substring(0,200)}; }

  send({step:'search',text:'补充搜索定向候选人...',progress:30});
  // Search more focused talents based on analysis
  const extraCompanies = analysis.target_companies || [];
  const extraTalents = [];
  for (const c of extraCompanies.slice(0,5)) {
    const results = await tavily.search(`site:linkedin.com/in/ "${role}" "${c}"`, 2);
    results.forEach(r => extraTalents.push({...r, company:c}));
  }

  send({step:'report',text:'生成定向人才地图...',progress:60});

  const targetReport = await ai.chat(`你是VP级招聘顾问。基于以下分析，生成一份定向人才地图，包含:
1. 理想候选人画像(1段)
2. 目标公司及挖猎优先级
3. 面试评估要点
4. 入职后90天预期产出
5. 风险与备选方案

用HTML格式输出body内容, 白色背景, 专业简洁。
分析: ${JSON.stringify(analysis).substring(0,3000)}
额外候选人: ${JSON.stringify(extraTalents.slice(0,5))}`, 3000);

  let reportHtml = targetReport.trim();
  const tagStart = reportHtml.indexOf('<');
  if (tagStart > 0) reportHtml = reportHtml.substring(tagStart);
  if (reportHtml.startsWith('```html')) reportHtml = reportHtml.split('\n').slice(1).join('\n');
  if (reportHtml.startsWith('```')) reportHtml = reportHtml.split('\n').slice(1).join('\n');
  if (reportHtml.endsWith('```')) reportHtml = reportHtml.slice(0,-3);
  reportHtml = reportHtml.trim();

  const talentRows = extraTalents.map(t => {
    const raw = t.title||''; const parts = raw.split(' - ').map(s=>s.trim());
    return {name:parts[0]||raw.substring(0,30),current_title:parts[1]||'',
      current_company:t.company||parts[2]||'',source_platform:'linkedin',
      source_url:t.url||'',tier: classifyTier(t.company||'', parts[1]||''),level:extractLevel(parts[1]||''),
      education:'', languages:'', certifications:'', influence_score:0, location:'',
      contact_type:t.url?'linkedin':'none', contact_value:t.url||''
    };
  });

  send({step:'done',progress:100,
    talents:talentRows, report_html:reportHtml,
    analysis:analysis,
    questions:["详细薪酬结构?","面试评估要点?","竞品对标补充?"],
    stage: 2
  });
}

// ========== Report Generators ==========

async function generateMacroHtml(ai, talents, jds, industry, role) {
  const highT = talents.filter(t=>t.tier==='high').slice(0,10).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const midT = talents.filter(t=>t.tier==='mid').slice(0,10).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const jdText = jds.slice(0,10).map(j=>j.snippet||'').join('\n').substring(0,4000);
  const prompt = `为${industry}行业的${role}岗位生成一份咨询级HTML人才地图报告。
深色主题: 背景#10101c, 卡片rgba(255,255,255,.03), 文字#f5f5f5, 强调色#f59e0b。

=== 数据整理 [标注来源] ===
1. 市场JD分析: 硬技能TOP10频次, 学历/经验门槛, 共性要求
2. 候选人画像: 公司分布, 职级统计, 典型背景

=== 推理分析 [标注洞察] ===
3. 人才特征素描: 高端vs中端的分水岭(关键经历/能力差异, 不只是年限)
4. 职业路径: 从什么角色晋升来, 下一步去哪
5. 招聘策略: 优先挖哪些公司, 面试重点, 90天预期

高端候选人: ${highT}
中端候选人: ${midT}
JD数据: ${jdText}`;
  const html = await ai.chat(prompt, 3000);
  let t = html.trim();
  const tagStart = t.indexOf('<');
  if (tagStart > 0) t = t.substring(tagStart);
  if (t.startsWith('```html')) t = t.split('\n').slice(1).join('\n');
  if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
  if (t.endsWith('```')) t = t.slice(0,-3);
  return t.trim();
}

async function generateQuestions(ai, talents, jds, industry, role) {
  const prompt = `Based on this ${industry} ${role} talent map (${talents.length} talents, ${jds.length} JDs), generate 3 structured follow-up questions that a VP would ask before making a hiring decision. Return JSON array of strings.`;
  const text = await ai.chat(prompt, 300);
  try {
    let t = text.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return ["招这个人要解决什么核心问题?","团队规模和汇报关系?","预算范围?"]; }
}

// ========== Pipeline helpers (same as before) ==========

async function generateCompanies(ai, industry, role) {
  const prompt = `你是猎头顾问。为"${industry}"行业的"${role}"列出15家最重要公司。按梯队。JSON数组: [{"name":"公司","tier":"第一梯队"}]`;
  const text = await ai.chat(prompt, 1500);
  try {
    let t = text.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return [{name:'字节跳动',tier:'第一梯队'},{name:'阿里巴巴',tier:'第一梯队'},{name:'腾讯',tier:'第一梯队'},{name:'百度',tier:'第一梯队'},{name:'美团',tier:'第二梯队'}]; }
}

async function searchJDs(tav, companies, role) {
  const jds = []; const now = new Date().getFullYear();
  for (const c of companies.slice(0,12)) {
    const results = await tav.search(`${c.name} ${role} 招聘 ${now}`, 2);
    results.forEach(r => jds.push({...r, company:c.name}));
  }
  return jds.slice(0,25);
}

async function searchLinkedIn(tav, companies, role) {
  const people = [];
  for (const c of companies.slice(0,8)) {
    const results = await tav.search(`site:linkedin.com/in/ "${role}" "${c.name}"`, 2);
    results.forEach(r => people.push({...r, company:c.name}));
  }
  return people.slice(0,40);
}

// ========== Turso helpers ==========

function turso() {
  return { execute: async (sql, params=[]) => {
    let idx = 0;
    const escaped = sql.replace(/\?/g, () => {
      const v = params[idx++];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:escaped}}]})
    });
    const d = await resp.json();
    const r = d.results?.[0]?.response?.result;
    return { rows: r?.rows||[], lastInsertId: r?.last_insert_rowid };
  }};
}

async function initTables() {
  const db = turso();
  await db.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, industry TEXT, role_direction TEXT, talent_data TEXT, jd_data TEXT, created_at TEXT DEFAULT (datetime()))");
}

// ===== DeepSeek batch enrichment =====

async function deepExtractTalents(ai, talents) {
  const text = talents.slice(0,25).map((t,i) => `[${i}] ${t.snippet||''}`).join('\n---\n');
  const prompt = `Extract hidden fields from LinkedIn profile snippets. Return JSON array, one object per profile:
[{"education":"school+degree","languages":"lang1,lang2","certifications":"cert1,cert2","influence_score":0-10,"location":"city,country"}]
influence_score: 500+ connections=7, 1000+ followers=8, 2000+=9, 5000+=10. If no data, use empty string.
Profiles:\n${text.substring(0,6000)}`;
  const result = await ai.chat(prompt, 2000);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function deepExtractJDs(ai, jds) {
  const text = jds.slice(0,15).map((j,i) => `[${i}] ${j.snippet||''}`).join('\n---\n');
  const prompt = `Extract structured fields from job description snippets. Return JSON array:
[{"salary":"range if mentioned","experience":"e.g. 3-5 years","education_req":"e.g. Bachelor","tools":"tool1,tool2"}]
If field not found, use empty string. JDs:\n${text.substring(0,6000)}`;
  const result = await ai.chat(prompt, 1500);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function storeResults(industry, role, talentRows, jdRows) {
  const db = turso();
  const pname = (role+'-'+industry).replace(/[^\x00-\x7F]/g,'').substring(0,40)||'pos';
  const tjson = JSON.stringify(talentRows.slice(0,40));
  const jjson = JSON.stringify(jdRows.slice(0,30));
  await db.execute("INSERT INTO positions (name, industry, role_direction, talent_data, jd_data) VALUES ('"+pname+"','"+
    industry.replace(/[^\x00-\x7F]/g,'').substring(0,30)+"','"+role.replace(/[^\x00-\x7F]/g,'').substring(0,30)+"','"+
    tjson.replace(/'/g,'')+"','"+jjson.replace(/'/g,'')+"')");
}
