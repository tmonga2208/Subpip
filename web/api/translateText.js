// POST /api/translateText (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { translateText } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(translateText, liveDeps);
