// POST /api/confirmPayment (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { confirmPayment } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(confirmPayment, liveDeps);
