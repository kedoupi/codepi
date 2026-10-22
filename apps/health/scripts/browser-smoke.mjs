// Shared by the portable Chrome runner and the optional local ego-browser entry.
const { default: assert } = await import('node:assert/strict');
const options = globalThis.ouraSmokeOptions || {};
const existingSpace = options.spaceId;
const task = await taskSpace(existingSpace || 'Oura browser regression');
console.log({ spaceId: task.spaceId });
const page = task.page(options.page || 'p1');
const origin = `http://127.0.0.1:${process.env.HEALTH_BROWSER_PORT || '4178'}`;
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
    '/': ['健康 Health', 'Health'],
    '/sleep': ['睡眠与恢复', 'Sleep & recovery'],
    '/insights': ['近 7 天解读', 'Weekly insights'],
    '/compare': ['对比', 'Compare'],
    '/settings': ['设置', 'Settings'],
  };
  const english = result.lang === 'en';
  assert.equal(result.title, result.landing
    ? english ? 'Health · kedoupi（codepi）' : '健康 Health · kedoupi（codepi）'
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

async function press(key, code, value, text) {
  await page.cdp('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: value, ...(text ? { text } : {}),
  });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: value });
}

async function mobileFits(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && document.body.scrollWidth <= innerWidth), true, `${label} fits mobile viewport`);
}

async function fixture(path, method = 'GET') {
  // Node-side requests keep scheduled events independent of the browser page.
  const response = await fetch(`${origin}/__test/${path}`, { method, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `fixture ${path}`);
  return response.json();
}

async function automatic() {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/me/health-records/automatic');
    return { status: response.status, value: await response.json() };
  });
  assert.equal(result.status, 200);
  return result.value;
}

async function waitForQueue(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const observation = await fixture('sync-scenario');
    if (predicate(observation) && observation.leaseUntil === 0) return observation;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(label);
}

async function settledScores() {
  return waitForQueue(observation => observation.tasks.find(task => task.collection === '__scores')?.state === 'done',
    'POST waitUntil did not persist the first score batch');
}

async function assertSyncWrites(count, status = 202) {
  const observation = await fixture('sync-scenario');
  assert.equal(observation.requests.length, count, 'only explicit clicks or the deliberate duplicate submit sync work');
  for (const request of observation.requests) {
    assert.deepEqual(request, { path: '/api/me/health-records/automatic', search: '', bodyBytes: 0, status },
      'the browser must submit automatic work without a window query or body');
  }
  return observation;
}

async function observeAutomaticPoll(timeout = 15000) {
  await page.evaluate(() => {
    window.__automaticReads = 0;
    const original = window.fetch;
    window.fetch = (...args) => {
      if (new URL(String(args[0]), location.origin).pathname === '/api/me/health-records/automatic'
        && (args[1]?.method || 'GET') === 'GET') window.__automaticReads++;
      return original(...args);
    };
  });
  await page.waitForFunction(() => window.__automaticReads >= 1, undefined, { timeout });
}

async function assertAutomaticDom(value) {
  await page.waitForFunction(value => {
    const panel = document.querySelector('.automatic-sync');
    const stages = panel?.querySelectorAll('.automatic-stages p');
    const progress = panel?.querySelector('progress');
    const scoreText = stages?.[0]?.textContent || '';
    const detailText = stages?.[1]?.textContent || '';
    const score = value.scores.status === 'completed' ? '已完成'
      : value.scores.status === 'failed' ? '更新失败' : '等待';
    return scoreText.includes('官方评分') && scoreText.includes(score)
      && detailText.includes(`${value.details.completed} / ${value.details.total}`)
      && (!value.details.total || progress?.value === value.details.completed && progress.max === value.details.total)
      && (location.pathname !== '/settings' || !value.current
        || panel.textContent.includes(value.current.from) && panel.textContent.includes(value.current.to));
  }, value);
}

async function startShortScenario(mode, collections = 'sleep,heartrate') {
  await fixture(`sync-scenario?mode=${mode}`, 'POST');
  await page.goto(`${origin}/settings`);
  await page.waitForSelector('.automatic-sync');
  await page.waitForFunction(() => document.querySelector('.health-data .actions button')?.textContent === '更新数据'
    && !document.querySelector('.health-data .actions button').disabled);
  await page.click('loc=css:.health-data .actions button:text-is("更新数据")');
  await settledScores();
  await fixture(`short-queue?collections=${collections}`, 'POST');
  await page.reload();
  await assertSyncWrites(1);
  const value = await automatic();
  assert.deepEqual(value.scores, { status: 'completed', error: null });
  await assertAutomaticDom(value);
  return value;
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
  await page.waitForSelector('.weekly-summary .insight-lines li');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.weekly-summary .insight-lines li').length), 3);
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
  await page.waitForFunction(() => document.documentElement.lang.startsWith('zh')
    && document.querySelector('h1')?.textContent === '设置' && document.title === '设置');
  await healthy('language restored');
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  await navigate('/insights');
  await page.waitForSelector('.next-watch');
  await healthy('owner weekly advice');
  await navigate('/compare');
  await page.waitForSelector('.metric-table');
  console.log(await page.snapshot());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.metric-row').length), 6);
  await page.click('loc=css:.category-tabs button:text-is("活动")');
  await page.waitForFunction(() => document.querySelectorAll('.metric-row').length === 1
    && document.querySelector('.metric-row')?.textContent.includes('日均步数'));
  await page.click('loc=css:.category-tabs button:text-is("压力")');
  await page.waitForFunction(() => document.querySelectorAll('.metric-row').length === 2
    && document.querySelector('.metric-row')?.textContent.includes('日间压力时长'));
  await page.click('loc=css:.category-tabs button:text-is("睡眠与恢复")');
  await page.waitForFunction(() => document.querySelectorAll('.metric-row').length === 6);
  await page.click('loc=css:.preset-buttons button:text-is("30 天")');
  await page.waitForFunction(() => document.querySelector('.range-presets small').textContent.startsWith('30 天对 30 天'));
  await page.click('loc=css:.preset-buttons button:text-is("自定义")');
  await page.evaluate(() => {
    const end = document.querySelector('input[aria-label="当前截止日期"]').value;
    const input = document.querySelector('.custom-range input');
    input.value = new Date(Date.parse(`${end}T00:00:00Z`) - 9 * 86400000).toISOString().slice(0, 10);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('.range-presets small').textContent.startsWith('10 天对 10 天'));
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="当前截止日期"]');
    input.value = new Date(Date.parse(`${input.value}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('.range-presets small').textContent.startsWith('10 天对 10 天'));
  await healthy('custom comparison retains its length when moved earlier');
  await page.reload();
  await page.waitForSelector('.metric-table');
  await healthy('week comparison');
  await page.click('loc=css:button[data-mode="range"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.score-table thead th')][2]?.textContent === '近 30 天');
  await healthy('7 vs 30 day comparison');
  await holdNextReport('/api/me/insights/compare?mode=week', 'STALE RESPONSE');
  await page.click('loc=css:button[data-mode="week"]');
  await page.waitForFunction(() => typeof window.__releaseReport === 'function');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.metric-table').length), 0,
    'old range results must be hidden while loading another mode');
  await page.click('loc=css:button[data-mode="range"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.score-table thead th')][2]?.textContent === '近 30 天');
  await page.click('loc=css:button[data-mode="week"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.score-table thead th')][2]?.textContent === '此前 7 天');
  await releaseReport();
  assert.equal(await page.evaluate(() => document.body.textContent.includes('STALE RESPONSE')), false,
    'a late response must not replace the newer request for the same mode');
  await healthy('rapid comparison switches ignore stale responses');
  await page.reload();
  await page.waitForSelector('.metric-table');
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
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-empty"]')?.textContent.includes('近 30 天暂无睡眠记录'));
  await healthy('sleep distinguishes verified empty range');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=records', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('[data-testid="sleep-detail"]');
  console.log(await page.snapshot({ scope: 'full_page' }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="sleep-duration"]').textContent), '8 小时 0 分');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.period-picker option').length), 2);
  await page.evaluate(() => {
    const picker = document.querySelector('.period-picker');
    picker.value = [...picker.options].find(option => option.textContent === '小睡 14:00').value;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-duration"]')?.textContent === '0 小时 30 分');
  await healthy('sleep paginates all periods and preserves missing metrics and days');
  await page.evaluate(() => {
    const picker = document.querySelector('.period-picker');
    picker.value = [...picker.options].find(option => option.textContent === '主睡眠 00:00').value;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('[data-testid="sleep-detail"]');
  await page.screenshot({ path: '/tmp/oura-sleep-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'sleep content fits mobile');
  await page.screenshot({ path: '/tmp/oura-sleep-mobile.png' });
  await navigate('/compare');
  await page.waitForSelector('.metric-table');
  await mobileFits('comparison');
  await page.click('loc=css:.metric-row[aria-controls="metric-detail-efficiency"]');
  await page.waitForSelector('#metric-detail-efficiency');
  assert.equal(await page.evaluate(() => document.querySelector('.metric-row.open').nextElementSibling.id), 'metric-detail-efficiency',
    'mobile detail stays immediately after its selected metric');
  await page.click('loc=css:.mobile-detail-tabs button:text-is("分布")');
  await page.waitForFunction(() => document.querySelector('#metric-detail-efficiency .dist-chart').getBoundingClientRect().height > 0
    && document.querySelector('#metric-detail-efficiency .daily-chart').getBoundingClientRect().height === 0);
  await healthy('mobile comparison expands in place and switches to distribution');
  await navigate('/insights');
  await page.waitForSelector('.finding');
  await mobileFits('weekly reading');
  await healthy('mobile weekly reading');
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
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
  await page.click('loc=css:.sleep-controls button:text-is("同步近 30 天")');
  await page.waitForSelector('#landing-view');
  console.log('PASS sleep returns to login when session expires');
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  await navigate('/insights');
  await page.waitForSelector('.next-watch');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner weekly full without paywall');
  await navigate('/compare');
  await page.waitForSelector('.metric-table');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner compare without paywall');
  for (const [route, endpoint, ready] of [
    ['/insights', '/api/me/insights/weekly', '.finding'],
    ['/compare', '/api/me/insights/compare', '.metric-table'],
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
  assert.deepEqual(await page.evaluate(() => ({
    url: document.querySelector('#connections code')?.textContent,
    management: document.querySelector('#connections a')?.getAttribute('href'),
    legacy: document.querySelector('#connections h3')?.textContent ?? null,
  })), {
    url: 'https://mcp.codepi.app/mcp',
    management: 'https://mcp.codepi.app/connections',
    legacy: null,
  });
  await healthy('owner settings shows personal workspace, no billing');
  await page.waitForFunction(() => document.querySelectorAll('.health-data .collection').length === 18);
  // Keep the real score response pending so acceptance, route changes and
  // reloads happen before waitUntil finishes its first batch.
  await navigate('/');
  await page.waitForSelector('.automatic-sync');
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '80'
    && document.querySelector('.journal-sleep')?.textContent.includes('8 小时 0 分'));
  await fixture('sync-scenario?mode=success&hold_scores=1', 'POST');
  await page.click('loc=css:.journal-sync-line button:text-is("更新数据")');
  await page.waitForFunction(async () => (await (await fetch('/api/me/health-records/automatic')).json()).status === 'running');
  const accepted = await automatic();
  assert.deepEqual(accepted.scores, { status: 'pending', error: null });
  assert.equal(accepted.details.completed, 0);
  assert.ok(accepted.details.total > 18, 'real POST plans the full detail queue before the test trims it');
  assert.equal(accepted.total, accepted.details.total + 1, 'legacy totals include scores');
  await assertSyncWrites(1);
  await navigate('/settings');
  await assertAutomaticDom(accepted);
  await page.reload();
  await assertAutomaticDom(accepted);
  assert.equal((await automatic()).started_at, accepted.started_at, 'reload reuses the durable run');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.health-data .actions button').length), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.health-data .actions button').disabled), true);

  // about:blank unloads the entire application; only the Node fixture drives
  // the Worker from here until the dashboard is opened again.
  await page.goto('about:blank');
  await fixture('release-scores', 'POST');
  await settledScores();
  await fixture('short-queue?collections=sleep,heartrate,session,workout', 'POST');
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '91');
  let auto = await automatic();
  assert.deepEqual(auto.scores, { status: 'completed', error: null });
  assert.deepEqual(auto.details, { total: 4, completed: 0, failed: 0, remaining: 4 });
  assert.equal(auto.status, 'running', 'official scores are ready while details still await Cron');
  await assertAutomaticDom(auto);
  await healthy('homepage restores scores separately from unfinished background details');
  await page.screenshot({ path: '/tmp/oura-automatic-desktop.png' });

  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.deepEqual(auto.details, { total: 4, completed: 3, failed: 0, remaining: 1 });
  assert.equal(auto.current.collection, 'sleep', 'three batches per tick leave only the trimmed history window');
  await assertAutomaticDom(auto);
  await page.reload();
  await assertAutomaticDom(auto);
  assert.equal((await automatic()).started_at, accepted.started_at);
  await assertSyncWrites(1);
  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.equal(auto.status, 'completed');
  assert.equal(auto.current, null);
  assert.deepEqual(auto.details, { total: 4, completed: 4, failed: 0, remaining: 0 });
  assert.equal(auto.completed, auto.total);
  await assertAutomaticDom(auto);
  assert.ok((await assertSyncWrites(1)).providerCalls.includes('/v2/usercollection/heartrate'));
  await healthy('Cron completes persisted work while the application is unloaded');

  // A permission failure is terminal for that collection; other detail work
  // completes, while the successful official scores remain usable at home.
  await startShortScenario('permission', 'daily_spo2,heartrate');
  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  await fixture('automatic-sync', 'POST');
  // Hold every daily response, including the refresh triggered by sync status,
  // so progress is guaranteed to arrive before the dashboard's score data.
  const dailyGate = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `{
      const original = window.fetch;
      const gate = new Promise(resolve => {
        window.__releaseDaily = () => { resolve(); window.fetch = original; };
      });
      window.__dailyHeld = false;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (new URL(response.url).pathname === '/api/me/daily') {
          window.__dailyHeld = true;
          await gate;
        }
        return response;
      };
    }`,
  });
  try {
    await page.goto(`${origin}/`);
    auto = await automatic();
    assert.equal(auto.status, 'completed');
    assert.deepEqual(auto.scores, { status: 'completed', error: null });
    assert.deepEqual(auto.details, { total: 1, completed: 1, failed: 0, remaining: 0 });
    assert.equal(auto.unavailable[0].collection, 'daily_spo2');
    await assertAutomaticDom(auto);
    await page.waitForFunction(() => window.__dailyHeld);
    assert.equal(await page.evaluate(() => document.querySelector('.journal-score-body strong').textContent), '—',
      'completed progress does not imply that daily scores have rendered');
    await page.evaluate(() => window.__releaseDaily());
    await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '91');
  } finally {
    try { await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: dailyGate.identifier }); }
    finally { await page.evaluate(() => window.__releaseDaily?.()); }
  }
  const permissionCalls = (await fixture('sync-scenario')).providerCalls;
  await fixture('automatic-sync', 'POST');
  assert.deepEqual((await assertSyncWrites(1)).providerCalls, permissionCalls, 'terminal failures do not loop');
  await healthy('homepage keeps refreshed scores when a detail collection fails');

  // Reproduce the three production refusals through the real token refresh,
  // collection import, durable executor and rendered settings page.
  const deniedCollections = ['daily_resilience', 'ring_configuration', 'ring_battery_level'];
  await startShortScenario('access-denied', [...deniedCollections, 'heartrate'].join(','));
  await page.goto('about:blank');
  for (let batch = 0; batch < 4; batch++) await fixture('automatic-sync', 'POST');
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.equal(auto.status, 'completed');
  assert.equal(auto.failed, 0);
  assert.equal(auto.remaining, 0);
  assert.equal(auto.completed, auto.total);
  assert.deepEqual(auto.unavailable.map(row => row.collection).sort(), [...deniedCollections].sort());
  await assertAutomaticDom(auto);
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('访问受限'));
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.sync-issues'))), false,
    'access pauses must not appear as retryable failures');
  const denialsBefore = (await fixture('sync-scenario')).providerCalls;
  for (const collection of deniedCollections) {
    assert.equal(denialsBefore.filter(path => path === `/v2/usercollection/${collection}`).length, 2,
      'one request plus one fresh-token check, not a request for every date');
  }
  await page.reload();
  await assertAutomaticDom(auto);
  await fixture('automatic-sync', 'POST');
  assert.deepEqual((await fixture('sync-scenario')).providerCalls, denialsBefore);
  await navigate('/sleep');
  await page.waitForFunction(() => document.querySelector('.archive-status')?.textContent.includes('3 类访问暂停'));
  assert.equal(await page.evaluate(() => document.querySelector('.archive-status').textContent.includes('类存在未完成批次')), false);
  await healthy('three refused collections stay paused across reloads without hiding successful sync');

  // Force only the persisted retry deadline to mature between real scheduled
  // invocations. The score executor must stop after three provider failures.
  await fixture('sync-scenario?mode=score-failure', 'POST');
  await page.goto(`${origin}/settings`);
  await page.waitForSelector('.automatic-sync');
  await page.click('loc=css:.health-data .actions button:text-is("更新数据")');
  await waitForQueue(observation => observation.tasks.find(task => task.collection === '__scores')?.attempts === 1,
    'first failed score attempt must be persisted');
  await fixture('short-queue?collections=heartrate,daily_spo2', 'POST');
  await page.goto('about:blank');
  for (let attempt = 2; attempt <= 3; attempt++) {
    await fixture('retry-due?collection=__scores', 'POST');
    await fixture('automatic-sync', 'POST');
  }
  await fixture('automatic-sync', 'POST');
  await fixture('automatic-sync', 'POST');
  const exhaustedScores = await fixture('sync-scenario');
  assert.equal(exhaustedScores.tasks.find(task => task.collection === '__scores').attempts, 3);
  assert.equal(exhaustedScores.tasks.find(task => task.collection === '__scores').state, 'failed');
  for (let tick = 0; tick < 3; tick++) await fixture('automatic-sync', 'POST');
  assert.deepEqual((await fixture('sync-scenario')).providerCalls, exhaustedScores.providerCalls,
    'exhausted score retries must not become an infinite Cron loop');
  await page.goto(`${origin}/`);
  auto = await automatic();
  assert.equal(auto.status, 'partial');
  assert.deepEqual(auto.scores, { status: 'failed', error: 'upstream_unavailable' });
  assert.deepEqual(auto.details, { total: 2, completed: 2, failed: 0, remaining: 0 });
  await assertAutomaticDom(auto);
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '91');
  await assertSyncWrites(1);
  await healthy('homepage distinguishes failed score refresh from completed details and retains saved scores');

  // Preserve the previous oversized-window regression in the server executor.
  // Trim under the normal scenario so the 30-day history window survives the
  // waitUntil head-start intact, then switch the provider to oversized
  // responses without resetting the queue.
  await startShortScenario('success');
  await fixture('sync-scenario?mode=oversized&keep=1', 'POST');
  await page.goto('about:blank');
  for (let tick = 0; tick < 30; tick++) {
    await fixture('automatic-sync', 'POST');
    if ((await fixture('sync-scenario')).status !== 'running') break;
  }
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.equal(auto.status, 'completed');
  assert.equal(auto.details.completed, 31, 'thirty split sleep days and one heart-rate day complete');
  const split = await page.evaluate(async () => (await (await fetch('/api/me/health-records/status')).json()));
  assert.equal(split.collections.find(row => row.name === 'sleep').failed_windows, 0);
  assert.equal(split.collections.find(row => row.name === 'heartrate').records, 1);
  assert.equal((await assertSyncWrites(1)).tasks.filter(task => task.state === 'split').length, 29);
  await assertAutomaticDom(auto);
  await healthy('oversized batches split durably without browser window POSTs');

  // A rate-limited batch must retain its exact backoff across duplicate POST,
  // remount, browser polling, and repeated scheduled delivery.
  await startShortScenario('rate-limit', 'heartrate,daily_spo2');
  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  const delayed = await fixture('sync-scenario');
  assert.equal(delayed.tasks.find(task => task.collection === 'heartrate').attempts, 1);
  assert.ok(delayed.tasks.filter(task => task.state === 'pending').every(task => task.after > Date.now()));
  await page.goto(`${origin}/settings`);
  const duplicate = await page.evaluate(async () => {
    const response = await fetch('/api/me/health-records/automatic', { method: 'POST' });
    return { status: response.status, value: await response.json() };
  });
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.value.error, 'rate_limited');
  assert.equal(duplicate.value.started_at, delayed.started_at);
  await page.reload();
  await assertAutomaticDom(duplicate.value);
  for (let tick = 0; tick < 3; tick++) await fixture('automatic-sync', 'POST');
  // Observe a real five-second UI poll rather than inferring that no retry ran.
  await observeAutomaticPoll();
  const afterDelay = await assertSyncWrites(2);
  assert.deepEqual(afterDelay.tasks, delayed.tasks, 'duplicate POST, Cron and UI polling preserve retry timestamps and attempts');
  assert.deepEqual(afterDelay.providerCalls, delayed.providerCalls, 'backoff never polls the provider');
  await healthy('rate limits preserve durable backoff without timer-driven POST retries');

  // Exercise the shared settings trigger and progress on a mobile viewport.
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await startShortScenario('success');
  await mobileFits('settings trigger');
  await navigate('/');
  await page.waitForSelector('.automatic-sync progress');
  await mobileFits('homepage running sync');
  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  await fixture('automatic-sync', 'POST');
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.equal(auto.status, 'completed');
  await assertAutomaticDom(auto);
  await assertSyncWrites(1);
  await mobileFits('mobile restored completion');
  await page.screenshot({ path: '/tmp/oura-automatic-mobile.png' });

  // Exhaust the real application write budget after scores, before details.
  await startShortScenario('success');
  await fixture('sync-budget', 'POST');
  const historyBeforeBudget = (await fixture('sync-scenario')).records;
  await page.goto('about:blank');
  await fixture('automatic-sync', 'POST');
  const budget = await fixture('sync-scenario');
  await page.goto(`${origin}/settings`);
  auto = await automatic();
  assert.equal(auto.error, 'daily_sync_budget_reached');
  assert.equal(auto.scores.status, 'completed');
  assert.equal(auto.details.completed, 0);
  assert.equal(auto.details.remaining, 2);
  await assertAutomaticDom(auto);
  await page.waitForFunction(() => document.querySelector('.automatic-error')?.textContent.includes('预算'));
  assert.equal(await page.evaluate(() => document.querySelector('.health-data .actions button').disabled), true);
  for (let tick = 0; tick < 3; tick++) await fixture('automatic-sync', 'POST');
  const budgetAfter = await assertSyncWrites(1);
  assert.deepEqual(budgetAfter.tasks, budget.tasks, 'quota holds survive subsequent Cron ticks');
  assert.deepEqual(budgetAfter.providerCalls, budget.providerCalls);
  assert.equal(budgetAfter.records, historyBeforeBudget, 'quota failures preserve archived history');
  await mobileFits('budget recovery message');
  await page.screenshot({ path: '/tmp/oura-budget-mobile.png' });
  await healthy('write budget defers details without retries or loss of history');

  // A D1 account quota can also reject admission itself. Reads stay real and
  // available; there must be one explicit POST and no client retry loop.
  await fixture('sync-scenario?mode=success', 'POST');
  await fixture('storage-quota?enabled=1', 'POST');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.health-data .collection').length === 18);
  await page.waitForFunction(() => document.querySelector('.health-data .actions button')?.disabled === false);
  await page.click('loc=css:.health-data .actions button:text-is("更新数据")');
  await page.waitForFunction(() => document.querySelector('.health-data [role="alert"]')?.textContent.includes('数据库写入额度'));
  const quota = await page.evaluate(async () => ({
    attempts: (await (await fetch('/__test/storage-quota')).json()).attempts,
    text: document.querySelector('.health-data [role="alert"]').textContent,
    failures: window.__smokeFailures,
    fits: document.documentElement.scrollWidth <= innerWidth,
  }));
  assert.equal(quota.attempts, 1);
  assert.match(quota.text, /08:00.*本次预计恢复/s);
  assert.deepEqual(quota.failures, ['/api/me/health-records/automatic: HTTP 503']);
  await assertSyncWrites(1, 503);
  assert.equal((await fixture('sync-scenario')).tasks.length, 0, 'failed admission must not fabricate an accepted job');
  assert.equal(quota.fits, true, 'quota recovery message fits mobile');
  await page.screenshot({ path: '/tmp/health-quota-mobile.png' });
  await observeAutomaticPoll(40000);
  await assertSyncWrites(1, 503);
  assert.equal((await fixture('storage-quota')).attempts, 1, 'idle polling after a quota error must never retry POST');
  await page.evaluate(async () => {
    await fetch('/__test/storage-quota?enabled=0', { method: 'POST' });
    window.__smokeFailures = [];
  });
  console.log('PASS quota rejects one automatic POST and shows recovery while history remains readable');
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

  // Exercise real keyboard default actions, including focus movement into a chart table.
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.journal-main');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=journal', { method: 'POST' }); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '82');
  await page.evaluate(() => document.querySelector('.journal-score-history > summary').focus());
  await press('Enter', 'Enter', 13, '\r');
  await page.waitForSelector('.journal-score-history[open]');
  await press('Tab', 'Tab', 9);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '7');
  await press('Tab', 'Tab', 9);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '30');
  await press('Enter', 'Enter', 13, '\r');
  await page.waitForSelector('.range[data-on="30"]');
  await page.evaluate(() => document.querySelector('.journal-calendar-cells button').focus());
  await press(' ', 'Space', 32, ' ');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-pressed')), 'true');
  // Scores and archived sleep load independently. Linux CI may finish this
  // keyboard path before the sleep response mounts its accessible table.
  await page.waitForSelector('.journal-sleep .chart-data > summary');
  await page.evaluate(() => document.querySelector('.journal-sleep .chart-data > summary').focus());
  await press('Enter', 'Enter', 13, '\r');
  await page.waitForSelector('.journal-sleep .chart-data[open]');
  await press('Tab', 'Tab', 9);
  assert.equal(await page.evaluate(() => document.activeElement.matches('.journal-sleep .table-scroll')), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.journal-sleep .chart-data tbody tr').length), 14);
  await page.screenshot({ path: '/tmp/oura-keyboard-chart-table.png' });
  await healthy('keyboard opens disclosures, changes range, selects day and reaches data table');

  await page.evaluate(async () => { await fetch('/__test/report-scenario', { method: 'POST' }); });
  await navigate('/insights');
  await page.waitForSelector('.finding');
  const sparseWeekly = await page.evaluate(() => document.querySelector('.weekly-page').textContent);
  assert.match(sparseWeekly, /有效记录 \d+\/7 晚/);
  await healthy('weekly sparse samples preserve zero, exclude gaps and suppress unsupported trends');
  await navigate('/compare');
  await page.waitForSelector('.score-table');
  const sparseCells = await page.evaluate(() => [...document.querySelectorAll('.score-table tbody tr')]
    .map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
  assert.deepEqual(sparseCells.map(row => row.slice(1)), [['40', '70', '2 · 1'], ['—', '70', '0 · 1'], ['80', '—', '3 · 0'], ['0', '—', '1 · 0']]);
  await healthy('comparison displays each metric mean and valid sample count');

  for (const width of [375, 390]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const [route, selector, name] of [
      ['/', '.today-scores', 'overview'],
      ['/sleep', '[data-testid="sleep-detail"]', 'sleep'],
      ['/insights', '.finding', 'weekly'],
      ['/compare', '.metric-table', 'compare'],
      ['/settings', '.health-data .collection', 'settings'],
    ]) {
      await navigate(route);
      await page.waitForSelector(selector);
      await mobileFits(`${name} at ${width}px`);
      await page.screenshot({ path: `/tmp/oura-${name}-mobile-${width}.png` });
      await healthy(`${name} mobile ${width}px`);
    }
  }
  await page.cdp('Emulation.clearDeviceMetricsOverride');

  // Cross from yesterday into the Worker's real today, so archive ranges stay valid.
  const dates = await page.evaluate(async () => (await (await fetch('/__test/calendar')).json()));
  const previousDay = new Date(Date.parse(`${dates.today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  for (const [route, selector, endpoint] of [
    ['/', '.today-scores', '/api/me/daily'],
    ['/insights', '.finding', '/api/me/insights/weekly'],
    ['/compare', '.metric-table', '/api/me/insights/compare'],
  ]) {
    const clockInstrument = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${(({ previousDay, endpoint }) => {
      const NativeDate = window.Date;
      let clock = NativeDate.parse(`${previousDay}T15:59:59Z`);
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      window.__midnightRequests = 0;
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        if (new URL(String(args[0]), location.origin).pathname === endpoint) window.__midnightRequests++;
        return originalFetch(...args);
      };
      window.__advanceMidnight = () => { clock += 2000; window.dispatchEvent(new Event('focus')); };
      window.__restoreMidnight = () => {
        window.Date = NativeDate;
        window.fetch = originalFetch;
        window.dispatchEvent(new Event('focus'));
      };
      }).toString()})(${JSON.stringify({ previousDay, endpoint })});`,
    });
    try {
      await page.goto(`${origin}${route}`);
      await page.waitForSelector(selector);
      if (route === '/') await page.waitForFunction(day =>
        document.querySelector('.journal-calendar-scale span:last-child')?.textContent === day, previousDay);
      await page.evaluate(() => { window.__midnightRequests = 0; window.__advanceMidnight(); });
      await page.waitForFunction(() => window.__midnightRequests >= 1);
      if (route === '/') {
        await page.waitForFunction(day => document.querySelector('.journal-calendar-scale span:last-child')?.textContent === day, dates.today);
        assert.equal(await page.evaluate(day => document.querySelector('.journal-meta span')?.textContent
          .startsWith(new Date(`${day}T12:00:00Z`).toLocaleDateString('zh-CN', {
            timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
          })), dates.today), true);
        assert.ok(await page.evaluate(day => document.querySelector('.journal-calendar-cells button:last-child')
          ?.getAttribute('aria-label').startsWith(day), dates.today));
      }
      await page.waitForSelector(selector);
    } finally {
      await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockInstrument.identifier });
      await page.evaluate(() => window.__restoreMidnight());
    }
    await page.waitForSelector(selector);
    await healthy(`${route} refreshes after Shanghai midnight focus`);
  }
  console.log('PASS browser journey');
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
}
if (!existingSpace) await task.finish({ keep: [] });
