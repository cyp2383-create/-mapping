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
推断2年前该岗位主流技能，对比当前变化。用2-3句话的结论性段落描述整体趋势转变。

### 2. current_top
从高频技能选TOP 8，每个给一个热度权重分(0-100整数)。用于柱状图展示。

### 3. emerging (新增技能)
筛选近12个月新出现的技能。每个技能推断1-3个细分方向(sub_categories)，如"LLM"→["LLM微调","LLM提示词工程","LLM评测"]。每个细分方向是AI基于技能本身的合理拆解。

### 4. rising (上升技能)
需求增速超平均的技能。同样推断细分方向。

### 5. declining (衰退技能)
2年前热门但现在需求下降的技能。

规则:
- sub_categories必须基于技能本身的逻辑拆解，不能凭空编造
- reason简洁(20字内)
- 只返回JSON，不要markdown包裹

返回JSON:
{
  "trend_summary": "总结段落...",
  "current_top": [{"skill":"技能","score":85}],
  "emerging": [{"skill":"技能","sub_categories":["细分1","细分2"],"reason":"原因"}],
  "rising": [{"skill":"技能","sub_categories":["细分1","细分2"],"reason":"原因"}],
  "declining": [{"skill":"技能","reason":"原因"}]
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

**p75 (75%分位)** = 该档位Top 25%顶尖表现
- capabilities: 3条核心能力特征
- skills: 3-5个核心技能
- project_example: 一个具体项目示例，引用JD中提到的真实业务场景。格式"能主导【JD中的业务场景】项目，输出【具体产出】"

**p50 (50%分位)** = 该档位中位水平
同上结构

**p25 (25%分位)** = 该档位入门门槛
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

  // Bar chart
  const barChart = topSkills.map((s, i) => {
    const pct = Math.max(5, Math.min(100, s.score || 50));
    return `<div class="bar-row">
      <span class="bar-label">${s.skill}</span>
      <div class="bar-track"><div class="bar-fill bar-c${i%5}" style="width:${pct}%"></div></div>
      <span class="bar-val">${pct}</span>
    </div>`;
  }).join('');

  // Trend detail cards
  const trendCard = (arr, label, icon, color, showSub) => {
    if (!arr || !arr.length) return '';
    return `<div class="trend-group">
      <h3 style="color:${color};margin-bottom:12px">${icon} ${label}</h3>
      ${arr.map(s => `<div class="trend-card">
        <div class="trend-head"><span class="trend-skill">${s.skill}</span><span class="trend-reason">${s.reason||''}</span></div>
        ${showSub && s.sub_categories?.length ? `<div class="sub-row">${s.sub_categories.map(sc => `<span class="sub-tag">${sc}</span>`).join('')}</div>` : ''}
      </div>`).join('')}
    </div>`;
  };

  // Scoring cards for one tier
  const scoringCards = (tierKey, tierName, color) => {
    const data = safeTiers[tierKey];
    if (!data) return '';
    const levels = [
      { key: 'p75', label: '顶尖水平 (Top 25%)', color: '#10b981' },
      { key: 'p50', label: '中位水平 (50%)', color: '#f59e0b' },
      { key: 'p25', label: '入门水平 (25%)', color: '#6366f1' },
    ];
    return levels.map(lv => {
      const d = data[lv.key];
      if (!d) return '';
      return `<div class="score-card">
        <div class="score-head" style="border-left:3px solid ${lv.color}"><h4 style="color:${lv.color === '#f59e0b' ? '#fcd34d' : lv.color}">${lv.label}</h4></div>
        <div class="score-body">
          <div class="score-sec"><span class="score-lbl">核心能力</span><div class="cap-row">${(d.capabilities||[]).map(c => `<span class="cap-tag" style="background:${lv.color}12;color:${lv.color}">${c}</span>`).join('')}</div></div>
          <div class="score-sec"><span class="score-lbl">关键技能</span><div class="skill-row">${(d.skills||[]).map(s => `<span class="skill-chip">${s}</span>`).join('')}</div></div>
          ${d.project_example ? `<div class="score-sec"><span class="score-lbl">典型项目示例</span><div class="proj-box"><p>${d.project_example}</p></div></div>` : ''}
        </div>
      </div>`;
    }).join('');
  };

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>人才画像报告 - ${industry||''} ${role||''}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.08) 0%,transparent 50%),linear-gradient(180deg,#151525 0%,#121220 30%,#10101c 60%,#121220 100%);background-attachment:fixed;color:#f5f5f5;line-height:1.6;padding:32px 24px;max-width:1100px;margin:0 auto}
h1{font-size:28px;font-weight:800;text-align:center;margin-bottom:4px;background:linear-gradient(135deg,#f5f5f5,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{text-align:center;color:#a8a8a8;font-size:13px;margin-bottom:32px}
h2{font-size:18px;font-weight:600;margin:32px 0 16px;border-left:3px solid #f59e0b;padding-left:12px;color:#f5f5f5}
h3{font-size:15px;font-weight:600;margin-bottom:8px;color:#e0e0e0}
h4{font-size:14px;font-weight:600;margin:0;color:#f5f5f5}

/* ===== Trend Summary (at top) ===== */
.summary-card{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);backdrop-filter:blur(16px);border-radius:16px;padding:20px 24px;margin-bottom:28px;display:flex;gap:14px;align-items:flex-start}
.summary-icon{font-size:24px;flex-shrink:0;line-height:1.6}
.summary-text{font-size:15px;color:#fcd34d;line-height:1.9}

/* ===== Bar Chart ===== */
.bar-chart{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.bar-row{display:flex;align-items:center;gap:10px}
.bar-label{width:100px;text-align:right;font-size:13px;color:#e0e0e0;flex-shrink:0;font-weight:500}
.bar-track{flex:1;height:20px;background:rgba(255,255,255,.06);border-radius:10px;overflow:hidden}
.bar-fill{height:100%;border-radius:10px;min-width:4px}
.bar-c0{background:linear-gradient(90deg,#10b981,#34d399)}
.bar-c1{background:linear-gradient(90deg,#6366f1,#818cf8)}
.bar-c2{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.bar-c3{background:linear-gradient(90deg,#ec4899,#f472b6)}
.bar-c4{background:linear-gradient(90deg,#06b6d4,#22d3ee)}
.bar-val{width:36px;font-size:12px;color:#a8a8a8;text-align:left;font-weight:600}

/* ===== Trend Groups ===== */
.trend-group{margin-bottom:20px}
.trend-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px 18px;margin-bottom:8px}
.trend-head{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.trend-skill{font-size:14px;font-weight:600;color:#f5f5f5}
.trend-reason{font-size:12px;color:#a8a8a8}
.sub-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-left:12px;border-left:2px solid rgba(99,102,241,.3)}
.sub-tag{font-size:11px;padding:3px 10px;border-radius:20px;background:rgba(99,102,241,.08);color:#a5b4fc;border:1px solid rgba(99,102,241,.15)}

/* ===== Tier Horizontal ===== */
.tier-h-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:36px}
.tier-h-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:28px 20px;text-align:center}
.tier-dot{width:12px;height:12px;border-radius:50%;margin:0 auto 12px}
.tier-dot.high{background:#10b981;box-shadow:0 0 12px rgba(16,185,129,.4)}
.tier-dot.mid{background:#f59e0b;box-shadow:0 0 12px rgba(245,158,11,.4)}
.tier-dot.low{background:#6366f1;box-shadow:0 0 12px rgba(99,102,241,.4)}
.tier-h-name{font-size:18px;font-weight:700;color:#f5f5f5;margin-bottom:4px}
.tier-h-label{font-size:14px;color:#f59e0b;font-weight:600;margin-bottom:4px}
.tier-h-count{font-size:12px;color:#a8a8a8}

/* ===== Scoring Cards ===== */
.tier-scoring-section{margin-bottom:36px}
.score-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;margin-bottom:10px}
.score-head{padding:10px 20px}
.score-body{padding:14px 20px}
.score-sec{margin-bottom:10px}
.score-sec:last-child{margin-bottom:0}
.score-lbl{font-size:10px;font-weight:600;color:#a8a8a8;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px}
.cap-row{display:flex;gap:6px;flex-wrap:wrap}
.cap-tag{padding:3px 10px;border-radius:20px;font-size:11px}
.skill-row{display:flex;gap:6px;flex-wrap:wrap}
.skill-chip{padding:3px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;font-size:11px;color:#e0e0e0}
.proj-box{padding:12px 16px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.1);border-radius:10px;font-size:13px;color:#c0c0c0;line-height:1.8}
.proj-box p{margin:0}

/* ===== Footer ===== */
.footer-row{text-align:center;padding:28px;color:#707070;font-size:11px;border-top:1px solid rgba(255,255,255,.1);margin-top:40px}
.footer-row p{margin:2px 0}

@media(max-width:700px){body{padding:16px}h1{font-size:22px}.tier-h-grid{grid-template-columns:1fr}.bar-label{width:70px;font-size:11px}}
</style></head><body>
<h1>人才画像报告</h1>
<div class="subtitle">${industry||''} · ${role||''} · 基于${talents.length}位候选人 · ${jdCount||0}条JD</div>

<!-- TREND SUMMARY at TOP -->
<div class="summary-card"><span class="summary-icon">📊</span><p class="summary-text">${trend?.trend_summary || '技能趋势分析生成中...'}</p></div>

<!-- BAR CHART -->
<h2>当前热门技能热度</h2>
<div class="bar-chart">${barChart || '<p style="color:#a8a8a8;text-align:center;padding:16px">暂无足够技能数据</p>'}</div>

<!-- TREND DETAIL -->
<h2>技能变化趋势</h2>
${trendCard(trend?.emerging, '新增技能', '🆕', '#10b981', true)}
${trendCard(trend?.rising, '上升技能', '📈', '#f59e0b', true)}
${trendCard(trend?.declining, '衰退技能', '📉', '#ef4444', false)}

<!-- TIER HORIZONTAL -->
<h2>三档人才能力对比</h2>
<div class="tier-h-grid">
  <div class="tier-h-card"><div class="tier-dot high"></div><div class="tier-h-name">高端人才</div><div class="tier-h-label">${safeLabels.high||'战略架构级'}</div><div class="tier-h-count">${highN}人</div></div>
  <div class="tier-h-card"><div class="tier-dot mid"></div><div class="tier-h-name">中端人才</div><div class="tier-h-label">${safeLabels.mid||'独立交付级'}</div><div class="tier-h-count">${midN}人</div></div>
  <div class="tier-h-card"><div class="tier-dot low"></div><div class="tier-h-name">入门人才</div><div class="tier-h-label">${safeLabels.low||'执行辅助级'}</div><div class="tier-h-count">${lowN}人</div></div>
</div>

<!-- PER-TIER SCORING -->
${['high','mid','low'].map((k, i) => {
  const names = ['高端人才','中端人才','入门人才'];
  const colors = ['#10b981','#f59e0b','#6366f1'];
  return `<div class="tier-scoring-section"><h2>${names[i]} · 分层画像</h2>${scoringCards(k, names[i], colors[i])}</div>`;
}).join('')}

<div class="footer-row"><p>Tavily · LinkedIn · DeepSeek | 趋势分析与能力画像基于AI对市场数据的推理</p><p>${new Date().toLocaleString('zh-CN')} | 数据样本: ${talents.length}位候选人, ${jdCount||0}条JD</p></div>
</body></html>`;
}
