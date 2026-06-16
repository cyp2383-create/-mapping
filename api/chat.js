/** POST /api/chat — 基于数据追问 + 智能候选人推荐 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  try {
    const { question, context, industry, role } = req.body;
    if (!question) return res.status(400).json({error:'Need question'});

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const dataSummary = `当前数据: ${talents.length}位候选人, ${jds.length}条JD。候选人来源: ${[...new Set(talents.map(t=>t.current_company))].slice(0,10).join(',')}`;
    const talentText = talents.slice(0,10).map(t => `${t.name}|${t.current_company}|${t.current_title}|tier:${t.tier||'?'}`).join('\n');

    // Step 1: Answer question strictly from data
    const answerPrompt = `你是人才分析助手。回答用户问题。

核心规则:
- 如果当前数据可以支撑回答, 引用具体数据(候选人姓名/公司/职位)
- 如果数据不足, 必须以"目前数据有限,我只能根据目前的数据和常识进行推理:"开头,然后给出合理推断
- 绝对不能编造不存在的数据或候选人

${dataSummary}
候选人清单: ${talentText}
用户问题: ${question}

用中文回答, 200字以内。`;

    const ansResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:answerPrompt}],temperature:0.3,max_tokens:500})
    });
    const ansData = await ansResp.json();
    const answer = ansData.choices?.[0]?.message?.content || '抱歉,暂时无法回答。';

    // Step 2: Match user needs against talent pool
    let recommendations = [];
    if (talents.length > 0) {
      const matchPrompt = `基于用户问题"${question}",从以下候选人中推荐最匹配的2-3人。
返回JSON: [{"name":"姓名","reason":"一句话理由(15字内)"}]
如果没有匹配的,返回空数组[]。
候选人: ${talentText}`;
      try {
        const matchResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
          body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:matchPrompt}],temperature:0.1,max_tokens:300})
        });
        const matchData = await matchResp.json();
        let matchText = matchData.choices?.[0]?.message?.content?.trim() || '[]';
        if (matchText.startsWith('```')) matchText = matchText.replace(/```json?|```/g,'');
        recommendations = JSON.parse(matchText);
      } catch(e) { recommendations = []; }
    }

    // Step 3: Generate follow-up suggestions
    let suggestions = [];
    if (talents.length > 0) {
      const sugPrompt = `基于用户问题"${question}"和${talents.length}位候选人数据,引导用户描述其公司具体场景来精准匹配。
生成3个追问问题(10字以内), 例如:"团队规模多大?""需要解决什么业务问题?""预算范围?"
返回JSON字符串数组。`;
      try {
        const sugResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
          body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:sugPrompt}],temperature:0.5,max_tokens:200})
        });
        const sugData = await sugResp.json();
        let sugText = sugData.choices?.[0]?.message?.content?.trim() || '[]';
        if (sugText.startsWith('```')) sugText = sugText.replace(/```json?|```/g,'');
        suggestions = JSON.parse(sugText);
      } catch(e) { suggestions = []; }
    }

    res.json({ answer, recommendations, suggestions });
  } catch(e) { res.status(500).json({error:e.message}); }
}
