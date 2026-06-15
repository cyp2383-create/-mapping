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

    const prompt = `为${industry}行业的${role}岗位生成一份咨询级HTML人才地图报告。
深色主题: 背景#10101c, 卡片rgba(255,255,255,.03), 文字#f5f5f5, 强调色#f59e0b。

报告分两大部分:
=== 第一部分: 数据整理总结 [标注数据来源] ===
1. 市场JD分析: 共性要求统计, 硬技能TOP10出现频次, 学历/经验门槛分布
2. 候选人画像: 公司来源分布, 职级统计, 典型背景特征
3. 薪酬对标: 按级别给出市场薪酬区间估算[AI推理,基于行业经验]

=== 第二部分: 推理分析 [标注为分析洞察] ===
4. 高端vs中端候选人的分水岭: 不是年限, 而是哪些关键经历/能力?
5. 典型职业路径: 这个岗位的人通常从什么角色晋升而来, 下一步去向哪里
6. 人才特征素描: 高/中/低三档人才在专业深度、业务理解、管理能力的差异
7. 招聘策略建议: 优先挖哪些公司, 面试关注什么, 入职后90天预期

候选人数据: ${tText}
JD数据: ${jText}`;

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
