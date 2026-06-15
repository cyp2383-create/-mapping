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

    const prompt = `为${industry}行业的${role}岗位生成一份结构化HTML人才地图报告。
深色主题: 背景#10101c, 卡片rgba(255,255,255,.03), 文字#f5f5f5, 强调色#f59e0b。

报告必须严格按照以下三段结构:

=== 第一部分: 看板 (紧凑,占页面20%) ===
用CSS conic-gradient画3个饼图(内联CSS,不用JS): 学历分布 / 公司来源分布 / 职级分布。
每个饼图旁边列出TOP5带百分比的小字说明。饼图直径不超过120px。
然后列出硬技能TOP10(小标签形式)。

=== 第二部分: 技能×经验矩阵 (核心,占页面50%) ===
一个表格,列为经验阶段: 校招生(0-1年) | 1-3年 | 3-5年 | 5年以上。
行为技能维度。每个单元格填入:
- 该阶段典型掌握的技能 (从JD数据提取)
- 一个具体场景例子 (如\"主导过从0到1的Agent产品落地,DAU从0到10万\")
- 如果有小众/稀缺技能,标记⭐并说明得分
- AI推理的技能热度得分 (1-10分)

=== 第三部分: 人才匹配度公式 (推理,占页面30%) ===
AI定义一个数学公式: Score = w1*A + w2*B + w3*C + w4*D + w5*E
解释每个字母:
A=硬技能匹配度(基于TOP10技能覆盖), 权重w1, 为什么?
B=经验年限匹配度, 权重w2
C=公司背景匹配度(是否来自目标公司), 权重w3
D=项目成果匹配度(是否有类似场景经验), 权重w4
E=稀缺技能加分, 权重w5
给出每项的满分值和评分标准。

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
