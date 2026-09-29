// POST /api/resendLicense — "Lost your key?" (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { resendLicense } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(resendLicense, liveDeps);
