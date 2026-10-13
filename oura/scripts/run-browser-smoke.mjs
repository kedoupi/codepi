import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const fixture = spawn(process.execPath, ['scripts/browser-fixture.mjs'], {
  cwd, stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 15000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited: ${code}`)); });
    fixture.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      if (chunk.toString().includes('Browser fixture ready:')) { clearTimeout(timeout); resolve(); }
    });
  });
  const script = await readFile(new URL('./browser-smoke.mjs', import.meta.url), 'utf8');
  await new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { cwd, stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser smoke exited: ${code}`)));
    child.stdin.on('error', reject);
    // Ego executes in its own runtime; shell environment is not forwarded there.
    const options = {
      spaceId: process.env.OURA_BROWSER_SPACE ? Number(process.env.OURA_BROWSER_SPACE) : undefined,
      page: process.env.OURA_BROWSER_PAGE,
    };
    child.stdin.end(`globalThis.ouraSmokeOptions = ${JSON.stringify(options)};\n${script}`);
  });
} finally {
  fixture.kill('SIGTERM');
}
