/** Shared report building module — used by both generate.js and regenerate.js */

// ===== Skill Extraction =====

const SKILL_KEYWORDS = [
  'agent','rag','llm','prompt','ai','ml','python','sql','java','go','rust',
  '产品','数据','模型','算法','架构','设计','运营','分析','开发','管理',
  '系统','平台','大模型','gpt','transformer','微调','评测','a/b','增长',
  '策略','安全','合规','风控','多模态','智能体','自动化','业务','行业',
  '团队','领导','沟通','跨部门','项目管理','英语',
];

export function extractSkills(jds) {
  const s = {};
  SKILL_KEYWORDS.forEach(k => {
    let c = 0;
    jds.forEach(j => {
      const txt = (j.snippet || '') + (j.tools || '') + (j.title || '');
      if (txt.toLowerCase().includes(k)) c++;
    });
    if (c > 0) s[k] = c;
  });
  return Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 12);
}

// ===== Prompt Builders =====

export function buildTrendAnalysisPrompt(currentSkills, jdSnippets, industry, role) {
  const skillText = currentSkills.map(([k, v]) => `${k}(${v})`).join(', ');
  const jdCtx = jdSnippets.slice(0, 6).map((s, i) => `[JD${i+1}] ${s.substring(0, 300)}`).join('\n');

  return `你是技术趋势分析师，研究${industry}行业${role}岗位的技能演变。

当前JD高频技能: ${skillText}
近期JD摘要: ${jdCtx}

任务:

### 1. trend_summary
用一段话回答: 以前需要什么？现在需要什么？这对招聘意味着什么？
- **将3-5个核心关键词用粗体&lt;b&gt;包裹**帮助定位重点
- 末尾必须加一句: <span style="color:#707070;font-size:12px">※ 趋势分析为AI基于训练数据的推理，仅供招聘决策参考</span>

### 2. current_top
从高频技能选TOP 8。每个skill必须用3-6字具体描述,让用户一眼看懂。
正例: "数字化采购平台搭建"、"AI辅助评标"、"供应商数据建模"
反例: "采购"、"平台"、"数据"、"AI"(太泛,不合格)
每个给一个热度权重分(0-100整数,代表该技能在JD中出现的相对频率,100=出现次数最多的技能)。分数必须参考JD高频技能数据中的实际出现频次,高频次=高分,不能随意编造。
每个skill还要给出category分类: "通用能力"、"专业技能"、"工具技术" 三选一。

### 3. emerging (市场新增方向) [AI推断] - 至少5个
基于你的训练数据,推断最近12个月新出现的方向。每个skill用3-8字具体描述+2-3个细分方向。

### 4. rising (需求上升方向) [AI推断] - 至少5个
基于你的训练数据,推断需求增速超过平均的方向。具体描述+细分方向。

### 5. declining (需求减弱方向) [数据+AI推断]
当前JD中出现极少的技能。每个必须同时给出:
- reason: AI推断的衰退原因
- evidence: JD数据中的具体信号(频次变化、替代信号)
重要规则:
- 每个衰退技能必须引用JD数据中的具体信号佐证（如"JD中该词频次从X次降至Y次""被XX技能/工具替代，因为JD中XX出现频次上升"）
- 禁止使用"被AI自动化替代""被AI取代"等模糊笼统结论
- 必须说明：什么在替代它？为什么需求在下降？
- 如果数据不足以判断，宁可返回空数组也不编造

规则:
- sub_categories必须基于技能本身的逻辑拆解，不能凭空编造
- reason简洁(20字内)
- 只返回JSON，不要markdown包裹

返回JSON:
{
  "trend_summary": "总结段落...",
  "current_top": [{"skill":"技能","score":85,"category":"专业技能"}],
  "emerging": [{"skill":"技能","sub_categories":["细分方向1","细分方向2"],"reason":"为什么这个方向对招聘决策重要(不是简单描述趋势，而是告诉用户这意味着什么)"}],
  "rising": [{"skill":"技能","sub_categories":["细分方向1","细分方向2"],"reason":"为什么这个上升方向值得关注，招聘时应重视什么"}],
  "declining": [{"skill":"技能","reason":"需求下降的具体原因+意味着候选人如果只有这个技能将缺乏竞争力","evidence":"JD数据中观察到的具体替代信号或频次变化"}]
}`;
}

export function buildTierProfilesPrompt(talents, jds) {
  const fmtTalents = (arr) => arr.slice(0, 6).map(t =>
    `${t.name}|${t.current_company}|${t.current_title}`).join('\n');

  const high = fmtTalents(talents.filter(t => t.tier === 'high'));
  const mid = fmtTalents(talents.filter(t => t.tier === 'mid'));
  const low = fmtTalents(talents.filter(t => t.tier === 'low'));
  const highN = talents.filter(t => t.tier === 'high').length;
  const midN = talents.filter(t => t.tier === 'mid').length;
  const lowN = talents.filter(t => t.tier === 'low').length;

  const jdCtx = jds.slice(0, 8).map((j, i) =>
    `[JD${i+1}] ${j.company||''} ${j.title||''}: ${(j.snippet||'').substring(0, 250)}`
  ).join('\n');

  return `你是顶级猎头和人才评估专家。根据真实市场数据，构建三档人才的差异化能力画像。

## 规则
1. 不提学历、不提工作年限
2. 聚焦: 技术能力深度、项目复杂度、业务理解力、领导力/影响力、思维结构化程度
3. 项目示例必须引用JD数据中的真实业务场景，不能编造
4. **每个能力和技能必须用3-6字具体描述**，不能用单字泛词(如不能只写"产品"、"数据"、"管理")
   正例: "商业化策略设计"、"跨部门资源协调"、"ROI数据建模"
   反例: "产品能力"、"数据分析"、"团队管理"
5. project_example必须说清楚业务价值: "主导XX项目，通过XX手段实现了XX业务结果"

## 数据

### 高端候选人(${highN}人)
${high || '无数据'}

### 中端候选人(${midN}人)
${mid || '无数据'}

### 低端候选人(${lowN}人)
${low || '无数据'}

### JD参考
${jdCtx || '无JD数据'}

## 任务

### A. horizontal_labels
为高/中/低三档各给一个8字以内的一句话能力标签，用于横向对比。例如"战略架构级"、"独立交付级"、"执行辅助级"。

### B. 纵向评分 (每档三层)
对每个档位，描述三个水平层次:

**p75 (75分位)** = 该档位高端水平 [AI推断]
- capabilities(3条): 基于候选人+JD数据综合分析 [数据+AI推断]
- skills(3-5个): 基于JD高频技能 [数据]
- project_example: 引用JD真实业务场景 [数据]

**p50 (50分位)** = 该档位中位水平 [AI推断]
同上结构

**p25 (25分位)** = 该档位入门水平 [AI推断]
同上结构

只返回JSON:
{
  "horizontal_labels": {"high":"标签","mid":"标签","low":"标签"},
  "high": {"p75":{"capabilities":[],"skills":[],"project_example":""},"p50":{...},"p25":{...}},
  "mid": {"p75":{...},"p50":{...},"p25":{...}},
  "low": {"p75":{...},"p50":{...},"p25":{...}}
}`;
}

// ===== DeepSeek Streaming =====

export async function streamDeepSeek(prompt, maxTokens, onChunk) {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.DEEPSEEK_KEY
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: true
    })
  });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const c = line.slice(6);
      if (c === '[DONE]') continue;
      try { full += JSON.parse(c).choices?.[0]?.delta?.content || ''; } catch (e) {}
    }
    if (onChunk) onChunk(full.length);
  }
  return full;
}

// ===== JSON Parser =====

export function parseJSONResponse(raw) {
  let t = raw.trim();
  if (t.startsWith('```')) t = t.replace(/```json?|```/g, '');
  return JSON.parse(t);
}

// ===== HTML Builder =====

export function buildRedesignedReportHTML(skills, trend, tiers, talents, highN, midN, lowN, industry, role, jdCount) {
  const topSkills = trend?.current_top || skills.map(([k, v]) => ({ skill: k, score: Math.min(100, Math.round(v / Math.max(...skills.map(s => s[1]) || [1]) * 100)) })).slice(0, 8);
  const safeTiers = tiers || {};
  const safeLabels = safeTiers.horizontal_labels || { high: '高端人才', mid: '中端人才', low: '入门人才' };

  // Bar chart with category-based colors
  const catColors = { '通用能力': '#f59e0b', '专业技能': '#10b981', '工具技术': '#6366f1' };
  const barChart = topSkills.map((s, i) => {
    const pct = Math.max(5, Math.min(100, s.score || 50));
    const c = catColors[s.category] || catColors['专业技能'];
    const catLabel = s.category ? `<span class="bar-cat" style="background:${c}22;color:${c};border:1px solid ${c}33">${s.category}</span>` : '';
    return `<div class="bar-row">
      <span class="bar-label">${s.skill}${catLabel}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>
      <span class="bar-val">${pct}%</span>
    </div>`;
  }).join('');

  // Trend detail (emerging/rising with sub-categories, declining with evidence)
  const trendCard = (arr, label, icon, color, showSub, showEvidence) => {
    if (!arr || !arr.length) return '';
    return `<div class="trend-group">
      <h3 style="color:${color};margin-bottom:12px">${icon} ${label}</h3>
      ${arr.map(s => `<div class="trend-card">
        <div class="trend-head"><span class="trend-skill">${s.skill}</span><span class="trend-reason">${s.reason||''}</span></div>
        ${showSub && s.sub_categories?.length ? `<div class="sub-row">${s.sub_categories.map(sc => `<span class="sub-tag">${sc}</span>`).join('')}</div>` : ''}
        ${showEvidence && s.evidence ? `<div class="evidence-row">📋 ${s.evidence}</div>` : ''}
      </div>`).join('')}
    </div>`;
  };

  // Tier colors (each tier has its own identity color)
  const tierColors = { high: '#10b981', mid: '#f59e0b', low: '#6366f1' };
  const tierNames = { high: '高端人才', mid: '中端人才', low: '入门人才' };

  // Build one scoring card for the kanban
  const scoreCard = (tierKey, levelKey, levelLabel, borderW) => {
    const data = safeTiers[tierKey]?.[levelKey];
    const color = tierColors[tierKey];
    if (!data) return '';
    return `<div class="kb-card" style="border-left:${borderW}px solid ${color}">
      <div class="kb-lvl">${levelLabel}</div>
      <div class="kb-cap">${(data.capabilities||[]).map(c => `<span class="cap-pill" style="background:${color}1a;color:${color};border:1px solid ${color}33">${c}</span>`).join('')}</div>
      <div class="kb-skill">${(data.skills||[]).map(s => `<span class="sk-chip">${s}</span>`).join('')}</div>
      ${data.project_example ? `<div class="kb-proj">💡 ${data.project_example}</div>` : ''}
    </div>`;
  };

  // Build one column for the kanban
  const kbColumn = (tierKey) => {
    const color = tierColors[tierKey];
    const count = tierKey === 'high' ? highN : tierKey === 'mid' ? midN : lowN;
    const label = safeLabels[tierKey] || tierNames[tierKey];
    return `<div class="kb-col">
      <div class="kb-col-head">
        <span class="kb-dot" style="background:${color};box-shadow:0 0 10px ${color}66"></span>
        <span class="kb-name">${tierNames[tierKey]}</span>
        <span class="kb-label" style="color:${color}">${label}</span>
        <span class="kb-count">${count}人</span>
      </div>
      ${scoreCard(tierKey, 'p75', '75分位 [AI推断]', 4)}
      ${scoreCard(tierKey, 'p50', '50分位 [AI推断]', 3)}
      ${scoreCard(tierKey, 'p25', '25分位 [AI推断]', 2)}
    </div>`;
  };

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>人才画像报告 - ${industry||''} ${role||''}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.08) 0%,transparent 50%),linear-gradient(180deg,#151525 0%,#121220 30%,#10101c 60%,#121220 100%);background-attachment:fixed;color:#f5f5f5;line-height:1.6;padding:32px 24px;max-width:1140px;margin:0 auto}
h1{font-size:28px;font-weight:800;text-align:center;margin-bottom:4px;background:linear-gradient(135deg,#f5f5f5,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px}
.subtitle{text-align:center;color:#a8a8a8;font-size:13px;margin-bottom:32px}
h2{font-size:18px;font-weight:600;margin:36px 0 18px;border-left:3px solid #f59e0b;padding-left:12px;color:#f5f5f5}
h3{font-size:15px;font-weight:600;margin-bottom:8px;color:#e0e0e0}

/* ===== Trend Summary ===== */
.summary-card{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);backdrop-filter:blur(16px);border-radius:16px;padding:20px 24px;margin-bottom:28px;display:flex;gap:14px;align-items:flex-start}
.summary-icon{font-size:24px;flex-shrink:0;line-height:1.6}
.summary-text{font-size:15px;color:#fcd34d;line-height:1.9}

/* ===== Bar Chart ===== */
.bar-chart{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.bar-row{display:flex;align-items:center;gap:10px}
.bar-label{width:120px;text-align:right;font-size:12px;color:#e0e0e0;flex-shrink:0;font-weight:500}
.bar-track{flex:1;height:20px;background:rgba(255,255,255,.06);border-radius:10px;overflow:hidden}
.bar-fill{height:100%;border-radius:10px;min-width:4px}
.bar-cat{display:inline-block;font-size:9px;padding:0 5px;border-radius:8px;margin-left:4px;font-weight:500;vertical-align:middle}
.bar-val{width:36px;font-size:12px;color:#a8a8a8;text-align:left;font-weight:600}

/* ===== Trend Detail ===== */
.trend-group{margin-bottom:20px}
.trend-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px 18px;margin-bottom:8px}
.trend-head{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.trend-skill{font-size:14px;font-weight:600;color:#f5f5f5}
.trend-reason{font-size:12px;color:#a8a8a8}
.sub-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-left:12px;border-left:2px solid rgba(99,102,241,.3)}
.sub-tag{font-size:11px;padding:3px 10px;border-radius:20px;background:rgba(99,102,241,.08);color:#a5b4fc;border:1px solid rgba(99,102,241,.15)}
.evidence-row{font-size:11px;color:#f87171;margin-top:6px;padding:6px 10px;background:rgba(239,68,68,.06);border-radius:8px;line-height:1.6}

/* ===== KANBAN WALL ===== */
.kanban-wall{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-bottom:40px}

/* Column */
.kb-col{display:flex;flex-direction:column;gap:12px}

/* Column header */
.kb-col-head{text-align:center;padding:16px 12px 20px;display:flex;flex-direction:column;align-items:center;gap:4px}
.kb-dot{width:10px;height:10px;border-radius:50%}
.kb-name{font-size:20px;font-weight:700;color:#f5f5f5}
.kb-label{font-size:15px;font-weight:700}
.kb-count{font-size:11px;color:#a8a8a8;margin-top:2px}

/* Card */
.kb-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;transition:background .2s}
.kb-card:hover{background:rgba(255,255,255,.05)}
.kb-lvl{font-size:12px;font-weight:700;color:#a8a8a8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}

/* Capability pills — highest visual weight */
.cap-pill{display:inline-block;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:500;margin:2px 4px 4px 0;line-height:1.5}

/* Skill chips — muted */
.sk-chip{display:inline-block;padding:3px 9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;font-size:11px;color:#c0c0c0;margin:2px 3px 3px 0}

/* Project example — subtle */
.kb-proj{font-size:11px;color:#a8a8a8;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.05);line-height:1.7;font-style:italic}

/* ===== Footer ===== */
.footer-row{text-align:center;padding:28px;color:#707070;font-size:11px;border-top:1px solid rgba(255,255,255,.1);margin-top:40px}
.footer-row p{margin:2px 0}

@media(max-width:750px){
  body{padding:16px}
  h1{font-size:22px}
  .kanban-wall{grid-template-columns:1fr;gap:28px}
  .bar-label{width:65px;font-size:11px}
}
</style></head><body>
<h1>人才画像报告</h1>
<div class="subtitle">${industry||''} · ${role||''} · 基于${talents.length}位候选人 · ${jdCount||0}条JD</div>

<!-- TREND SUMMARY -->
<div class="summary-card"><span class="summary-icon">📊</span><p class="summary-text">${trend?.trend_summary || '技能趋势分析生成中...'}</p></div>

<!-- BAR CHART -->
<h2>当前热门技能热度</h2>
<div class="bar-chart">${barChart || '<p style="color:#a8a8a8;text-align:center;padding:16px">暂无足够技能数据</p>'}</div>

<!-- TREND DETAIL -->
<h2>技能变化趋势</h2>
${trendCard(trend?.emerging, '市场新增方向 [AI推断]', '🆕', '#10b981', true, false)}
${trendCard(trend?.rising, '需求上升方向 [AI推断]', '📈', '#f59e0b', true, false)}
${trendCard(trend?.declining, '需求减弱方向 [数据+AI推断]', '📉', '#ef4444', false, true)}

<!-- KANBAN WALL -->
<h2>三档人才能力看板</h2>
<div class="kanban-wall">
  ${kbColumn('high')}
  ${kbColumn('mid')}
  ${kbColumn('low')}
</div>

<div class="footer-row"><p>Tavily · LinkedIn · DeepSeek | 趋势分析与能力画像基于AI对市场数据的推理</p><p>${new Date().toLocaleString('zh-CN')} | 数据样本: ${talents.length}位候选人, ${jdCount||0}条JD</p></div>
</body></html>`;
}
