/** POST /api/chat — 猎头翻译官: 业务语言↔人才市场语言 */
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
    if (!question) { send({step:'error',text:'请输入问题'}); res.end(); return; }

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const companies = [...new Set(talents.map(t=>t.current_company).filter(Boolean))].slice(0,10);
    const history = (context?.history || []).slice(-20);

    if (action === 'generate') {
      await generateReport(question, talents, jds, companies, history, send);
    } else {
      await translate(question, talents, jds, companies, history, send);
    }
    res.end();
  } catch(e) { send({step:'error',text:e.message}); res.end(); }
}

// ===== Main: Translator =====

async function translate(question, talents, jds, companies, history, send) {
  send({step:'progress',text:'理解需求中...'});

  const rounds = history.filter(h => h.role === 'user').length;
  const remaining = Math.max(0, 10 - rounds);

  const historyText = history.map(h =>
    `${h.role==='user'?'业务方':'翻译官'}: ${h.content}`
  ).join('\n');

  const companyList = companies.join('、');
  const jdExcerpts = jds.slice(0, 5).map(j =>
    `${j.company}: ${j.title} — ${(j.snippet||'').substring(0, 120)}`
  ).join('\n');

  const prompt = `你是「猎头翻译官」—— 你的角色是连接业务方和猎头市场的桥梁。

## 背景
业务方很懂自己的业务，但不清楚:
1. 市场上有什么样的人才
2. 怎么把业务需求翻译成人才画像
3. 如何高效和猎头沟通要找什么人

你的工作: 帮业务方理清思路，把模糊的业务描述转化为精准的人才画像，并指出他们对市场认知的偏差。

## 核心规则
1. **先判断输入是否和招聘/人才相关**。如果用户聊天气、闲聊、问无关问题 → 礼貌驳回，不计入轮次。回复JSON: {"reject":true,"message":"驳回理由(1句话)"}
2. **有效对话最多10轮**。当前第${rounds+1}轮，剩余${remaining}轮。
3. 如果已经是第8轮或更后 → offer_report=true
4. 如果信息足够(业务目标+岗位定位基本清晰) → offer_report=true

## 你的回复方式
- 先acknowledge业务方的描述，帮他把模糊需求**翻译成猎头能听懂的人才语言**
- 如果用户说"我还没想好"、"帮我理思路"等 → 基于市场数据，给他3个不同方向的思路选项（如"目前市场上有3类典型画像: A类侧重XX, B类侧重YY, C类侧重ZZ，你对哪个方向更感兴趣？"）
- 如果他的认知和市场数据有差距，**指出来**
- 追问时给2-3个具体选项，不要开放题
- **引用市场数据**增加说服力

## 市场数据
候选人公司: ${companyList}
JD参考: ${jdExcerpts}

## 对话历史
${historyText || '(第一轮)'}

## 业务方消息
${question}

## 返回JSON
{
  "reject": true/false,
  "message": "回复(HTML,深色主题,自然对话,200字内)",
  "offer_report": true/false,
  "understanding": "一句话总结理解(offer_report=true时需要)",
  "remaining": ${remaining},
  "suggestions": ["选项1","选项2"]
}`;

  const raw = await streamDeepSeek(prompt, 1000, (chars) => {
    send({step:'progress',text:`组织回复...${chars}字`});
  });

  try {
    let t = raw.trim();
    if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
    const result = JSON.parse(t);
    if (result.reject) {
      send({step:'done', message:result.message, offer_report:false, remaining:remaining, suggestions:[]});
    } else {
      send({step:'done', message:result.message, offer_report:result.offer_report||false, understanding:result.understanding||'', remaining:result.remaining||remaining, suggestions:result.suggestions||[]});
    }
  } catch(e) {
    send({step:'done', message:raw, offer_report:false, remaining:remaining, suggestions:[]});
  }
}

// ===== Report Generator =====

async function generateReport(question, talents, jds, companies, history, send) {
  // Check if enough information was collected
  const userMsgs = history.filter(h => h.role === 'user');
  if (userMsgs.length < 2) {
    send({step:'warning', message:'<div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.15);border-radius:12px;padding:16px;text-align:center"><p style="color:#fcd34d;margin:0 0 8px"><strong>⚠️ 信息还不够充分</strong></p><p style="color:#a8a8a8;font-size:13px;margin:0">目前只聊了'+userMsgs.length+'轮，信息不足以生成精准的人才画像。<br>建议再多聊几轮，或者回复：<span style="color:#f59e0b">"我还没想好，给我提供一些思路"</span></p></div>'});
    return;
  }

  send({step:'progress',text:'匹配市场数据...'});

  const talentSummary = talents.map(t =>
    `${t.name}|${t.current_company}|${t.current_title}|${t.level||''}`
  ).join('\n');

  const jdSummary = jds.map(j =>
    `${j.title}|${j.company}|${j.salary||'?'}|${(j.snippet||'').substring(0,200)}`
  ).join('\n');

  const historyText = history.map(h =>
    `${h.role==='user'?'业务方':'翻译官'}: ${h.content}`
  ).join('\n');

  const prompt = `你是猎头翻译官。基于和业务方的沟通，为他生成一份「人才画像+招聘建议」。

## 业务方需求(来自对话)
${historyText}
最新: ${question}

## 市场数据
候选人(${talents.length}人): ${talentSummary}
JD(${jds.length}条): ${jdSummary}

## 任务
### 1. 需求翻译
把业务方的业务语言翻译成猎头市场的人才语言。

### 2. 人才画像
硬技能+软技能+理想背景+面试重点。如果市场数据与用户认知有偏差，指出来。

### 3. 招聘建议
去哪类公司找、薪资参考、常见坑。

### 4. 候选推荐(简要)
从市场数据中匹配2-3位最接近的候选人，按匹配度排序。

## 格式规则（严格遵守）
- 直接输出HTML body内容，不要任何前言、介绍、或解释性文字
- 不要用\`\`\`html包裹
- 不要写"以下是基于...生成的报告"之类的前导语
- 深色主题(#151525,#f5f5f5,#f59e0b,毛玻璃卡片)
- h3金色标题, p/ul/li正文
- 卡片:background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:12px`;

  const answer = await streamDeepSeek(prompt, 3000, (chars) => {
    send({step:'progress',text:`生成报告...${chars}字`});
  });

  // Clean up any preamble or code fences
  let clean = answer.trim();
  if (clean.startsWith('```html')) clean = clean.split('\n').slice(1).join('\n');
  if (clean.startsWith('```')) clean = clean.split('\n').slice(1).join('\n');
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  send({step:'report', answer:clean});
}
