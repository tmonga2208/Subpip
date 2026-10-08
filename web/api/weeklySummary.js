// GET /api/weeklySummary — the week's anonymous counts, emailed to the owner.
// Called by Vercel's scheduler on Monday mornings (vercel.json). It sends at
// most once a day whoever calls it, so the address needs no secret.
import { weeklySummary } from './_lib/counts.js';
import { liveDeps } from './_lib/deps.js';
import { log } from './_lib/log.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await weeklySummary({}, {}, await liveDeps()));
  } catch (error) {
    log('error', 'weekly-summary-failed', { error: error.message });
    return res.status(500).json({ ok: false });
  }
}
