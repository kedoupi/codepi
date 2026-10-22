import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractWorkerVersion } from './deployment-evidence.mjs';
import { remoteMain } from './release-drift.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const DOMAINS = Object.freeze({
  mcp: { appDir: 'services/mcp', worker: 'codepi-mcp', database: 'codepi-mcp' },
  project: { appDir: 'apps/project', worker: 'codepi-project', database: 'codepi-project' },
  me: { appDir: 'apps/me', worker: 'codepi-me', database: 'codepi-me' },
});
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkMigrations(directory) {
  return readdir(directory).then(files => {
    const sql = files.filter(file => file.endsWith('.sql')).sort();
    assert.ok(sql.length > 0, 'at least one D1 migration is required before deployment');
    assert.equal(sql.length, files.length, 'migration directory contains non-SQL entries');
    const prefixes = new Map();
    for (const file of sql) {
      const match = /^(\d+)_[a-z0-9_]+\.sql$/.exec(file);
      assert.ok(match, `invalid migration filename ${file}`);
      const prefix = match[1].replace(/^0+/, '') || '0';
      assert.ok(!prefixes.has(prefix), `duplicate migration prefix ${prefix}: ${prefixes.get(prefix)}, ${file}`);
      prefixes.set(prefix, file);
    }
    return sql;
  });
}

function renderConfig(source, appDir, databaseId) {
  const config = { source, databaseId };
  assert.equal((source.match(/^main\s*=\s*"[^"]+"/gm) ?? []).length, 1, 'Wrangler config must declare main once');
  assert.equal((source.match(/^database_name\s*=\s*"[^"]+"/gm) ?? []).length, 1,
    'Wrangler config must declare database_name once');
  assert.ok((source.match(/^migrations_dir\s*=\s*"[^"]+"/gm) ?? []).length <= 1,
    'Wrangler config must not declare migrations_dir more than once');
  const idLines = source.match(/^database_id\s*=\s*"[^"]*"/gm) ?? [];
  assert.ok(idLines.length <= 1, 'Wrangler config must not declare database_id more than once');
  if (idLines.length) {
    const configured = idLines[0].match(/"([^"]*)"/)?.[1];
    assert.equal(configured, databaseId, 'reviewed config database_id differs from the exact-name D1');
  }
  return {
    ...config,
    render() {
      let text = source
        .replace(/^main\s*=\s*"([^"]+)"/m, (_, value) =>
          `main = ${JSON.stringify(path.resolve(appDir, value))}`);
      const migrations = source.match(/^migrations_dir\s*=\s*"([^"]+)"/m);
      if (migrations) {
        text = text.replace(/^migrations_dir\s*=\s*"[^"]+"/m, () =>
          `migrations_dir = ${JSON.stringify(path.resolve(appDir, migrations[1]))}`);
      }
      const assets = /\[assets\]([\s\S]*?)(?=\n\[|\s*$)/.exec(source);
      if (assets?.[1].match(/^\s*directory\s*=\s*"([^"]+)"/m)) {
        const directory = assets[1].match(/^\s*directory\s*=\s*"([^"]+)"/m)[1];
        const replacement = assets[0].replace(/^(\s*)directory\s*=\s*"[^"]+"/m, (_, indent) =>
          `${indent}directory = ${JSON.stringify(path.resolve(appDir, directory))}`);
        text = text.replace(assets[0], replacement);
      }
      if (!idLines.length) {
        text = text.replace(/^database_name\s*=\s*"([^"]+)"/m, line =>
          `${line}\ndatabase_id = ${JSON.stringify(databaseId)}`);
      }
      return text;
    },
  };
}

async function resolveD1(name, { appDir, provisionD1, execute }) {
  const run = (args, capture = false) => {
    const result = execute('pnpm', ['exec', 'wrangler', ...args], {
      cwd: appDir,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    });
    assert.ok(!result.error && result.status === 0,
      `Wrangler ${args.slice(0, 2).join(' ')} failed; no credentials or protected output were printed`);
    return result.stdout ?? '';
  };
  const list = () => {
    let parsed;
    try { parsed = JSON.parse(run(['d1', 'list', '--json'], true)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('Wrangler d1 list did not return JSON');
      throw error;
    }
    assert.ok(Array.isArray(parsed), 'Wrangler d1 list returned an unexpected payload');
    return parsed.filter(database => database?.name === name);
  };
  let matches = list();
  if (!matches.length && provisionD1) {
    run(['d1', 'create', name, '--update-config=false']);
    matches = list();
  }
  assert.equal(matches.length, 1,
    `D1 ${name} must resolve to exactly one exact-name database${provisionD1 ? '' : '; use the authorized --provision-d1 first-deploy flag only after review'}`);
  assert.match(matches[0].uuid ?? '', uuid, `D1 ${name} has an invalid UUID`);
  return matches[0].uuid;
}

export async function deployDomain(app, {
  sha, provisionD1 = false, cwd = root, execute = spawnSync,
} = {}) {
  const domain = DOMAINS[app];
  assert.ok(domain, 'expected --app mcp|project|me');
  const appDir = path.join(cwd, domain.appDir);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  sha ??= head;
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'pass a full reviewed source SHA');
  assert.equal(head, sha, 'source does not match HEAD');
  assert.equal(git(cwd, ['status', '--porcelain']), '', 'release source must be clean');
  assert.equal(remoteMain(cwd), sha, 'release source must equal current remote main');
  const source = await readFile(path.join(appDir, 'wrangler.toml'), 'utf8');
  assert.ok(new RegExp(`^name\\s*=\\s*"${domain.worker}"$`, 'm').test(source),
    `Wrangler config does not identify ${domain.worker}`);
  assert.match(source, new RegExp(`^database_name\\s*=\\s*"${domain.database}"$`, 'm'),
    `Wrangler config does not reserve ${domain.database}`);
  const migrationDirectory = path.join(appDir, 'migrations');
  const migrations = await checkMigrations(migrationDirectory);
  const databaseId = await resolveD1(domain.database, { appDir, provisionD1, execute });
  const config = renderConfig(source, appDir, databaseId);
  await mkdir(path.join(appDir, '.wrangler'), { recursive: true });
  const work = await mkdtemp(path.join(appDir, '.wrangler', 'release-'));
  try {
    const configFile = path.join(work, 'wrangler.toml');
    await writeFile(configFile, config.render(), { mode: 0o600 });
    const run = args => {
      const result = execute('pnpm', ['exec', 'wrangler', ...args], {
        cwd: appDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI: 'true',
          GITHUB_SHA: sha,
          WRANGLER_SEND_METRICS: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.ok(!result.error && result.status === 0,
        `Wrangler ${args[0]} failed; release stopped before claiming success`);
      return result.stdout ?? '';
    };
    run(['d1', 'migrations', 'apply', domain.database, '--remote', '--config', configFile]);
    const output = run(['deploy', '--config', configFile, '--var', `BUILD_SHA:${sha.slice(0, 12)}`]);
    const version = extractWorkerVersion(output);
    assert.ok(version, 'deployment did not report a Worker version');
    return {
      app,
      worker: domain.worker,
      database: domain.database,
      database_id: databaseId,
      migrations: migrations.length,
      source_sha: sha,
      version,
      smoke: 'pending',
      previous_version: '',
      new_version: version,
      migration_applied: true,
      secret_changed: true,
      binding_changed: true,
      external_side_effects: true,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--app') options.app = args[++i];
      else if (args[i] === '--sha') options.sha = args[++i];
      else if (args[i] === '--provision-d1') options.provisionD1 = true;
      else throw new Error(`Unknown option: ${args[i]}`);
    }
    assert.ok(options.app, 'Usage: deploy-domain.mjs --app <mcp|project|me> [--sha <full-source-SHA>] [--provision-d1]');
    console.log(JSON.stringify(await deployDomain(options.app, options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
