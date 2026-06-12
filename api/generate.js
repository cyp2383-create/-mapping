/** POST /api/generate — 全流程人才地图生成 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { industry, role, city } = req.body;
  if (!industry || !role) return res.status(400).json({error:'Need industry and role'});

  const deepseek = createDeepSeek();
  const tavily = createTavily();

  // Step 1: Generate target companies
  const companies = await generateCompanies(deepseek, industry, role);
  // Step 2: Search JDs (parallel)
  const jds = await searchJDs(tavily, companies, role);
  // Step 3: Search LinkedIn (parallel, sample 8 companies)
  const talents = await searchLinkedIn(tavily, companies.slice(0,8), role);
  // Step 4: Generate report
  const reportHtml = await generateReport(deepseek, talents, jds, industry, role);

  // Step 5: Store in Turso
  await storeResults(industry, role, talents, jds);

  res.json({
    talents: talents.slice(0, 30),
    jds: jds.slice(0, 30),
    report_html: reportHtml,
    companies: companies.slice(0, 10).map(c => c.name),
  });
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

async function storeResults(industry, role, talents, jds) {
  // Turso storage placeholder — will be implemented after Turso setup
  console.log(`Storing: ${talents.length} talents, ${jds.length} JDs for ${role} in ${industry}`);
}
