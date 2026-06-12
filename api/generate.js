/** POST /api/generate — 全流程人才地图生成 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  try {
    const { industry, role, city } = req.body;
    if (!industry || !role) return res.status(400).json({error:'Need industry and role'});

    const deepseek = createDeepSeek();
    const tavily = createTavily();

    await initTables();

    const companies = await generateCompanies(deepseek, industry, role);
    const jds = await searchJDs(tavily, companies, role);
    const talents = await searchLinkedIn(tavily, companies.slice(0,6), role);

    // Store FIRST (before slow report generation)
    await storeResults(industry, role, talents, jds);

    const reportHtml = await generateReport(deepseek, talents, jds, industry, role);

    // Transform to frontend-friendly format
    const talentRows = talents.slice(0, 30).map(t => {
      const raw = t.title || '';
      const parts = raw.split(' - ').map(s => s.trim());
      return {
        name: parts[0] || raw.substring(0,30),
        current_title: parts[1] || '',
        current_company: t.company || parts[2] || '',
        city: '',
        skills: '',
        source_platform: 'linkedin',
        source_url: t.url || '',
        contact_type: t.url ? 'linkedin' : 'none',
        contact_value: t.url || '',
        confidence: 0.8
      };
    });
    const jdRows = jds.slice(0, 30).map(j => ({
      title: j.title || '',
      company: j.company || '',
      salary: j.salary || '',
      location: '',
      experience: '',
      skills: '',
      source_platform: 'websearch',
      source_url: j.url || ''
    }));

    res.json({
      talents: talentRows,
      jds: jdRows,
      report_html: reportHtml,
      companies: companies.slice(0, 10).map(c => c.name),
    });
  } catch(e) {
    res.status(500).json({error: e.message, stack: e.stack});
  }
}

// ========== API Clients ==========

function createDeepSeek() {
  return {
    chat: async (prompt, maxTokens=2000) => {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:maxTokens})
      });
      const d = await resp.json();
      return d.choices?.[0]?.message?.content || '';
    }
  };
}

function createTavily() {
  return {
    search: async (query, maxResults=5) => {
      const resp = await fetch('https://api.tavily.com/search', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({api_key:process.env.TAVILY_KEY, query, max_results:maxResults, search_depth:'advanced'})
      });
      const d = await resp.json();
      return (d.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.content?.substring(0,500)||''}));
    }
  };
}

// ========== Pipeline Steps ==========

async function generateCompanies(ai, industry, role) {
  const prompt = `你是猎头顾问。为"${industry}"行业的"${role}"列出10家最重要的公司。按梯队。JSON数组: [{"name":"公司","tier":"第一梯队","size":"X万+","reason":"理由"}]`;
  const text = await ai.chat(prompt, 1500);
  try {
    let t = text.trim();
    if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
    if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return [{name:'字节跳动',tier:'第一梯队'},{name:'阿里巴巴',tier:'第一梯队'},{name:'腾讯',tier:'第一梯队'},{name:'百度',tier:'第一梯队'},{name:'美团',tier:'第二梯队'}]; }
}

async function searchJDs(tav, companies, role) {
  const jds = [];
  const batch = companies.slice(0, 10);
  const promises = batch.map(async c => {
    const results = await tav.search(`${c.name} ${role} 招聘 岗位职责 任职要求`, 3);
    return results.map(r => ({...r, company:c.name}));
  });
  const all = await Promise.all(promises);
  all.forEach(arr => jds.push(...arr));
  // Extract structured JD info with DeepSeek
  return jds.slice(0, 25);
}

async function searchLinkedIn(tav, companies, role) {
  const people = [];
  const batch = companies.slice(0, 6);
  const promises = batch.map(async c => {
    const results = await tav.search(`site:linkedin.com/in/ "${role}" "${c.name}"`, 3);
    return results.map(r => ({...r, company:c.name}));
  });
  const all = await Promise.all(promises);
  all.forEach(arr => people.push(...arr));
  return people.slice(0, 25);
}

async function generateReport(ai, talents, jds, industry, role) {
  const talentText = talents.slice(0,15).map(t=>`${t.snippet||''}`).join('\n');
  const jdText = jds.slice(0,10).map(j=>`${j.snippet||''}`).join('\n');
  const prompt = `基于${talents.length}条候选人数据和${jds.length}条JD数据，为${industry}行业的${role}岗位生成一份HTML人才画像报告。
板块: 1)市场需要怎样的人-硬技能/经验/学历/薪酬 2)这些都是什么人-公司/职位/背景。
每条数据标注[JD数据]或[候选人数据]。白色背景，只输出body内容。
候选人:${talentText.substring(0,4000)} JD:${jdText.substring(0,4000)}`;
  const html = await ai.chat(prompt, 4000);
  let t = html.trim();
  if (t.startsWith('```html')) t = t.split('\n').slice(1).join('\n');
  if (t.endsWith('```')) t = t.slice(0,-3);
  return t;
}

function turso() {
  return {
    execute: async (sql, params=[]) => {
      const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.TURSO_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{ type: 'execute', stmt: { sql, params: params.map(String) } }]
        })
      });
      const d = await resp.json();
      const r = d.results?.[0]?.response?.result;
      return { rows: r?.rows || [], lastInsertId: r?.last_insert_rowid };
    }
  };
}

async function initTables() {
  const db = turso();
  await db.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, industry TEXT, role_direction TEXT, created_at TEXT DEFAULT (datetime()))");
  await db.execute("CREATE TABLE IF NOT EXISTS talents (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, name TEXT, current_company TEXT, current_title TEXT, city TEXT, skills TEXT, source_platform TEXT, source_url TEXT, confidence REAL DEFAULT 0.5)");
  await db.execute("CREATE TABLE IF NOT EXISTS jds (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, title TEXT, company TEXT, salary TEXT, location TEXT, experience TEXT, education TEXT, skills TEXT, source_platform TEXT, source_url TEXT)");
}

async function storeResults(industry, role, talents, jds) {
  const db = turso();
  try {
    // Create position
    const ins = await db.execute(
      "INSERT INTO positions (name, industry, role_direction) VALUES (?,?,?)",
      [role + '-' + industry, industry, role]
    );
    console.log('Position insert result:', JSON.stringify(ins));

    const pos = await db.execute("SELECT last_insert_rowid() as id");
    const pid = pos.rows?.[0]?.[0]?.value || pos.rows?.[0]?.[0] || 1;
    console.log('Position ID:', pid);

    // Store first talent as test
    if (talents.length > 0) {
      const t = talents[0];
      const raw = t.title || '';
      const parts = raw.split(' - ').map(s => s.trim());
      const name = (parts[0] || raw).substring(0,50);
      const current_title = (parts[1] || '').substring(0,100);
      const current_company = (t.company || parts[2] || '').substring(0,100);
      const result = await db.execute(
        "INSERT INTO talents (position_id, name, current_title, current_company, source_platform, source_url, confidence) VALUES (?,?,?,?,?,?,?)",
        [pid, name, current_title, current_company, 'linkedin', t.url||'', 0.8]
      );
      console.log('Talent insert result:', JSON.stringify(result));
    }

    // Store first JD as test
    if (jds.length > 0) {
      const j = jds[0];
      const result = await db.execute(
        "INSERT INTO jds (position_id, title, company, source_platform, source_url) VALUES (?,?,?,?,?)",
        [pid, (j.title||'').substring(0,100), (j.company||'').substring(0,100), 'websearch', j.url||'']
      );
      console.log('JD insert result:', JSON.stringify(result));
    }

    console.log(`Stored: 1 test talent + 1 test JD for position ${pid}`);
  } catch(e) {
    console.log('storeResults error:', e.message, e.stack);
  }
}
