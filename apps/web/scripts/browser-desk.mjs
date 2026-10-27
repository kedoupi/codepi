import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../health/scripts/browser-cdp.mjs';
import { deskFixture } from '../test/runtime.mjs';
import { calendarDay, shiftDay } from '@kedoupi/shared/desk/contract';
import { deflateSync } from 'node:zlib';

function syntheticCover() {
  const width = 1200, height = 675;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Flat geometric fields make cropping and image loading visible at any viewport.
      let color = [244, 231, 208];
      if (x > 720) color = [92, 128, 119];
      if ((x - 360) ** 2 + (y - 325) ** 2 < 220 ** 2) color = [216, 108, 65];
      if (y > 480 && x < 900) color = [69, 77, 83];
      if (x > 900 && y < 140) color = [234, 190, 91];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels.set(color, offset);
    }
  }
  const chunk = (type, bytes) => {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, bytes])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, name, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

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
  const blogShell = await readFile(join(root, 'blog/index.html'), 'utf8');
  const image = await f.rpc({ subject: 'kdp-owner', client: 'browser-fixture', operation: 'media_upload', args: { alt: '本地合成封面：橙色圆形、绿色矩形与深灰横条', data_base64: syntheticCover().toString('base64') } });
  assert.ok(image.ok);
  const coverId = image.data.id;
  const syntheticBody = `## 阅读与排版\n\n这是一篇用于本地验收的合成文章。\n\n![合成测试图片](/blog/media/${coverId} "图片说明：本地合成数据")\n\n\`\`\`mermaid\nflowchart TD\n    U[开发者 / 企业用户] --> A[Codex 或其他 Agent]\n    A --> T[工具执行与权限控制]\n    A --> R[模型路由与调用接口]\n    R --> O[OpenAI 直接服务]\n    R --> G[Google Cloud 模型入口]\n    R --> X[其他模型供应商]\n    T --> L[日志、审计与任务结果]\n    R --> L\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n    A[桌面 / Web / IM 入口] --> B[Agent 工作流与任务状态]\n    B --> C[模型路由与统一观测]\n    C --> D[OpenAI]\n    C --> E[Google Cloud]\n    C --> F[其他供应商]\n    B --> G[工具权限 / 审批 / 执行日志]\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n    Broken[无效图表\n\`\`\`\n\n\`\`\`js\n${'const readable = "overflow stays inside code"; '.repeat(14)}\n\`\`\`\n\n| 项目 | 说明 | 备注 |\n| --- | --- | --- |\n| 表格滚动 | ${'较长的表格内容'.repeat(12)} | 完整保留 |`;
  for (let i = 0; i < 13; i++) {
    const result = await f.rpc({ subject: 'kdp-owner', client: 'browser-fixture', clientName: '本地浏览器验收', operation: 'submit', args: { slug: `browser-article-${i}`, title: `合成文章 ${i}：个人数字空间的观察与记录`, summary: '用于验收封面、日期、分页及阅读排版的本地合成内容。', body_markdown: syntheticBody, cover_media_id: coverId } });
    assert.ok(result.ok);
  }
  // Seed publication snapshots locally; browser review exercises the thirteenth draft.
  await f.blog.prepare(`INSERT INTO blog_posts(slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,published_at,updated_at) SELECT slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,submitted_at,updated_at FROM blog_drafts WHERE slug <> 'browser-article-12'`).run();
  await f.blog.prepare("UPDATE blog_drafts SET status='published' WHERE slug <> 'browser-article-12'").run();
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
        if (id === 'desk' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/blog/')) {
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
        if (id === 'desk' && url.pathname.startsWith('/blog/') && !url.pathname.startsWith('/blog/media/') && response.ok) {
          const rendered = await response.text();
          const mount = rendered.match(/<section id="blog-list-mount"[\s\S]*?<\/section>/)?.[0];
          assert.ok(mount, 'Worker renders the article or listing mount');
          let html = blogShell.replace(/<section id="blog-list-mount"[\s\S]*?<\/section>/, mount)
            .replace(/<section class="blog-empty-pavilion"[\s\S]*?<\/section>/, '');
          if (url.pathname !== '/blog/') html = html.replace(/<header class="blog-header"[\s\S]*?<\/header>/, '');
          html = html.replace(/<title>[\s\S]*?<\/title>/, rendered.match(/<title>[\s\S]*?<\/title>/)[0]);
          res.end(html);
        } else res.end(Buffer.from(await response.arrayBuffer()));
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
  await page.waitForFunction(() => document.querySelector('#blog-drafts-list [data-review-action="publish"]'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.desk-review').scrollIntoView({ behavior: 'instant', block: 'start' }); });
  await page.screenshot({ path: 'desk-blog-review-desktop.png' });
  // Read the full text and inline images without leaving the Desk.
  await page.click('#blog-drafts-list .desk-review-full > summary');
  await page.waitForSelector('#blog-drafts-list .desk-review-full[open] .personal-article-content img');
  await page.screenshot({ path: 'desk-blog-fulltext-desktop.png' });
  // Archive removes the draft from the queue; restore brings it back.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => document.querySelector('#blog-drafts-list [data-review-action="archive"]').click());
  await page.waitForFunction(() => document.querySelector('#blog-review-status').textContent.includes('稿件已归档'));
  await page.waitForSelector('#blog-archived-list [data-review-action="restore"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#blog-drafts-list [data-slug]').length), 0);
  await page.evaluate(() => document.querySelector('#blog-archived-list [data-review-action="restore"]').click());
  await page.waitForFunction(() => document.querySelector('#blog-review-status').textContent.includes('已恢复'));
  await page.waitForSelector('#blog-drafts-list [data-review-action="publish"]');
  await page.evaluate(() => { window.confirm = message => { window.__reviewConfirmation = message; return true; }; });
  await page.evaluate(() => document.querySelector('#blog-drafts-list [data-review-action="publish"]').click());
  await page.waitForFunction(() => document.querySelector('#blog-review-status').textContent.includes('文章已发布'));
  assert.match(await page.evaluate(() => window.__reviewConfirmation), /修订 1/);
  assert.equal((await f.blog.prepare("SELECT revision FROM blog_posts WHERE slug='browser-article-12'").first()).revision, 1);
  await page.goto(origins.desk + '/blog/');
  await page.waitForSelector('.blog-card');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(resource => resource.name.includes('mermaid'))), false, 'the listing does not load Mermaid without a chart');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.blog-card').length), 12);
  await page.screenshot({ path: 'blog-list-desktop.png' });
  await page.click('.blog-pagination [rel="next"]');
  await page.waitForFunction(() => document.querySelectorAll('.blog-card').length === 1);
  await page.screenshot({ path: 'blog-list-page-two.png' });
  await page.click('.blog-card');
  await page.waitForSelector('.blog-article-cover');
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  assert.deepEqual(await page.evaluate(() => { const image = document.querySelector('.blog-article-cover'); return [image.naturalWidth, image.naturalHeight]; }), [1200, 675]);
  const articlePresentation = await page.evaluate(() => {
    const cover = document.querySelector('.blog-article-cover');
    const content = document.querySelector('.personal-article-content img');
    const box = image => { const rect = image.getBoundingClientRect(); return { width: rect.width, height: rect.height, fit: getComputedStyle(image).objectFit }; };
    return { cover: box(cover), content: box(content), reading: document.querySelector('.blog-article-header').getBoundingClientRect().width };
  });
  assert.equal(articlePresentation.cover.fit, 'contain');
  assert.ok(articlePresentation.cover.width > articlePresentation.reading && articlePresentation.cover.width <= 920 && articlePresentation.cover.height <= 680, 'the landscape cover is wider than the text but bounded');
  assert.ok(articlePresentation.content.width <= 680 && articlePresentation.content.height <= 680, 'content images stay within the reading bounds');
  assert.ok(await page.evaluate(() => document.querySelector('figcaption').textContent.length > 0));
  await page.waitForFunction(() => document.querySelectorAll('.blog-mermaid svg').length === 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.blog-mermaid svg').length), 2);
  assert.match(await page.evaluate(() => document.querySelector('.blog-mermaid').textContent), /模型路由与调用接口/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.blog-mermaid-source').length), 2);
  await page.waitForSelector('pre[data-mermaid-state="failed"]');
  assert.match(await page.evaluate(() => document.querySelector('.blog-mermaid-error').textContent), /已保留 Mermaid 源码/);
  assert.match(await page.evaluate(() => document.querySelector('pre[data-mermaid-state="failed"]').textContent), /无效图表/);
  await page.screenshot({ path: 'blog-article-desktop.png' });
  await page.evaluate(() => document.querySelector('.blog-mermaid').scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.screenshot({ path: 'blog-article-mermaid-desktop.png' });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `article fits ${width}px`);
  }
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'blog-article-mobile.png' });
  await page.goto(await page.evaluate(() => location.href));
  await page.waitForFunction(() => document.querySelectorAll('.blog-mermaid svg').length === 2);
  await page.evaluate(() => document.querySelector('.blog-mermaid').scrollIntoView({ behavior: 'instant', block: 'center' }));
  assert.ok(await page.evaluate(() => { const chart = document.querySelector('.blog-mermaid'); return chart.scrollWidth > chart.clientWidth && chart.scrollLeft > 0; }), 'mobile charts center the root inside their own scroll region');
  await page.screenshot({ path: 'blog-article-mermaid-mobile.png' });
  await page.evaluate(() => document.querySelector('.blog-mermaid-source summary').click());
  assert.equal(await page.evaluate(() => document.querySelector('.blog-mermaid-source').open), true);
  await page.evaluate(() => document.querySelector('.blog-mermaid-source summary').click());
  await page.evaluate(() => document.querySelector('code.language-js').parentElement.scrollIntoView({ behavior: 'instant', block: 'center' }));
  assert.ok(await page.evaluate(() => { const pre = document.querySelector('code.language-js').parentElement; return pre.scrollWidth > pre.clientWidth; }));
  await page.screenshot({ path: 'blog-article-mobile-code.png' });
  await page.goto(origins.desk + '/blog/');
  await page.waitForSelector('.blog-card-cover');
  const cardPresentation = await page.evaluate(() => { const image = document.querySelector('.blog-card-cover'); return { fit: getComputedStyle(image).objectFit, ratio: image.getBoundingClientRect().width / image.getBoundingClientRect().height }; });
  assert.equal(cardPresentation.fit, 'contain');
  assert.ok(Math.abs(cardPresentation.ratio - 16 / 9) < 0.02, 'list covers keep a consistent frame without cropping');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'blog-list-mobile.png' });
  await page.goto(origins.desk + '/desk/');
  await page.waitForFunction(() => document.querySelector('#desk-status').textContent.includes('概览已读取'));
  await page.waitForFunction(() => document.querySelectorAll('#blog-published-list article').length === 13);
  f.faults.health = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return new Response('', { status: 503 }); };
  await page.click('#desk-generate');
  await page.click('#desk-logout');
  await page.waitForFunction(() => document.querySelector('#desk-login-note').textContent.includes('已退出'));
  assert.equal(await page.evaluate(() => document.querySelector('#desk-private').hidden), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.desk-summary-section').length), 0);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#blog-drafts-list article, #blog-published-list article, .desk-review img, .desk-review textarea').length), 0);
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
