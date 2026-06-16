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
    return (d.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.content||''}));
  }};
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

  // Deep enrichment: extract hidden fields from snippets (parallel)
  send({step:'enrich',text:'深度提取候选人档案...',progress:58});
  const [enrichedT, enrichedJ] = await Promise.all([
    deepExtractTalents(ai, talents.slice(0,25)),
    deepExtractJDs(ai, jds.slice(0,15))
  ]);

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
      snippet:j.snippet||'',  // Keep snippet for skill extraction
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

  // PHASE 2: Generate template-based report (same as regenerate)
  send({step:'report',text:'生成报告...',progress:70});
  try {
    const reportHtml = await buildStreamingReport(ai, talentRows, jdRows, industry, role, send);
    // Update the position with report_html (JSON encoded)
    const rjson = JSON.stringify(reportHtml);
    const db = turso();
    db.execute("UPDATE positions SET report_html='"+rjson.replace(/'/g,'')+"' WHERE id=(SELECT MAX(id) FROM positions)").catch(e=>{});
    send({step:'report_ready',progress:100, report_html: reportHtml});
    send({step:'report_ready',progress:100,
      report_html: '<p style=\"color:#a8a8a8;text-align:center;padding:40px\">报告生成失败</p>',
    });
  }
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

async function buildStreamingReport(ai, talents, jds, industry, role, send) {
  // Compute stats (same logic as regenerate.js)
  const stats = computeReportStats(talents, jds);
  const tText = talents.slice(0,15).map(t=>`${t.name||'?'}|${t.current_company||''}|${t.current_title||''}`).join('\n');

  // Stream DeepSeek analysis for experience levels
  const prompt = `为${industry}行业${role}岗位写4段短分析, 必须严格覆盖4个经验阶段:
1. 校招生(0-1年): 需要什么技能, 典型项目举例(80字)
2. 1-3年: 需要什么技能, 典型项目举例(80字)
3. 3-5年: 需要什么技能, 典型项目举例(80字)
4. 5年以上: 需要什么技能, 典型项目举例(80字)
每个阶段用<div class='level-card'><h3>阶段名</h3><p>内容</p></div>格式。必须是4段。候选人参考:${tText}`;

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
    body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.3,max_tokens:1500,stream:true})
  });
  const reader = resp.body.getReader(); const decoder = new TextDecoder();
  let buf='', analysis='', start=Date.now();
  while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop()||'';
    for(const line of lines){if(!line.startsWith('data:'))continue;const c=line.slice(6);if(c==='[DONE]')continue;
      try{analysis+=JSON.parse(c).choices?.[0]?.delta?.content||'';}catch(e){}
    }
    send({step:'report_progress',progress:75+Math.min(20,Math.round((Date.now()-start)/1000)),text:`生成分析中...${analysis.length}字`,chars:analysis.length});
  }
  analysis=analysis.trim();
  if(analysis.startsWith('```'))analysis=analysis.replace(/```html?|```/g,'');

  // Build final HTML with stats + analysis
  return buildReportHTML(stats, analysis, industry, role);
}

// ===== Report stats computation =====
function computeReportStats(talents, jds) {
  const total = talents.length||1;
  const edu={}; talents.forEach(t=>{const e=(t.education||'').trim();if(e){const k=e.split('+')[0].substring(0,20);edu[k]=(edu[k]||0)+1;}});
  let eduSorted=Object.entries(edu).sort((a,b)=>b[1]-a[1]);
  if(!eduSorted.length){const tmp={};talents.forEach(t=>{const l=t.level||'其他';tmp[l]=(tmp[l]||0)+1;});eduSorted=Object.entries(tmp).sort((a,b)=>b[1]-a[1]);}
  eduSorted=eduSorted.slice(0,5);
  const exp={校招生:0,'1-3年':0,'3-5年':0,'5年以上':0};
  talents.forEach(t=>{const lv=(t.level||'').toLowerCase();const tt=(t.current_title||'').toLowerCase();
    if(/intern|实习|应届|trainee|校招/i.test(tt)||/专员|初级|助理|associate|junior/i.test(tt))exp['校招生']++;
    else if(/总监|vp|副总裁|head|director|principal|首席|负责人/i.test(tt)||lv.includes('总监'))exp['5年以上']++;
    else if(/资深|高级|senior|staff|lead|经理|manager/i.test(tt)||lv.includes('经理'))exp['3-5年']++;
    else exp['1-3年']++;});
  const techKw=['agent','rag','llm','prompt','ai','ml','python','sql','产品','数据','模型','算法','架构','设计','运营','分析','开发','管理','系统','平台','大模型','gpt','transformer','微调','评测','a/b','增长','策略'];
  const hardSkills={};techKw.forEach(kw=>{let cnt=0;(jds||[]).forEach(j=>{if((j.snippet||'').toLowerCase().includes(kw))cnt++;});if(cnt>0)hardSkills[kw]=cnt;});
  const skillSorted=Object.entries(hardSkills).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const comp={};talents.forEach(t=>{const c=t.current_company||'其他';comp[c]=(comp[c]||0)+1;});
  const compSorted=Object.entries(comp).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return {total,eduSorted,exp,skillSorted,compSorted};
}

function buildReportHTML(stats, analysisHtml, industry, role) {
  const total=stats.total;
  const eduColors=['#f59e0b','#10b981','#6366f1','#ef4444','#8b5cf6'];
  const eduPie=stats.eduSorted.map(([,v],i)=>{const pct=Math.round(v/total*100);const prev=stats.eduSorted.slice(0,i).reduce((s,[,n])=>s+Math.round(n/total*100),0);return`${eduColors[i]} ${prev}% ${prev+pct}%`;}).join(',');
  const expColors=['#10b981','#f59e0b','#6366f1','#ef4444'];
  const expEntries=Object.entries(stats.exp);const expPieNums=expEntries.map(([,v])=>Math.round(v/total*100));
  const expPie=expEntries.map(([,v],i)=>{const pct=expPieNums[i];const prev=expPieNums.slice(0,i).reduce((s,n)=>s+n,0);return`${expColors[i]} ${prev}% ${prev+pct}%`;}).join(',');
  const cc=['#f59e0b','#10b981','#6366f1','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
  const compPie=stats.compSorted.map(([,v],i)=>{const pct=Math.round(v/total*100);const prev=stats.compSorted.slice(0,i).reduce((s,[,n])=>s+Math.round(n/total*100),0);return`${cc[i]} ${prev}% ${prev+pct}%`;}).join(',');
  const skillTags=stats.skillSorted.map(([k,v])=>`<span class="skill-tag">${k} <small>${v}</small></span>`).join('');
  return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.08) 0%,transparent 50%),linear-gradient(180deg,#151525 0%,#121220 30%,#10101c 60%,#121220 100%);background-attachment:fixed;color:#f5f5f5;line-height:1.6;padding:32px 24px;max-width:1100px;margin:0 auto}
h1{font-size:28px;font-weight:800;text-align:center;margin-bottom:28px;background:linear-gradient(135deg,#f5f5f5,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:18px;font-weight:600;margin:28px 0 16px;border-left:3px solid #f59e0b;padding-left:12px;color:#f5f5f5}
.dashboard{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
.pie-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;text-align:center}
.pie-card h3{font-size:12px;font-weight:600;color:#a8a8a8;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.pie{width:100px;height:100px;border-radius:50%;margin:0 auto 12px;box-shadow:0 0 20px rgba(245,158,11,.1)}
.pie.edu{background:conic-gradient(${eduPie||'#333 0% 100%'})}
.pie.exp{background:conic-gradient(${expPie||'#333 0% 100%'})}
.pie.comp{background:conic-gradient(${compPie||'#333 0% 100%'})}
.legend{font-size:11px;color:#a8a8a8;text-align:left;margin-top:8px}
.legend span{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
.skills-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:24px}
.skills-card h3{font-size:12px;font-weight:600;color:#a8a8a8;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.skill-tag{display:inline-block;background:rgba(245,158,11,.15);color:#fcd34d;padding:4px 10px;border-radius:20px;font-size:12px;margin:3px;border:1px solid rgba(245,158,11,.2)}
.skill-tag small{color:#a8a8a8;margin-left:4px}
.level-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:14px}
.level-card h3{color:#f59e0b;font-size:16px;font-weight:600;margin-bottom:10px}
.level-card p{font-size:14px;color:#a8a8a8;line-height:1.8}
@media(max-width:700px){.dashboard{grid-template-columns:1fr}}
</style></head><body>
<h1>${role} · ${industry} 人才画像报告</h1>
<div class="dashboard">
<div class="pie-card"><h3>学历分布</h3><div class="pie edu"></div><div class="legend">${stats.eduSorted.map(([k,v],i)=>`<div><span style="background:${eduColors[i]}"></span>${k}:${Math.round(v/total*100)}%</div>`).join('')||'暂无数据'}</div></div>
<div class="pie-card"><h3>经验分布</h3><div class="pie exp"></div><div class="legend">${expEntries.map(([k],i)=>`<div><span style="background:${expColors[i]}"></span>${k}:${expPieNums[i]}%</div>`).join('')}</div></div>
<div class="pie-card"><h3>公司来源</h3><div class="pie comp"></div><div class="legend">${stats.compSorted.slice(0,5).map(([k,v],i)=>`<div><span style="background:${cc[i]}"></span>${k.substring(0,15)}:${v}人</div>`).join('')}</div></div>
</div>
<div class="skills-card"><h3>硬技能 TOP10</h3><div>${skillTags||'暂无数据'}</div></div>
<h2>经验阶段分析</h2>
${analysisHtml||'<div class="level-card"><p>分析生成失败。</p></div>'}
<div style="text-align:center;padding:24px;color:#666;font-size:12px">数据来源: Tavily · LinkedIn · DeepSeek | 标注[AI推理]的内容为算法推断</div>
</body></html>`;
}

// ========== Pipeline helpers ==========

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
  await db.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, industry TEXT, role_direction TEXT, talent_data TEXT, jd_data TEXT, report_html TEXT, created_at TEXT DEFAULT (datetime()))");
}

// ===== DeepSeek batch enrichment =====

async function deepExtractTalents(ai, talents) {
  const text = talents.slice(0,25).map((t,i) => `[${i}] ${(t.snippet||'').substring(0,2000)}`).join('\n---\n');
  const prompt = `Extract hidden fields from LinkedIn profile snippets. Return JSON array, one object per profile:
[{"education":"school+degree","languages":"lang1,lang2","certifications":"cert1,cert2","influence_score":0-10,"location":"city,country"}]
influence_score: 500+ connections=7, 1000+ followers=8, 2000+=9, 5000+=10. If no data, use empty string.
Profiles:\n${text.substring(0,12000)}`;
  const result = await ai.chat(prompt, 3000);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function deepExtractJDs(ai, jds) {
  const text = jds.slice(0,15).map((j,i) => `[${i}] ${(j.snippet||'').substring(0,2000)}`).join('\n---\n');
  const prompt = `Extract structured fields from job description snippets. Return JSON array:
[{"salary":"range if mentioned","experience":"e.g. 3-5 years","education_req":"e.g. Bachelor","tools":"tool1,tool2"}]
If field not found, use empty string. JDs:\n${text.substring(0,12000)}`;
  const result = await ai.chat(prompt, 2500);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function storeResults(industry, role, talentRows, jdRows) {
  const db = turso();
  // Store Chinese in JSON (Turso TEXT garbles Chinese chars)
  const tjson = JSON.stringify({_industry:industry, _role:role, _name:role+'-'+industry, data:talentRows.slice(0,40)});
  const jjson = JSON.stringify(jdRows.slice(0,30));
  const rjson = JSON.stringify(reportHtml || '');
  const pname = (role+'-'+industry).replace(/[^\x00-\x7F]/g,'').substring(0,40)||'pos';
  await db.execute("INSERT INTO positions (name, industry, role_direction, talent_data, jd_data, report_html) VALUES ('"+pname+"','"+
    industry.replace(/[^\x00-\x7F]/g,'').substring(0,30)+"','"+role.replace(/[^\x00-\x7F]/g,'').substring(0,30)+"','"+
    tjson.replace(/'/g,'')+"','"+jjson.replace(/'/g,'')+"','"+rjson.replace(/'/g,'')+"')");
}
