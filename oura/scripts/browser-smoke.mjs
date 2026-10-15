// Executed by ego-browser nodejs, not plain Node.
const { default: assert } = await import('node:assert/strict');
const options = globalThis.ouraSmokeOptions || {};
const existingSpace = options.spaceId;
const task = await taskSpace(existingSpace || 'Oura browser regression');
console.log({ spaceId: task.spaceId });
const page = task.page(options.page || 'p1');
const origin = 'http://127.0.0.1:4178';
await page.cdp('Emulation.clearDeviceMetricsOverride');
const instrumentation = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__smokeFailures = [];
    window.__smokeConsole = [];
    for (const level of ['error', 'warn']) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        window.__smokeConsole.push(level + ': ' + args.map(String).join(' '));
        original(...args);
      };
    }
    window.addEventListener('error', e => { if(e.message) window.__smokeFailures.push(e.message); });
    window.addEventListener('unhandledrejection', () => window.__smokeFailures.push('Unhandled rejection'));
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = new URL(response.url);
      if (url.pathname.startsWith('/api/') && !response.ok)
        window.__smokeFailures.push(url.pathname + ': HTTP ' + response.status);
      return response;
    };`,
});
async function healthy(label) {
  const result = await page.evaluate(() => ({
    origin: location.origin,
    path: location.pathname,
    lang: document.documentElement.lang,
    landing: Boolean(document.querySelector('#landing-view')),
    title: document.title,
    meaningfulContent: document.body.textContent.trim().length > 100,
    frameworkOverlay: Boolean(document.querySelector('vite-error-overlay')),
    errors: window.__smokeFailures || [],
    console: window.__smokeConsole || [],
    banners: [...document.querySelectorAll('.status.err')].map(el => el.textContent),
  }));
  assert.equal(result.origin, origin, label);
  const titles = {
    '/': ['健康看板', 'Health board'],
    '/sleep': ['睡眠与恢复', 'Sleep & recovery'],
    '/insights': ['本周解读', 'Weekly insights'],
    '/compare': ['对比', 'Compare'],
    '/settings': ['设置', 'Settings'],
  };
  const english = result.lang === 'en';
  assert.equal(result.title, result.landing
    ? english ? 'Oura health board' : 'Oura 健康看板'
    : titles[result.path]?.[english ? 1 : 0], label);
  assert.equal(result.meaningfulContent, true, label);
  assert.equal(result.frameworkOverlay, false, label);
  assert.deepEqual(result.errors, [], label);
  assert.deepEqual(result.console, [], label);
  assert.deepEqual(result.banners, [], label);
  console.log(`PASS ${label}`);
}
async function navigate(path) {
  await page.click(`loc=css:nav a[href="${path}"]`);
  await page.waitForURL(`${origin}${path}`);
}

// Delay one real Worker response to exercise loading states and out-of-order delivery.
async function holdNextReport(path, staleLabel = '') {
  await page.evaluate(({ path, staleLabel }) => {
    const original = window.fetch;
    let held = false;
    window.__releaseReport = null;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (held || new URL(response.url).pathname + new URL(response.url).search !== path) return response;
      held = true;
      const body = await response.json();
      if (staleLabel && body.left) body.left.label = staleLabel;
      await new Promise(resolve => { window.__releaseReport = resolve; });
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
    };
    window.__restoreReportFetch = () => { window.fetch = original; };
  }, { path, staleLabel });
}

async function releaseReport() {
  await page.evaluate(async () => {
    window.__releaseReport();
    window.__restoreReportFetch();
    // Let the late response and Svelte's render flush finish before inspecting the DOM.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

try {
  // A previous interrupted run may leave the shared page in a mobile emulation override.
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  // Journey 1: non-owner account sees access notices.
  await page.goto(`${origin}/__test/login?free=1`);
  await page.waitForSelector('.journal-main');
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '80');
  console.log('PASS free overview renders');
  // Snapshot establishes page state and actionable controls before the journey.
  console.log(await page.snapshot());
  await page.click('loc=css:.journal-score-history > summary');
  for (const days of [30, 90]) {
    await page.click(`loc=css:.range button:text-is("${days}")`);
    await page.waitForSelector(`.range[data-on="${days}"]`);
    await page.waitForFunction(n => document.querySelector('.sub')?.textContent?.includes(String(n)), days);
    await healthy(`dashboard ${days} days`);
  }
  await holdNextReport('/api/me/insights/weekly');
  await navigate('/insights');
  await page.waitForFunction(() => typeof window.__releaseReport === 'function');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('数据不足，暂无解读。')), false,
    'pending weekly requests must not flash an empty-data result');
  await releaseReport();
  await page.waitForSelector('.insight-lines li');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.insight-lines li').length), 3);
  // Non-owner access stays restricted.
  await page.waitForFunction(() => {
    const text = document.body.textContent;
    return text.includes('完整建议需要个人账号权限') || text.includes('Full advice requires personal access');
  });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('free weekly locked notice');
  await navigate('/compare');
  await page.waitForFunction(() => {
    const text = document.body.textContent;
    return text.includes('尚未开放完整对比') || text.includes('Full comparison is not enabled');
  });
  await healthy('free compare locked notice');
  await navigate('/settings');
  await page.waitForSelector('button[aria-pressed]');
  console.log(await page.snapshot());
  await page.click('loc=css:button[aria-pressed]:text-is("English")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'en');
  await page.waitForSelector('button[aria-pressed]:not([disabled])');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('h1')?.textContent === 'Settings');
  await healthy('language persisted across reload');
  await page.click('loc=css:button[aria-pressed]:text-is("中文")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'zh');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang.startsWith('zh'));
  await healthy('language restored');
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  await navigate('/insights');
  await page.waitForFunction(() => document.querySelectorAll('.insight-lines').length === 2);
  await healthy('owner weekly advice');
  await navigate('/compare');
  await page.waitForSelector('.compare-grid');
  console.log(await page.snapshot());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.compare-grid article').length), 2);
  await healthy('week comparison');
  await page.click('loc=css:button:text-is("近 7 天 vs 近 30 天")');
  await page.waitForFunction(() => document.querySelectorAll('.compare-grid h2')[1]?.textContent === '近 30 天');
  await healthy('7 vs 30 day comparison');
  await holdNextReport('/api/me/insights/compare?mode=week', 'STALE RESPONSE');
  await page.click('loc=css:button:text-is("本周 vs 上周")');
  await page.waitForFunction(() => typeof window.__releaseReport === 'function');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.compare-grid').length), 0,
    'old range results must be hidden while loading another mode');
  await page.click('loc=css:button:text-is("近 7 天 vs 近 30 天")');
  await page.waitForFunction(() => document.querySelectorAll('.compare-grid h2')[1]?.textContent === '近 30 天');
  await page.click('loc=css:button:text-is("本周 vs 上周")');
  await page.waitForFunction(() => document.querySelectorAll('.compare-grid h2')[1]?.textContent === '上周');
  await releaseReport();
  assert.equal(await page.evaluate(() => document.body.textContent.includes('STALE RESPONSE')), false,
    'a late response must not replace the newer request for the same mode');
  await healthy('rapid comparison switches ignore stale responses');
  await page.reload();
  await page.waitForSelector('.compare-grid');
  await healthy('direct compare URL reload');
  await page.click('loc=css:.journal-account > summary');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/me')).json()).authenticated), false);
  await healthy('logout returns to landing and invalidates session');

  // Journey 2: personal owner has full reports and health archive.
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  // Journey 1's fixture seeded a full journal dataset; reset sleep so the unsynced state is testable.
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=missing', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('.journal-main');
  await page.waitForSelector('.today-scores article');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.today-scores article').length), 3);
  await page.waitForFunction(() => document.querySelector('.sleep-preview')?.textContent.includes('近 30 天还没有保存'));
  await healthy('overview shows official scores and unsynced sleep entry');
  await navigate('/sleep');
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-empty"]')?.textContent.includes('还没有保存'));
  await healthy('sleep distinguishes unsynced archive');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=empty', { method: 'POST' }); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-empty"]')?.textContent.includes('此区间暂无睡眠记录'));
  await healthy('sleep distinguishes verified empty range');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=records', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('[data-testid="sleep-detail"]');
  console.log(await page.snapshot({ scope: 'full_page' }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="sleep-duration"]').textContent), '8 小时 0 分');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.period-picker button').length), 2);
  await page.click('loc=css:.period-picker button:text-is("短睡眠 / 小睡 14:00")');
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-duration"]')?.textContent === '0 小时 30 分');
  assert.equal(await page.evaluate(() => document.querySelector('.recovery-metrics p').textContent), '—');
  await page.click('loc=css:.sleep-controls button:text-is("30 天")');
  await page.waitForFunction(() => document.querySelector('.sleep-coverage')?.textContent.includes('58 段记录'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sleep-bars button').length), 30);
  await page.click('loc=css:.sleep-bars button.missing');
  await page.waitForFunction(() => document.querySelector('.sleep-empty')?.textContent.includes('这一天没有保存'));
  await healthy('sleep paginates all periods and preserves missing metrics and days');
  await page.click('loc=css:.sleep-bars button:last-child');
  await page.waitForSelector('[data-testid="sleep-detail"]');
  await page.screenshot({ path: '/tmp/oura-sleep-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'sleep content fits mobile');
  await page.screenshot({ path: '/tmp/oura-sleep-mobile.png' });
  await navigate('/');
  await page.waitForSelector('.today-scores');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'overview content fits mobile');
  await page.screenshot({ path: '/tmp/oura-overview-mobile.png' });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.screenshot({ path: '/tmp/oura-overview-desktop.png' });
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=failure', { method: 'POST' }); });
  await navigate('/sleep');
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('暂时无法'));
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=records', { method: 'POST' }); window.__smokeFailures = []; });
  console.log(await page.snapshot());
  await page.click('loc=css:button:text-is("重试")');
  await page.waitForSelector('[data-testid="sleep-detail"]');
  await healthy('sleep recovers from failed archive request');
  await page.evaluate(async () => { await fetch('/api/auth/logout'); });
  await page.click('loc=css:.sleep-controls button:text-is("同步此区间")');
  await page.waitForSelector('#landing-view');
  console.log('PASS sleep returns to login when session expires');
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  await navigate('/insights');
  await page.waitForFunction(() => document.querySelectorAll('.insight-lines').length === 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner weekly full without paywall');
  await navigate('/compare');
  await page.waitForSelector('.compare-grid');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner compare without paywall');
  for (const [route, endpoint, ready] of [
    ['/insights', '/api/me/insights/weekly', '.insight-lines'],
    ['/compare', '/api/me/insights/compare', '.compare-grid'],
  ]) {
    await navigate('/settings');
    await page.evaluate(endpoint => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        if (new URL(String(args[0]), location.origin).pathname === endpoint) {
          window.fetch = original;
          return Response.json({ error: 'reconnect_required' }, { status: 401 });
        }
        return original(...args);
      };
    }, endpoint);
    await navigate(route);
    await page.waitForSelector('.status.err');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#landing-view'))), false,
      `${route}: provider authorization must not log the user out`);
    assert.equal(await page.evaluate(() => document.querySelector('main a[href="/api/auth/oura/start"]')?.textContent), '重新连接 Oura');
    assert.equal(await page.evaluate(async () => (await (await fetch('/api/me')).json()).authenticated), true);
    await page.click('loc=css:main button:text-is("重试")');
    await page.waitForSelector(ready);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('main a[href="/api/auth/oura/start"]'))), false,
      'successful retry clears the obsolete reconnect action');
    await healthy(`${route} keeps the session and recovers from an Oura reconnect error`);
  }
  await navigate('/settings');
  await page.waitForFunction(() => document.body.textContent.includes('个人工作区'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.landing-btn.primary').length), 0);
  await healthy('owner settings shows personal workspace, no billing');
  await page.waitForFunction(() => document.querySelectorAll('.health-data .collection').length === 18);
  await page.evaluate(async () => { await fetch('/__test/backfill-scenario', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('.sync-issues');
  console.log(await page.snapshot({ scope: 'full_page' }));
  await page.screenshot({ path: '/tmp/oura-backfill-retry.png' });
  await page.click('loc=css:.health-data button:text-is("继续未完成部分")');
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。')
    && !document.querySelector('.health-data button[disabled]'), undefined, { timeout: 60000 });
  const splitResult = await page.evaluate(async () => {
    const status = await (await fetch('/api/me/health-records/status')).json();
    const heart = status.collections.find(row => row.name === 'heartrate');
    const failures = window.__smokeFailures;
    window.__smokeFailures = [];
    return { heart, failures, progress: document.querySelector('.sync-progress progress').value };
  });
  assert.equal(splitResult.heart.records, 7);
  assert.equal(splitResult.heart.failed_windows, 0);
  assert.equal(splitResult.progress, 100);
  assert.equal(splitResult.failures.length, 6, 'seven days split into seven one-day windows after six oversized requests');
  assert.ok(splitResult.failures.every(f => f === '/api/me/health-records: HTTP 422'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sync-issues').length), 0);
  await healthy('oversized backfill automatically splits, saves every day and clears old failures');
  await page.screenshot({ path: '/tmp/oura-backfill-desktop.png' });
  console.log(await page.snapshot({ scope: 'full_page' }));
  await page.click('loc=css:.health-data button:text-is("同步最近 7 天")');
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.health-data .error').length), 0);
  await healthy('owner syncs 18 health collections, including empty results');
  await page.goto(`${origin}/settings?sync=90`);
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。')
    && !document.querySelector('.health-data button[disabled]'), undefined, { timeout: 60000 });
  assert.equal(await page.url(), `${origin}/settings`, 'automatic backfill flag is consumed once');
  await healthy('owner completes 90-day backfill');
  await page.waitForSelector('.automatic-sync');
  assert.ok(await page.evaluate(() => document.querySelector('.automatic-sync').textContent.includes('每天 09:00')));
  // Leave settings, then deliver real Worker scheduled events with no page
  // initiating Oura requests. Return to prove durable background progress.
  await navigate('/');
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      const response = await fetch('/__test/automatic-sync', { method: 'POST' });
      if (!response.ok) throw new Error('Scheduled fixture event failed');
    }
  });
  await navigate('/settings');
  await page.waitForFunction(() => document.querySelector('.automatic-sync')?.textContent.includes('后台正在更新数据'));
  const auto = await page.evaluate(async () => (await (await fetch('/api/me/health-records/status')).json()).automatic);
  assert.equal(auto.completed, 2);
  assert.equal(auto.status, 'running');
  await healthy('scheduled sync continues away from settings and shows persisted progress');
  await page.screenshot({ path: '/tmp/oura-automatic-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'settings fits mobile viewport');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.health-data *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'sync controls and messages fit mobile');
  await page.screenshot({ path: '/tmp/oura-backfill-mobile.png' });
  await page.screenshot({ path: '/tmp/oura-automatic-mobile.png' });
  await page.evaluate(async () => { await fetch('/__test/storage-quota?enabled=1', { method: 'POST' }); });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.health-data .collection').length === 18);
  console.log(await page.snapshot());
  await page.click('loc=css:.health-data button:text-is("同步最近 7 天")');
  await page.waitForFunction(() => document.querySelector('.sync-issue')?.textContent.includes('数据库写入额度')
    && !document.querySelector('.health-data button[disabled]'));
  const quota = await page.evaluate(async () => ({
    attempts: (await (await fetch('/__test/storage-quota')).json()).attempts,
    groups: document.querySelectorAll('.sync-issue').length,
    text: document.querySelector('.sync-issues').textContent,
    failures: window.__smokeFailures,
    fits: document.documentElement.scrollWidth <= innerWidth,
  }));
  assert.equal(quota.attempts, 1, 'quota stops all other collections');
  assert.equal(quota.groups, 1, 'one storage failure must not become eighteen collection failures');
  assert.match(quota.text, /08:00.*历史数据保留.*本次预计恢复/s);
  assert.deepEqual(quota.failures, ['/api/me/health-records: HTTP 503']);
  assert.equal(quota.fits, true, 'quota recovery message fits mobile');
  await page.screenshot({ path: '/tmp/oura-quota-mobile.png' });
  await page.evaluate(async () => {
    await fetch('/__test/storage-quota?enabled=0', { method: 'POST' });
    window.__smokeFailures = [];
  });
  console.log('PASS quota stops after one request and shows reset while history remains readable');
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.click('loc=css:.journal-account > summary');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  await healthy('owner logout');
  await page.evaluate(async () => { await fetch('/__test/storage-quota?enabled=1', { method: 'POST' }); });
  console.log(await page.snapshot());
  await page.click('loc=css:#landing-view button.landing-btn.primary');
  await page.waitForFunction(() => document.querySelector('#landing-view')?.textContent.includes('数据库写入额度'));
  assert.match(await page.evaluate(() => document.querySelector('#landing-view').textContent), /本次预计恢复/);
  console.log('PASS login reports storage quota instead of an unreachable API');
  const reset = new Date(Date.parse(new Date().toISOString().slice(0, 10)) + 86400000).toISOString();
  await page.goto(`${origin}/?error=storage_write_quota_exceeded&retry_at=${encodeURIComponent(reset)}`);
  await page.waitForFunction(() => document.querySelector('#landing-view')?.textContent.includes('数据库写入额度'));
  console.log('PASS OAuth callback displays reset instead of a raw error code');
  await page.evaluate(async () => { await fetch('/__test/storage-quota?enabled=0', { method: 'POST' }); });
  console.log('PASS browser journey');
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
}
if (!existingSpace) await task.finish({ keep: [] });
