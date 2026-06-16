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
    // Convert raw Tavily format to parsed format if needed
    talents = talents.map(t => {
      if (t.name !== undefined) return t; // Already parsed
      const raw = t.title||'';
      const parts = raw.split(' - ').map(s=>s.trim());
      const urlMatch = (t.url||'').match(/linkedin\.com\/in\/([^/]+)/);
      const name = parts[0] || (urlMatch ? urlMatch[1].replace(/-/g,' ').replace(/[0-9]/g,'').trim() : raw.substring(0,25));
      return {name:name||raw.substring(0,25), current_title:parts[1]||'', current_company:t.company||parts[2]||'', source_platform:'linkedin', source_url:t.url||'', contact_type:t.url?'linkedin':'none', contact_value:t.url||''};
    });
    res.json({ talents, jds, industry, role, report_html:'' });
    return;
  }

  res.json({ error: 'Need position_id or list' });
  } catch(e) { res.status(500).json({error:e.message}); }
}
