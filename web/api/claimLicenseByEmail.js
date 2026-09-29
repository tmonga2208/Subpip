// POST /api/claimLicenseByEmail (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { claimLicenseByEmail } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(claimLicenseByEmail, liveDeps);
