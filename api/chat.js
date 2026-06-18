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

// ===== Stage 1: Deterministic Gap Analysis =====

function analyzeGap(question, jds, companies, industry, role) {
  const totalJDs = jds.length || 1;

  // Extract domain context from user's message (not every word)
  // Focus on business domains and specialty areas, ignore conversational fillers
  const domainPatterns = [
    /(?:人力|HR|招聘|培训|绩效|薪酬|员工|组织|人才|入职|离职)/g,
    /(?:AI|大模型|算法|模型|智能|自动化|数字化)/g,
    /(?:采购|供应链|物流|仓储|供应商)/g,
    /(?:金融|风控|合规|支付|信贷|保险)/g,
    /(?:电商|增长|用户|流量|转化|投放|广告|商业化)/g,
    /(?:SaaS|PaaS|云|平台|中台|系统|架构)/g,
    /(?:出海|海外|跨境|国际化|东南亚|欧美)/g,
  ];
  const domains = [];
  domainPatterns.forEach(p => {
    const m = question.match(p);
    if (m) domains.push(...m);
  });

  // Extract what the user is actually looking for beyond the base role
  // e.g., if role is "AI产品经理" and user mentions "HR", the specialty is "HR方向"
  const baseRole = role || '';
  const specialtyKeywords = [...new Set(domains.filter(d => !baseRole.includes(d)))].slice(0, 5);

  // Check if the specialty domain appears in JDs
  const specialtyInJDs = specialtyKeywords.map(kw => {
    let count = 0;
    jds.forEach(j => {
      const txt = (j.snippet||'') + (j.title||'') + (j.tools||'');
      if (txt.includes(kw)) count++;
    });
    return { kw, count, pct: Math.round(count / totalJDs * 100) };
  }).filter(s => s.count > 0);

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

  // Build facts for LLM
  let text = '';
  text += `[背景] 用户搜索岗位: ${industry||'未知行业'} · ${baseRole||'未知岗位'}。共${totalJDs}条JD。\n`;

  if (specialtyKeywords.length > 0) {
    text += `[领域] 用户描述中隐含的特殊方向: ${specialtyKeywords.join('、')}\n`;
    if (specialtyInJDs.length > 0) {
      text += `[领域-市场] 这些方向在JD中出现频率: ${specialtyInJDs.map(s => `${s.kw}(${s.pct}%)`).join('、')}\n`;
    }
    // Only flag a gap if the domain is significantly underrepresented (<20% of JDs)
    const lowDomain = specialtyInJDs.filter(s => s.pct < 20);
    if (lowDomain.length > 0 && specialtyInJDs.length > 0) {
      text += `[洞察] ${lowDomain.map(s => s.kw).join('、')}方向在JD中出现较少(<20%),但这个可能是用户的核心需求。不要否定用户方向,而是告诉用户这个方向的市场现状和替代路径。\n`;
    }
  }

  text += `[市场] JD高频技能: ${topSkills.map(([s,c]) => `${s}(${c}次)`).join('、')}\n`;
  text += `[市场] 候选公司: ${companyStats.join('、')}\n`;

  // Only flag genuine contradictions: user wants something that almost never appears
  const allSpecialtyRare = specialtyInJDs.length > 0 && specialtyInJDs.every(s => s.pct < 10);
  if (allSpecialtyRare) {
    text += `[注意] 用户提到的领域方向在JD中都很少见(<10%)。不要纠正用户的说法,而是帮他理解: 这个方向的人才市场上可能不叫这个名字,或者需要从相邻方向找人。给出相近的市场方向作为参考。\n`;
  }

  return { text, specialtyKeywords, specialtyInJDs, topSkills };
}

// ===== Main: Translator =====

async function translate(question, talents, jds, companies, history, send, industry, role) {
  send({step:'progress',text:'正在比对JD数据...'});

  const rounds = history.filter(h => h.role === 'user').length;
  const remaining = Math.max(0, 10 - rounds);

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
1. 用自然对话语气把上述事实告诉用户，像猎头顾问在聊天
2. 如果事实显示用户的某个需求在市场数据中**支撑度为0** → 必须告诉用户，并给出事实中列出的替代方向
3. 如果事实显示了品类映射 → 用A/B/C选项呈现，每个选项从事实中引用公司和能力
4. 不要输出任何结构化格式(JSON/表格/代码块)，只输出人类对话
5. 回复带HTML内联样式(深色主题)，强调用<span style="color:#f59e0b">
6. 150字内

## 对话元数据
第${rounds+1}轮/剩${remaining}轮 | 无关输入 → reject=true

## 对话历史
${historyText || '(第一轮)'}

## 输出JSON(只JSON,不要其他文字)
{"reject":bool,"message":"HTML回复","offer_report":bool${remaining <= 3 ? ', 剩余轮次<=3请设为true' : ''},"understanding":"","remaining":${remaining},"suggestions":["选项1","选项2"]}`;

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

## 事实核查规则（严格遵守）
- 报告中提到的任何公司名、技能、薪资，必须能在市场数据中找到出处
- 如果某个判断数据中找不到依据 → 标注 [基于市场推断] 或直接不写
- 不要编造候选人、JD、薪资数字

## 格式规则（严格遵守）
- 直接输出HTML body内容，不要任何前言、介绍、或解释性文字
- 不要用\`\`\`html包裹
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
