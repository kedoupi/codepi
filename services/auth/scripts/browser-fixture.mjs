import { createServer } from 'node:http';
import { fixture, clients, authOrigin } from '../test/runtime.mjs';
const f = await fixture();
const origins = [['auth', authOrigin], ...Object.entries(clients).map(([id, c]) => [id, new URL(c.redirectUris[0]).origin])];
const servers = [];
for (const [id, origin] of origins) {
  const worker = await f.runtime.getWorker(id);
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await worker.fetch(new URL(req.url, origin), {
        method: req.method, headers: req.headers, redirect: 'manual',
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      res.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
      if (response.headers.getSetCookie().length) res.setHeader('Set-Cookie', response.headers.getSetCookie());
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('Fixture unavailable'); }
  });
  await new Promise(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
  servers.push(server);
}
console.log('SSO browser fixture ready: auth localhost:8795, clients localhost:8801/8802/8803/8804');
async function close() {
  for (const server of servers) server.close();
  await f.runtime.dispose();
  process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
