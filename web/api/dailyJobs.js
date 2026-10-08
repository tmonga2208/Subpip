// GET /api/dailyJobs — called by Vercel's scheduler once a day (vercel.json):
// reminds the buyers of one-year passes that end within a week, and ends the
// ones that are over (see _lib/passes.js). Each licence is marked as it is
// dealt with, so calling this again, by anybody, does nothing more.
import { endFinishedPasses } from './_lib/passes.js';
import { liveDeps } from './_lib/deps.js';
import { log } from './_lib/log.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await endFinishedPasses({}, {}, await liveDeps()));
  } catch (error) {
    log('error', 'daily-jobs-failed', { error: error.message });
    return res.status(500).json({ ok: false });
  }
}
