import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDay, calendarWindow, shiftDay } from '../../../../shared/dates.ts';
import { createRuntime, login, migrate } from './runtime.mjs';

test('HTTP weekly, comparison and AI preserve sparse samples and requested calendar periods', async () => {
  const today = calendarDay();
  const runtime = createRuntime({
    providerResponse(url) {
      if (!/\/daily_(sleep|readiness|activity)$/.test(url.pathname)) return undefined;
      return Response.json({ data: [today, shiftDay(today, -14)].map((day, index) => ({
        id: `${url.pathname}-${day}`, day, score: index ? 20 : 80, steps: index ? 1000 : 8000,
      })), next_token: null });
    },
  });
  try {
    await runtime.ready;
    await migrate(runtime);
    const cookie = await login(runtime);
    const get = async path => {
      const response = await runtime.dispatchFetch(`https://oura.example${path}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const weekly = await get('/api/me/insights/weekly');
    assert.deepEqual(weekly.thisPeriod, calendarWindow(7, today));
    assert.deepEqual(weekly.lastPeriod, calendarWindow(7, shiftDay(today, -7)));
    assert.equal(weekly.timezone, 'Asia/Shanghai');
    assert.equal(weekly.sampleCounts.thisWeek.sleep, 1);
    assert.equal(weekly.sampleCounts.lastWeek.sleep, 0);
    assert.ok(weekly.summaries.every(line => line.includes('样本不足')));
    assert.doesNotMatch(weekly.tips.join(' '), /接近|持平|高于|低于/);
    const range = await get('/api/me/insights/compare?mode=range');
    assert.equal(range.left.days, 1);
    assert.equal(range.left.sleep, 80);
    assert.equal(range.right.days, 2);
    assert.equal(range.right.sleep, 50);
    assert.equal(range.right.samples.sleep, 2);
    assert.equal(range.left.from, calendarWindow(7, today).from);
    const week = await get('/api/me/insights/compare?mode=week');
    assert.equal(week.right.days, 0);
    assert.equal(week.right.sleep, null);
    const ai = await get('/api/me/ai?days=30');
    assert.ok(ai.report.findings.every(finding => finding.detail.includes('样本不足')));
    assert.doesNotMatch(ai.report.actions.join(' '), /接近|持平|高于|低于/);
  } finally {
    await runtime.dispose();
  }
});
