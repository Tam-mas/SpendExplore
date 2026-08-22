// An error whose message is safe, and intended, to send straight to the
// client in an HTTP response body. Everything else that reaches the
// top-level catch-all in server/index.js is treated as unexpected and never
// shown verbatim — Node's fs and JSON errors routinely embed absolute
// filesystem paths (e.g. "ENOENT: ... open '/Users/tam/.../ledger.json'"),
// which would otherwise leak the user's directory layout into the response.
//
// `status` defaults to 500 because the one current source of UserFacingError
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
