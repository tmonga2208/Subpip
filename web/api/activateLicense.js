// POST /api/activateLicense (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { activateLicense } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(activateLicense, liveDeps);
