/** POST /api/chat — 对当前报告追问 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { question, context } = req.body;
  if (!question) return res.status(400).json({error:'Need question'});

  const prompt = `你是人才分析助手。基于当前人才地图数据回答用户问题。
回答简洁，引用数据中的具体信息。如果数据不足以回答，诚实说明。

当前报告数据: ${JSON.stringify(context).substring(0, 4000)}

用户问题: ${question}`;

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
    body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.3,max_tokens:1500})
  });
  const d = await resp.json();
  const answer = d.choices?.[0]?.message?.content || '抱歉，暂时无法回答。';

  res.json({ answer });
}
