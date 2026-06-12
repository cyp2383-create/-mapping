/** GET /api/data — 查询Turso数据库 */
export default async function handler(req, res) {
  const { position_id, list } = req.query;

  async function query(sql, params=[]) {
    const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, params: params.map(String) } }] })
    });
    const d = await resp.json();
    const r = d.results?.[0]?.response?.result;
    return { rows: r?.rows || [], cols: r?.cols?.map(c=>c.name) || [] };
  }

  if (list) {
    const { rows, cols } = await query("SELECT * FROM positions ORDER BY created_at DESC");
    const positions = rows.map(r => {
      const obj = {};
      cols.forEach((c,i) => obj[c] = r[i].value);
      return obj;
    });
    res.json({ positions });
    return;
  }

  if (position_id) {
    const t = await query("SELECT * FROM talents WHERE position_id=? LIMIT 100", [position_id]);
    const j = await query("SELECT * FROM jds WHERE position_id=? LIMIT 100", [position_id]);
    const mapRows = (r, cols) => r.rows.map(row => {
      const obj = {};
      cols.forEach((c,i) => { obj[c] = row[i]?.value; });
      return obj;
    });
    res.json({
      talents: mapRows(t, t.cols),
      jds: mapRows(j, j.cols)
    });
    return;
  }

  res.json({ error: 'Need position_id or list' });
}
