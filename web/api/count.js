// POST /api/count — one anonymous usage count from the extension (see _lib/counts.js)
import { callable } from './_lib/http.js';
import { countUsage } from './_lib/counts.js';
import { liveDeps } from './_lib/deps.js';

export default callable(countUsage, liveDeps);
