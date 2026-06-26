/** GET /api/delete-corrupt — 删除talent_data也已损坏的不可恢复记录 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: "SELECT id, name, talent_data FROM positions WHERE name LIKE '%�%' OR name NOT LIKE '%产品%' AND name NOT LIKE '%采购%' AND name NOT LIKE '%PM%' AND name NOT LIKE '%AI%'" } }] })
    });
    const d = await r.json();
    const rows = d.results?.[0]?.response?.result?.rows || [];
    let deleted = 0;
    for (const row of rows) {
      const id = row[0]?.value, name = row[1]?.value || '';
      // Check if talent_data is also garbled
      try {
        const td = JSON.parse(row[2]?.value || '{}');
        if (!td._name || td._name.includes('�') || /^[\x00-\x7F]+$/.test(td._name)) {
          await fetch(process.env.TURSO_URL + '/v2/pipeline', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: `DELETE FROM positions WHERE id=${id}` } }] })
          });
          deleted++;
        }
      } catch { deleted++; /* If can't parse talent_data, it's corrupt */ }
    }
    res.json({ deleted, total: rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}
