// GET /api/scheduled — called by Vercel's scheduler every morning
// (vercel.json); see _lib/scheduled.js. Everything it does is marked as done,
// so calling it again, by anybody, does nothing more.
import { runScheduled } from './_lib/scheduled.js';
import { liveDeps } from './_lib/deps.js';
import { log } from './_lib/log.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await runScheduled(req.query || {}, await liveDeps()));
  } catch (error) {
    log('error', 'scheduled-failed', { error: error.message });
    return res.status(500).json({ ok: false });
  }
}
