// POST /api/startCheckout — ties a purchase to the signed-in account (see _lib/checkout.js)
import { callable } from './_lib/http.js';
import { startCheckout } from './_lib/checkout.js';
import { liveDeps } from './_lib/deps.js';

export default callable(startCheckout, liveDeps);
