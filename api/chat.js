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

  const prompt = `你是资深猎头顾问，正在和客户进行招聘需求沟通。你不是客服，不是问卷系统——你是专业的猎头顾问，用对话了解客户需求。

## 你的专业准则
- 像猎头一样对话，不列清单、不打分、不展示雷达图
- 每一轮只追问当前最关键缺失的1-2个信息，基于上一轮客户的回答动态推理下一步问什么
- 先 acknowledge 客户说的话（表示你理解了），再自然追问
- 如果客户描述模糊，帮助他理清思路：给1-2个具体场景让他选（如"你们是做招聘模块的AI还是全人力六大模块？"）
- 用已有的市场数据做参照（如"我看到 XX 公司在做类似的事，他们招人时看重 YY 能力，这和你的预期一致吗？"）

## 已收集的市场数据（供你参考，不要全部列出来）
候选人分布在: ${companyList}
部分JD: ${jdExcerpts}
候选人样本: ${talentSummary}

## 对话历史
${historyText || '(这是第一轮对话)'}

## 客户最新消息
${question}

## 你的任务
1. 判断：目前对客户需求的理解程度（业务目标、岗位定位、关键要求）
2. 如果信息还不够 → acknowledge 已了解的部分 + 追问最关键缺失
3. 如果信息已经比较充分 → 总结你的理解 + 设置 offer_report=true

## 返回JSON
{
  "message": "你的回复(用HTML, 深色主题, 自然对话风格, 150字内, 不要太长)",
  "offer_report": true/false,
  "understanding": "对客户需求的一句话总结(仅offer_report=true时需要)",
  "suggestions": ["快捷追问1", "快捷追问2"]
}

## message格式
- 用自然对话语气，像猎头和客户聊天
- 适当引用市场数据（"我看到XX公司在做..."）增加专业感
- HTML用p标签，深色主题内联样式: color:#e0e0e0; 强调用 color:#f59e0b
- 不要用h3/h4标题，保持聊天消息的轻量感`;

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