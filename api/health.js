/** GET /api/health — connectivity check */
export default async function handler(req, res) {
  const results = {};

  // Test DeepSeek
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'hi'}],max_tokens:5})
    });
    results.deepseek = r.ok ? 'OK' : `HTTP ${r.status}`;
  } catch(e) { results.deepseek = e.message; }

  // Test Tavily
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:process.env.TAVILY_KEY, query:'test', max_results:1})
    });
    results.tavily = r.ok ? 'OK' : `HTTP ${r.status}`;
  } catch(e) { results.tavily = e.message; }

  // Test Turso
  try {
    const r = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method:'POST',
      headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:'SELECT 1'}}]})
    });
    results.turso = r.ok ? 'OK' : `HTTP ${r.status}`;
  } catch(e) { results.turso = e.message; }

  // Check env vars
  results.env = {
    DEEPSEEK_KEY: process.env.DEEPSEEK_KEY ? 'set' : 'MISSING',
    TAVILY_KEY: process.env.TAVILY_KEY ? 'set' : 'MISSING',
    TURSO_URL: process.env.TURSO_URL ? 'set' : 'MISSING',
    TURSO_TOKEN: process.env.TURSO_TOKEN ? 'set' : 'MISSING',
  };

  res.json(results);
}
