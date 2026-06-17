/** POST /api/regenerate — 趋势+能力画像报告 (uses shared report-builder) */
import { extractSkills, buildTrendAnalysisPrompt, buildTierProfilesPrompt, streamDeepSeek, parseJSONResponse, buildRedesignedReportHTML } from './report-builder.js';

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
    const rawTalents=JSON.parse(v(0)||'[]'), jds=JSON.parse(v(1)||'[]');
    const talentData=Array.isArray(rawTalents)?rawTalents:(rawTalents.data||[]);

    // Extract industry/role from stored talent_data JSON
    let industry='', role='';
    if (!Array.isArray(rawTalents) && rawTalents._industry) {
      industry = rawTalents._industry || '';
      role = rawTalents._role || '';
    }

    send({step:'progress',text:'并行分析技能趋势+能力画像...',elapsed:0});

    // Both analyses run in PARALLEL
    const currentSkills = extractSkills(jds);
    const [trendAnalysis, tierProfiles] = await Promise.all([
      (async () => {
        try {
          const prompt = buildTrendAnalysisPrompt(currentSkills, jds.map(j => j.snippet || ''), industry, role);
          const raw = await streamDeepSeek(prompt, 4000, (chars) => {
            send({step:'trend_progress',text:`趋势分析...${chars}字`,chars});
          });
          return parseJSONResponse(raw);
        } catch(e) {
          console.error('Trend regen failed:', e.message);
          return { emerging:[], rising:[], declining:[], current_top:[], trend_summary:'趋势分析生成失败' };
        }
      })(),
      (async () => {
        try {
          const prompt = buildTierProfilesPrompt(talentData, jds);
          const raw = await streamDeepSeek(prompt, 5000, (chars) => {
            send({step:'tier_progress',text:`画像分析...${chars}字`,chars});
          });
          return parseJSONResponse(raw);
        } catch(e) {
          console.error('Tier regen failed:', e.message);
          return { horizontal_labels:{}, high:{}, mid:{}, low:{} };
        }
      })()
    ]);

    // Build report
    const highN = talentData.filter(t => t.tier === 'high').length;
    const midN = talentData.filter(t => t.tier === 'mid').length;
    const lowN = talentData.filter(t => t.tier === 'low').length;
    const report = buildRedesignedReportHTML(currentSkills, trendAnalysis, tierProfiles, talentData, highN, midN, lowN, industry, role, jds.length);

    // Save to Turso (fire-and-forget)
    const rjson = JSON.stringify(report);
    fetch(process.env.TURSO_URL+'/v2/pipeline', {
      method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{type:'execute',stmt:{sql:"UPDATE positions SET report_html='"+rjson.replace(/'/g,"''")+"' WHERE id="+Number(position_id)}}]})
    }).catch(e=>{});
    send({step:'done',report_html:report,chars:report.length});
    res.end();
  } catch(e) { send({error:e.message}); res.end(); }
}
