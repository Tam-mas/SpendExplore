import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createStore } from './store.js';
import { createRouter } from './routes.js';
import { serveStatic } from './static.js';
import { sendJson, UserFacingError } from './http.js';

const HOST = '127.0.0.1';   // loopback only, never 0.0.0.0

export function createApp(store) {
  const route = createRouter(store);
  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
      return sendJson(res, 400, { error: 'Bad path' });
    }
    try {
      if (pathname.startsWith('/api/')) return await route(req, res, pathname);
      return await serveStatic(req, res, pathname);
    } catch (err) {
      // UserFacingError messages are written to be shown as-is. Anything
      // else is unexpected and may embed filesystem internals (Node's fs
      // and JSON.parse errors routinely include absolute paths), so it is
      // logged server-side for debugging but never sent to the client.
      if (err instanceof UserFacingError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  };
}

export async function startServer({ port = 5173, dataDir } = {}) {
  const store = createStore(dataDir ?? new URL('../data/', import.meta.url).pathname);
  await store.init();

  const server = createServer(createApp(store));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });

  return {
    server,
    store,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// Only auto-start when run directly, so tests can import it without starting a listener.
if (import.meta.url === `file://${process.argv[1]}`) {
  // DATA_DIR lets a live-testing session point at an isolated directory
  // instead of the real data/ — e.g. `DATA_DIR=./data-test npm run start:test`
  // (see package.json). This exists because a subagent once found real CSVs
  // sitting in a Downloads folder during live browser testing and imported
  // them into the real ledger. Never test against the real data/ directory.
  const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : undefined;
  const app = await startServer({ port: Number(process.env.PORT) || 5173, dataDir });
  console.log(`SpendExplore running at http://${HOST}:${app.port}${dataDir ? ` (data: ${dataDir})` : ''}`);
}
