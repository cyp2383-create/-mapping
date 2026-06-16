/** POST /api/regenerate — 模板化报告生成 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { position_id } = req.body;
  if (!position_id) return res.status(400).json({error:'Need position_id'});

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  const send=(d)=>res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    // 1. Read stored data
    const dbResp = await fetch(process.env.TURSO_URL+'/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:'SELECT talent_data,jd_data,industry,role_direction FROM positions WHERE id='+Number(position_id)}}]})
    });
    const dbData = await dbResp.json();
    const result = dbData.results?.[0]?.response?.result;
    if (!result||!result.rows.length) { send({error:'Position not found'}); res.end(); return; }

    const row = result.rows[0];
    const v=(i)=>row[i]?.value||'';
    const talents = JSON.parse(v(0)||'[]'); const jds = JSON.parse(v(1)||'[]');
    const industry=v(2)||'Industry'; const role=v(3)||'Role';

    // Handle both old format (array) and new format ({_industry,_role,data})
    const talentData = Array.isArray(talents) ? talents : (talents.data||[]);
    const realIndustry = talents._industry || industry;
    const realRole = talents._role || role;

    send({step:'progress',text:'计算统计数据...',elapsed:0});

    // 2. Compute stats from data
    const stats = computeStats(talentData, jds);

    // 3. Call DeepSeek for experience-level analysis
    const tText = talentData.slice(0,15).map(t=>`${t.name||'?'}|${t.current_company||''}|${t.current_title||''}`).join('\n');
    const analysisPrompt = `为${realIndustry}行业${realRole}岗位写4段短分析, 必须严格覆盖4个经验阶段:
1. 校招生(0-1年): 需要什么技能, 典型项目举例(80字)
2. 1-3年: 需要什么技能, 典型项目举例(80字)
3. 3-5年: 需要什么技能, 典型项目举例(80字)
4. 5年以上: 需要什么技能, 典型项目举例(80字)
每个阶段用<div class='level-card'><h3>阶段名</h3><p>内容</p></div>格式。必须是4段。候选人参考:${tText}`;

    send({step:'progress',text:'AI分析经验阶段...',elapsed:1});
    let analysisHtml = '';
    try {
      const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
        body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:analysisPrompt}],temperature:0.3,max_tokens:1500,stream:true})
      });
      const reader=aiResp.body.getReader(); const decoder=new TextDecoder(); let buf='';
      while(true){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});}
      const lines=buf.split('\n');
      for(const line of lines){if(!line.startsWith('data:'))continue;const chunk=line.slice(6);if(chunk==='[DONE]')continue;
        try{analysisHtml+=JSON.parse(chunk).choices?.[0]?.delta?.content||'';}catch(e){}
      }
    } catch(e) { analysisHtml='<p>分析生成失败</p>'; }
    analysisHtml = analysisHtml.trim();
    if (analysisHtml.startsWith('```')) analysisHtml = analysisHtml.replace(/```html?/g,'').replace(/```/g,'');

    // 4. Build final HTML report + save to Turso
    const report = buildReport(stats, analysisHtml, realIndustry, realRole);
    const rjson = JSON.stringify(report);
    try {
      await fetch(process.env.TURSO_URL+'/v2/pipeline', {
        method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({requests:[{type:'execute',stmt:{sql:\"UPDATE positions SET report_html='\"+rjson.replace(/'/g,\"''\")+\"' WHERE id=\"+Number(position_id)}}]})
      });
    } catch(e) {}
    send({step:'done', report_html: report, chars: report.length});
    res.end();
  } catch(e) { send({error:e.message}); res.end(); }
}

function computeStats(talents, jds) {
  const total = talents.length||1;
  // Education - always have data
  const edu = {};
  talents.forEach(t=>{
    const e=(t.education||'').trim();
    if(e){const k=e.split('+')[0].substring(0,20);edu[k]=(edu[k]||0)+1;}
  });
  // Fallback: if no education data, use level distribution
  let eduSorted=Object.entries(edu).sort((a,b)=>b[1]-a[1]);
  if(!eduSorted.length){
    const tmp={};
    talents.forEach(t=>{const l=t.level||'其他';tmp[l]=(tmp[l]||0)+1;});
    eduSorted=Object.entries(tmp).sort((a,b)=>b[1]-a[1]);
  }
  eduSorted=eduSorted.slice(0,5);

  // Experience levels from title + level field
  const exp = {校招生:0,'1-3年':0,'3-5年':0,'5年以上':0};
  talents.forEach(t=>{
    const level=(t.level||'').toLowerCase();
    const title=(t.current_title||'').toLowerCase();
    if(/intern|实习|应届|trainee|校招/i.test(title)||/专员|初级|助理|associate|junior/i.test(title)) exp['校招生']++;
    else if(/总监|vp|副总裁|head|director|principal|首席|负责人/i.test(title)||level.includes('总监')) exp['5年以上']++;
    else if(/资深|高级|senior|staff|lead|经理|manager/i.test(title)||level.includes('经理')) exp['3-5年']++;
    else exp['1-3年']++;
  });

  // Skills from JD data
  const skills = {};
  (jds||[]).forEach(j=>{
    (j.snippet||'').toLowerCase().split(/[,.;，。；\s]+/).forEach(w=>{
      if(w.length>3&&!/^(the|and|for|with|about|this|that|from|have|will|your|about|their)$/i.test(w)) skills[w]=(skills[w]||0)+1;
    });
  });

  // Hard skills: filter for tech/biz terms
  const techKw = ['agent','rag','llm','prompt','ai','ml','python','sql','产品','数据','模型','算法','架构','设计','运营','分析','开发','管理','架构','系统','平台','大模型','gpt','transformer','微调','评测','a/b','增长','策略'];
  const hardSkills = {};
  techKw.forEach(kw=>{
    let cnt=0; (jds||[]).forEach(j=>{if((j.snippet||'').toLowerCase().includes(kw)) cnt++;});
    if(cnt>0) hardSkills[kw]=cnt;
  });
  const skillSorted = Object.entries(hardSkills).sort((a,b)=>b[1]-a[1]).slice(0,10);

  // Companies
  const comp = {};
  talents.forEach(t=>{ const c=t.current_company||'其他'; comp[c]=(comp[c]||0)+1; });
  const compSorted = Object.entries(comp).sort((a,b)=>b[1]-a[1]).slice(0,8);

  return { total, eduSorted, exp, skillSorted, compSorted };
}

function buildReport(stats, analysisHtml, industry, role) {
  const total=stats.total;

  // Build pie chart conic-gradient strings
  const eduColors=['#f59e0b','#10b981','#6366f1','#ef4444','#8b5cf6'];
  const eduPie = stats.eduSorted.map(([k,v],i)=>{
    const pct=Math.round(v/total*100); const prev=stats.eduSorted.slice(0,i).reduce((s,[,n])=>s+Math.round(n/total*100),0);
    return `${eduColors[i]} ${prev}% ${prev+pct}%`;
  }).join(',');

  const expColors=['#10b981','#f59e0b','#6366f1','#ef4444'];
  const expEntries = Object.entries(stats.exp);
  const expPieNum=expEntries.map(([,v])=>Math.round(v/total*100));
  const expPie = expEntries.map(([,v],i)=>{
    const pct=expPieNum[i]; const prev=expPieNum.slice(0,i).reduce((s,n)=>s+n,0);
    return `${expColors[i]} ${prev}% ${prev+pct}%`;
  }).join(',');

  const compPie = stats.compSorted.map(([,v],i)=>{
    const pct=Math.round(v/total*100); const prev=stats.compSorted.slice(0,i).reduce((s,[,n])=>s+Math.round(n/total*100),0);
    return `${['#f59e0b','#10b981','#6366f1','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'][i]} ${prev}% ${prev+pct}%`;
  }).join(',');

  const skillTags = stats.skillSorted.map(([k,v])=>`<span class="skill-tag">${k} <small>${v}</small></span>`).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.08) 0%,transparent 50%),linear-gradient(180deg,#151525 0%,#121220 30%,#10101c 60%,#121220 100%);background-attachment:fixed;color:#f5f5f5;line-height:1.6;padding:32px 24px;max-width:1100px;margin:0 auto}
h1{font-size:28px;font-weight:800;text-align:center;margin-bottom:28px;background:linear-gradient(135deg,#f5f5f5,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:18px;font-weight:600;margin:28px 0 16px;border-left:3px solid #f59e0b;padding-left:12px;color:#f5f5f5}
/* Dashboard */
.dashboard{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
.pie-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;text-align:center}
.pie-card h3{font-size:12px;font-weight:600;color:#a8a8a8;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.pie{width:100px;height:100px;border-radius:50%;margin:0 auto 12px;box-shadow:0 0 20px rgba(245,158,11,.1)}
.pie.edu{background:conic-gradient(${eduPie||'#333 0% 100%'})}
.pie.exp{background:conic-gradient(${expPie||'#333 0% 100%'})}
.pie.comp{background:conic-gradient(${compPie||'#333 0% 100%'})}
.legend{font-size:11px;color:#a8a8a8;text-align:left;margin-top:8px}
.legend span{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
/* Skills */
.skills-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:24px}
.skills-card h3{font-size:12px;font-weight:600;color:#a8a8a8;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.skill-tag{display:inline-block;background:rgba(245,158,11,.15);color:#fcd34d;padding:4px 10px;border-radius:20px;font-size:12px;margin:3px;border:1px solid rgba(245,158,11,.2)}
.skill-tag small{color:#a8a8a8;margin-left:4px}
/* Experience breakdown */
.level-card{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;margin-bottom:14px}
.level-card h3{color:#f59e0b;font-size:16px;font-weight:600;margin-bottom:10px}
.level-card p{font-size:14px;color:#a8a8a8;line-height:1.8}
@media(max-width:700px){.dashboard{grid-template-columns:1fr}}
</style></head><body>
<h1>${role} · ${industry} 人才画像报告</h1>

<div class="dashboard">
  <div class="pie-card"><h3>学历分布</h3><div class="pie edu"></div>
    <div class="legend">${stats.eduSorted.map(([k,v],i)=>`<div><span style="background:${eduColors[i]}"></span>${k}: ${Math.round(v/total*100)}%</div>`).join('')||'暂无数据'}</div></div>
  <div class="pie-card"><h3>经验分布</h3><div class="pie exp"></div>
    <div class="legend">${expEntries.map(([k,v],i)=>`<div><span style="background:${expColors[i]}"></span>${k}: ${expPieNum[i]}%</div>`).join('')}</div></div>
  <div class="pie-card"><h3>公司来源</h3><div class="pie comp"></div>
    <div class="legend">${stats.compSorted.slice(0,5).map(([k,v],i)=>`<div><span style="background:${['#f59e0b','#10b981','#6366f1','#ef4444','#8b5cf6'][i]}"></span>${k.substring(0,15)}: ${v}人</div>`).join('')}</div></div>
</div>

<div class="skills-card"><h3>硬技能 TOP10</h3><div>${skillTags||'暂无数据'}</div></div>

<h2>经验阶段分析</h2>
${analysisHtml||'<div class="level-card"><p>分析生成中，请稍后重新生成。</p></div>'}

<div style="text-align:center;padding:24px;color:#666;font-size:12px">数据来源: LinkedIn · Tavily · DeepSeek | 标注[AI推理]的内容为算法推断</div>
</body></html>`;
}
