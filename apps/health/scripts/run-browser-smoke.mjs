import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchBrowser, stopChild } from './browser-cdp.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

async function nativeScenario(script, artifactDir) {
  let browser;
  let failure;
  try {
    browser = await launchBrowser(artifactDir);
    globalThis.taskSpace = async () => ({
      spaceId: 'headless-cdp', page: () => browser.page, finish: async () => {},
    });
    await import(new URL(script, import.meta.url));
    assert.deepEqual(browser.page.diagnostics.filter(event =>
      event.method === 'Runtime.exceptionThrown'
      || (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type))),
    [], 'No runtime exceptions or console warnings/errors across the entire journey');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { if (browser) await browser.page.saveDiagnostics(failure); }
    finally { await browser?.close(); }
  }
}

async function runScenario(scenario, artifactDir, ego) {
  await mkdir(artifactDir, { recursive: true });
  const script = scenario === 'sso' ? './browser-sso-smoke.mjs' : './browser-smoke.mjs';
  const env = { ...process.env, HEALTH_BROWSER_SSO: scenario === 'sso' ? '1' : '0', HEALTH_BROWSER_ARTIFACTS: artifactDir };
  let fixtureLog = '';
  let suiteLog = '';
  let child;
  const fixture = spawn(process.execPath, ['scripts/browser-fixture.mjs'], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = (stream, chunk) => { process[stream].write(chunk); };
  fixture.stderr.on('data', chunk => { fixtureLog += chunk; output('stderr', chunk); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      fixture.once('error', fail);
      fixture.once('exit', code => fail(new Error(`Fixture exited: ${code}`)));
      fixture.stdout.on('data', chunk => {
        fixtureLog += chunk;
        output('stdout', chunk);
        if (fixtureLog.includes('Browser fixture ready:')) { clearTimeout(timer); resolve(); }
      });
    });
    const options = {
      spaceId: process.env.HEALTH_BROWSER_SPACE ? Number(process.env.HEALTH_BROWSER_SPACE) : undefined,
      page: process.env.HEALTH_BROWSER_PAGE,
    };
    child = ego
      ? spawn('ego-browser', ['nodejs'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(process.execPath, ['scripts/run-browser-smoke.mjs', '--native-child', script], {
        cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
      });
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      suiteLog += chunk;
      output(stream, chunk);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Browser ${scenario} exceeded 10 minutes`)), 600000);
      const fail = error => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('exit', code => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`Browser ${scenario} exited: ${code}`));
      });
      fixture.once('exit', code => fail(new Error(`Fixture stopped during ${scenario}: ${code}`)));
      if (ego) {
        child.stdin.on('error', fail);
        readFile(new URL(script, import.meta.url), 'utf8')
          .then(source => child.stdin.end(`globalThis.ouraSmokeOptions = ${JSON.stringify(options)};\n${source}`), fail);
      }
    });
  } catch (error) {
    await writeFile(join(artifactDir, 'runner-failure.txt'), error.stack || String(error));
    throw error;
  } finally {
    if (child) await stopChild(child);
    await stopChild(fixture);
    await Promise.all([
      writeFile(join(artifactDir, 'fixture.log'), fixtureLog),
      writeFile(join(artifactDir, 'suite.log'), suiteLog),
    ]);
  }
}

if (process.argv[2] === '--native-child') {
  await nativeScenario(process.argv[3], process.env.HEALTH_BROWSER_ARTIFACTS);
} else {
  const artifactRoot = process.env.HEALTH_BROWSER_ARTIFACTS
    ? resolve(process.env.HEALTH_BROWSER_ARTIFACTS)
    : await mkdtemp(join(tmpdir(), 'health-browser-artifacts-'));
  console.log(`Browser artifacts: ${artifactRoot}`);
  const scenarios = process.env.HEALTH_BROWSER_SSO === '1' ? ['sso']
    : process.env.HEALTH_BROWSER_SSO === '0' ? ['normal'] : ['normal', 'sso'];
  const failures = [];
  for (const scenario of scenarios) {
    try { await runScenario(scenario, join(artifactRoot, scenario), process.argv.includes('--ego')); }
    catch (error) { failures.push(error); console.error(error.message); }
  }
  if (failures.length) throw new AggregateError(failures, 'Browser regression failed; see artifacts above');
}
