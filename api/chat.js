/** POST /api/chat — 猎头顾问: 动态追问 → 人才画像报告 */
import { streamDeepSeek } from './report-builder.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { question, context, action } = req.body;
    if (!question) { send({step:'error',text:'Need question'}); res.end(); return; }

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const companies = [...new Set(talents.map(t=>t.current_company).filter(Boolean))].slice(0,10);

    // Build conversation history (up to last 6 messages for context)
    const history = (context?.history || []).slice(-6);

    if (action === 'generate') {
      // User explicitly wants the full talent persona report
      await generatePersonaReport(question, talents, jds, companies, history, send);
    } else {
      // Normal conversation: understand → ask OR offer report
      await handleConversation(question, talents, jds, companies, history, send);
    }
    res.end();
  } catch(e) { send({step:'error',text:e.message}); res.end(); }
}

// ===== Main Conversation Handler =====

async function handleConversation(question, talents, jds, companies, history, send) {
  send({step:'progress',text:'正在分析你的需求...'});

  const talentSummary = talents.slice(0, 8).map(t =>
    `${t.name}|${t.current_company}|${t.current_title}`
  ).join('\n');
  const companyList = companies.join('、');
  const jdExcerpts = jds.slice(0, 6).map(j =>
    `${j.company}: ${j.title} — ${(j.snippet||'').substring(0, 150)}`
  ).join('\n');

  const historyText = history.map(h =>
    `${h.role==='user'?'客户':'我'}: ${h.content}`
  ).join('\n');

  const conversationRounds = history.filter(h => h.role === 'user').length;

  const prompt = `你是资深猎头顾问，正在和客户进行招聘需求沟通。这是第${conversationRounds + 1}轮对话。

## 核心规则（必须遵守）
1. **每轮必须引用至少1条市场数据**：从JD或候选人中找一个具体洞察（如"我看到XX公司的JD要求YY能力"、"目前数据中有N位来自XX的候选人"），用数据增加专业感，不要只说空话。
2. **禁止重复追问**：对话历史中已经问过的问题绝对不能再问。如果卡住了，给2-3个具体选项让客户选，而不是继续追问开放问题。
3. **及时收束**：第1-2轮可以追问细节。第3轮起，在回复开头给出阶段性判断（"根据目前的沟通，我初步判断你需要..."）。第4轮及以后，必须设置 offer_report=true 并引导客户生成画像。
4. **不要列清单**：像猎头一样对话，不打分、不列维度表。

## 市场数据（必须引用）
候选人在这些公司: ${companyList}
JD片段: ${jdExcerpts}

## 对话历史
${historyText || '(第一轮)'}

## 客户消息
${question}

## 回复结构
1. 先acknowledge + 引用一条数据洞察
2. 如果需要更多信息：追问1个最关键问题（给2-3个选项让客户选，不要开放题）
3. 如果信息够了：简要总结理解 + offer_report=true
4. 如果这是第4轮或更后：offer_report=true

## JSON返回
{
  "message": "HTML格式回复(深色主题, 自然对话, 150字内)",
  "offer_report": true/false,
  "understanding": "一句话总结(offer_report=true时必填)",
  "suggestions": ["快捷选项1", "快捷选项2"]
}

## message格式
- 数据引用用 <span style="color:#f59e0b">...</span> 高亮
- 追问选项用序号列出，简洁明了
- 不用h3/h4，保持聊天轻量感`;

  const raw = await streamDeepSeek(prompt, 800, (chars) => {
    send({step:'progress',text:`正在组织回复...${chars}字`});
  });

  try {
    let t = raw.trim();
    if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
    const result = JSON.parse(t);
    send({step:'done', message:result.message, offer_report:result.offer_report||false, understanding:result.understanding||'', suggestions:result.suggestions||[]});
  } catch(e) {
    // Fallback: return raw text as message
    send({step:'done', message:raw, offer_report:false, understanding:'', suggestions:[]});
  }
}

// ===== Report Generation =====

async function generatePersonaReport(question, talents, jds, companies, history, send) {
  send({step:'progress',text:'正在匹配市场数据...'});

  const talentSummary = talents.map(t =>
    `${t.name}|${t.current_company}|${t.current_title}|${t.level||''}`
  ).join('\n');
  const jdSummary = jds.map(j =>
    `${j.title}|${j.company}|${j.salary||'?'}|${j.experience||'?'}|${(j.snippet||'').substring(0,200)}`
  ).join('\n');

  const historyText = history.map(h =>
    `${h.role==='user'?'客户':''}: ${h.content}`
  ).join('\n');

  const prompt = `你是资深猎头顾问。基于和客户的沟通以及市场数据，为客户生成一份人才画像报告。

## 客户需求（来自对话）
${historyText}
最新问题: ${question}

## 市场数据
候选人(${talents.length}人): ${talentSummary}
JD(${jds.length}条): ${jdSummary}

## 任务

按以下结构输出（主要篇幅在1-3，4较简短）：

### 1. 你该招一个怎样的人（核心画像）
- 一句话定位这个候选人
- 硬技能清单（5-8个）
- 软技能与特质（3-5个）
- 理想的背景特征（从哪些公司、什么级别、主导过什么类型的项目）
- 面试时重点考察什么（3个关键问题方向）

### 2. 市场对标
从数据中找出与客户业务相关的公司，每家公司1句：他们在做什么、为什么值得挖。按相关性排序。

### 3. JD中的能力信号
从收集到的JD中提炼：这些公司在招人时最看重哪些能力，和客户需求是否一致。

### 4. 推荐候选人（简短，按匹配度排序）
从以下候选人中选最匹配的2-3位，每人1句推荐理由：
${talentSummary}

## 规则
- 所有建议基于数据和对话，不编造
- 候选人推荐优先高相关性公司
- 输出HTML body，深色主题(#151525背景,#f5f5f5文字,#f59e0b强调,毛玻璃卡片)
- h3金色标题, p/ul/li正文, 卡片:background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:12px`;

  const answer = await streamDeepSeek(prompt, 3000, (chars) => {
    send({step:'progress',text:`正在生成报告...${chars}字`});
  });

  send({step:'report', answer});
}