import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../health/scripts/browser-cdp.mjs';
import { deskFixture } from '../test/runtime.mjs';
import { calendarDay, shiftDay } from '@kedoupi/shared/desk/contract';

const artifacts = await mkdtemp(join(tmpdir(), 'kdp-desk-browser-'));
await mkdir(artifacts, { recursive: true });
const f = await deskFixture();
const servers = [];
let browser;
let failure;
let testOtp;
let deskMeRequests = 0;
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const origins = { desk: 'http://localhost:8804', auth: 'http://localhost:8795' };
try {
  const deskHtml = await readFile(join(root, 'desk/index.html'), 'utf8');
  assert.match(deskHtml, /name="robots" content="noindex, nofollow"/);
  assert.ok(!(await readFile(join(root, 'sitemap-0.xml'), 'utf8')).includes('/desk/'));
  assert.ok(!deskHtml.includes('synthetic-owner') && !deskHtml.includes('DESK_SUMMARY_TOKEN'));
  const today = calendarDay();
  const health = f.sources.dbs.health;
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(today, -i);
    await health.prepare('INSERT INTO daily_cache VALUES(?,?,?)').bind('synthetic-owner', day,
      JSON.stringify({ date: day, sleep: { score: 80 + i }, readiness: { score: 85 }, activity: { steps: 6000 + i * 100 } })).run();
  }
  await health.prepare('INSERT INTO sync_state VALUES(?,?,?)').bind('synthetic-owner', new Date().toISOString(), null).run();
  const gu = f.sources.dbs.gu;
  await gu.prepare('INSERT INTO dashboard_batches VALUES(?,?,?,?)').bind('synthetic-batch', new Date().toISOString(), new Date().toISOString(),
    JSON.stringify({ account: [{ total_usd: 12345 }], risk: [{ rule_id: 'fixture', item: '测试规则', triggered: false, proximity: 'near' }] })).run();
  await gu.prepare("INSERT INTO dashboard_current VALUES(1,'synthetic-batch')").run();
  const wechat = f.sources.dbs.wechat;
  await wechat.prepare('INSERT INTO posts VALUES(?,?,?,?,?)').bind('synthetic-post', '测试稿件：一次整理的记录', '待审', 0, new Date().toISOString()).run();
  for (const [id, origin] of Object.entries(origins)) {
    const worker = await f.runtime.getWorker(id);
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin);
        if (id === 'desk' && !url.pathname.startsWith('/api/')) {
          const path = resolve(root, '.' + decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
          if (!path.startsWith(root)) { res.writeHead(404); res.end(); return; }
          const body = await readFile(path);
          const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); res.end(body); return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (id === 'desk' && url.pathname === '/api/desk/me') deskMeRequests++;
        const response = await worker.fetch(url, {
          method: req.method, headers: req.headers, redirect: 'manual',
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        });
        if (id === 'auth' && url.pathname === '/api/auth/request-otp') {
          testOtp = (await response.clone().json()).dev_otp;
        }
        res.statusCode = response.status;
        for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
        if (response.headers.getSetCookie().length) res.setHeader('Set-Cookie', response.headers.getSetCookie());
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.writeHead(404); res.end('Fixture unavailable'); }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(new URL(origin).port), '127.0.0.1', resolve);
    });
    servers.push(server);
  }
  browser = await launchBrowser(artifacts);
  const page = browser.page;
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await page.goto(origins.desk + '/desk/');
  await page.waitForFunction(() => !document.querySelector('#desk-login').hidden);
  assert.equal(await page.evaluate(() => document.querySelector('#desk-private').hidden), true);
  await page.screenshot({ path: 'desk-login.png' });
  await page.click('#desk-login a');
  await page.waitForSelector('#send');
  await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#verify').hidden);
  assert.ok(testOtp, 'Only a local synthetic OTP is used');
  await page.click('#code');
  await page.cdp('Input.insertText', { text: testOtp });
  await page.click('#submit');
  await page.waitForURL(origins.desk + '/desk/');
  await page.waitForFunction(() => document.querySelector('#desk-status').textContent.includes('概览已读取'));
  const initialDeskMeRequests = deskMeRequests;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    document.querySelector('#desk-retry').click();
  });
  await page.waitForFunction(() => document.querySelector('#desk-status').textContent.includes('概览已读取'));
  assert.equal(deskMeRequests, initialDeskMeRequests + 1, 'concurrent initialize triggers share one me request');
  const appearance = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--kdp-canvas').trim(),
    columns: getComputedStyle(document.querySelector('.desk-overview')).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(appearance.canvas.toLowerCase(), '#faf8f4');
  assert.match(appearance.font, /MiSans|Inter/);
  assert.equal(appearance.columns, 3);
  assert.equal(appearance.overflow, false);
  assert.equal(await page.evaluate(() => document.querySelector('details').open), false);
  await page.click('#desk-generate');
  await page.waitForFunction(() => document.querySelectorAll('.desk-summary-section').length === 3);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'desk-desktop.png' });
  await page.click('input[value="week"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.desk-summary-section').length), 0);
  await page.click('#desk-generate');
  await page.waitForFunction(() => document.querySelector('#desk-summary-output').textContent.includes('7/7'));
  await page.click('#desk-refresh');
  await page.waitForFunction(() => !document.querySelector('#desk-refresh').disabled);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.desk-summary-section').length), 0);

  f.faults.gu = () => new Response('', { status: 503 });
  await page.click('#desk-refresh');
  await page.waitForFunction(() => document.querySelector('#desk-status').textContent.includes('部分来源'));
  assert.match(await page.evaluate(() => document.querySelector('[data-source="gu"]').innerText), /暂不可用/);
  delete f.faults.gu;
  await page.click('#desk-refresh');
  await page.waitForFunction(() => !document.querySelector('#desk-refresh').disabled);
  for (const source of ['health', 'gu', 'wechat']) f.faults[source] = () => Response.json({
    source, status: 'empty', asOf: null, updatedAt: null, stale: false,
    metrics: [], facts: [], notes: ['测试空状态：尚无已保存记录。'], attention: [],
  });
  await page.click('#desk-refresh');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-state]')].every(node => node.textContent === '暂无数据'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.desk-metrics dd').length), 0);
  await page.screenshot({ path: 'desk-empty.png' });
  for (const source of ['health', 'gu', 'wechat']) delete f.faults[source];
  await page.click('#desk-refresh');
  await page.waitForFunction(() => !document.querySelector('#desk-refresh').disabled);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.desk-overview')).gridTemplateColumns.split(' ').length), 1);
  assert.ok(await page.evaluate(() => {
    const rect = document.querySelector('.kdp-mobile-nav-toggle').getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44 && rect.right <= innerWidth;
  }), 'The mobile navigation toggle remains visible and tappable on mobile');
  await page.screenshot({ path: 'desk-mobile.png' });
  await page.click('#desk-generate');
  await page.waitForFunction(() => document.querySelectorAll('.desk-summary-section').length === 3);
  await page.screenshot({ path: 'desk-mobile-summary.png' });
  f.faults.health = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return new Response('', { status: 503 }); };
  await page.click('#desk-generate');
  await page.click('#desk-logout');
  await page.waitForFunction(() => document.querySelector('#desk-login-note').textContent.includes('已退出'));
  assert.equal(await page.evaluate(() => document.querySelector('#desk-private').hidden), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.desk-summary-section').length), 0);
  assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('测试稿件'));
  assert.deepEqual(page.diagnostics.filter(event => event.method === 'Runtime.exceptionThrown'), []);
  console.log(`Desk browser checks passed; synthetic-data screenshots: ${artifacts}`);
} catch (error) {
  failure = error;
  console.error(`Desk browser failed; artifacts: ${artifacts}`);
  throw error;
} finally {
  if (browser) { await browser.page.saveDiagnostics(failure); await browser.close(); }
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  await f.runtime.dispose();
  await f.sources.runtime.dispose();
}
