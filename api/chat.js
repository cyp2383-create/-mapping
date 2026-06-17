/** POST /api/chat — SSE streaming 猎头顾问: 业务场景 → 人才画像 + 挖猎策略 */
import { streamDeepSeek } from './report-builder.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  // SSE headers
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { question, context } = req.body;
    if (!question) { send({step:'error',text:'Need question'}); res.end(); return; }

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const companies = [...new Set(talents.map(t=>t.current_company).filter(Boolean))].slice(0,12);

    // Intent detection
    send({step:'progress',text:'正在分析你的问题...'});
    const intent = detectIntent(question, companies.length, talents.length);

    let result;
    switch (intent) {
      case 'business_scenario':
        result = await handlePersonaBuilding(question, talents, jds, companies, send);
        break;
      case 'poaching':
        result = await handlePoachingStrategy(question, talents, jds, companies, send);
        break;
      case 'company_analysis':
        result = await handleCompanyAnalysis(question, talents, jds, companies, send);
        break;
      case 'capability':
        result = await handleCapabilityAnalysis(question, talents, jds, send);
        break;
      default:
        result = await handleGeneralQA(question, talents, jds, send);
    }

    result.suggestions = await generateSuggestions(question, intent, talents.length);
    send({step:'done', answer:result.answer, recommendations:result.recommendations||[], suggestions:result.suggestions||[]});
    res.end();
  } catch(e) { send({step:'error',text:e.message}); res.end(); }
}

// ========== Intent Detection ==========

function detectIntent(q) {
  const t = q.toLowerCase();

  // 业务场景描述：用户说"我们"/"我们部门"/"我们公司"在做/要做什么
  const scenarioPatterns = [
    /我们(部门|公司|团队|业务|现在|目前|要|想|在|正在|准备|打算)/,
    /业务(场景|需求|方向|是)/,
    /做.*(转型|升级|改造|优化|提效|降本|创新)/,
    /招.*(负责|带队|从0|搭建|组建)/,
    /需要.*(人才|什么样|能力|具备)/,
    /帮.*(分析|看看|推荐|规划|画像)/,
    /怎么.*(挖|找|招|搭)/,
  ];
  if (scenarioPatterns.some(p => p.test(t))) return 'business_scenario';

  // 挖猎策略：从哪里/哪个公司/如何挖
  const poachingPatterns = [
    /(挖|招|找).*(哪里|哪个公司|哪家|推荐|优先)/,
    /(哪个|哪些|什么)公司.*(挖|招|找|好|适合)/,
    /(推荐|建议).*(挖|找|目标|公司)/,
    /挖人.*(推荐|策略|目标|方向)/,
  ];
  if (poachingPatterns.some(p => p.test(t))) return 'poaching';

  // 公司分析：大厂业务/方向/布局
  const companyPatterns = [
    /(大厂|公司|他们|字节|阿里|腾讯|美团|快手|京东).*(业务|方向|布局|战略|做|转型)/,
    /(业务|方向|战略|转型|布局).*(大厂|公司|哪些|什么)/,
    /(优势|劣势|对比|区别).*(公司|大厂)/,
  ];
  if (companyPatterns.some(p => p.test(t))) return 'company_analysis';

  // 能力分析：需要什么技能/能力/经验
  const capabilityPatterns = [
    /(需要|要求|具备|掌握).*(什么|哪些).*(能力|技能|经验|背景)/,
    /(能力|技能|经验).*(要求|画像|模型)/,
    /什么样.*(人|人才|候选人|背景)/,
  ];
  if (capabilityPatterns.some(p => p.test(t))) return 'capability';

  return 'general';
}

// ========== Mode 1: 业务场景 → 人才画像 ==========

async function handlePersonaBuilding(question, talents, jds, companies, send) {
  const talentSummary = buildTalentSummary(talents);
  const jdSummary = buildJdSummary(jds);
  const companyTalentMap = buildCompanyTalentMap(talents);
  const skillExtract = extractKeySkills(jds);

  // Phase 1: Multi-dimensional needs assessment (5 dimensions)
  send({step:'progress',text:'正在理解你的业务需求...'});
  const assessPrompt = `你是资深猎头顾问。用户在描述招聘需求。从以下5个维度评估信息完整度，每维度给出known(0-100分)和缺失的具体信息。

用户描述: "${question}"

5个评估维度:
1. business_goal: 业务目标(做什么项目、什么阶段0-1还是迭代、落地范围、考核指标)
2. role_scope: 岗位权责(汇报对象、团队配置、权责边界、交付产出)
3. hard_requirements: 硬性门槛(经验年限、行业限定、技术理解要求)
4. team_budget: 团队与预算(薪资级别、职级定位、之前招人痛点)
5. culture_fit: 软性诉求(公司属性、候选人特质偏好)

规则:
- known分数 >= 60 表示该维度信息基本够用
- 如果用户是第一次描述且维度known<60，追问该维度最关键缺失的1-2条
- 每次最多追问3个最关键的问题(优先追问影响最大的缺失维度)
- 如果5个维度中至少3个known>=60，可以 proceed

返回JSON:
{
  "dimensions": {
    "business_goal": {"known": 0-100, "have": "已知信息","missing": "缺失什么"},
    "role_scope": {"known": 0-100, "have": "已知信息","missing": "缺失什么"},
    "hard_requirements": {"known": 0-100, "have": "已知信息","missing": "缺失什么"},
    "team_budget": {"known": 0-100, "have": "已知信息","missing": "缺失什么"},
    "culture_fit": {"known": 0-100, "have": "已知信息","missing": "缺失什么"}
  },
  "ready_count": 3,
  "proceed": true/false,
  "focus_questions": ["最关键追问1","最关键追问2"],
  "focus_dimensions": ["最需深挖的维度名"]
}`;

  try {
    const assessRaw = await callDeepSeek(assessPrompt, 400, 0.1);
    const assess = JSON.parse(assessRaw.trim().replace(/```json?|```/g, ''));

    if (!assess.proceed || assess.ready_count < 3) {
      const qs = (assess.focus_questions || ['能否详细描述一下你的业务方向和具体需求？','这个岗位需要什么核心能力？']).slice(0,3);
      const focusDims = (assess.focus_dimensions||[]).slice(0,2).join('、');
      const dims = assess.dimensions || {};
      // Build a mini radar showing known dimensions
      const dimLabels = [
        { key: 'business_goal', label: '业务目标' },
        { key: 'role_scope', label: '岗位权责' },
        { key: 'hard_requirements', label: '硬性门槛' },
        { key: 'team_budget', label: '团队预算' },
        { key: 'culture_fit', label: '软性诉求' },
      ];
      const radarHTML = dimLabels.map(d => {
        const v = (dims[d.key]?.known) || 0;
        const color = v >= 60 ? '#10b981' : v >= 30 ? '#f59e0b' : '#ef4444';
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="width:70px;font-size:11px;color:#a8a8a8;text-align:right">${d.label}</span>
          <div style="flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
            <div style="width:${v}%;height:100%;background:${color};border-radius:3px"></div>
          </div>
          <span style="width:26px;font-size:10px;color:${color};text-align:right">${v}%</span>
        </div>`;
      }).join('');
      const answer = `<div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.15);border-radius:12px;padding:16px;margin-bottom:12px">
<p style="color:#fcd34d;font-size:14px;margin:0 0 4px"><strong>🔍 需求深挖中...</strong></p>
<p style="color:#a8a8a8;font-size:12px;margin:0 0 12px">目前关于 <span style="color:#f59e0b">${focusDims||'部分关键信息'}</span> 还不够清晰，我先帮你梳理一下当前了解的程度：</p>
<div style="margin-bottom:12px">${radarHTML}</div>
<p style="color:#e0e0e0;font-size:13px;margin:0 0 10px"><strong>想更精准匹配，请帮我补充：</strong></p>
<div style="display:flex;flex-direction:column;gap:6px">${qs.map((q,i) => `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 14px;font-size:13px;color:#e0e0e0"><span style="color:#f59e0b;font-weight:600">${i+1}.</span> ${q}</div>`).join('')}</div>
</div>
<p style="color:#a8a8a8;font-size:11px">💡 信息越具体，人才画像越精准。你可以挑最清楚的部分先回答。</p>`;
      return { answer, recommendations: [], suggestions: qs };
    }
  } catch(e) {
    console.error('Persona assessment failed:', e.message);
    // Proceed with whatever info we have
  }

  // Phase 2: Cross-reference collected companies for business relevance
  send({step:'progress',text:'正在匹配市场数据...'});
  const relevancePrompt = `你是猎头顾问。根据用户业务场景，评估已收集的公司与用户需求的相关性。

用户业务: "${question}"
已收集公司及人才: ${companyTalentMap}

对每家相关公司，20字内说明他们在做什么、与用户业务的关联点。只引用数据中出现的公司。
返回JSON: [{"company":"公司名","relevance":"高/中/低","reason":"关联原因20字内","talent_count":人数}]`;

  let companyRelevance = [];
  try {
    const relRaw = await callDeepSeek(relevancePrompt, 400, 0.1);
    companyRelevance = JSON.parse(relRaw.trim().replace(/```json?|```/g, ''));
  } catch(e) {
    companyRelevance = companies.map(c => ({ company: c, relevance: '中', reason: '数据中出现', talent_count: talents.filter(t => t.current_company === c).length }));
  }
  // Sort by relevance then talent count
  const relOrder = { '高': 0, '中': 1, '低': 2 };
  companyRelevance.sort((a, b) => (relOrder[a.relevance]||1) - (relOrder[b.relevance]||1) || (b.talent_count||0) - (a.talent_count||0));
  const topRelevant = companyRelevance.slice(0, 6).map(c =>
    `${c.company}(${c.relevance}相关): ${c.reason} | 候选人${c.talent_count||0}人`
  ).join('\n');

  // Phase 3: Full persona + recommendation (stream chars progress)
  send({step:'progress',text:'正在生成建议...0字'});
  const prompt = `你是资深猎头顾问。根据客户需求和市场数据，输出以下内容：

## 客户需求
${question}

## 公司相关性排序(高→低)
${topRelevant}

## 市场数据
候选人(${talents.length}人): ${talentSummary}
JD(${jds.length}条): ${jdSummary}
技能热度: ${skillExtract}

## 任务

### 1. 业务对标 & 公司优先级
按相关性排序列出与客户业务最匹配的公司。每家公司: 他们在做什么、为什么值得挖、相关性级别。如果近期有这些公司的人出来可以着重挖掘。

### 2. 能力要求提炼
这些对标公司JD最看重什么能力？分3-5个维度(技术+业务+软技能)，引用具体JD数据。

### 3. 分层候选人画像
根据客户需求，如果能判断层级，按画像分层(如0-1搭建型/平台级负责人/解决方案型)。每层: 硬性背景标签+核心能力+适配场景。如果信息不足以分层，给出一个综合画像。

### 4. 挖猎策略
推荐2-3家优先挖猎公司 + 每家的优势和风险 + 面试评估要点 + 建议的筛选标准(什么背景直接不看)。

## 规则
- 只基于数据和用户描述推理，不编造
- 数据不足处诚实标注「建议定向搜索确认」
- 公司相关性排序是重要参考: 高相关公司的人才优先推荐
- 输出HTML body，深色主题(#151525背景,#f5f5f5文字,#f59e0b强调,卡片毛玻璃)
- h3金色标题, p正文, ul/li列表, 卡片:background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:12px`;

  const answer = await streamDeepSeek(prompt, 2500, (chars) => {
    send({step:'progress',text:`正在生成建议...${chars}字`});
  });
  return formatAnswer(answer, []);
}

// ========== Mode 2: 挖猎策略 ==========

async function handlePoachingStrategy(question, talents, jds, companies, send) {
  const talentSummary = buildTalentSummary(talents);
  const jdSummary = buildJdSummary(jds);
  const companyList = companies.join('、');

  const prompt = `你是资深猎头顾问，为客户提供挖猎策略建议。

## 客户问题
${question}

## 市场数据
候选人分布在${companies.length}家公司: ${companyList}
候选人概况: ${talentSummary}
JD市场情报: ${jdSummary}

## 任务
1. 基于数据推荐2-3家优先挖猎的公司，说明原因
2. 从每家挖人的优势和潜在难度
3. 建议的挖猎顺序和触达策略
4. 如果数据不足以给出具体公司推荐，给出应该搜索什么方向

## 规则
- 只基于数据推理，不编造
- 专业猎头口吻
- HTML格式(body)，深色主题(#151525背景,#f5f5f5文字,#f59e0b强调)，卡片式布局`;

  const answer = await callDeepSeek(prompt, 1500, 0.3);

  // Match relevant candidates
  const recs = await matchCandidates(question, talents);
  return formatAnswer(answer, recs);
}

// ========== Mode 3: 公司业务分析 ==========

async function handleCompanyAnalysis(question, talents, jds, companies, send) {
  const companyTalentMap = buildCompanyTalentMap(talents);
  const jdSummary = buildJdSummary(jds);

  const prompt = `你是资深猎头顾问，为客户分析大厂的业务方向和人才策略。

## 客户问题
${question}

## 市场数据
${companyTalentMap}
JD情报: ${jdSummary}

## 任务
1. 基于数据中出现的公司和岗位，推断各公司的业务重点
2. 如果有明确的业务对标，指出哪些公司在做类似的事
3. 各公司的招人偏好和能力要求差异
4. 每家公司1-2句分析，聚焦对挖猎决策有帮助的信息

## 规则
- 只基于已有数据推理，不编造不存在的业务线
- 不提及具体人数、金额等精确数字
- HTML格式(body内容)，深色主题(#151525背景,#f5f5f5文字,#f59e0b强调)
- 最后引导客户描述业务场景，以便进一步给出定向建议`;

  const answer = await callDeepSeek(prompt, 1500, 0.3);

  const recs = companyListFromAnswer(answer, companies);
  return formatAnswer(answer, recs);
}

// ========== Mode 4: 能力画像分析 ==========

async function handleCapabilityAnalysis(question, talents, jds, send) {
  const skillExtract = extractKeySkills(jds);
  const jdSummary = buildJdSummary(jds);
  const talentSummary = buildTalentSummary(talents.slice(0, 10));

  const prompt = `你是资深猎头顾问，为客户分析目标岗位的能力要求。

## 客户问题
${question}

## 市场JD中的能力要求
${skillExtract}
${jdSummary}

## 高端候选人能力特征
${talentSummary}

## 任务
1. 从JD数据中提炼该岗位的核心能力要求（硬技能+软技能）
2. 高端候选人与普通候选人的能力差异在哪
3. 哪些能力是市场稀缺的（供给少但需求高）
4. 如果用户业务有特殊需求，哪些能力需要额外重视

## 规则
- 只基于数据推理
- 不编造具体能力或标准
- HTML格式(body)，深色主题(#151525背景,#f5f5f5文字,#f59e0b强调)，卡片式布局`;

  const answer = await callDeepSeek(prompt, 1500, 0.3);
  return formatAnswer(answer, []);
}

// ========== Mode 5: 通用问答 ==========

async function handleGeneralQA(question, talents, jds, send) {
  const talentText = talents.slice(0,8).map(t =>
    `${t.name}|${t.current_company}|${t.current_title}`
  ).join('\n');

  const hasEnoughData = talents.length >= 5;

  const prompt = `你是资深猎头顾问，为客户解答招聘市场相关问题。

核心规则:
- ${hasEnoughData ? '基于已收集的候选人数据回答问题，引用具体数据作为支撑' : '以"目前数据有限，我只能根据市场常识推理:"开头，不编造数据'}
- 语言专业、务实，像猎头之间的交流
- 如果用户的问题可以用数据回答，优先引用数据

当前数据: ${talents.length}位候选人, ${jds.length}条JD
候选人: ${talentText}
用户问题: ${question}

用中文回答，300字以内。`;

  const answer = await callDeepSeek(prompt, 600, 0.3);
  const recs = await matchCandidates(question, talents);
  return formatAnswer(answer, recs);
}

// ========== Helpers ==========

function buildTalentSummary(talents) {
  const top = talents.slice(0, 12);
  return top.map(t =>
    `${t.name}|${t.current_company}|${t.current_title}|${t.level||''}|${t.education||''}|影响力:${t.influence_score||0}`
  ).join('\n');
}

function buildJdSummary(jds) {
  const top = jds.slice(0, 10);
  return top.map(j =>
    `${j.title}|${j.company}|薪资:${j.salary||'?'}|经验:${j.experience||'?'}|工具:${j.tools||''}|${(j.snippet||'').substring(0,150)}`
  ).join('\n');
}

function buildCompanyTalentMap(talents) {
  const map = {};
  talents.forEach(t => {
    const c = t.current_company || '未知';
    if (!map[c]) map[c] = [];
    map[c].push(`${t.current_title||'?'}(Lv:${t.level||'?'})`);
  });
  return Object.entries(map).slice(0, 10).map(([c, titles]) =>
    `${c}: ${titles.slice(0,5).join(', ')}`
  ).join('\n');
}

function extractKeySkills(jds) {
  const skills = {};
  const keywords = [
    'agent','rag','llm','prompt','ai','ml','python','sql','java','go','rust',
    '产品','数据','模型','算法','架构','设计','运营','分析','开发','管理',
    '系统','平台','大模型','gpt','transformer','微调','评测','a/b','增长',
    '策略','安全','合规','风控','多模态','智能体','自动化','业务','行业',
    '团队','领导','沟通','跨部门','项目管理','英语',
  ];
  keywords.forEach(k => {
    let count = 0;
    jds.forEach(j => {
      if ((j.snippet||'').toLowerCase().includes(k) ||
          (j.tools||'').toLowerCase().includes(k) ||
          (j.title||'').toLowerCase().includes(k)) count++;
    });
    if (count > 0) skills[k] = count;
  });
  return Object.entries(skills)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 15)
    .map(([k,v]) => `${k}(${v})`)
    .join(', ');
}

function formatAnswer(rawAnswer, recommendations) {
  let html = rawAnswer.trim();

  // Clean up markdown code blocks
  if (html.startsWith('```html')) html = html.split('\n').slice(1).join('\n');
  if (html.startsWith('```')) html = html.split('\n').slice(1).join('\n');
  if (html.endsWith('```')) html = html.slice(0, -3);

  // If response is HTML already, use it; otherwise wrap in paragraphs
  if (!html.includes('<') && !html.includes('&lt;')) {
    html = html
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    html = `<p>${html}</p>`;
    // Bold markdown
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Headings
    html = html.replace(/### (.+?)(?:<br>|$)/g, '<h4>$1</h4>');
  }

  // Ensure we only return body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) html = bodyMatch[1];

  return { answer: html, recommendations };
}

// ========== Candidate Matching ==========

async function matchCandidates(question, talents) {
  if (!talents.length) return [];
  const talentText = talents.slice(0, 10).map(t =>
    `${t.name}|${t.current_company}|${t.current_title}|${t.level||''}`
  ).join('\n');

  const prompt = `基于问题"${question}",从以下候选人推荐最匹配2人。JSON:[{"name":"","reason":"15字内"}]。无匹配返回[]。
候选人: ${talentText}`;

  try {
    const raw = await callDeepSeek(prompt, 250, 0.1);
    let t = raw.trim();
    if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
    return JSON.parse(t);
  } catch(e) { return []; }
}

function companyListFromAnswer(answer, companies) {
  // Extract company names from answer for recommendation display
  return companies
    .filter(c => answer.includes(c))
    .slice(0, 3)
    .map(c => ({ name: c, reason: '数据匹配' }));
}

// ========== Follow-up Suggestions ==========

async function generateSuggestions(question, intent, talentCount) {
  let prompt;
  if (intent === 'business_scenario') {
    prompt = `基于用户描述的业务场景"${question}"，生成3个追问（10字内），引导用户进一步细化需求（如：团队规模、目标级别、特殊要求、薪资范围等）。JSON数组。`;
  } else if (talentCount === 0) {
    prompt = `没有候选人数据时，生成3个引导用户先搜索数据的追问（10字内）。JSON数组。`;
  } else {
    prompt = `基于用户问题"${question}"和${talentCount}位候选人数据，生成3个追问（10字内），引导用户深入描述业务场景或挖猎方向。JSON数组。`;
  }

  try {
    const raw = await callDeepSeek(prompt, 150, 0.5);
    let t = raw.trim();
    if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
    return JSON.parse(t);
  } catch(e) {
    return ['你的业务阶段是?','目标候选人级别?','团队规模和预算?'];
  }
}

// ========== DeepSeek API ==========

async function callDeepSeek(prompt, maxTokens = 1500, temperature = 0.3) {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.DEEPSEEK_KEY
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens
    })
  });
  const d = await resp.json();
  return d.choices?.[0]?.message?.content || '';
}
