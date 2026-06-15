/** POST /api/regenerate — 从历史数据重新生成报告 (SSE streaming) */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { position_id } = req.body;
  if (!position_id) return res.status(400).json({error:'Need position_id'});

  // SSE headers
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Read stored data
    const dbResp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:'SELECT talent_data, jd_data, industry, role_direction FROM positions WHERE id='+Number(position_id)}}]})
    });
    const dbData = await dbResp.json();
    const result = dbData.results?.[0]?.response?.result;
    if (!result || !result.rows.length) { send({error:'Position not found'}); res.end(); return; }

    const row = result.rows[0];
    const v = (i) => (row[i] && row[i].value) || '';
    const talents = JSON.parse(v(0) || '[]');
    const jds = JSON.parse(v(1) || '[]');
    const industry = v(2) || 'Industry';
    const role = v(3) || 'Role';

    const tText = talents.slice(0,15).map(t => `${t.name||'?'}|${t.current_company||''}|${t.current_title||''}`).join('\n');
    const jText = jds.slice(0,15).map(j => `${j.title||''}|${j.company||''}`).join('\n');

    const prompt = `为${industry}行业的${role}岗位生成详细HTML人才画像报告。
深色主题: 背景#10101c, 卡片rgba(255,255,255,.03), 文字#f5f5f5, 强调色#f59e0b。
5个板块(标注[JD数据]或[候选人数据]):
1. 市场JD分析: 共性要求, 硬技能TOP10
2. 候选人画像: 公司/职级分布, 薪酬对标
3. 高-中-低三档定义(附代表人物)
4. 三档规律抽取: 专业/经验/能力的差异
5. VP建议: 招聘策略+时间线+风险

候选人: ${tText}
JD: ${jText}`;

    // Stream from DeepSeek
    const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:3500,stream:true})
    });

    const reader = aiResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '', startTime = Date.now();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const chunk = line.slice(6);
        if (chunk === '[DONE]') continue;
        try {
          const parsed = JSON.parse(chunk);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          fullText += delta;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          send({step:'progress', chars: fullText.length, elapsed: elapsed, text: `已生成${fullText.length}字 (${elapsed}秒)`});
        } catch(e) {}
      }
    }

    // Clean: strip any text before first HTML tag, remove code fences
    let html = fullText.trim();
    const tagStart = html.indexOf('<');
    if (tagStart > 0) html = html.substring(tagStart);
    if (html.startsWith('```html')) html = html.split('\n').slice(1).join('\n');
    if (html.startsWith('```')) html = html.split('\n').slice(1).join('\n');
    if (html.endsWith('```')) html = html.slice(0,-3);
    html = html.trim();
    send({step:'done', report_html: html, chars: html.length});
    res.end();
  } catch(e) {
    send({error: e.message});
    res.end();
  }
}
