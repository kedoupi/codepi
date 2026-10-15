import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpConnection, CdpPage, parseLocator } from '../browser-cdp.mjs';

class Socket extends EventTarget {
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close() { this.dispatchEvent(new Event('close')); }
}

test('CDP correlates concurrent responses, forwards events and reports protocol errors', async () => {
  const socket = new Socket();
  const cdp = new CdpConnection(socket);
  const events = [];
  const stop = cdp.on('Runtime.exceptionThrown', params => events.push(params));
  const first = cdp.send('Page.enable');
  const second = cdp.send('Runtime.enable');
  socket.message({ id: socket.sent[1].id, result: { enabled: true } });
  socket.message({ id: socket.sent[0].id, result: {} });
  assert.deepEqual(await second, { enabled: true });
  assert.deepEqual(await first, {});
  socket.message({ method: 'Runtime.exceptionThrown', params: { text: 'failure' } });
  stop();
  socket.message({ method: 'Runtime.exceptionThrown', params: { text: 'ignored' } });
  assert.deepEqual(events, [{ text: 'failure' }]);
  const failure = cdp.send('Invalid.command');
  socket.message({ id: socket.sent[2].id, error: { message: 'unknown method' } });
  await assert.rejects(failure, /Invalid.command: unknown method/);
  cdp.close();
});

test('CDP timeout and disconnect reject pending work instead of hanging CI', async () => {
  const socket = new Socket();
  const cdp = new CdpConnection(socket);
  await assert.rejects(cdp.send('slow', {}, 5), /CDP timed out: slow/);
  assert.equal(cdp.pending.size, 0);
  const pending = cdp.send('pending');
  cdp.close();
  await assert.rejects(pending, /disconnected during pending/);
  await assert.rejects(cdp.send('later'), /disconnected before later/);
  assert.equal(cdp.pending.size, 0);
});

test('locator adapter handles exact text without changing native CSS selectors', () => {
  assert.deepEqual(parseLocator('loc=css:nav a[href="/sleep"]'), { selector: 'nav a[href="/sleep"]', text: null });
  assert.deepEqual(parseLocator('loc=css:button:text-is("30")'), { selector: 'button', text: '30' });
  assert.deepEqual(parseLocator('button:text-is("a \\"quote\\"")'), { selector: 'button', text: 'a "quote"' });
});

test('page evaluation awaits promises and propagates browser exceptions', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const page = new CdpPage(connection, '/unused');
  const result = page.evaluate(async value => value + 1, 2);
  assert.equal(socket.sent[0].params.awaitPromise, true);
  assert.equal(socket.sent[0].params.returnByValue, true);
  socket.message({ id: socket.sent[0].id, result: { result: { value: 3 } } });
  assert.equal(await result, 3);
  const failure = page.evaluate(() => { throw new Error('render failed'); });
  socket.message({ id: socket.sent[1].id, result: {
    exceptionDetails: { exception: { description: 'Error: render failed' } },
  } });
  await assert.rejects(failure, /render failed/);
  connection.close();
});

test('failure diagnostics retain console/network events even if screenshot or DOM capture fails', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'oura-cdp-test-'));
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const page = new CdpPage(connection, artifactDir);
  try {
    socket.message({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'render failed' }] } });
    socket.message({ method: 'Network.responseReceived', params: { response: { status: 503, url: 'http://127.0.0.1/api/me' } } });
    page.screenshot = async () => { throw new Error('target closed'); };
    page.snapshot = async () => ({ title: 'Settings', text: 'Retry' });
    await page.saveDiagnostics(new Error('assertion failed'));
    assert.deepEqual((await readdir(artifactDir)).sort(), ['capture.json', 'console-network.json', 'failure-page.json', 'failure.txt']);
    assert.match(await readFile(join(artifactDir, 'failure.txt'), 'utf8'), /assertion failed/);
    assert.match(await readFile(join(artifactDir, 'console-network.json'), 'utf8'), /render failed/);
    assert.match(await readFile(join(artifactDir, 'console-network.json'), 'utf8'), /503/);
    const capture = JSON.parse(await readFile(join(artifactDir, 'capture.json'), 'utf8'));
    assert.equal(capture[0].status, 'rejected');
    assert.equal(capture[1].status, 'fulfilled');
  } finally {
    connection.close();
    await rm(artifactDir, { recursive: true, force: true });
  }
});
