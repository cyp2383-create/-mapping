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
    const reportHtml = await generateReport(deepseek, talents, jds, industry, role);

    await storeResults(industry, role, talents, jds);

    res.json({
      talents: talents.slice(0, 30),
      jds: jds.slice(0, 30),
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
  const prompt = `Based on ${talents.length} candidates and ${jds.length} JDs about ${role} in ${industry}, generate a concise HTML talent profile report. Sections: 1)Market demand - skills/exp/salary from JDs 2)Who are these people - from candidates. Mark [JD data]/[Candidate data]. Clean white HTML, body only. Candidates:${talentText.substring(0,4000)} JDs:${jdText.substring(0,4000)}`;
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
  // Create position
  await db.execute(
    "INSERT INTO positions (name, industry, role_direction) VALUES (?,?,?)",
    [role + '-' + industry, industry, role]
  );
  const pos = await db.execute("SELECT last_insert_rowid() as id");
  const pid = pos.rows?.[0]?.[0]?.value || pos.rows?.[0]?.[0] || 1;

  // Store talents
  for (const t of talents.slice(0, 30)) {
    await db.execute(
      "INSERT INTO talents (position_id, name, current_title, current_company, city, skills, source_platform, source_url, confidence) VALUES (?,?,?,?,?,?,?,?,?)",
      [pid, t.name||'', t.title||'', t.company||'', t.city||'', '[]', 'linkedin', t.url||'', 0.85]
    );
  }
  // Store JDs
  for (const j of jds.slice(0, 30)) {
    await db.execute(
      "INSERT INTO jds (position_id, title, company, salary, location, experience, source_platform, source_url) VALUES (?,?,?,?,?,?,?,?)",
      [pid, j.title||'', j.company||'', '', '', '', 'websearch', j.url||'']
    );
  }
  console.log(`Stored: ${talents.length} talents, ${jds.length} JDs for position ${pid}`);
}
