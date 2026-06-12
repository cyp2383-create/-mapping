/** POST /api/chat — 智能追问：分析现有数据 or 触发新搜索 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  try {
    const { question, context } = req.body;
    if (!question) return res.status(400).json({error:'Need question'});

    // Step 1: Decide if we need to search more
    const decisionPrompt = `Given this talent data (${context.talents?.length||0} candidates, ${context.jds?.length||0} JDs) and the question "${question}",
should we SEARCH for more data or ANALYZE existing data?
- Return "SEARCH" if: data is clearly insufficient, user wants newer data, or user asks about companies/people not in the data
- Return "ANALYZE" if: existing data can reasonably answer the question
Return only SEARCH or ANALYZE.`;

    const decResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:decisionPrompt}],temperature:0,max_tokens:10})
    });
    const decData = await decResp.json();
    const decision = decData.choices?.[0]?.message?.content?.trim() || 'ANALYZE';

    // Step 2: Execute
    if (decision === 'SEARCH' && process.env.TAVILY_KEY) {
      // Quick search for supplementary data
      const searchResp = await fetch('https://api.tavily.com/search', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({api_key:process.env.TAVILY_KEY, query:question, max_results:3, search_depth:'basic'})
      });
      const searchData = await searchResp.json();
      const snippets = (searchData.results||[]).map(r=>r.content?.substring(0,300)||'').join('\n');

      const answerPrompt = `你是人才分析助手。基于搜索补充的最新数据回答用户问题。引用具体信息。搜索补充: ${snippets.substring(0,2000)} 原始数据: ${JSON.stringify(context).substring(0,2000)} 问题: ${question}`;
      const ansResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:answerPrompt}],temperature:0.3,max_tokens:1200})
      });
      const ansData = await ansResp.json();
      res.json({ answer: ansData.choices?.[0]?.message?.content || '抱歉', searched: true });
    } else {
      // Analyze existing data
      const answerPrompt = `你是人才分析助手。仅基于当前人才地图数据回答用户问题。引用数据中的具体信息。如果数据不足以回答，诚实说明并建议补充搜索的方向。数据: ${JSON.stringify(context).substring(0,4000)} 问题: ${question}`;
      const ansResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:answerPrompt}],temperature:0.3,max_tokens:1200})
      });
      const ansData = await ansResp.json();
      res.json({ answer: ansData.choices?.[0]?.message?.content || '抱歉', searched: false });
    }
  } catch(e) { res.status(500).json({error:e.message}); }
}
