/** POST /api/regenerate — 从历史数据重新生成报告 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { position_id } = req.body;
  if (!position_id) return res.status(400).json({error:'Need position_id'});

  try {
    // Read stored data from Turso
    const fetchJson = async (sql) => {
      let idx = 0;
      const escaped = sql.replace(/\?/g, () => { const v = arguments[idx++]; return "'" + String(v??'').replace(/'/g,"''") + "'"; });
      const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
        method:'POST',headers:{'Authorization':'Bearer '+process.env.TURSO_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({requests:[{type:'execute',stmt:{sql:escaped}}]})
      });
      const d = await resp.json();
      return d.results?.[0]?.response?.result;
    };

    const result = await fetchJson('SELECT talent_data, jd_data, industry, role_direction FROM positions WHERE id=' + Number(position_id));
    if (!result || !result.rows.length) return res.status(404).json({error:'Position not found'});

    const row = result.rows[0];
    const talents = JSON.parse(row[0].get('value','') || '[]');
    const jds = JSON.parse(row[1].get('value','') || '[]');
    const industry = row[2].get('value','') || 'Industry';
    const role = row[3].get('value','') || 'Role';

    const tText = talents.slice(0,15).map(t => `${t.name||'?'}|${t.current_company||''}|${t.current_title||''}|tier:${t.tier||''}`).join('\n');
    const jText = jds.slice(0,15).map(j => `${j.title||''}|${j.company||''}`).join('\n');

    const prompt = `为${industry}行业的${role}岗位生成详细HTML人才画像报告。
深色主题: 背景#10101c, 卡片rgba(255,255,255,.03), 文字#f5f5f5, 强调色#f59e0b。
5个板块(标注[JD数据]或[候选人数据]):
1. 市场JD分析: 共性要求, 硬技能TOP10
2. 候选人画像: 公司/职级分布, 薪酬对标
3. 高-中-低三档定义(附代表人物)
4. 三档规律抽取: 专业/经验/能力的差异
5. VP建议: 招聘策略+时间线+风险

候选人: ${tText}
JD: ${jText}`;

    const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.DEEPSEEK_KEY},
      body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:3500})
    });
    const aiData = await aiResp.json();
    let html = aiData.choices?.[0]?.message?.content || '';
    html = html.trim();
    if (html.startsWith('```html')) html = html.split('\n').slice(1).join('\n');
    if (html.endsWith('```')) html = html.slice(0,-3);

    res.json({ report_html: html, talents, jds });
  } catch(e) {
    res.status(500).json({error: e.message});
  }
}
