// Small HTTP-layer primitives shared by every route handler: JSON
// responses, a size-capped request-body reader, and the error class that
// marks a message as safe to show a client verbatim.

// An error whose message is safe, and intended, to send straight to the
// client in an HTTP response body. Everything else that reaches the
// top-level catch-all in server/index.js is treated as unexpected and never
// shown verbatim — Node's fs and JSON errors routinely embed absolute
// filesystem paths (e.g. "ENOENT: ... open '/Users/tam/.../ledger.json'"),
// which would otherwise leak the user's directory layout into the response.
//
// `status` defaults to 500 because the one original source of UserFacingError
// (server/store.js's corrupt-JSON message) describes a server-side data
// problem, not a malformed request — but it's left overridable so a future
// caller (e.g. a bad-input error from an import endpoint) can use 400
// without needing a second error class.
export class UserFacingError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'UserFacingError';
    this.status = status;
  }
}

export const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
};

export const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    // Guard against an unbounded upload filling memory.
    if (size > 50 * 1024 * 1024) { reject(new Error('Request body too large (limit 50MB)')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '') return resolve({});
    try { resolve(JSON.parse(text)); } catch { reject(new Error('Request body is not valid JSON')); }
  });
  req.on('error', reject);
});
