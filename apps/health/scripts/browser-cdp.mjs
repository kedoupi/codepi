import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
    const disconnect = () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP disconnected during ${pending.method}`));
      }
      this.pending.clear();
    };
    socket.addEventListener('close', disconnect);
    socket.addEventListener('error', disconnect);
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const connection = new CdpConnection(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timed out')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return connection;
  }

  send(method, params = {}, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error(`CDP disconnected before ${method}`));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method).delete(listener);
  }

  close() { this.socket.close(); }
}

export function parseLocator(locator) {
  const value = locator.replace(/^loc=css:/, '');
  const text = value.match(/:text-is\(("(?:[^"\\]|\\.)*")\)$/);
  return { selector: text ? value.slice(0, text.index) : value, text: text ? JSON.parse(text[1]) : null };
}

export class CdpPage {
  constructor(connection, artifactDir) {
    this.connection = connection;
    this.artifactDir = artifactDir;
    this.diagnostics = [];
    for (const method of ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded', 'Network.loadingFailed']) {
      connection.on(method, params => this.diagnostics.push({ method, params }));
    }
    connection.on('Network.responseReceived', ({ response }) => {
      if (response.status >= 400) this.diagnostics.push({
        method: 'Network.responseReceived',
        params: { url: response.url, status: response.status },
      });
    });
  }

  cdp(method, params) { return this.connection.send(method, params); }

  async evaluate(fn, arg, timeout = 15000) {
    const expression = `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
    const result = await this.connection.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    }, timeout);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitForFunction(fn, arg, { timeout = 15000 } = {}) {
    const deadline = Date.now() + timeout;
    do {
      try {
        if (await this.evaluate(fn, arg, Math.max(1, deadline - Date.now()))) return;
      } catch (error) {
        if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
      }
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error(`Timed out after ${timeout}ms: ${fn.toString()} (${JSON.stringify(arg)})`);
  }

  waitForSelector(selector) {
    return this.waitForFunction(selector => Boolean(document.querySelector(selector)), selector);
  }

  waitForURL(url) { return this.waitForFunction(url => location.href === url, url); }
  url() { return this.evaluate(() => location.href); }
  title() { return this.evaluate(() => document.title); }

  async navigate(method, params) {
    let stop;
    let timer;
    const loaded = new Promise((resolve, reject) => {
      stop = this.connection.on('Page.loadEventFired', resolve);
      timer = setTimeout(() => reject(new Error(`Navigation timed out: ${method}`)), 20000);
    });
    // Register before navigation so even an immediate local response is observed.
    try {
      const [result] = await Promise.all([this.cdp(method, params), loaded]);
      if (result?.errorText) throw new Error(result.errorText);
    } finally {
      clearTimeout(timer);
      stop();
    }
  }

  goto(url) { return this.navigate('Page.navigate', { url }); }
  reload() { return this.navigate('Page.reload', { ignoreCache: true }); }

  async click(locator) {
    const point = await this.evaluate(async ({ selector, text }) => {
      const matches = [...document.querySelectorAll(selector)]
        .filter(el => text === null || el.textContent.trim() === text)
        .filter(el => el.getClientRects().length);
      if (matches.length !== 1) throw new Error(`Expected one visible match for ${selector}, got ${matches.length}`);
      const el = matches[0];
      if (el.disabled) throw new Error(`Disabled control: ${selector}`);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      let box = el.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        box = el.getBoundingClientRect();
      }
      if (box.top < 0 || box.bottom > innerHeight) {
        scrollTo(0, scrollY + box.top - (innerHeight - box.height) / 2);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        box = el.getBoundingClientRect();
      }
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== el && !el.contains(hit))) {
        const hitLabel = hit
          ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${String(hit.className).trim().replace(/\s+/g, '.')}`
          : 'none';
        const style = getComputedStyle(el);
        const details = el.closest('details');
        const state = [
          `visible=${el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })}`,
          `display=${style.display}`,
          `visibility=${style.visibility}`,
          `pointer-events=${style.pointerEvents}`,
          `opacity=${style.opacity}`,
          `details.open=${details?.open ?? 'none'}`,
        ].join(' ');
        throw new Error(
          `Control is covered: ${selector} (hit ${hitLabel}; ${state}; target ${JSON.stringify(box.toJSON())}; scroll ${scrollX},${scrollY})`,
        );
      }
      return { x, y };
    }, parseLocator(locator));
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }

  snapshot() {
    return this.evaluate(() => ({
      url: location.href, title: document.title, text: document.body.innerText,
      focus: document.activeElement?.outerHTML.slice(0, 500),
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      errors: window.__smokeFailures, console: window.__smokeConsole || window.__ssoConsole,
    }));
  }

  async screenshot({ path }) {
    const { data } = await this.cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(this.artifactDir, basename(path)), Buffer.from(data, 'base64'));
  }

  async saveDiagnostics(error) {
    await writeFile(join(this.artifactDir, 'console-network.json'), JSON.stringify(this.diagnostics, null, 2));
    if (!error) return;
    await writeFile(join(this.artifactDir, 'failure.txt'), error.stack || String(error));
    // Preserve whatever remains available even when navigation or Chrome failed.
    const results = await Promise.allSettled([
      this.screenshot({ path: 'failure.png' }),
      this.snapshot().then(value => writeFile(join(this.artifactDir, 'failure-page.json'), JSON.stringify(value, null, 2))),
    ]);
    await writeFile(join(this.artifactDir, 'capture.json'), JSON.stringify(results.map(result => ({
      status: result.status, error: result.reason?.message,
    })), null, 2));
  }
}

export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

export async function removeBrowserProfile(profile, remove = rm) {
  // Chrome subprocesses can finish writing after the parent exits.
  await remove(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export async function launchBrowser(artifactDir) {
  await mkdir(artifactDir, { recursive: true });
  const candidates = [
    process.env.CHROME_BIN, process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  let executable;
  for (const candidate of candidates) {
    try { await access(candidate); executable = candidate; break; } catch {}
  }
  if (!executable) throw new Error('Chrome not found; set CHROME_BIN to an installed Chrome executable');
  const profile = await mkdtemp(join(tmpdir(), 'health-browser-'));
  const child = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '';
  let spawnError;
  child.stderr.on('data', chunk => { chromeLog += chunk; });
  child.once('error', error => { spawnError = error; });
  let connection;
  const close = async () => {
    connection?.close();
    await stopChild(child);
    await writeFile(join(artifactDir, 'chrome.log'), chromeLog);
    await removeBrowserProfile(profile);
  };
  try {
    const deadline = Date.now() + 15000;
    let port;
    while (!port && Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Chrome exited: ${child.exitCode}`);
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch { await delay(50); }
    }
    if (!port) throw new Error('Chrome startup timed out');
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Chrome target creation: HTTP ${response.status}`);
    const target = await response.json();
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    const page = new CdpPage(connection, artifactDir);
    for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await page.cdp(`${domain}.enable`);
    // Deliberately use a different browser timezone: the app must choose Shanghai itself.
    await page.cdp('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
