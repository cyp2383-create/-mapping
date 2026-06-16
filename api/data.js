/** GET /api/data — 查询Turso数据库 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
  const { position_id, list } = req.query;

  async function query(sql, params=[]) {
    let idx = 0;
    const escaped = sql.replace(/\?/g, () => {
      const v = params[idx++];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: escaped } }] })
    });
    const d = await resp.json();
    const r = d.results?.[0]?.response?.result;
    return { rows: r?.rows || [], cols: r?.cols?.map(c=>c.name) || [] };
  }

  if (list) {
    const { rows, cols } = await query("SELECT id, name, industry, role_direction, created_at FROM positions ORDER BY created_at DESC");
    const positions = rows.map(r => {
      const obj = {};
      cols.forEach((c,i) => { try { obj[c] = r[i]?.value; } catch {} });
      // Try to get real Chinese name from JSON data
      try {
        const raw = JSON.parse(obj.talent_data||'[]');
        if (raw && raw._name) obj.name = raw._name;
        if (raw && raw._industry) obj.industry = raw._industry;
        if (raw && raw._role) obj.role_direction = raw._role;
      } catch {}
      return obj;
    });
    res.json({ positions });
    return;
  }

  if (position_id) {
    const { rows, cols } = await query("SELECT id, name, industry, role_direction, talent_data, jd_data, created_at FROM positions WHERE id=?", [position_id]);
    if (!rows.length) return res.json({ talents: [], jds: [] });
    const obj = {};
    cols.forEach((c,i) => { try { obj[c] = rows[0][i]?.value; } catch {} });
    let talents=[], jds=[], industry='', role='';
    try {
      const raw = JSON.parse(obj.talent_data||'[]');
      if (raw && raw._industry) {
        industry = raw._industry;
        role = raw._role || '';
        talents = raw.data || raw;
      } else {
        talents = raw;
      }
    } catch {}
    try { jds = JSON.parse(obj.jd_data||'[]'); } catch {}
    // Normalize: always ensure all expected fields exist
    talents = talents.map(t => {
      let result;
      if (t.name !== undefined) {
        result = {...t}; // Already parsed, keep all fields
      } else {
        // Raw Tavily format: convert
        const raw = t.title||'';
        const parts = raw.split(' - ').map(s=>s.trim());
        const urlMatch = (t.url||'').match(/linkedin\.com\/in\/([^/]+)/);
        const name = parts[0] || (urlMatch ? urlMatch[1].replace(/-/g,' ').replace(/[0-9]/g,'').trim() : raw.substring(0,25));
        result = {name:name||raw.substring(0,25), current_title:parts[1]||'', current_company:t.company||parts[2]||'', source_platform:'linkedin', source_url:t.url||'', contact_type:t.url?'linkedin':'none', contact_value:t.url||''};
      }
      // Ensure enrichment fields always have defaults
      result.education = result.education || '';
      result.languages = result.languages || '';
      result.certifications = result.certifications || '';
      result.influence_score = result.influence_score || 0;
      result.location = result.location || '';
      result.level = result.level || '其他';
      result.tier = result.tier || 'low';
      return result;
    });
    res.json({ talents, jds, industry, role, report_html: obj.report_html || '' });
    return;
  }

  res.json({ error: 'Need position_id or list' });
  } catch(e) { res.status(500).json({error:e.message}); }
}
