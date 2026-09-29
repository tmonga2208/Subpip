// POST /api/createOrder — server-priced Razorpay order (see _lib/orders.js)
import { callable } from './_lib/http.js';
import { createOrder } from './_lib/orders.js';
import { liveDeps } from './_lib/deps.js';

export default callable(createOrder, liveDeps);
