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
assert.ok(imageFiles.length >= 3, '图片目录至少需要一张封面和两张正文 PNG、JPEG 或 WebP 图片');

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
  for (const entry of imageFiles.slice(0, 3)) {
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
    '### 具体核对项',
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
    `![本地配图一](/blog/media/${media[1]} "图注一：本地合成图片")`,
    '',
    `![本地配图二](/blog/media/${media[2]} "图注二：另一张本地合成图片")`,
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
  for (let i = 1; i <= 21; i++) {
    const extra = await fixture.rpc({
      subject: 'kdp-owner', client: 'desk-preview-sample', operation: 'submit',
      args: { slug: `desk-preview-online-${i}`, title: `分页样例文章 ${i}`, summary: '用于演示博客工作台每页 20 篇的已上架列表。', body_markdown: '## 分页样例\n\n这是一篇列表分页用的本地合成文章。', cover_media_id: media[0], category: i % 2 ? 'tech' : 'digital-space', tags: ['分页样例'], sources: [] },
    });
    assert.equal(extra.ok, true, '分页样例稿件提交必须成功');
  }
  await fixture.blog.prepare("INSERT INTO blog_posts (slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,published_at,updated_at,category,tags,series,sources) SELECT slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,submitted_at,updated_at,category,tags,series,sources FROM blog_drafts WHERE slug LIKE 'desk-preview-online-%'").run();
  await fixture.blog.prepare("UPDATE blog_drafts SET status='published' WHERE slug LIKE 'desk-preview-online-%'").run();

  for (const [id, origin] of Object.entries(origins)) {
    const worker = await fixture.runtime.getWorker(id);
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, origin);
        const deskBlogPreview = /^\/desk\/blog\/[a-z0-9][a-z0-9-]{0,79}\/$/.test(url.pathname);
        if (id === 'desk' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/blog/')) {
          const assetPath = deskBlogPreview ? '/desk/blog/' : url.pathname;
          const path = resolve(root, `.${decodeURIComponent(assetPath)}${assetPath.endsWith('/') ? 'index.html' : ''}`);
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
          const mountStart = rendered.indexOf('<section id="blog-list-mount"');
          const mountEnd = rendered.lastIndexOf('</section>') + '</section>'.length;
          const mount = mountStart >= 0 && mountEnd > mountStart ? rendered.slice(mountStart, mountEnd) : null;
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
  await page.waitForFunction(() => document.querySelector('#blog-review-summary')?.textContent.includes('1 篇待审'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${origins.desk}/desk/blog/?tab=pending`);
  await page.waitForFunction(() => document.querySelector('#blog-drafts-list [data-slug="desk-preview-sample"]'));
  await capturePage(page, join(artifacts, 'desk-blog-list-pending-desktop.png'));
  await page.goto(`${origins.desk}/desk/blog/?tab=published&page=2`);
  await page.waitForFunction(() => document.querySelector('#blog-published-list [data-slug]'));
  await capturePage(page, join(artifacts, 'desk-blog-list-desktop.png'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.goto(`${origins.desk}/desk/blog/?tab=published&page=2`);
  await page.waitForFunction(() => document.querySelector('#blog-published-list [data-slug]'));
  await capturePage(page, join(artifacts, 'desk-blog-list-mobile.png'));
  await page.goto(`${origins.desk}/desk/blog/?tab=pending`);
  await page.waitForFunction(() => document.querySelector('#blog-drafts-list [data-slug="desk-preview-sample"]'));
  await page.click('#blog-drafts-list [data-slug="desk-preview-sample"]');
  await page.waitForURL(`${origins.desk}/desk/blog/desk-preview-sample/?tab=pending`);
  const waitForArticle = async () => {
    await page.waitForFunction(() => {
      const frame = document.querySelector('#blog-review-detail iframe');
      const doc = frame?.contentDocument;
      const images = doc ? [...doc.images] : [];
      return Boolean(doc?.querySelector('.personal-article-content h2, .personal-article-content blockquote, .personal-article-content pre'))
        && images.length >= 3 && images.every(image => image.complete && image.naturalWidth > 0)
        && doc.querySelectorAll('figcaption').length >= 2;
    });
    await page.evaluate(async () => {
      const frame = document.querySelector('#blog-review-detail iframe');
      const images = frame?.contentDocument ? [...frame.contentDocument.images] : [];
      await Promise.all(images.map(image => image.decode().catch(() => undefined)));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  };
  await waitForArticle();
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await waitForArticle();
  await capturePage(page, join(artifacts, 'desk-blog-preview-desktop.png'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitForArticle();
  await capturePage(page, join(artifacts, 'desk-blog-preview-mobile.png'));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('#blog-review-detail [data-review-action="publish"]');
  await page.waitForFunction(() => location.href.includes('/desk/blog/?result=published'));
  await page.goto(`${origins.desk}/blog/desk-preview-sample/`);
  await page.waitForSelector('.blog-article');
  await capturePage(page, join(artifacts, 'blog-public-desktop.png'));
  const screenshots = ['desk-blog-list-pending-desktop.png', 'desk-blog-list-desktop.png', 'desk-blog-list-mobile.png', 'desk-blog-preview-desktop.png', 'desk-blog-preview-mobile.png', 'blog-public-desktop.png'];
  for (const name of screenshots) assert.ok((await stat(join(artifacts, name))).size > 0, `${name} 必须写入非空截图`);
  console.log(`Desk preview sample passed; screenshots: ${screenshots.map(name => join(artifacts, name)).join(', ')}`);
} finally {
  if (browser) await browser.close();
  for (const server of servers) await new Promise(resolveServer => server.close(resolveServer));
  await fixture.runtime.dispose();
  await fixture.sources.runtime.dispose();
}
