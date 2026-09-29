// The request/response protocol the extension and site already speak (it
// mirrors Firebase callable functions): POST { data } → { result } or
// { error: { message, status } }. Signed-in calls carry a Firebase ID token
// as `Authorization: Bearer <token>`.

export class HttpsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HTTP_STATUS = {
  'invalid-argument': 400,
  'failed-precondition': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'method-not-allowed': 405,
  internal: 500
};

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendError(res, status, message) {
  return res.status(HTTP_STATUS[status] || 400).json({ error: { message, status: status.toUpperCase().replace(/-/g, '_') } });
}

// A forged or expired token counts as signed out; handlers that need a user
// reject with 'unauthenticated'
async function verifyUser(req, auth) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, token: decoded };
  } catch {
    return null;
  }
}

export function callable(handler, getDeps) {
  return async (req, res) => {
    allowCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return sendError(res, 'method-not-allowed', 'Method Not Allowed');
    try {
      const deps = await getDeps();
      const data = (req.body && req.body.data) || {};
      const auth = await verifyUser(req, deps.auth);
      const result = await handler(data, { auth }, deps);
      return res.status(200).json({ result });
    } catch (error) {
      if (error instanceof HttpsError) return sendError(res, error.status, error.message);
      console.error('[api] Unexpected error:', error);
      return sendError(res, 'internal', 'Internal error');
    }
  };
}
