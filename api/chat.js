/** POST /api/chat — 猎头顾问角色: 业务场景 → 人才画像 + 挖猎策略 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'POST only'});

  try {
    const { question, context } = req.body;
    if (!question) return res.status(400).json({error:'Need question'});

    const talents = context?.talents || [];
    const jds = context?.jds || [];
    const companies = [...new Set(talents.map(t=>t.current_company).filter(Boolean))].slice(0,12);

    // ===== Intent Classification =====
    const intent = detectIntent(question, companies.length, talents.length);

    let result;
    switch (intent) {
      case 'business_scenario':
        // 用户描述了自己的业务场景 → 构建人才画像
        result = await handlePersonaBuilding(question, talents, jds, companies);
        break;
      case 'poaching':
        // 用户问从哪里挖人 / 哪个公司好
        result = await handlePoachingStrategy(question, talents, jds, companies);
        break;
      case 'company_analysis':
        // 用户问大厂业务方向 / 公司对比
        result = await handleCompanyAnalysis(question, talents, jds, companies);
        break;
      case 'capability':
        // 用户问需要什么能力 / 技能要求
        result = await handleCapabilityAnalysis(question, talents, jds);
        break;
      default:
        // 通用问答 + 候选人匹配
        result = await handleGeneralQA(question, talents, jds);
    }

    // Generate contextual follow-up suggestions
    result.suggestions = await generateSuggestions(question, intent, talents.length);

    res.json(result);
  } catch(e) { res.status(500).json({error:e.message, answer:'抱歉，处理请求时出错'}); }
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

async function handlePersonaBuilding(question, talents, jds, companies) {
  const talentSummary = buildTalentSummary(talents);
  const jdSummary = buildJdSummary(jds);
  const companyTalentMap = buildCompanyTalentMap(talents);
  const skillExtract = extractKeySkills(jds);

  // Phase 1: Business understanding check
  // If the business description is vague, ask clarifying questions first
  const clarityPrompt = `你是资深猎头顾问。用户在描述他的业务需求。判断以下描述是否足够清晰（包含：业务是什么、需要什么类型的人才、人才级别/定位）。

用户描述: "${question}"

如果描述足够清晰（包含上述3个要素中的至少2个），返回: {"clear":true}
如果描述模糊（少于2个要素），返回: {"clear":false,"missing":["缺失的要素1","缺失的要素2"],"questions":["具体追问1","具体追问2"]}

只返回JSON。`;

  try {
    const clarityRaw = await callDeepSeek(clarityPrompt, 200, 0.1);
    const clarity = JSON.parse(clarityRaw.trim().replace(/```json?|```/g, ''));

    if (!clarity.clear) {
      const qs = (clarity.questions||['能否详细描述一下你的业务方向和具体需求？','你希望找到什么样的人才？']).slice(0,3);
      const missing = (clarity.missing||[]).join('、');
      const answer = `<div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.15);border-radius:12px;padding:16px;margin-bottom:12px">
<p style="color:#fcd34d;font-size:14px;margin:0 0 8px"><strong>🤔 想更准确帮你，我需要了解以下信息：</strong></p>
<p style="color:#a8a8a8;font-size:13px;margin:0 0 12px">目前你提到业务中关于 <span style="color:#f59e0b">${missing}</span> 的信息还不够具体，这会影响人才画像的精准度。</p>
<div style="display:flex;flex-direction:column;gap:6px">${qs.map((q,i) => `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 14px;font-size:13px;color:#e0e0e0"><span style="color:#f59e0b;font-weight:600">${i+1}.</span> ${q}</div>`).join('')}</div>
</div>
<p style="color:#a8a8a8;font-size:12px">💡 你可以直接在下面回复，描述越具体，人才画像越精准。</p>`;
      return { answer, recommendations: [], suggestions: qs };
    }
  } catch(e) {
    // If clarity check fails, proceed with full analysis
  }

  // Phase 2: Business is clear — full persona building
  const prompt = `你是资深猎头顾问。分析客户业务场景 → 市场对标 → 构建人才画像。

## 客户业务场景
${question}

## 市场数据
候选人(${talents.length}人): ${talentSummary}
JD(${jds.length}条): ${jdSummary}
公司人才特征: ${companyTalentMap}
技能热度: ${skillExtract}

## 任务

### 1. 业务对标分析
从数据中找出与客户业务相关的公司。每家公司：他们在做什么 → 为什么员工可能是目标人选。只引用数据中的公司和岗位。

### 2. 能力要求提炼
这些公司JD看重什么能力？总结3-5个核心维度(技术+业务+软技能)。引用JD数据点。

### 3. 理想候选人画像
一句话定位 + 硬技能清单 + 软技能 + 理想背景(从哪些公司、什么级别、主导过什么项目)。

### 4. 挖猎策略
推荐2-3家优先挖猎公司 + 优势 + 面试评估要点。

## 规则
- 只基于数据推理，数据不足处标注「建议后续定向搜索」
- 不编造公司、候选人、数字
- 输出HTML body内容，深色主题风格(背景#151525,文字#f5f5f5,金色#f59e0b强调,卡片rgba(255,255,255,.03)毛玻璃)
- 用h3做段落标题(金色),p做正文,ul/li做列表
- 卡片: background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;margin-bottom:12px`;

  const answer = await callDeepSeek(prompt, 2000, 0.3);
  return formatAnswer(answer, []);
}

// ========== Mode 2: 挖猎策略 ==========

async function handlePoachingStrategy(question, talents, jds, companies) {
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

async function handleCompanyAnalysis(question, talents, jds, companies) {
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

async function handleCapabilityAnalysis(question, talents, jds) {
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

async function handleGeneralQA(question, talents, jds) {
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
