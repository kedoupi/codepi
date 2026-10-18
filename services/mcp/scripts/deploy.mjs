import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Pass the reviewed source commit SHA');
const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
if (git(['rev-parse', 'HEAD']) !== sha || git(['status', '--porcelain'])) {
  throw new Error('Release must use the exact clean reviewed commit');
}
const cli = args => {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed; no credentials or captured output will be printed`);
  return result.stdout;
};
const list = () => JSON.parse(cli(['d1', 'list', '--json']));
let databases = list().filter(db => db.name === 'codepi-mcp');
if (!databases.length) {
  cli(['d1', 'create', 'codepi-mcp', '--update-config=false']);
  databases = list().filter(db => db.name === 'codepi-mcp');
}
if (databases.length !== 1 || !/^[a-f0-9-]{36}$/i.test(databases[0].uuid)) {
  throw new Error('Could not resolve exactly one codepi-mcp D1 database');
}
// Resolve new resource IDs at release time without rewriting the reviewed source.
// The migration and deploy commands use this SAME concrete configuration.
mkdirSync(path.join(cwd, '.wrangler'), { recursive: true });
const temp = mkdtempSync(path.join(cwd, '.wrangler', 'release-'));
const config = path.join(temp, 'wrangler.toml');
const source = readFileSync(path.join(cwd, 'wrangler.toml'), 'utf8');
writeFileSync(config, source
  .replace('main = "src/index.ts"', `main = ${JSON.stringify(path.join(cwd, 'src/index.ts'))}`)
  .replace('database_name = "codepi-mcp"', `database_name = "codepi-mcp"\ndatabase_id = "${databases[0].uuid}"`)
  .replace('migrations_dir = "migrations"', `migrations_dir = ${JSON.stringify(path.join(cwd, 'migrations'))}`));
cli(['d1', 'migrations', 'apply', 'codepi-mcp', '--remote', '--config', config]);
const output = cli(['deploy', '--config', config, '--var', `BUILD_SHA:${sha.slice(0, 12)}`]);
// Deployment output contains provider identifiers, never token responses.
process.stdout.write(output);
console.log(JSON.stringify({ service: 'codepi-mcp', database_id: databases[0].uuid, source_sha: sha }));
