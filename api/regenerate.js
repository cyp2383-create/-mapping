/** POST /api/regenerate — 趋势+能力画像报告 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});
  const { position_id } = req.body;
  if (!position_id) return res.status(400).json({error:'Need position_id'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  const send=(d)=>res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    // Read stored data
    const dbResp = await fetch(process.env.TURSO_URL+'/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:'SELECT talent_data,jd_data FROM positions WHERE id='+Number(position_id)}}]})
    });
    const dbData = await dbResp.json();
    const result = dbData.results?.[0]?.response?.result;
    if (!result||!result.rows.length) { send({error:'Position not found'}); res.end(); return; }
    const v=(i)=>result.rows[0][i]?.value||'';
    const talents=JSON.parse(v(0)||'[]'), jds=JSON.parse(v(1)||'[]');
    const talentData=Array.isArray(talents)?talents:(talents.data||[]);

    // Skill comparison + Tier profiles — run in parallel (independent)
    send({step:'progress',text:'分析技能趋势+能力画像...',elapsed:0});
    const currentSkills=extractSkills(jds);
    const [trendAnalysis, tierProfiles]=await Promise.all([
      generateTrendAnalysis(currentSkills, talentData, jds, send),
      generateTierProfiles(talentData, jds, send)
    ]);

    // Build report
    const report=buildTrendReport(currentSkills, trendAnalysis, tierProfiles, talentData);
    const rjson=JSON.stringify(report);
    fetch(process.env.TURSO_URL+'/v2/pipeline',{
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:"UPDATE positions SET report_html='"+rjson.replace(/'/g,"''")+"' WHERE id="+Number(position_id)}}]})
    }).catch(e=>{});
    send({step:'done',report_html:report,chars:report.length});
    res.end();
  } catch(e) { send({error:e.message}); res.end(); }
}

function extractSkills(jds) {
  const kw=['agent','rag','llm','prompt','ai','ml','python','sql','产品','数据','模型','算法','架构','设计','运营','分析','开发','管理','系统','平台','大模型','gpt','transformer','微调','评测','a/b','增长','策略','安全','合规','风控','多模态','智能体','自动化'];
  const s={}; kw.forEach(k=>{let c=0;jds.forEach(j=>{if((j.snippet||'').toLowerCase().includes(k))c++;});if(c>0)s[k]=c;});
  return Object.entries(s).sort((a,b)=>b[1]-a[1]).slice(0,12);
}

async function generateTrendAnalysis(currentSkills, talents, jds, send) {
  const skillText=currentSkills.map(([k,v])=>`${k}:${v}次`).join(',');
  const prompt=`你是技术趋势分析师。当前${skillText}。
基于这些技能数据，推断2年前这个岗位的主流技能是什么，并与现在对比。
按以下JSON格式返回(只返回JSON):
{
  "emerging": [{"skill":"新增技能","reason":"一句话原因"}],
  "rising": [{"skill":"上升技能","reason":"一句话原因"}],
  "declining": [{"skill":"衰退技能","reason":"一句话原因"}],
  "trend_summary": "2-3句话总结市场人才需求变化趋势"
}`;

  const resp=await fetch('https://api.deepseek.com/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
    body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.3,max_tokens:1500,stream:true})
  });
  const reader=resp.body.getReader();const decoder=new TextDecoder();
  let buf='',full='',start=Date.now();
  while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop()||'';
    for(const line of lines){if(!line.startsWith('data:'))continue;const c=line.slice(6);if(c==='[DONE]')continue;
      try{full+=JSON.parse(c).choices?.[0]?.delta?.content||'';}catch(e){}
    }
    send({step:'trend_progress',text:`趋势分析中...${full.length}字`,chars:full.length});
  }
  try{
    let t=full.trim();if(t.startsWith('```'))t=t.replace(/```json?|```/g,'');
    return JSON.parse(t);
  }catch(e){return {emerging:[],rising:[],declining:[],trend_summary:'分析生成失败'};}
}

async function generateTierProfiles(talents, jds, send) {
  const high=talents.filter(t=>t.tier==='high').slice(0,5).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const mid=talents.filter(t=>t.tier==='mid').slice(0,5).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const low=talents.filter(t=>t.tier==='low').slice(0,5).map(t=>`${t.name}|${t.current_company}|${t.current_title}`).join('\n');
  const jdText=jds.slice(0,5).map(j=>(j.snippet||'').substring(0,300)).join('\n');

  const prompt=`你是人才评估专家。根据以下真实数据，总结高/中/低三档人才的差异化能力画像。
重要: 不要提学历、不要提工作年限。聚焦于: 技术能力、项目复杂度、业务理解、领导力。

高端候选人: ${high}
中端候选人: ${mid}
低端候选人: ${low}
JD参考: ${jdText}

按JSON格式返回(只返回JSON):
{
  "high": {"capabilities":["能力1","能力2","能力3"],"project_scope":"能主导什么级别项目","differentiator":"与中端的核心区别"},
  "mid": {"capabilities":["能力1","能力2","能力3"],"project_scope":"能主导什么级别项目","differentiator":"与低端的核心区别"},
  "low": {"capabilities":["能力1","能力2","能力3"],"project_scope":"能主导什么级别项目","differentiator":"入门门槛"}
}`;

  const resp=await fetch('https://api.deepseek.com/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
    body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.3,max_tokens:1500,stream:true})
  });
  const reader=resp.body.getReader();const decoder=new TextDecoder();
  let buf='',full='',start=Date.now();
  while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop()||'';
    for(const line of lines){if(!line.startsWith('data:'))continue;const c=line.slice(6);if(c==='[DONE]')continue;
      try{full+=JSON.parse(c).choices?.[0]?.delta?.content||'';}catch(e){}
    }
    send({step:'tier_progress',text:`画像分析中...${full.length}字`,chars:full.length});
  }
  try{
    let t=full.trim();if(t.startsWith('```'))t=t.replace(/```json?|```/g,'');
    return JSON.parse(t);
  }catch(e){return {high:{capabilities:[],project_scope:'',differentiator:''},mid:{capabilities:[],project_scope:'',differentiator:''},low:{capabilities:[],project_scope:'',differentiator:''}};}
}

function buildTrendReport(skills, trend, tiers, talents) {
  const highN=talents.filter(t=>t.tier==='high').length;
  const midN=talents.filter(t=>t.tier==='mid').length;
  const lowN=talents.filter(t=>t.tier==='low').length;
  const skillTags=skills.map(([k,v])=>`<span class="skill-tag">${k}<small>${v}</small></span>`).join('');

  const trendCards=(arr,label,color)=>{
    if(!arr||!arr.length)return'';
    return arr.map(s=>`<div class="trend-item"><span class="trend-dot" style="background:${color}"></span><strong>${s.skill}</strong><span class="trend-reason">${s.reason}</span></div>`).join('');
  };

  const tierCard=(tier,data,color)=>{
    if(!data||!data.capabilities)return'';
    return`<div class="tier-card" style="border-left:3px solid ${color}">
<h3 style="color:${color}">${tier==='high'?'高端人才':tier==='mid'?'中端人才':'入门人才'} <small style="color:#a8a8a8">(${tier==='high'?highN:tier==='mid'?midN:lowN}人)</small></h3>
<div class="tier-capabilities">${(data.capabilities||[]).map(c=>`<span class="cap-tag">${c}</span>`).join('')}</div>
<div class="tier-scope"><strong>项目级别:</strong> ${data.project_scope||''}</div>
<div class="tier-diff"><strong>核心差异:</strong> ${data.differentiator||''}</div>
</div>`;
  };

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.08) 0%,transparent 50%),linear-gradient(180deg,#151525 0%,#121220 30%,#10101c 60%,#121220 100%);background-attachment:fixed;color:#f5f5f5;line-height:1.6;padding:32px 24px;max-width:1100px;margin:0 auto}
h1{font-size:28px;font-weight:800;text-align:center;margin-bottom:8px;background:linear-gradient(135deg,#f5f5f5,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{text-align:center;color:#a8a8a8;font-size:14px;margin-bottom:28px}
h2{font-size:18px;font-weight:600;margin:28px 0 16px;border-left:3px solid #f59e0b;padding-left:12px;color:#f5f5f5}

.skills-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:24px}
.skills-card h3{font-size:12px;font-weight:600;color:#a8a8a8;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.skill-tag{display:inline-block;background:rgba(245,158,11,.15);color:#fcd34d;padding:4px 10px;border-radius:20px;font-size:12px;margin:3px;border:1px solid rgba(245,158,11,.2)}
.skill-tag small{color:#a8a8a8;margin-left:4px}

.trend-section{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:16px}
.trend-section h3{font-size:16px;font-weight:600;margin-bottom:12px}
.trend-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:14px}
.trend-item:last-child{border-bottom:none}
.trend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.trend-reason{color:#a8a8a8;font-size:12px;margin-left:4px}
.trend-summary{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);border-radius:12px;padding:16px;margin-top:16px;font-size:14px;color:#fcd34d;line-height:1.8}

.tier-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:14px}
.tier-card h3{font-size:18px;margin-bottom:12px}
.tier-capabilities{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.cap-tag{background:rgba(99,102,241,.12);color:#a5b4fc;padding:4px 12px;border-radius:20px;font-size:12px}
.tier-scope,.tier-diff{font-size:14px;color:#a8a8a8;margin-top:8px;line-height:1.8}
.tier-diff strong{color:#f59e0b}

@media(max-width:700px){body{padding:16px}}
</style></head><body>
<h1>人才画像报告</h1>
<div class="subtitle">基于${talents.length}位候选人</div>

<h2>技能趋势变化</h2>
<div class="skills-card"><h3>当前热门技能</h3><div>${skillTags||'暂无数据'}</div></div>
${trend.emerging?.length?`<div class="trend-section"><h3 style="color:#10b981">新增技能</h3>${trendCards(trend.emerging,'emerging','#10b981')}</div>`:''}
${trend.rising?.length?`<div class="trend-section"><h3 style="color:#6366f1">上升技能</h3>${trendCards(trend.rising,'rising','#6366f1')}</div>`:''}
${trend.declining?.length?`<div class="trend-section"><h3 style="color:#ef4444">衰退技能</h3>${trendCards(trend.declining,'declining','#ef4444')}</div>`:''}
${trend.trend_summary?`<div class="trend-summary">${trend.trend_summary}</div>`:''}

<h2>三档人才能力画像</h2>
${tierCard('high',tiers.high,'#10b981')}
${tierCard('mid',tiers.mid,'#f59e0b')}
${tierCard('low',tiers.low,'#6366f1')}

<div style="text-align:center;padding:24px;color:#666;font-size:12px">Tavily · LinkedIn · DeepSeek | 趋势分析为AI基于数据推理</div>
</body></html>`;
}
