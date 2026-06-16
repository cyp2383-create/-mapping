/** POST /api/chat — 智能追问: 数据推理 + 业务引导 + 挖人推荐 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  try {
    const { question, context } = req.body;
    if (!question) return res.status(400).json({error:'Need question'});

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const companies = [...new Set(talents.map(t=>t.current_company).filter(Boolean))].slice(0,10);

    // Detect intent: business inquiry
    const isBusinessQ = /业务|方向|战略|转型|布局|做什么|发展|挖人|推荐|优势|劣势|哪个公司|哪家公司/.test(question);

    if (isBusinessQ && companies.length > 0) {
      // === Business Analysis Mode ===
      const dataSummary = `候选人分布在${companies.length}家公司: ${companies.join(',')}。JD数据${jds.length}条。`;
      const talentSample = talents.slice(0,8).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');

      const prompt = `你是企业战略分析师。基于以下招聘市场数据，分析主要大厂的业务方向和人才策略。

核心规则:
- 只基于数据中出现的公司和岗位推理，不编造不存在的业务线
- 不提及具体人数、金额、规模等精确数字
- 推理聚焦于业务方向、技术投入重点、人才偏好
- 每个公司1-2句话

数据: ${dataSummary}
候选人: ${talentSample}
用户问题: ${question}

用中文回答, 300字以内。按以下结构:
1. 数据观察到的大厂业务方向(基于JD和候选人来源推断)
2. 引导用户"您的业务场景是什么? 我可以帮您分析从哪些公司挖人有优势"
3. 如果用户已描述业务, 推荐2-3家公司并说明从每家挖人的优势和劣势`;

      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.3,max_tokens:800})
      });
      const d = await resp.json();
      const answer = d.choices?.[0]?.message?.content || '抱歉';

      // Generate follow-up suggestions
      const sugPrompt = `基于用户问题"${question}", 生成3个引导用户描述其业务的追问(10字内)。JSON数组。`;
      let suggestions = [];
      try {
        const sr = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
          body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:sugPrompt}],temperature:0.5,max_tokens:150})
        });
        const sd = await sr.json();
        let st = sd.choices?.[0]?.message?.content?.trim() || '[]';
        if (st.startsWith('```')) st = st.replace(/```json?|```/g,'');
        suggestions = JSON.parse(st);
      } catch(e) { suggestions = ["您的业务方向是?","团队规模和阶段?"]; }

      return res.json({ answer, suggestions, recommendations: [] });
    }

    // === Standard Q&A Mode ===
    const dataSummary = `当前数据: ${talents.length}位候选人, ${jds.length}条JD。`;
    const talentText = talents.slice(0,8).map(t => `${t.name}|${t.current_company}|${t.current_title}`).join('\n');

    const answerPrompt = `你是人才分析助手。回答用户问题。
核心规则:
- 如果当前数据可以支撑回答, 引用具体候选人数据
- 如果数据不足, 以"目前数据有限,我只能根据常识推理:"开头
- 绝对不能编造不存在的数据或候选人
${dataSummary} 候选人清单: ${talentText} 用户问题: ${question} 用中文回答, 200字以内。`;

    const ansResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:answerPrompt}],temperature:0.3,max_tokens:500})
    });
    const ansData = await ansResp.json();
    const answer = ansData.choices?.[0]?.message?.content || '抱歉';

    // Candidate matching
    let recommendations = [];
    if (talents.length > 0) {
      const matchPrompt = `基于"${question}",从以下候选人推荐最匹配2人。JSON:[{"name":"","reason":"15字内"}] 无匹配返回[]。${talentText}`;
      try {
        const mr = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
          body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:matchPrompt}],temperature:0.1,max_tokens:250})
        });
        const md = await mr.json();
        let mt = md.choices?.[0]?.message?.content?.trim() || '[]';
        if (mt.startsWith('```')) mt = mt.replace(/```json?|```/g,'');
        recommendations = JSON.parse(mt);
      } catch(e) {}
    }

    // Suggestions
    let suggestions = [];
    try {
      const sp = `基于"${question}"和${talents.length}位候选人,生成3个追问(10字内)引导用户描述业务场景。JSON数组。`;
      const sr = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:sp}],temperature:0.5,max_tokens:150})
      });
      const sd = await sr.json();
      let st = sd.choices?.[0]?.message?.content?.trim() || '[]';
      if (st.startsWith('```')) st = st.replace(/```json?|```/g,'');
      suggestions = JSON.parse(st);
    } catch(e) { suggestions = []; }

    res.json({ answer, recommendations, suggestions });
  } catch(e) { res.status(500).json({error:e.message}); }
}
