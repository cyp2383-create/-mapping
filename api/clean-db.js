/** GET /api/clean-db — 修复positions表中的中文乱码,从talent_data JSON恢复真实名称 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const listResp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT id, name, talent_data FROM positions' } }] })
    });
    const listData = await listResp.json();
    const rows = listData.results?.[0]?.response?.result?.rows || [];
    let fixed = 0;

    for (const row of rows) {
      const id = row[0]?.value;
      const currentName = row[1]?.value || '';
      const talentData = row[2]?.value || '{}';

      // Check if name is garbled (contains replacement characters or only ASCII when it shouldn't)
      try {
        const parsed = JSON.parse(talentData);
        const realName = parsed._name || '';
        const realIndustry = parsed._industry || '';
        const realRole = parsed._role || '';
        const updates = [];
        if (realName && (currentName.includes('�') || /^[\x00-\x7F]+$/.test(currentName)) && realName !== currentName) {
          updates.push(`name='${realName.replace(/'/g, "''")}'`);
        }
        if (realIndustry) updates.push(`industry='${realIndustry.replace(/'/g, "''")}'`);
        if (realRole) updates.push(`role_direction='${realRole.replace(/'/g, "''")}'`);
        if (updates.length) {
          await fetch(process.env.TURSO_URL + '/v2/pipeline', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: `UPDATE positions SET ${updates.join(', ')} WHERE id=${id}` } }] })
          });
          fixed++;
        }
      } catch {}
    }
    res.json({ fixed, total: rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}
