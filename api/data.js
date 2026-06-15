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
    let talents=[], jds=[];
    try { talents = JSON.parse(obj.talent_data||'[]'); } catch {}
    try { jds = JSON.parse(obj.jd_data||'[]'); } catch {}
    res.json({ talents, jds, report_html:'', vp_summary:'' });
    return;
  }

  res.json({ error: 'Need position_id or list' });
  } catch(e) { res.status(500).json({error:e.message}); }
}
