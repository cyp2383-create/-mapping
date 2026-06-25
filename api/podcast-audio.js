/** GET /api/podcast-audio?position_id=X — Edge TTS神经网络双人声MP3 */
import { tts } from 'edge-tts';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { position_id } = req.query;
  if (!position_id) return res.status(400).json({ error: 'Need position_id' });

  try {
    const dbResp = await fetch(process.env.TURSO_URL + '/v2/pipeline', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT podcast_script FROM positions WHERE id=' + Number(position_id) } }] })
    });
    const dbData = await dbResp.json();
    const raw = dbData.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value;
    if (!raw) return res.status(404).json({ error: 'No podcast script' });

    let script = raw;
    try { script = JSON.parse(raw); } catch {}
    const lines = [];
    (script || '').split('\n').forEach(l => {
      const m = l.trim().match(/【(小研|小诺)】(.*)/);
      if (m) lines.push({ host: m[1], text: m[2].trim() });
    });
    if (!lines.length) return res.status(400).json({ error: 'Could not parse' });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const voice = l.host === '小研' ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunxiNeural';
      const rate = l.host === '小研' ? '+5%' : '+10%';
      try {
        const buf = await tts(l.text, { voice, rate });
        res.write(buf);
      } catch(e) { console.error(`Line ${i} failed:`, e.message); }
    }
    res.end();
  } catch(e) {
    console.error('Podcast audio:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
}
