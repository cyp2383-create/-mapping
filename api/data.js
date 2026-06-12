/** GET /api/data — 查询已有数据 */
export default async function handler(req, res) {
  const { position_id, list } = req.query;

  if (list) {
    // Return list of positions (placeholder)
    res.json({ positions: [] });
    return;
  }

  if (position_id) {
    // Return position data from Turso (placeholder)
    res.json({ talents: [], jds: [] });
    return;
  }

  res.json({ error: 'Need position_id or list' });
}
