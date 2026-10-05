// POST /api/feedback — why someone uninstalled SubPIP, or what did not work
// for them on a site (see _lib/feedback.js)
import { callable } from './_lib/http.js';
import { sendFeedback } from './_lib/feedback.js';
import { liveDeps } from './_lib/deps.js';

export default callable(sendFeedback, liveDeps);
