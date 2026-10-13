import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, login, migrate } from '../workers/api/test/integration/runtime.mjs';

const origin = 'http://127.0.0.1:4178';
const root = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
// Owner runtime: test-user == PERSONAL_OWNER_ID (full reports, no billing).
const ownerRuntime = createRuntime();
await ownerRuntime.ready;
await migrate(ownerRuntime);
// Free runtime: no owner configured, so test-user is a regular account that
// sees paywalls until subscribed.
const freeRuntime = createRuntime({ bindings: {
  ALLOW_DEV_LOGIN: '0',
  FRONTEND_ORIGIN: 'https://oura.example',
  OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
  OURA_CLIENT_ID: 'integration-client',
  OURA_CLIENT_SECRET: 'integration-client-secret',
  SESSION_SECRET: 'integration-session-secret',
  TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
  PERSONAL_OWNER_ID: '',
} });
await freeRuntime.ready;
await migrate(freeRuntime);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// Test-only server: ephemeral D1, mock Oura, loopback binding, no real secrets.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/__test/login') {
      const runtime = url.searchParams.get('free') === '1' ? freeRuntime : ownerRuntime;
      const cookie = await login(runtime);
      const db = await runtime.getD1Database('DB');
      await db.prepare('INSERT OR REPLACE INTO subscriptions (user_id, status) VALUES (?, ?)')
        .bind('test-user', url.searchParams.get('subscribed') === '1' ? 'active' : 'none').run();
      const jar = url.searchParams.get('free') === '1' ? 'free' : 'owner';
      res.writeHead(302, {
        'Set-Cookie': [
          `${cookie}; Path=/; HttpOnly; SameSite=Lax`,
          `oura_fixture_jar=${jar}; Path=/; SameSite=Lax`,
        ],
        Location: '/',
      });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const jar = /oura_fixture_jar=free/.test(req.headers.cookie || '') ? freeRuntime : ownerRuntime;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      // The Worker whitelists its own origin + FRONTEND_ORIGIN. The fixture
      // impersonates the trusted frontend origin for browser requests.
      const requestHeaders = { ...req.headers, origin: 'https://oura.example', referer: 'https://oura.example/' };
      // Public hostname exercises production auth gates, while data stays local.
      const response = await jar.dispatchFetch(`https://oura.example${url.pathname}${url.search}`, {
        method: req.method, headers: requestHeaders, redirect: 'manual',
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const headers = Object.fromEntries(response.headers);
      if (headers.location?.startsWith('https://oura.example')) {
        headers.location = headers.location.replace('https://oura.example', origin);
      }
      if (response.headers.getSetCookie().length) headers['set-cookie'] = response.headers.getSetCookie();
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== resolve(root) && !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end();
      return;
    }
    let file;
    try { file = await readFile(path); }
    catch {
      if (extname(path)) { res.writeHead(404).end(); return; }
      file = await readFile(resolve(root, 'index.html'));
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/html', 'Cache-Control': 'no-store' });
    res.end(file);
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Fixture server failed');
  }
});
server.listen(4178, '127.0.0.1', () => console.log(`Browser fixture ready: ${origin}`));
async function stop() {
  server.close();
  await ownerRuntime.dispose();
  await freeRuntime.dispose();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
