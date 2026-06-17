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
- 先acknowledge业务方的描述，帮他把模糊需求**翻译成猎头能听懂的人才语言**(如"你说的AI转型，在人才市场上对应的是XX方向，目前市场上有YY类人在做")
- 如果他的认知和市场数据有差距，**指出来**("你提到的XX技能目前在JD中出现很少，市场上更看重YY")
- 追问时给2-3个具体选项，不要开放题
- **引用市场数据**(JD/候选人)增加说服力

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
把业务方的业务语言翻译成猎头市场的人才语言。告诉他: "你需要的其实是这样的人..."

### 2. 人才画像
硬技能+软技能+理想背景+面试重点。如果用市场数据发现他的认知有偏差，指出来。

### 3. 招聘建议
去哪类公司找、薪资参考、常见坑。

### 4. 候选推荐(简要)
从市场数据中匹配2-3位最接近的候选人，按匹配度排序。

## 规则
- 输出HTML body,深色主题(#151525,#f5f5f5,#f59e0b,毛玻璃卡片)
- h3金色标题, p/ul/li正文
- 卡片:background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:12px`;

  const answer = await streamDeepSeek(prompt, 3000, (chars) => {
    send({step:'progress',text:`生成报告...${chars}字`});
  });

  send({step:'report', answer});
}
