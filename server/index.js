import { createServer } from 'node:http';
import { createStore } from './store.js';
import { createRouter, serveStatic, sendJson } from './routes.js';

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
      sendJson(res, 500, { error: err.message });
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
  const app = await startServer({ port: Number(process.env.PORT) || 5173 });
  console.log(`SpendExplore running at http://${HOST}:${app.port}`);
}
