/** POST /api/generate — 两步人才地图: 宏观报告 + 追问后定向报告 */
import { extractSkills, buildTrendAnalysisPrompt, buildTierProfilesPrompt, streamDeepSeek, parseJSONResponse, buildRedesignedReportHTML } from './report-builder.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { industry, role, city, stage, context } = req.body;
  const responsibilities = req.body.responsibilities || req.body.core_tasks || '';
  const sourcePreference = req.body.source_preference || req.body.location_preference || city || '';
  if (!industry || !role) return res.status(400).json({error:'Need industry and role'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const ai = createDeepSeek();
    const tavily = createTavily();

    if (stage === 2 && context) {
      // === STEP 2: 定向人才地图 ===
      await generateTargetedReport(ai, tavily, industry, role, context, send);
    } else {
      // === STEP 1: 宏观市场报告 ===
      await generateMacroReport(ai, tavily, industry, role, city, send, { responsibilities, sourcePreference });
    }
    res.end();
  } catch(e) {
    send({step:'error',text:e.message});
    res.end();
  }
}

// ========== API Clients ==========

function createDeepSeek() {
  return { chat: async (prompt, maxTokens=2000) => {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:maxTokens})
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${resp.status}: ${text.slice(0,200)}`);
    }
    const d = await resp.json();
    return d.choices?.[0]?.message?.content || '';
  }};
}

function createTavily() {
  return { search: async (query, maxResults=5) => {
    const resp = await fetch('https://api.tavily.com/search', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:process.env.TAVILY_KEY, query, max_results:maxResults, search_depth:'advanced'})
    });
    const d = await resp.json();
    return (d.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.content||''}));
  }};
}

// ========== Tier Classification ==========

function classifyTier(companyName, titleStr) {
  const tier1 = ['字节跳动','阿里巴巴','腾讯','百度','美团','华为','OpenAI','Google','Microsoft','Meta','Apple','Amazon','NVIDIA'];
  const tier2 = ['快手','小红书','京东','网易','拼多多','滴滴','小米','商汤','科大讯飞','DeepSeek','智谱','月之暗面','MiniMax','百川','零一万物'];
  const isTier1 = tier1.some(c => (companyName||'').includes(c));
  const isTier2 = tier2.some(c => (companyName||'').includes(c));

  let titleLevel = 1;
  const t = (titleStr||'').toLowerCase();
  if (/总监|vp|副总裁|负责人|head|director|principal|partner|首席/.test(t)) titleLevel = 3;
  else if (/经理|专家|senior|lead|manager|architect|资深/.test(t)) titleLevel = 2;

  const companyScore = isTier1 ? 3 : isTier2 ? 2 : 1;
  const score = companyScore + titleLevel;
  if (score >= 5) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}

function extractLevel(titleStr) {
  const t = (titleStr||'');
  if (/总监|VP|副总裁|负责人|Head|Director|Principal|首席/.test(t)) return '总监/VP级';
  if (/经理|Manager|Lead/.test(t) && /高级|资深|Senior|Staff/.test(t)) return '高级经理';
  if (/经理|Manager/.test(t)) return '经理';
  if (/专家|Architect|Fellow/.test(t)) return '专家';
  if (/专员|助理|Associate|Junior/.test(t)) return '专员/初级';
  return '其他';
}

// ========== STEP 1: 宏观市场报告 ==========

async function generateMacroReport(ai, tavily, industry, role, city, send, input = {}) {
  await initTables();

  const searchInput = {
    business_scene: normalizeText(industry),
    target_role: normalizeText(role),
    core_tasks: normalizeText(input.responsibilities || ''),
    location_preference: normalizeText(city || ''),
    source_preference: normalizeText(input.sourcePreference || city || ''),
  };
  searchInput.location_terms = getPreferredLocationTerms(`${searchInput.location_preference} ${searchInput.source_preference}`);

  send({step:'intent',text:'改写专业搜索意图...',progress:4});
  const searchIntent = await buildSearchIntent(ai, searchInput);
  send({step:'intent',text:'已生成专业搜索词',progress:8,
    input: searchInput,
    search_sentence: searchIntent.search_sentence,
    rewritten_intent: searchIntent.rewritten_intent,
    search_queries: searchIntent.search_queries
  });

  send({step:'companies',text:'生成目标公司列表...',progress:10});
  const companies = await generateCompanies(ai, industry, role, searchIntent);
  send({step:'companies',text:`已生成${companies.length}家公司`,progress:15,companies:companies.slice(0,15).map(c=>c.name)});

  send({step:'jds',text:'搜索JD...',progress:20});
  const [jds, companySignals] = await Promise.all([
    searchJDs(tavily, companies, role, searchIntent),
    searchCompanyPages(tavily, companies, searchIntent)
  ]);
  send({step:'jds',text:`找到${jds.length}条JD`,progress:35});

  send({step:'talents',text:'搜索候选人...',progress:40});
  const rawTalents = await searchLinkedIn(tavily, companies, role, searchIntent);
  send({step:'talents',text:`找到${rawTalents.length}位候选人，正在判断匹配度...`,progress:50});
  const talents = await evaluateCandidateFit(ai, rawTalents, searchInput, searchIntent);
  send({step:'talents',text:`AI评估后保留${talents.length}位候选人`,progress:55});

  // Deep enrichment: extract hidden fields from snippets (parallel)
  send({step:'enrich',text:'深度提取候选人档案...',progress:58});
  const [enrichedT, enrichedJ] = await Promise.all([
    deepExtractTalents(ai, talents.slice(0,25)),
    deepExtractJDs(ai, jds.slice(0,15))
  ]);

  // Parse and classify talents with enriched data
  let talentRows = talents.slice(0,40).map((t, i) => {
    const raw = t.title||'';
    const parsedTalent = parseLinkedInTalent(raw, t.url);
    const e = enrichedT[i] || {};
    return {
      name:parsedTalent.name, current_title:parsedTalent.current_title||'',
      current_company:t.company||parsedTalent.current_company||'',
      source_platform:detectPlatform(t.url)||'web', source_url:t.url||'',
      contact_type:t.url?(detectPlatform(t.url)||'profile'):'none', contact_value:t.url||'',
      level: extractLevel(parsedTalent.current_title), tier: classifyTier(t.company||'', parsedTalent.current_title),
      education:e.education||'', languages:e.languages||'',
      certifications:e.certifications||'', influence_score:e.influence_score||0,
      location:e.location||'',
      match_score:t.ai_fit_score||t.match_score||0,
      fit_decision:t.fit_decision||'unreviewed',
      sources: buildTalentSources(t),
      match_reasons:t.fit_reasons?.length ? t.fit_reasons : buildMatchReasons(t, searchInput, searchIntent),
      verification_needed:t.risk_flags?.length ? t.risk_flags : ['实际职责范围', '团队规模与业务阶段', '可触达性与求职意愿'],
      search_queries: searchIntent.search_queries,
    };
  });
  talentRows = sortTalentRowsByMatch(filterTalentRowsByLocation(talentRows, searchIntent));

  const jdRows = jds.slice(0,30).map((j, i) => {
    const e = enrichedJ[i] || {};
    return {
      title:j.title||'', company:j.company||'',
      snippet:j.snippet||'',  // Keep snippet for skill extraction
      salary:e.salary||'', experience:e.experience||'',
      education_req:e.education_req||'', tools:e.tools||'',
      source_platform:'websearch', source_url:j.url||'', source_type:'job_posting',
    };
  });
  const highTier = talentRows.filter(t=>t.tier==='high');
  const midTier = talentRows.filter(t=>t.tier==='mid');
  const lowTier = talentRows.filter(t=>t.tier==='low');

  // Persist before data_ready so the frontend can keep a stable position_id.
  let positionId = 0;
  try {
    positionId = await storeResults(industry, role, talentRows, jdRows, {
      input: searchInput,
      search_sentence: searchIntent.search_sentence,
      rewritten_intent: searchIntent.rewritten_intent,
      search_queries: searchIntent.search_queries,
      company_signals: companySignals
    }) || 0;
  } catch(e) { console.error('storeResults failed:', e.message); }

  // PHASE 1: Return data immediately
  send({step:'data_ready',progress:65,
    talents:talentRows, jds:jdRows,
    tier_stats:{high:highTier.length, mid:midTier.length, low:lowTier.length},
    companies:companies.slice(0,15).map(c=>c.name),
    input: searchInput,
    search_sentence: searchIntent.search_sentence,
    rewritten_intent: searchIntent.rewritten_intent,
    search_queries: searchIntent.search_queries,
    company_signals: companySignals,
    questions:["我该优先找哪类人?","从哪家公司挖人最适合?","怎么判断候选人水平?"],
    stage:1, city: city||'', position_id: positionId
  });

  // PHASE 2: Generate report
  send({step:'report',text:'生成报告...',progress:70});
  try {
    const reportHtml = await buildStreamingReport(ai, talentRows, jdRows, industry, role, city, send);
    // Save report_html to Turso (await to guarantee persistence)
    const rjson = JSON.stringify(reportHtml);
    const db = turso();
    try {
      if (positionId) {
        const upd = await db.execute("UPDATE positions SET report_html=? WHERE id=?", [rjson, positionId]);
      }
    } catch(e) { console.error('Report save failed:', e.message); }
    send({step:'report_ready',progress:100, report_html: reportHtml});
  } catch(e) {
    send({step:'report_ready',progress:100,
      report_html: '<p style=\"color:#a8a8a8;text-align:center;padding:40px\">报告生成失败</p>',
    });
  }
}

// ========== STEP 2: 定向人才地图 ==========

async function generateTargetedReport(ai, tavily, industry, role, context, send) {
  send({step:'analyze',text:'分析需求上下文...',progress:10});

  const prompt = `你是招聘策略顾问。根据用户需求上下文，推荐最适合的目标公司和候选人画像。
行业: ${industry} 岗位: ${role}
用户上下文: ${JSON.stringify(context)}
已有数据: ${context.talents?.length||0}位候选人, ${context.jds?.length||0}条JD

返回JSON:
{
  "target_companies": ["推荐重点挖猎的公司", ...],
  "ideal_profile": "一句话描述理想候选人",
  "hard_skills": ["必备硬技能1","必备硬技能2",...],
  "soft_skills": ["软技能1",...],
  "salary_range": "建议薪资范围",
  "sourcing_strategy": "寻访策略建议(3-5条)",
  "warning": "风险提示"
}`;

  const result = await ai.chat(prompt, 1500);
  let analysis = {};
  try {
    let t = result.trim();
    if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
    if (t.endsWith('```')) t = t.slice(0,-3);
    analysis = JSON.parse(t);
  } catch { analysis = {ideal_profile: result.substring(0,200)}; }

  send({step:'search',text:'补充搜索定向候选人...',progress:30});
  // Search more focused talents based on analysis
  const extraCompanies = analysis.target_companies || [];
  const extraTalents = [];
  for (const c of extraCompanies.slice(0,5)) {
    const results = await searchLinkedInProfilesForCompany(tavily, c, role, 3);
    results.forEach(r => extraTalents.push(r));
  }

  send({step:'report',text:'生成定向人才地图...',progress:60});

  const targetReport = await ai.chat(`你是VP级招聘顾问。基于以下分析，生成一份定向人才地图，包含:
1. 理想候选人画像(1段)
2. 目标公司及挖猎优先级
3. 面试评估要点
4. 入职后90天预期产出
5. 风险与备选方案

用HTML格式输出body内容, 白色背景, 专业简洁。
分析: ${JSON.stringify(analysis).substring(0,3000)}
额外候选人: ${JSON.stringify(extraTalents.slice(0,5))}`, 3000);

  let reportHtml = targetReport.trim();
  const tagStart = reportHtml.indexOf('<');
  if (tagStart > 0) reportHtml = reportHtml.substring(tagStart);
  if (reportHtml.startsWith('```html')) reportHtml = reportHtml.split('\n').slice(1).join('\n');
  if (reportHtml.startsWith('```')) reportHtml = reportHtml.split('\n').slice(1).join('\n');
  if (reportHtml.endsWith('```')) reportHtml = reportHtml.slice(0,-3);
  reportHtml = reportHtml.trim();

  const talentRows = extraTalents.map(t => {
    const raw = t.title||''; const parts = raw.split(' - ').map(s=>s.trim());
    return {name:parts[0]||raw.substring(0,30),current_title:parts[1]||'',
      current_company:t.company||parts[2]||'',source_platform:'linkedin',
      source_url:t.url||'',tier: classifyTier(t.company||'', parts[1]||''),level:extractLevel(parts[1]||''),
      education:'', languages:'', certifications:'', influence_score:0, location:'',
      contact_type:t.url?'linkedin':'none', contact_value:t.url||''
    };
  });

  send({step:'done',progress:100,
    talents:talentRows, report_html:reportHtml,
    analysis:analysis,
    questions:["详细薪酬结构?","面试评估要点?","竞品对标补充?"],
    stage: 2
  });
}

// ========== Report Generators (parallel, shared module) ==========

async function buildStreamingReport(ai, talents, jds, industry, role, city, send) {
  const currentSkills = extractSkills(jds);

  // Both DeepSeek calls run in PARALLEL — independent data, no shared state
  send({ step:'report_progress', progress:72, text:'并行分析技能趋势+能力画像...' });

  const [trendAnalysis, tierProfiles] = await Promise.all([
    (async () => {
      try {
        const prompt = buildTrendAnalysisPrompt(currentSkills, jds.map(j => j.snippet || ''), industry, role);
        const raw = await streamDeepSeek(prompt, 4000, (chars) => {
          send({ step:'report_progress', progress:74, text:`趋势分析...${chars}字` });
        });
        return parseJSONResponse(raw);
      } catch (e) {
        console.error('Trend analysis failed:', e.message);
        return { emerging:[], rising:[], declining:[], current_top:[], trend_summary:'趋势分析生成失败，请重试' };
      }
    })(),
    (async () => {
      try {
        const prompt = buildTierProfilesPrompt(talents, jds);
        const raw = await streamDeepSeek(prompt, 5000, (chars) => {
          send({ step:'report_progress', progress:78, text:`画像分析...${chars}字` });
        });
        return parseJSONResponse(raw);
      } catch (e) {
        console.error('Tier profiles failed:', e.message);
        return { horizontal_labels:{}, high:{}, mid:{}, low:{} };
      }
    })()
  ]);

  send({ step:'report_progress', progress:90, text:'渲染报告...' });

  const highN = talents.filter(t => t.tier === 'high').length;
  const midN = talents.filter(t => t.tier === 'mid').length;
  const lowN = talents.filter(t => t.tier === 'low').length;

  return buildRedesignedReportHTML(currentSkills, trendAnalysis, tierProfiles, talents, highN, midN, lowN, industry, role, jds.length, city);
}


// ========== Pipeline helpers ==========

async function buildSearchIntent(ai, input) {
  const fallback = buildFallbackSearchIntent(input);
  const prompt = `你是资深招聘研究员。请把用户的人才搜索需求改写成适合 Tavily/Web 搜索的专业搜索策略。

用户输入:
业务场景/行业方向: ${input.business_scene}
目标角色/岗位方向: ${input.target_role}
核心任务/职责关键词: ${input.core_tasks || '未填写'}
地区/来源偏好: ${input.location_preference || input.source_preference || '未填写'}

返回严格 JSON:
{
  "search_sentence": "把四个用户输入合成一句给搜索 API 使用的中文搜索句, 必须包含业务场景、目标角色、核心任务、地区/来源偏好",
  "rewritten_intent": "一句专业搜索意图, 说明要找什么人、服务什么业务、优先什么来源",
  "role_keywords": ["中英文角色关键词"],
  "candidate_queries": ["用于搜索人的 query, 3-5条"],
  "jd_queries": ["用于搜索岗位/JD/市场要求的 query, 2-3条"],
  "company_queries": ["用于搜索目标公司/来源公司的 query, 2-3条"]
}`;

  try {
    const text = await ai.chat(prompt, 1200);
    const parsed = parseLooseJson(text);
    const searchQueries = [
      ...(parsed.candidate_queries || []),
      ...(parsed.jd_queries || []),
      ...(parsed.company_queries || [])
    ].map(normalizeText).filter(Boolean);
    return {
      ...fallback,
      ...parsed,
      search_sentence: normalizeText(parsed.search_sentence) || fallback.search_sentence,
      rewritten_intent: normalizeText(parsed.rewritten_intent) || fallback.rewritten_intent,
      role_keywords: Array.isArray(parsed.role_keywords) ? parsed.role_keywords.map(normalizeText).filter(Boolean).slice(0, 8) : fallback.role_keywords,
      candidate_queries: Array.isArray(parsed.candidate_queries) ? parsed.candidate_queries.map(normalizeText).filter(Boolean).slice(0, 5) : fallback.candidate_queries,
      jd_queries: Array.isArray(parsed.jd_queries) ? parsed.jd_queries.map(normalizeText).filter(Boolean).slice(0, 4) : fallback.jd_queries,
      company_queries: Array.isArray(parsed.company_queries) ? parsed.company_queries.map(normalizeText).filter(Boolean).slice(0, 4) : fallback.company_queries,
      location_terms: getPreferredLocationTerms(`${input.location_preference || ''} ${input.source_preference || ''}`),
      search_queries: searchQueries.length ? searchQueries.slice(0, 12) : fallback.search_queries,
    };
  } catch {
    return fallback;
  }
}

function buildFallbackSearchIntent(input) {
  const task = input.core_tasks ? `，核心任务包括${input.core_tasks}` : '';
  const place = input.location_preference ? `，地区/来源偏好为${input.location_preference}` : '';
  const searchSentence = `寻找${input.business_scene}方向的${input.target_role}${task}${place}。`;
  const rewritten = `搜索${input.business_scene}方向的${input.target_role}${task}${place}，重点识别候选人公开资料、来源公司、岗位要求和能力水平。`;
  const roleKeywords = extractSearchTokens(`${input.target_role} ${input.core_tasks}`).slice(0, 8);
  const base = `${input.business_scene} ${input.target_role} ${input.core_tasks} ${input.location_preference}`.trim();
  const candidateQueries = [
    `site:linkedin.com/in ${base}`,
    `${base} GitHub Medium Substack 知乎 个人主页`,
    `${input.target_role} ${input.core_tasks} 候选人 公开资料`
  ].map(normalizeText);
  const jdQueries = [
    `${base} 招聘 JD 岗位职责`,
    `${input.business_scene} ${input.target_role} job description responsibilities`
  ].map(normalizeText);
  const companyQueries = [
    `${input.business_scene} ${input.target_role} 目标公司`,
    `${input.business_scene} ${input.core_tasks} 头部公司 团队`
  ].map(normalizeText);
  return {
    search_sentence: searchSentence,
    rewritten_intent: rewritten,
    role_keywords: roleKeywords.length ? roleKeywords : [input.target_role],
    candidate_queries: candidateQueries,
    jd_queries: jdQueries,
    company_queries: companyQueries,
    location_terms: getPreferredLocationTerms(`${input.location_preference || ''} ${input.source_preference || ''}`),
    search_queries: [...candidateQueries, ...jdQueries, ...companyQueries]
  };
}

function parseLooseJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n');
  if (t.endsWith('```')) t = t.slice(0, -3);
  const arrayStart = t.indexOf('[');
  const arrayEnd = t.lastIndexOf(']');
  const objectStart = t.indexOf('{');
  const objectEnd = t.lastIndexOf('}');
  if (arrayStart >= 0 && arrayEnd > arrayStart && (objectStart < 0 || arrayStart < objectStart)) {
    t = t.slice(arrayStart, arrayEnd + 1);
    return JSON.parse(t);
  }
  const start = objectStart;
  const end = objectEnd;
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function prioritizeDomesticCompanies(companies, searchIntent) {
  const defaults = [
    {name:'字节跳动',tier:'第一梯队'},
    {name:'阿里巴巴',tier:'第一梯队'},
    {name:'腾讯',tier:'第一梯队'},
    {name:'百度',tier:'第一梯队'},
    {name:'美团',tier:'第一梯队'},
    {name:'华为',tier:'第一梯队'},
    {name:'小红书',tier:'第二梯队'},
    {name:'快手',tier:'第二梯队'},
    {name:'京东',tier:'第二梯队'},
    {name:'网易',tier:'第二梯队'},
    {name:'拼多多',tier:'第二梯队'},
    {name:'DeepSeek',tier:'AI公司'},
    {name:'智谱AI',tier:'AI公司'},
    {name:'月之暗面',tier:'AI公司'},
    {name:'MiniMax',tier:'AI公司'},
  ];
  const normalized = companies
    .map(item => typeof item === 'string' ? {name:item,tier:'推荐来源'} : item)
    .filter(item => normalizeText(item?.name));
  const pool = hasChinaLocationPreference(searchIntent) ? [...defaults, ...normalized] : [...normalized, ...defaults];
  const unique = [];
  const seen = new Set();
  for (const item of pool) {
    const name = normalizeText(item.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    unique.push({name, tier:item.tier || '推荐来源'});
  }
  if (!hasChinaLocationPreference(searchIntent)) return unique.slice(0, 15);
  const domestic = unique.filter(item => !isForeignCompanyName(item.name));
  const foreign = unique.filter(item => isForeignCompanyName(item.name));
  return [...domestic, ...foreign].slice(0, 15);
}

function isForeignCompanyName(name) {
  return /OpenAI|Anthropic|Google|DeepMind|Microsoft|Meta|Facebook|Amazon|Apple|NVIDIA|Tesla|Oracle|Salesforce|Adobe|Netflix|Uber|Airbnb|Stripe|Datadog|Snowflake/i.test(normalizeText(name));
}

async function generateCompanies(ai, industry, role, searchIntent) {
  const domesticInstruction = hasChinaLocationPreference(searchIntent)
    ? '用户地区偏好在中国。目标公司必须以中国国内大厂、中国AI公司和中国互联网/科技公司为主，海外公司只能作为少量对标补充，不能排在前列。'
    : '如果用户没有明确海外偏好，优先中国本土公司和中文互联网/科技生态。';
  const prompt = `你是猎头顾问。为以下人才搜索意图列出15家最重要的来源公司。按梯队。JSON数组: [{"name":"公司","tier":"第一梯队"}]
${domesticInstruction}
行业/场景: ${industry}
岗位: ${role}
搜索意图: ${searchIntent?.rewritten_intent || ''}`;
  const text = await ai.chat(prompt, 1500);
  try {
    let t = text.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return prioritizeDomesticCompanies(parsed, searchIntent);
    if (Array.isArray(parsed.companies)) return prioritizeDomesticCompanies(parsed.companies, searchIntent);
    if (Array.isArray(parsed.target_companies)) return prioritizeDomesticCompanies(parsed.target_companies.map(item => typeof item === 'string' ? {name:item,tier:'推荐来源'} : item), searchIntent);
    throw new Error('Company list is not an array');
  } catch { return prioritizeDomesticCompanies([], searchIntent); }
}

async function searchJDs(tav, companies, role, searchIntent) {
  const jds = []; const now = new Date().getFullYear();
  const searchSentence = normalizeText(searchIntent?.search_sentence || searchIntent?.rewritten_intent || role);
  const generalResults = await tav.search(`${searchSentence} 招聘 JD 岗位职责 ${now}`, 3);
  generalResults.forEach(r => jds.push({...r, company: extractCompanyFromTitle(r.title) || '', source_type:'job_posting'}));
  for (const c of companies.slice(0,4)) {
    const results = await tav.search(`${searchSentence} ${c.name} 招聘 JD ${now}`, 1);
    results.forEach(r => jds.push({...r, company:c.name, source_type:'job_posting'}));
  }
  return dedupeByUrl(jds).slice(0,12);
}

async function searchCompanyPages(tav, companies, searchIntent) {
  const pages = [];
  const searchSentence = normalizeText(searchIntent?.search_sentence || searchIntent?.rewritten_intent || '');
  for (const c of companies.slice(0,4)) {
    const results = await tav.search(`${searchSentence} ${c.name} official company team careers`, 1);
    results
      .filter(isCompanyOrTeamSource)
      .forEach(r => pages.push({...r, company:c.name, type:'company_page', platform: detectPlatform(r.url)}));
  }
  return dedupeByUrl(pages).slice(0,8);
}

async function searchLinkedIn(tav, companies, role, searchIntent) {
  const targetCount = 6;
  const firstRound = await Promise.all(
    companies.slice(0,6).map(c => searchLinkedInProfilesForCompany(tav, c.name, role, 3, searchIntent))
  );
  const people = firstRound.flat();
  let ranked = rankProfileResults(dedupeByProfileUrl(people), role, searchIntent);
  if (ranked.length < targetCount) {
    const broader = await searchBroaderLinkedInProfiles(tav, role, searchIntent, companies, targetCount - ranked.length);
    ranked = rankProfileResults(dedupeByProfileUrl([...ranked, ...broader]), role, searchIntent);
  }
  return ranked.slice(0,40);
}

async function searchLinkedInProfilesForCompany(tav, company, role, maxResults=3, searchIntent) {
  const companyName = normalizeText(getCompanyName(company));
  const roleName = normalizeText(role);
  const searchSentence = normalizeText(searchIntent?.search_sentence || searchIntent?.rewritten_intent || roleName);
  const roleQuery = buildCandidateRoleQuery(roleName, searchIntent);
  const queries = [
    `site:linkedin.com/in/ "${companyName}" ${roleQuery} -jobs -careers -hiring -docs -documentation -developers -api -guide -help -product`,
    `site:linkedin.com/in/ "${companyName}" ${searchSentence} -jobs -careers -hiring -docs -documentation -developers -api -guide -help -product`
  ].map(normalizeText).filter(Boolean);

  let collected = [];
  for (const query of queries.slice(0, 1)) {
    const results = await tav.search(query, maxResults);
    filterLinkedInProfileResults(results, companyName, roleName, searchIntent)
      .forEach(r => collected.push({...r, company: companyName, search_query: query}));
    collected = dedupeByProfileUrl(collected);
  }

  return rankProfileResults(dedupeByProfileUrl(collected), roleName, searchIntent).slice(0, maxResults);
}

async function searchBroaderLinkedInProfiles(tav, role, searchIntent, companies, needed=5) {
  const roleName = normalizeText(role);
  const searchSentence = normalizeText(searchIntent?.search_sentence || searchIntent?.rewritten_intent || roleName);
  const roleQuery = buildCandidateRoleQuery(roleName, searchIntent);
  const companyTerms = companies
    .slice(0, 6)
    .map(c => normalizeText(getCompanyName(c)))
    .filter(Boolean)
    .map(name => `"${name}"`)
    .join(' OR ');
  const queries = [
    `${roleQuery} ${searchSentence} ${companyTerms} 个人主页 公开资料 领英 LinkedIn GitHub 知乎 脉脉 -jobs -careers -hiring -docs -documentation -developers -api -guide -help -product`
  ].map(normalizeText).filter(Boolean);

  const query = queries[0];
  const results = query ? await tav.search(query, Math.max(needed, 6)) : [];
  const collected = filterLinkedInProfileResults(results, '', roleName, searchIntent)
    .map(r => ({...r, company: extractCompanyFromTitle(r.title) || '', search_query: query}));
  return rankProfileResults(dedupeByProfileUrl(collected), roleName, searchIntent).slice(0, Math.max(needed, 5));
}

function filterLinkedInProfileResults(results, company, role, searchIntent) {
  const roleTokens = [
    ...extractSearchTokens(role),
    ...(searchIntent?.role_keywords || []),
    ...extractSearchTokens(searchIntent?.search_sentence || '').slice(0, 6)
  ].map(normalizeText).filter(Boolean);
  const filtered = results.filter(r => {
    if (!isPublicPersonProfileUrl(r)) return false;
    if (looksLikeNonPersonResult(r)) return false;
    if (!passesLocationConstraint(r, searchIntent)) return false;

    const text = normalizeText(`${r.title || ''} ${r.snippet || ''}`);
    const hasCompany = company && includesLoose(text, company);
    const hasRole = roleTokens.length ? roleTokens.some(token => includesLoose(text, token)) : false;
    const fromCompanyQuery = !!company && isPublicPersonProfileUrl(r);
    return hasCompany || hasRole || fromCompanyQuery;
  });
  return filtered;
}

async function evaluateCandidateFit(ai, candidates, input, searchIntent) {
  const pool = candidates.slice(0, 40);
  if (!pool.length) return [];
  const reviews = [];
  for (let offset = 0; offset < pool.length; offset += 20) {
    const batch = pool.slice(offset, offset + 20);
    const prompt = `你是资深猎头/招聘研究员。请判断下面候选人是否真的符合用户要找的人，不要做关键词匹配。

用户要找的人:
- 业务场景/行业: ${input.business_scene || ''}
- 目标角色/岗位: ${input.target_role || ''}
- 核心职责/任务: ${input.core_tasks || '未填写'}
- 地区/来源偏好: ${input.location_preference || input.source_preference || '未填写'}
- 搜索意图: ${searchIntent?.rewritten_intent || searchIntent?.search_sentence || ''}

判断原则:
1. 只根据候选人的公开资料标题、摘要、公司、链接判断；证据不足要降分，不能脑补履历。
2. 高分候选人必须在职能方向、业务阶段、职责关键词、公司/行业背景上整体匹配。
3. 信息不足时不要直接 reject，应给 weak/possible 并写 risk；只有明显不是人、纯技术文档、公司页、招聘页、岗位页、课程页、学生/实习生或明显无关职能才 reject。
4. 只是网页里出现某个关键词不代表匹配，要结合 title/snippet/company/url 形成判断。
5. 地区偏好为中国/北京/上海时，明确海外候选人要降分或 reject；未知地区不要直接 reject，但要写 risk。
6. 不要新增候选人，只评估给定 index。

返回严格 JSON 数组，每条格式:
[
  {
    "index": 0,
    "fit_score": 0,
    "decision": "strong|possible|weak|reject",
    "fit_reasons": ["具体为什么匹配，最多3条"],
    "risk_flags": ["需要验证或不匹配风险，最多3条"],
    "inferred_role": "从公开资料判断的角色",
    "inferred_company": "从公开资料判断的公司"
  }
]

候选人:
${batch.map((item, index) => {
  const absoluteIndex = offset + index;
  return `[${absoluteIndex}]
title: ${normalizeText(item.title).slice(0, 220)}
company: ${normalizeText(item.company).slice(0, 120)}
url: ${normalizeText(item.url).slice(0, 220)}
snippet: ${normalizeText(item.snippet).slice(0, 900)}
search_query: ${normalizeText(item.search_query).slice(0, 260)}`;
}).join('\n\n')}`;

    try {
      const text = await ai.chat(prompt, 3500);
      const parsed = parseLooseJson(text);
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.candidates) ? parsed.candidates : []);
      rows.forEach(row => reviews.push(normalizeFitReview(row)));
    } catch {}
  }

  const reviewByIndex = new Map(reviews.filter(Boolean).map(review => [review.index, review]));
  const evaluated = pool.map((candidate, index) => {
    const review = reviewByIndex.get(index);
    if (!review) {
      return {
        ...candidate,
        ai_fit_score: candidate.match_score || 0,
        fit_decision: 'unreviewed',
        fit_reasons: buildFallbackFitReasons(candidate),
        risk_flags: ['AI匹配评估失败，需人工复核'],
      };
    }
    return {
      ...candidate,
      ai_fit_score: review.fit_score,
      fit_decision: review.decision,
      fit_reasons: review.fit_reasons,
      risk_flags: review.risk_flags,
      inferred_role: review.inferred_role,
      inferred_company: review.inferred_company,
      company: review.inferred_company || candidate.company,
    };
  });

  const qualified = evaluated
    .filter(candidate => candidate.fit_decision !== 'reject' && (candidate.ai_fit_score || 0) >= 55)
    .sort((a, b) => (b.ai_fit_score || 0) - (a.ai_fit_score || 0));
  if (qualified.length) return qualified;

  return evaluated
    .filter(candidate => candidate.fit_decision !== 'reject' && (candidate.ai_fit_score || 0) >= 45)
    .sort((a, b) => (b.ai_fit_score || 0) - (a.ai_fit_score || 0));
}

function normalizeFitReview(row) {
  const index = Number(row?.index);
  if (!Number.isInteger(index) || index < 0) return null;
  const fitScore = Math.max(0, Math.min(100, Number(row?.fit_score) || 0));
  const decision = normalizeFitDecision(row?.decision, fitScore);
  return {
    index,
    fit_score: fitScore,
    decision,
    fit_reasons: normalizeStringArray(row?.fit_reasons).slice(0, 3),
    risk_flags: normalizeStringArray(row?.risk_flags).slice(0, 3),
    inferred_role: normalizeText(row?.inferred_role).slice(0, 120),
    inferred_company: normalizeText(row?.inferred_company).slice(0, 120),
  };
}

function normalizeFitDecision(value, score) {
  const text = normalizeText(value).toLowerCase();
  if (['strong', 'possible', 'weak', 'reject'].includes(text)) return text;
  if (score >= 75) return 'strong';
  if (score >= 55) return 'possible';
  if (score >= 40) return 'weak';
  return 'reject';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeText(item)).filter(Boolean);
}

function buildFallbackFitReasons(candidate) {
  const reasons = [];
  if (candidate.company) reasons.push(`公开资料关联 ${candidate.company}`);
  if (candidate.title) reasons.push(`公开资料标题: ${normalizeText(candidate.title).slice(0, 80)}`);
  return reasons.slice(0, 3);
}

function isLinkedInProfileUrl(result) {
  try {
    const url = new URL(result?.url || '');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.endsWith('linkedin.com')) return false;
    const path = url.pathname.toLowerCase();
    if (!path.startsWith('/in/')) return false;
    if (path === '/in/' || path.split('/').filter(Boolean).length < 2) return false;
    return !/\/(jobs|company|companies|school|learning|pulse|posts|feed|showcase|help|advice)\//i.test(path);
  } catch {
    return false;
  }
}

function isPublicPersonProfileUrl(result) {
  if (isLinkedInProfileUrl(result)) return true;
  try {
    const url = new URL(result?.url || '');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host.endsWith('github.com')) return parts.length === 1 && !isReservedProfileSlug(parts[0]);
    if (host.endsWith('zhihu.com')) return parts[0] === 'people' && !!parts[1];
    if (host.endsWith('maimai.cn')) return /\/profile\//i.test(url.pathname) || /\/contact\/detail\//i.test(url.pathname);
    if (host === 'x.com' || host.endsWith('twitter.com')) return parts.length === 1 && !isReservedProfileSlug(parts[0]);
    if (host.endsWith('medium.com')) return parts[0]?.startsWith('@') || parts.length === 1;
    if (host.endsWith('substack.com')) return !/(\/p\/|\/post\/|\/archive|\/about)/i.test(url.pathname);
    if (isCompanyOrTeamSource(result)) return false;
    return ['personal_site'].includes(detectPlatform(result?.url || ''));
  } catch {
    return false;
  }
}

function isReservedProfileSlug(slug) {
  return /^(orgs|organizations|features|enterprise|marketplace|topics|collections|events|settings|login|signup|explore|jobs|careers|about|company|companies|school|learning|pulse|posts|feed|showcase|help|advice|search|notifications|messages|home|i|share|intent)$/i.test(normalizeText(slug));
}

function looksLikeNonPersonResult(result) {
  const text = normalizeText(`${result?.title || ''} ${result?.snippet || ''} ${result?.url || ''}`).toLowerCase();
  const blocked = [
    'api documentation', 'documentation', 'docs',
    'guide', 'guides', 'reference', 'quickstart', 'sdk', 'agent builder',
    'jobs at', 'careers', 'hiring', 'job posting', '招聘', '职位',
    'company profile', 'linkedin learning'
  ];
  return blocked.some(term => text.includes(term.toLowerCase()));
}

function dedupeByProfileUrl(results) {
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = canonicalProfileUrl(r?.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({...r, url:key});
  }
  return unique;
}

function canonicalProfileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || '');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!isPublicPersonProfileUrl({url: rawUrl})) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (!host.endsWith('linkedin.com')) {
      if (host.endsWith('github.com') || host === 'x.com' || host.endsWith('twitter.com') || host.endsWith('medium.com')) {
        return `${url.protocol}//${host}/${parts[0] || ''}`.replace(/\/$/, '');
      }
      if (host.endsWith('zhihu.com') && parts[0] === 'people' && parts[1]) return `${url.protocol}//${host}/people/${parts[1]}`;
      if (host.endsWith('maimai.cn')) return `${url.protocol}//${host}${url.pathname.replace(/\/+$/, '')}`;
      return `${url.protocol}//${host}${url.pathname.replace(/\/+$/, '')}`;
    }
    if (parts[0]?.toLowerCase() !== 'in' || !parts[1]) return '';
    return `https://www.linkedin.com/in/${parts[1].replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function extractSearchTokens(value) {
  return normalizeText(value)
    .split(/[\s,，/|、()（）-]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !['and','or','the','for','with'].includes(t.toLowerCase()))
    .slice(0, 8);
}

function buildRoleQueryTerms(role, searchIntent) {
  const tokens = [
    role,
    ...(searchIntent?.role_keywords || []),
    ...extractSearchTokens(searchIntent?.search_sentence || '').slice(0, 4)
  ].map(normalizeText).filter(Boolean);
  const unique = [...new Set(tokens)].slice(0, 8);
  return unique.map(term => term.length > 18 ? term : `"${term}"`).join(' ');
}

function buildCandidateRoleQuery(role, searchIntent) {
  const tokens = [
    role,
    ...(searchIntent?.role_keywords || []),
    ...extractSearchTokens(role),
    ...extractSearchTokens(searchIntent?.search_sentence || '').slice(0, 4),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .filter(term => term.length >= 2 && !/招聘|岗位|职位|JD|职责|要求/i.test(term));
  const unique = [...new Set(tokens)].slice(0, 8);
  if (!unique.length) return normalizeText(role);
  return `(${unique.map(term => `"${term}"`).join(' OR ')})`;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function includesLoose(haystack, needle) {
  const h = normalizeText(haystack).toLowerCase();
  const n = normalizeText(needle).toLowerCase();
  return !!n && h.includes(n);
}

function getPreferredLocationTerms(value) {
  const text = normalizeText(value);
  const terms = [];
  if (/中国|国内|北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|华东|华北|一线城市|China|Beijing|Shanghai|Shenzhen|Guangzhou|Hangzhou|Chengdu/i.test(text)) {
    terms.push('China', '中国');
  }
  const cityPairs = [
    ['北京', 'Beijing'], ['上海', 'Shanghai'], ['深圳', 'Shenzhen'], ['广州', 'Guangzhou'],
    ['杭州', 'Hangzhou'], ['成都', 'Chengdu'], ['武汉', 'Wuhan'], ['南京', 'Nanjing'], ['苏州', 'Suzhou']
  ];
  cityPairs.forEach(([zh, en]) => {
    if (text.includes(zh) || new RegExp(en, 'i').test(text)) terms.push(zh, en);
  });
  if (/华东/.test(text)) terms.push('上海', 'Shanghai', '杭州', 'Hangzhou', '苏州', 'Suzhou');
  if (/华北/.test(text)) terms.push('北京', 'Beijing');
  return [...new Set(terms)].slice(0, 10);
}

function hasChinaLocationPreference(searchIntent) {
  return (searchIntent?.location_terms || []).some(term => /中国|China|北京|Beijing|上海|Shanghai|深圳|Shenzhen|广州|Guangzhou|杭州|Hangzhou|成都|Chengdu|武汉|Wuhan|南京|Nanjing|苏州|Suzhou/i.test(term));
}

function hasChinaSignal(value, searchIntent) {
  const text = normalizeText(value);
  if (!hasChinaLocationPreference(searchIntent)) return true;
  return (searchIntent.location_terms || []).some(term => includesLoose(text, term)) || /中国|China|北京|Beijing|上海|Shanghai|深圳|Shenzhen|广州|Guangzhou|杭州|Hangzhou|成都|Chengdu|武汉|Wuhan|南京|Nanjing|苏州|Suzhou/i.test(text);
}

function buildLocationQueryClause(searchIntent) {
  const terms = (searchIntent?.location_terms || []).slice(0, 8).filter(Boolean);
  if (!terms.length) return '';
  return `(${terms.map(term => `"${term}"`).join(' OR ')})`;
}

function passesLocationConstraint(result, searchIntent) {
  if (!hasChinaLocationPreference(searchIntent)) return true;
  const text = `${result?.title || ''} ${result?.snippet || ''} ${result?.url || ''}`;
  return !isExplicitForeignSignal(text);
}

function isExplicitForeignSignal(value) {
  return /United States|USA|U\.S\.|America|San Francisco|Bay Area|New York|Seattle|California|Boston|Austin|Los Angeles|Washington|Canada|Toronto|Vancouver|London|United Kingdom|UK|Singapore|India|Bangalore|Bengaluru|Germany|Berlin|France|Paris|Netherlands|Amsterdam|Australia|Sydney|Melbourne/i.test(normalizeText(value));
}

function rankProfileResultsByLocation(results, searchIntent) {
  if (!hasChinaLocationPreference(searchIntent)) return results;
  return results.slice().sort((a, b) => Number(hasChinaSignal(`${b.title || ''} ${b.snippet || ''} ${b.url || ''}`, searchIntent)) - Number(hasChinaSignal(`${a.title || ''} ${a.snippet || ''} ${a.url || ''}`, searchIntent)));
}

function rankProfileResults(results, role, searchIntent) {
  return results
    .map(result => ({...result, match_score: scoreProfileResult(result, role, searchIntent)}))
    .sort((a, b) => b.match_score - a.match_score);
}

function scoreProfileResult(result, role, searchIntent) {
  const text = normalizeText(`${result?.title || ''} ${result?.snippet || ''} ${result?.company || ''}`).toLowerCase();
  const roleText = normalizeText(role).toLowerCase();
  const company = normalizeText(result?.company).toLowerCase();
  let score = 100;
  if (isLinkedInProfileUrl(result)) score += 20;
  else if (isPublicPersonProfileUrl(result)) score += 12;
  if (company && text.includes(company)) score += 24;
  if (roleText && text.includes(roleText)) score += 30;
  for (const token of (searchIntent?.role_keywords || [])) {
    const normalized = normalizeText(token).toLowerCase();
    if (normalized && text.includes(normalized)) score += 10;
  }
  for (const token of extractSearchTokens(searchIntent?.search_sentence || '').slice(0, 6)) {
    const normalized = token.toLowerCase();
    if (normalized && text.includes(normalized)) score += 5;
  }
  if (hasChinaLocationPreference(searchIntent) && hasChinaSignal(`${result?.title || ''} ${result?.snippet || ''}`, searchIntent)) score += 18;
  if (isExplicitForeignSignal(`${result?.title || ''} ${result?.snippet || ''}`)) score -= 80;
  if (parseLinkedInTalent(result?.title || '', result?.url || '').name) score += 8;
  return score;
}

function sortTalentRowsByMatch(rows) {
  return rows.slice().sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
}

function filterTalentRowsByLocation(rows, searchIntent) {
  if (!hasChinaLocationPreference(searchIntent)) return rows;
  return rows.filter(row => {
    const evidence = normalizeText([
      row.location,
      row.source_url,
      ...(row.sources || []).flatMap(source => [source.title, source.snippet, source.url])
    ].filter(Boolean).join(' '));
    if (!evidence) return true;
    return !isExplicitForeignSignal(evidence);
  });
}

function getCompanyName(company) {
  if (!company) return '';
  if (typeof company === 'string') return company;
  return company.name || company.company || company.company_name || company.title || '';
}

async function enrichTalentSources(tav, talents, role, companySignals, jds) {
  for (const talent of talents.slice(0, 8)) {
    const name = extractPersonName(talent);
    const company = normalizeText(talent.company);
    if (!name || name.length < 2) continue;
    try {
      const results = await tav.search(`"${name}" "${company}" "${role}" GitHub Medium Substack Zhihu X Twitter`, 3);
      talent.professional_sources = results
        .filter(isProfessionalCommunitySource)
        .map(r => ({type:'professional_community', platform: detectPlatform(r.url), title:r.title||'', url:r.url||'', snippet:r.snippet||''}))
        .slice(0, 3);
    } catch {}
  }
}

function buildTalentSources(talent) {
  const sources = [];
  if (talent.url) {
    sources.push({type:'person_profile', platform: detectPlatform(talent.url) || 'linkedin', title:talent.title||'', url:talent.url, snippet:talent.snippet||''});
  }
  return dedupeSources(sources);
}

function buildMatchReasons(talent, input, searchIntent) {
  const text = normalizeText(`${talent.title || ''} ${talent.snippet || ''} ${talent.company || ''}`).toLowerCase();
  const reasons = [];
  if (talent.company) reasons.push(`公开资料关联 ${talent.company}`);
  if (input.target_role && includesLoose(text, input.target_role)) reasons.push(`职位/title 与 ${input.target_role} 相关`);
  for (const token of (searchIntent.role_keywords || []).slice(0, 4)) {
    if (includesLoose(text, token)) reasons.push(`匹配关键词: ${token}`);
  }
  return [...new Set(reasons)].slice(0, 5);
}

function extractPersonName(result) {
  return parseLinkedInTalent(result?.title || '', result?.url || '').name;
}

function isProfessionalCommunitySource(result) {
  const platform = detectPlatform(result?.url || '');
  if (!platform) return false;
  return ['github','medium','substack','zhihu','x','twitter','personal_site'].includes(platform);
}

function isCompanyOrTeamSource(result) {
  try {
    const url = new URL(result?.url || '');
    const text = normalizeText(`${result?.title || ''} ${result?.snippet || ''} ${url.pathname}`).toLowerCase();
    if (/\/(jobs|careers|company|about|team|people|product|blog)\b/i.test(url.pathname)) return true;
    return ['official', 'company', 'team', 'careers', 'about', '产品', '团队', '招聘'].some(term => text.includes(term));
  } catch {
    return false;
  }
}

function detectPlatform(rawUrl) {
  try {
    const host = new URL(rawUrl || '').hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('linkedin.com')) return 'linkedin';
    if (host.endsWith('github.com')) return 'github';
    if (host.endsWith('medium.com')) return 'medium';
    if (host.endsWith('substack.com')) return 'substack';
    if (host.endsWith('zhihu.com')) return 'zhihu';
    if (host.endsWith('maimai.cn')) return 'maimai';
    if (host === 'x.com') return 'x';
    if (host.endsWith('twitter.com')) return 'twitter';
    return host ? 'personal_site' : '';
  } catch {
    return '';
  }
}

function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter(source => {
    const key = normalizeText(source.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeByUrl(results) {
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = normalizeText(r?.url).replace(/[?#].*$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({...r, url:key});
  }
  return unique;
}

function extractCompanyFromTitle(title) {
  const parts = normalizeText(title).split(/[-|｜]/).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function parseLinkedInTalent(rawTitle, url) {
  const raw = normalizeText(rawTitle).replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s+on LinkedIn.*$/i, '');
  const parts = raw.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
  const titleName = parts[0] || '';
  const slugName = nameFromLinkedInSlug(url);
  return {
    name: isLikelyPersonName(titleName) ? titleName : slugName,
    current_title: parts.length >= 2 ? parts[1] : '',
    current_company: parts.length >= 3 ? parts[2] : '',
  };
}

function nameFromLinkedInSlug(url) {
  const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return '';
  const slug = decodeURIComponent(match[1])
    .replace(/[-_]+/g, ' ')
    .replace(/\b[0-9a-f]{6,}\b/gi, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isLikelyPersonName(slug)) return '';
  return slug.replace(/\b\w/g, c => c.toUpperCase());
}

function isLikelyPersonName(value) {
  const text = normalizeText(value);
  if (!text || text.length < 2 || text.length > 60) return false;
  if (/候选人线索|姓名待确认|linkedin|profile|profiles|login|招聘|职位|公司|company|jobs|careers|official|unknown|undefined|null/i.test(text)) return false;
  if (/^[^a-zA-Z\u4e00-\u9fa5]+$/.test(text)) return false;
  return true;
}

// ========== Turso helpers ==========

function turso() {
  return { execute: async (sql, params=[]) => {
    let idx = 0;
    const escaped = sql.replace(/\?/g, () => {
      const v = params[idx++];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:escaped}}]})
    });
    const d = await resp.json();
    const r = d.results?.[0]?.response?.result;
    return { rows: r?.rows||[], lastInsertId: r?.last_insert_rowid };
  }};
}

async function initTables() {
  const db = turso();
  await db.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, industry TEXT, role_direction TEXT, talent_data TEXT, jd_data TEXT, report_html TEXT, created_at TEXT DEFAULT (datetime()))");
  try { await db.execute("ALTER TABLE positions ADD COLUMN updated_at TEXT"); } catch {}
}

// ===== DeepSeek batch enrichment =====

async function deepExtractTalents(ai, talents) {
  const text = talents.slice(0,25).map((t,i) => `[${i}] ${(t.snippet||'').substring(0,2000)}`).join('\n---\n');
  const prompt = `Extract hidden fields from LinkedIn profile snippets. Return JSON array, one object per profile:
[{"education":"school+degree","languages":"lang1,lang2","certifications":"cert1,cert2","influence_score":0-10,"location":"city,country"}]
influence_score: 500+ connections=7, 1000+ followers=8, 2000+=9, 5000+=10. If no data, use empty string.
Profiles:\n${text.substring(0,12000)}`;
  const result = await ai.chat(prompt, 3000);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function deepExtractJDs(ai, jds) {
  const text = jds.slice(0,15).map((j,i) => `[${i}] ${(j.snippet||'').substring(0,2000)}`).join('\n---\n');
  const prompt = `Extract structured fields from job description snippets. Return JSON array:
[{"salary":"range if mentioned","experience":"e.g. 3-5 years","education_req":"e.g. Bachelor","tools":"tool1,tool2"}]
If field not found, use empty string. JDs:\n${text.substring(0,12000)}`;
  const result = await ai.chat(prompt, 2500);
  try {
    let t = result.trim(); if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n'); if (t.endsWith('```')) t = t.slice(0,-3);
    return JSON.parse(t);
  } catch { return []; }
}

async function storeResults(industry, role, talentRows, jdRows, meta = {}) {
  const db = turso();
  const pname = normalizeText(`${role}-${industry}`).substring(0,80)||'pos';
  const indSafe = normalizeText(industry).substring(0,60);
  const roleSafe = normalizeText(role).substring(0,60);

  // Check for existing position with same name
  const existing = await db.execute("SELECT id, talent_data, jd_data FROM positions WHERE name=?", [pname]);
  const existingId = existing.rows?.[0]?.[0]?.value;

  // Replace candidate data on each run so old low-fit candidates do not leak into new searches.
  let mergedTalents = talentRows.slice(0, 40);

  const tjson = JSON.stringify({
    _industry:industry,
    _role:role,
    _name:role+'-'+industry,
    input: meta.input || {},
    rewritten_intent: meta.rewritten_intent || '',
    search_queries: meta.search_queries || [],
    company_signals: meta.company_signals || [],
    data:mergedTalents
  });
  const jjson = JSON.stringify(jdRows.slice(0, 30));
  const rjson = JSON.stringify('');

  if (existingId) {
    await db.execute("UPDATE positions SET talent_data=?, jd_data=?, updated_at=datetime('now') WHERE id=?",
      [tjson, jjson, existingId]);
    return existingId;
  }

  const inserted = await db.execute(
    "INSERT INTO positions (name, industry, role_direction, talent_data, jd_data, report_html) VALUES (?,?,?,?,?,?)",
    [pname, indSafe, roleSafe, tjson, jjson, rjson]
  );
  return inserted.lastInsertId || 0;
}
