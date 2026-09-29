// GET /api/health — for uptime monitors: which settings are present, never values
import { configStatus, requiredConfigOk } from './_lib/deps.js';

export default function handler(req, res) {
  const config = configStatus(process.env);
  const ok = requiredConfigOk(config);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(ok ? 200 : 503).json({ ok, config });
}
