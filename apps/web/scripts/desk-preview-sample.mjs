import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../health/scripts/browser-cdp.mjs';
import { deskFixture } from '../test/runtime.mjs';

const imageDir = process.argv[2];
if (!imageDir || process.argv.length !== 3) throw new Error('用法：node scripts/desk-preview-sample.mjs <图片目录>');
const imageRoot = resolve(imageDir);
const imageFiles = (await readdir(imageRoot, { withFileTypes: true }))
  .filter(entry => entry.isFile() && ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(entry.name).toLowerCase()))
  .sort((a, b) => a.name.localeCompare(b.name));
assert.ok(imageFiles.length >= 2, '图片目录至少需要两张 PNG、JPEG 或 WebP 图片');

const artifacts = await mkdtemp(join(tmpdir(), 'kdp-desk-preview-sample-'));
await mkdir(artifacts, { recursive: true });
const fixture = await deskFixture();
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const origins = { desk: 'http://localhost:8804', auth: 'http://localhost:8795' };
const servers = [];
let browser;
let testOtp;
async function capturePage(page, path, selector) {
  const metrics = await page.cdp('Page.getLayoutMetrics');
  const size = metrics.cssContentSize ?? metrics.contentSize;
  const clip = selector
    ? await page.evaluate(target => {
      const element = document.querySelector(target);
      if (!element) throw new Error(`截图区域不存在：${target}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: element.scrollHeight, scale: 1 };
    }, selector)
    : { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
  const screenshot = await page.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip });
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
}
try {
  const blogShell = await readFile(join(root, 'blog/index.html'), 'utf8');
  const media = [];
  for (const entry of imageFiles.slice(0, 2)) {
    const bytes = await readFile(join(imageRoot, entry.name));
    const contentType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(entry.name).toLowerCase()];
    let result;
    if (bytes.length <= 1024 * 1024) {
      result = await fixture.rpc({
        subject: 'kdp-owner', client: 'desk-preview-sample', operation: 'media_upload',
        args: { alt: '本地合成配图', data_base64: bytes.toString('base64') },
      });
    }
    if (!result?.ok) {
      const started = await fixture.rpc({
        subject: 'kdp-owner', client: 'desk-preview-sample', operation: 'media_upload_start',
        args: { alt: '本地合成配图', bytes: bytes.length, content_type: contentType },
      });
      assert.equal(started.ok, true, '本地图片上传槽位创建必须成功');
      const uploaded = await (await fixture.runtime.getWorker('desk')).fetch(started.data.upload_url, {
        method: started.data.method, headers: started.data.headers, body: bytes,
      });
      assert.equal(uploaded.status, 201, '本地图片原始上传必须成功');
      result = { ok: true, data: await uploaded.json() };
    }
    assert.equal(result.ok, true, '本地图片上传必须成功');
    assert.ok(result.data?.id, '图片上传必须返回 id');
    media.push(result.data.id);
  }
  const bodyMarkdown = [
    '## 审核预览的结构',
    '',
    '这篇文章用于核对真实文章页嵌入 Desk 后的排版。',
    '',
    '> 先看结构，再看细节；预览应与公开文章使用同一套渲染。',
    '',
    '- 二级标题与引用',
    '- 列表与代码块',
    '- 两张带图注的配图',
    '',
    '```js',
    'const preview = "same article renderer";',
    'console.log(preview);',
    '```',
    '',
    `![本地配图一](/blog/media/${media[0]} "图注一：本地合成图片")`,
    '',
    `![本地配图二](/blog/media/${media[1]} "图注二：另一张本地合成图片")`,
  ].join('\n');
  const submitted = await fixture.rpc({
    subject: 'kdp-owner', client: 'desk-preview-sample', operation: 'submit',
    args: {
      slug: 'desk-preview-sample', title: 'Desk 预览样例：结构与配图', summary: '本地合成数据，用于核对博客审核预览。',
      body_markdown: bodyMarkdown, cover_media_id: media[0], category: 'digital-space',
      tags: ['本地验收'], sources: [{ title: '本地合成来源', url: 'https://example.test/desk-preview' }],
    },
  });
  assert.equal(submitted.ok, true, '本地样例稿件提交必须成功');

  for (const [id, origin] of Object.entries(origins)) {
    const worker = await fixture.runtime.getWorker(id);
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, origin);
        if (id === 'desk' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/blog/')) {
          const path = resolve(root, `.${decodeURIComponent(url.pathname)}${url.pathname.endsWith('/') ? 'index.html' : ''}`);
          if (!path.startsWith(root)) { response.writeHead(404); response.end(); return; }
          const body = await readFile(path);
          const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
          response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
          response.end(body);
          return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await worker.fetch(url, {
          method: request.method,
          headers: request.headers,
          redirect: 'manual',
          ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(chunks) } : {}),
        });
        if (id === 'auth' && url.pathname === '/api/auth/request-otp') testOtp = (await result.clone().json()).dev_otp;
        response.statusCode = result.status;
        for (const [key, value] of result.headers) if (key !== 'set-cookie') response.setHeader(key, value);
        if (result.headers.getSetCookie().length) response.setHeader('Set-Cookie', result.headers.getSetCookie());
        if (id === 'desk' && url.pathname.startsWith('/blog/') && !url.pathname.startsWith('/blog/media/') && result.ok) {
          const rendered = await result.text();
          const mount = rendered.match(/<section id="blog-list-mount"[\s\S]*?<\/section>/)?.[0];
          assert.ok(mount, 'Worker 必须渲染文章挂载点');
          let html = blogShell.replace(/<section id="blog-list-mount"[\s\S]*?<\/section>/, mount)
            .replace(/<section class="blog-empty-pavilion"[\s\S]*?<\/section>/, '');
          const bodyClass = rendered.match(/<body\s+class="([^"]+)"/)?.[1];
          if (bodyClass) html = html.replace('<body>', `<body class="${bodyClass}">`);
          if (url.pathname !== '/blog/') html = html.replace(/<header class="blog-header"[\s\S]*?<\/header>/, '');
          html = html.replace(/<title>[\s\S]*?<\/title>/, rendered.match(/<title>[\s\S]*?<\/title>/)[0]);
          response.end(html);
        } else response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(404);
        response.end('Fixture unavailable');
      }
    });
    await new Promise((resolveServer, reject) => {
      server.once('error', reject);
      server.listen(Number(new URL(origin).port), '127.0.0.1', resolveServer);
    });
    servers.push(server);
  }

  browser = await launchBrowser(artifacts);
  const page = browser.page;
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${origins.desk}/desk/`);
  await page.waitForSelector('#desk-login:not([hidden])');
  await page.click('#desk-login a');
  await page.waitForSelector('#send');
  await page.click('#send');
  await page.waitForSelector('#verify:not([hidden])');
  assert.ok(testOtp, '仅使用本地合成 OTP');
  await page.click('#code');
  await page.cdp('Input.insertText', { text: testOtp });
  await page.click('#submit');
  await page.waitForURL(`${origins.desk}/desk/`);
  await page.waitForFunction(() => document.querySelector('#blog-drafts-list [data-slug="desk-preview-sample"]'));
  await page.click('#blog-drafts-list [data-slug="desk-preview-sample"]');
  const waitForArticle = () => page.waitForFunction(() => {
    const frame = document.querySelector('#blog-review-detail iframe');
    const doc = frame?.contentDocument;
    const images = doc ? [...doc.images] : [];
    return Boolean(doc?.querySelector('.blog-article h2, .blog-article blockquote, .blog-article pre, .blog-article ul'))
      && images.length >= 3 && images.every(image => image.complete && image.naturalWidth > 0)
      && doc.querySelectorAll('figcaption').length >= 2 && Number.parseInt(frame.style.height, 10) > 600;
  });
  await waitForArticle();
  await capturePage(page, join(artifacts, 'desk-preview-desktop.png'));
  await capturePage(page, join(artifacts, 'desk-preview-desktop-review.png'), '.desk-review');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitForArticle();
  await capturePage(page, join(artifacts, 'desk-preview-mobile.png'));
  await capturePage(page, join(artifacts, 'desk-preview-mobile-review.png'), '.desk-review');
  const screenshots = ['desk-preview-desktop.png', 'desk-preview-desktop-review.png', 'desk-preview-mobile.png', 'desk-preview-mobile-review.png'];
  for (const name of screenshots) assert.ok((await stat(join(artifacts, name))).size > 0, `${name} 必须写入非空截图`);
  console.log(`Desk preview sample passed; screenshots: ${screenshots.map(name => join(artifacts, name)).join(', ')}`);
} finally {
  if (browser) await browser.close();
  for (const server of servers) await new Promise(resolveServer => server.close(resolveServer));
  await fixture.runtime.dispose();
  await fixture.sources.runtime.dispose();
}
