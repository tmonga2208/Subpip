// POST /api/feedback — why someone uninstalled SubPIP (see _lib/feedback.js)
import { callable } from './_lib/http.js';
import { sendFeedback } from './_lib/feedback.js';
import { liveDeps } from './_lib/deps.js';

export default callable(sendFeedback, liveDeps);
