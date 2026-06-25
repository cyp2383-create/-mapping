/** POST /api/save-report — 保存顾问报告或播客剧本到Turso */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { position_id, chat_report, podcast_script } = req.body;
    if (!position_id) return res.status(400).json({ error: 'Need position_id' });

    // Ensure columns exist
    try {
      await fetch(process.env.TURSO_URL + '/v2/pipeline', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [
          { type: 'execute', stmt: { sql: "ALTER TABLE positions ADD COLUMN chat_report TEXT" } },
          { type: 'execute', stmt: { sql: "ALTER TABLE positions ADD COLUMN podcast_script TEXT" } }
        ]})
      });
    } catch {}

    const updates = [];
    if (chat_report) {
      const safe = JSON.stringify(chat_report).replace(/'/g, "''");
      updates.push(`chat_report='${safe}'`);
    }
    if (podcast_script) {
      const safe = JSON.stringify(podcast_script).replace(/'/g, "''");
      updates.push(`podcast_script='${safe}'`);
    }
    if (!updates.length) return res.json({ ok: true });

    const sql = `UPDATE positions SET ${updates.join(', ')} WHERE id=${Number(position_id)}`;

    const resp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }] })
    });
    const data = await resp.json();
    if (data.results?.[0]?.error) {
      console.error('Save failed:', data.results[0].error);
      return res.status(500).json({ error: 'Save failed' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
