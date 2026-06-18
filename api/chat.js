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
    const industry = context?.industry || '';
    const role = context?.role || '';

    if (action === 'generate') {
      await generateReport(question, talents, jds, companies, history, send);
    } else {
      await translate(question, talents, jds, companies, history, send, industry, role);
    }
    res.end();
  } catch(e) { send({step:'error',text:e.message}); res.end(); }
}

// ===== Stage 1: Lightweight Market Facts (code, not LLM) =====

function analyzeGap(question, jds, companies, industry, role) {
  const totalJDs = jds.length || 1;
  const totalTalents = 0; // talents count passed separately, not needed here

  // Find most frequently mentioned skills in JDs
  const skillFreq = {};
  const skillKWs = ['AI','大模型','数据','产品','开发','架构','算法','运营','策略','分析','管理','设计','系统','平台','Agent','RAG','Python','SQL','Go','Java','业务','行业','增长','商业化'];
  jds.forEach(j => {
    const txt = (j.snippet||'') + (j.title||'') + (j.tools||'');
    skillKWs.forEach(s => { if (txt.toLowerCase().includes(s.toLowerCase())) skillFreq[s] = (skillFreq[s]||0) + 1; });
  });
  const topSkills = Object.entries(skillFreq).sort((a,b) => b[1]-a[1]).slice(0, 6);

  // Top companies
  const companyStats = companies.slice(0, 5);

  // Build minimal facts — no keyword matching, no domain analysis, no relevance scoring
  let text = '';
  text += `[背景] 用户搜索: ${industry||'未知'} · ${role||'未知'}。共${totalJDs}条JD, ${companies.length}家公司。\n`;
  text += `[市场] JD高频技能: ${topSkills.map(([s,c]) => `${s}(${c}次)`).join('、')}\n`;
  text += `[市场] 候选来源: ${companyStats.join('、')}\n`;
  text += `[规则] 不要用代码关键词匹配的结果去'纠正'用户。相关性由你的语言理解判断,不由关键词匹配判断。\n`;

  return { text, topSkills };
}

// ===== Main: Translator =====

async function translate(question, talents, jds, companies, history, send, industry, role) {
  send({step:'progress',text:'正在比对JD数据...'});

  const historyText = history.map(h =>
    `${h.role==='user'?'业务方':'翻译官'}: ${h.content}`
  ).join('\n');

  // ===== Stage 1: Deterministic gap analysis (code, not LLM) =====
  const gap = analyzeGap(question, jds, companies, industry, role);

  // ===== Stage 2: LLM expresses facts in natural language =====
  const prompt = `你是「猎头翻译官」—— 你只负责把市场事实翻译成自然语言，不负责判断和推理。

## 已计算的事实（你必须基于这些事实回复，不能否认、忽略、或编造新的事实）
${gap.text}

## 你的表达规则
1. 用猎头顾问的语气自然对话
2. 追问和选项基于市场事实中的公司、技能、JD。**相关性由你判断，不由关键词匹配判断。** 即使某个词没在JD中出现，只要业务逻辑合理，就是相关方向
3. 用户选择某个方向后 → 基于这个方向给具体信息，不要反过来否定用户的选择
4. 如果数据确实不足以支撑某个方向 → 诚实说"数据有限"并给出你能看到的最近似方向
5. A/B/C选项用市场事实支撑，每个选项引用公司和技能
6. HTML内联样式(深色主题), 强调用<span style="color:#f59e0b">, 150字内

## 收束信号(任一触发即设置offer_report=true,不设硬性轮次上限)
1. 用户重复追问类似问题 → 信息已到边界
2. 用户连续2轮肯定你的理解 → 需求已清晰
3. 用户选择了某个具体方向 → 画像已锁定
4. 你在重复之前的追问 → 没有新的有效问题了
5. 用户明确说"可以了/懂了/生成吧" → 用户主动收束

## 对话历史
${historyText || '(第一轮)'}

## 输出JSON(只JSON,不要其他文字)
{"reject":bool,"message":"HTML回复","offer_report":bool,"understanding":"收束理由(offer_report=true时)","suggestions":["选项1","选项2"]}`;

  const raw = await streamDeepSeek(prompt, 1000, (chars) => {
    send({step:'progress',text:`组织回复...${chars}字`});
  });

  try {
    let t = raw.trim();
    if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
    const result = JSON.parse(t);
    if (result.reject) {
      send({step:'done', message:result.message, offer_report:false, suggestions:[]});
    } else {
      send({step:'done', message:result.message, offer_report:result.offer_report||false, understanding:result.understanding||'', suggestions:result.suggestions||[]});
    }
  } catch(e) {
    send({step:'done', message:raw, offer_report:false, suggestions:[]});
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
### 1. 需求翻译 [AI推断]
把业务方的业务语言翻译成猎头市场的人才语言。

### 2. 人才画像 [数据+AI推断]
硬技能(基于JD数据)+软技能(AI推断)+理想背景+面试重点。

### 3. 招聘建议 [数据+AI推断]
去哪类公司找(基于候选公司数据)、薪资参考(基于JD数据)、常见坑。

### 4. 候选推荐 [数据]
从市场数据中匹配2-3位最接近的候选人，按匹配度排序。标注每位候选人匹配原因。

## 事实核查规则（严格遵守）
- 报告中提到的任何公司名、技能、薪资，必须能在市场数据中找到出处
- 如果某个判断数据中找不到依据 → 标注 [基于市场推断] 或直接不写
- 不要编造候选人、JD、薪资数字

## 格式规则（严格遵守——风格必须和下面的CSS完全一致）

直接输出HTML body内容，不要前言、不用\`\`\`html包裹。

每个元素必须带内联style：
- body: style="background:#151525;color:#f5f5f5;font-family:'Inter','PingFang SC','Microsoft YaHei',sans-serif;padding:24px;max-width:800px;margin:0 auto;line-height:1.8"
- 大标题: style="font-size:22px;font-weight:800;color:#fbbf24;margin-bottom:20px;text-align:center"
- 段落标题(h3): style="font-size:16px;font-weight:700;color:#f59e0b;margin:24px 0 12px;border-left:3px solid #f59e0b;padding-left:10px"
- 正文段落(p,li): style="font-size:14px;color:#e0e0e0;line-height:1.8;margin-bottom:8px"
- 卡片容器(div): style="background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:16px"
- 高亮文字: style="color:#f59e0b;font-weight:600"
- 禁止使用白色/浅色背景(#fff/#f8f8f8等),整个页面必须是深色`;

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
