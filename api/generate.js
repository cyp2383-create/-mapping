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

// ========== Tier Classification ==========

function classifyTier(companyName, salaryStr, titleStr) {
  const tier1 = ['字节跳动','阿里巴巴','腾讯','百度','美团','华为','OpenAI','Google','Microsoft','Meta','Apple','Amazon','NVIDIA'];
  const tier2 = ['快手','小红书','京东','网易','拼多多','滴滴','小米','商汤','科大讯飞','DeepSeek','智谱','月之暗面','MiniMax','百川','零一万物'];
  const isTier1 = tier1.some(c => companyName.includes(c));
  const isTier2 = tier2.some(c => companyName.includes(c));

  // Salary heuristic
  let salaryLevel = 1;
  const s = (salaryStr||'').toLowerCase();
  if (/\d+k/.test(s)) {
    const num = parseInt(s.match(/\d+/)?.[0]||'0');
    if (num >= 60) salaryLevel = 3;
    else if (num >= 30) salaryLevel = 2;
  }
  if (/万/.test(s) && /\d+/.test(s)) {
    const num = parseInt(s.match(/\d+/)?.[0]||'0');
    if (num >= 60) salaryLevel = 3;
    else if (num >= 30) salaryLevel = 2;
  }

  // Title heuristic
  let titleLevel = 1;
  if (/总监|VP|副总裁|负责人|head|director|principal/i.test(titleStr||'')) titleLevel = 3;
  else if (/经理|专家|senior|lead|manager/i.test(titleStr||'')) titleLevel = 2;

  const score = (isTier1?3:isTier2?2:1) + salaryLevel + titleLevel;
  if (score >= 7) return 'high';
  if (score >= 4) return 'mid';
  return 'low';
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

  send({step:'report',text:'生成报告...',progress:60});

  // Parse and classify talents
  const talentRows = talents.slice(0,40).map(t => {
    const raw = t.title||''; const parts = raw.split(' - ').map(s=>s.trim());
    const name = parts[0]||raw.substring(0,30);
    const current_title = parts[1]||'';
    const current_company = t.company||parts[2]||'';
    return {name,current_title,current_company,city:'',skills:'',source_platform:'linkedin',source_url:t.url||'',
      contact_type:t.url?'linkedin':'none',contact_value:t.url||'',confidence:.8,
      tier: classifyTier(current_company, '', current_title)
    };
  });

  // Store results first (fast)
  await storeResults(industry, role, talents, jds);

  // Generate reports in parallel with timeout
  const reportTimeout = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]);

  const [vpSummary, reportHtml, questions] = await Promise.all([
    reportTimeout(generateVPSummary(ai, talentRows, jds, industry, role), 20000),
    reportTimeout(generateMacroHtml(ai, talentRows, jds, industry, role), 25000),
    reportTimeout(generateQuestions(ai, talentRows, jds, industry, role), 10000),
  ]);

  const highTier = talentRows.filter(t=>t.tier==='high');
  const midTier = talentRows.filter(t=>t.tier==='mid');
  const lowTier = talentRows.filter(t=>t.tier==='low');

  send({step:'done',progress:100,
    talents:talentRows, jds:jds.slice(0,30).map(j=>({title:j.title||'',company:j.company||'',
      source_platform:'websearch',source_url:j.url||''})),
    report_html: reportHtml || '<p>报告生成中，请稍后重试。数据已就绪。</p>',
    vp_summary: vpSummary || '<p>摘要生成超时，请稍后重试。</p>',
    questions: questions || ["招这个人要解决什么核心问题?","团队规模和汇报关系?","预算范围?"],
    tier_stats: {high:highTier.length, mid:midTier.length, low:lowTier.length},
    companies: companies.slice(0,15).map(c=>c.name),
    stage: 1
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
  if (reportHtml.startsWith('```html')) reportHtml = reportHtml.split('\n').slice(1).join('\n');
  if (reportHtml.endsWith('```')) reportHtml = reportHtml.slice(0,-3);

  const talentRows = extraTalents.map(t => {
    const raw = t.title||''; const parts = raw.split(' - ').map(s=>s.trim());
    return {name:parts[0]||raw.substring(0,30),current_title:parts[1]||'',
      current_company:t.company||parts[2]||'',source_platform:'linkedin',
      source_url:t.url||'',tier: classifyTier(t.company||'', '', parts[1]||'')};
  });

  send({step:'done',progress:100,
    talents:talentRows, report_html:reportHtml,
    analysis:analysis,
    questions:["详细薪酬结构?","面试评估要点?","竞品对标补充?"],
    stage: 2
  });
}

// ========== Report Generators ==========

async function generateVPSummary(ai, talents, jds, industry, role) {
  const highN = talents.filter(t=>t.tier==='high').length;
  const midN = talents.filter(t=>t.tier==='mid').length;
  const jdText = jds.slice(0,10).map(j=>j.snippet||'').join('\n').substring(0,3000);
  const prompt = `你是VP级战略顾问。为${industry}行业的${role}岗位写一份1页摘要(HTML格式,body内容):
1. 市场供需: 人才池大小, 竞争激烈度
2. 核心发现: JD中3个最重要的趋势变化
3. 人才分层: 高端${highN}人/中端${midN}人, 各层次定义
4. 建议: 招聘策略 + 时间线
5. 风险提示
白色背景, 专业简洁。JD数据: ${jdText}`;
  return await ai.chat(prompt, 2000);
}

async function generateMacroHtml(ai, talents, jds, industry, role) {
  const highT = talents.filter(t=>t.tier==='high').slice(0,10).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const midT = talents.filter(t=>t.tier==='mid').slice(0,10).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const jdText = jds.slice(0,12).map(j=>j.snippet||'').join('\n').substring(0,4000);
  const prompt = `为${industry}行业的${role}岗位生成HTML人才地图(VP级):
1. 市场JD分析: 共性要求, 趋势变化, 硬技能TOP8
2. 候选人画像: 经验分布, 公司来源, 薪酬对标
3. 高-中-低三档人才定义(附代表人物)
4. 高-中-低三档规律抽取: 专业/经验/能力的差异
5. 目标候选人画像建议
白色背景, body内容, 专业简洁。

高端候选人: ${highT}
中端候选人: ${midT}
JD数据: ${jdText}`;
  const html = await ai.chat(prompt, 3500);
  let t = html.trim();
  if (t.startsWith('```html')) t = t.split('\n').slice(1).join('\n');
  if (t.endsWith('```')) t = t.slice(0,-3);
  return t;
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
  await db.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, industry TEXT, role_direction TEXT, created_at TEXT DEFAULT (datetime()))");
  await db.execute("CREATE TABLE IF NOT EXISTS talents (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, name TEXT, current_company TEXT, current_title TEXT, city TEXT, skills TEXT, tier TEXT, source_platform TEXT, source_url TEXT, confidence REAL DEFAULT 0.5)");
  await db.execute("CREATE TABLE IF NOT EXISTS jds (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, title TEXT, company TEXT, salary TEXT, location TEXT, experience TEXT, education TEXT, skills TEXT, source_platform TEXT, source_url TEXT)");
}

async function storeResults(industry, role, talents, jds) {
  const db = turso();
  await db.execute("INSERT INTO positions (name, industry, role_direction) VALUES (?,?,?)", [role+'-'+industry, industry, role]);
  const pos = await db.execute("SELECT last_insert_rowid() as id");
  const pid = pos.rows?.[0]?.[0]?.value || pos.rows?.[0]?.[0] || 1;
  for (const t of talents.slice(0,30)) {
    const raw = t.title||''; const parts = raw.split(' - ').map(s=>s.trim());
    const name = (parts[0]||raw).substring(0,50);
    const current_title = (parts[1]||'').substring(0,100);
    const current_company = (t.company||parts[2]||'').substring(0,100);
    const tier = classifyTier(current_company, '', current_title);
    await db.execute("INSERT INTO talents (position_id, name, current_title, current_company, tier, source_platform, source_url, confidence) VALUES (?,?,?,?,?,?,?,?)", [pid, name, current_title, current_company, tier, 'linkedin', t.url||'', 0.8]);
  }
  for (const j of jds.slice(0,30)) {
    await db.execute("INSERT INTO jds (position_id, title, company, source_platform, source_url) VALUES (?,?,?,?,?)", [pid, (j.title||'').substring(0,100), (j.company||'').substring(0,100), 'websearch', j.url||'']);
  }
}
