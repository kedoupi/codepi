#!/usr/bin/env node
/** Push codepi's task index, merge titles and worktree branches to Project. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENDPOINT = 'https://project.codepi.app/api/ingest/codepi';
const KEYCHAIN_SERVICE = 'codepi-project-push';
const MAX_BODY = 256 * 1024;
const CHANGELOG_DAYS = 30;
const STATUS = new Map([
  ['执行', 'doing'],
  ['待决定', 'decide'],
  ['缺陷', 'bug'],
  ['待确认', 'verify'],
  ['想法', 'idea'],
]);
const NEED = new Map([
  ['无', 'none'],
  ['决定', 'decide'],
  ['到场', 'attend'],
  ['授权', 'authorize'],
  ['确认', 'confirm'],
]);

// This is the same scanner used by the Project Worker. Node >=24 can load this
// import directly, so the producer and consumer cannot silently diverge.
const { findSecret } = await import(pathToFileURL(path.join(REPO_ROOT, 'apps/project/worker/scan.ts')).href);

export function clip(value, limit) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function stripMarkdownLinks(value) {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
}

function tableCells(line) {
  let text = line.trim();
  if (!text.startsWith('|')) return null;
  text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      cell += character;
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isDelimiter(line) {
  const cells = tableCells(line);
  return Boolean(cells?.length) && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

export function parseTaskTable(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  let headerIndex = -1;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (tableCells(lines[index]) && isDelimiter(lines[index + 1])) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) throw new Error('未找到任务索引表');

  const headers = tableCells(lines[headerIndex]);
  const expected = ['工作', '状态', '需要你', '当前事实', '下一步'];
  if (headers.length !== expected.length || expected.some((header, index) => headers[index] !== header)) {
    throw new Error(`任务索引表头必须为「${expected.join(' | ')}」`);
  }

  const items = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const cells = tableCells(lines[index]);
    if (!cells) break;
    if (cells.length !== expected.length) throw new Error(`任务索引第 ${index + 1} 行列数错误`);
    if (cells.every(cell => cell === '')) continue;
    items.push({
      title: cells[0],
      status: cells[1],
      need: cells[2],
      what: cells[3],
      advice: cells[4],
    });
  }
  return items;
}

function needKind(value) {
  const text = (value || '无').trim();
  for (const [label, kind] of NEED) if (text.startsWith(label)) return kind;
  throw new Error(`未知需要你「${text}」`);
}

export function tasksFromTable(markdown) {
  return parseTaskTable(markdown).map((item, index) => {
    const status = STATUS.get(item.status.trim());
    if (!status) throw new Error(`任务索引第 ${index + 1} 行未知状态「${item.status.trim()}」`);
    const title = clip(stripMarkdownLinks(item.title), 200);
    if (!title) throw new Error(`任务索引第 ${index + 1} 行工作不能为空`);
    const need = item.need.trim() === '无' || item.need.trim() === '' ? null : clip(item.need, 500);
    return {
      title,
      category: 'codepi',
      status,
      due: null,
      recorded: null,
      what: clip(item.what, 2000),
      impact: null,
      advice: clip(stripMarkdownLinks(item.advice), 2000),
      need,
      need_kind: needKind(item.need),
      source: null,
      related: [],
    };
  });
}

function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function dayNumber(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function mergeTitle(subject) {
  const text = String(subject).trim();
  const colon = text.indexOf(':');
  const title = colon >= 0 ? text.slice(colon + 1).trim() : text;
  return clip(title || text, 200);
}

export function changelogFromGit(root, { today = shanghaiDate(), git = args => gitOutput(root, args), days = CHANGELOG_DAYS } = {}) {
  const since = dayNumber(today) - days;
  const output = git(['log', '--first-parent', '--merges', '--format=%cI%x09%s', 'main']);
  const entries = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('\t');
    if (separator < 0) continue;
    const timestamp = line.slice(0, separator);
    const subject = line.slice(separator + 1);
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.valueOf())) continue;
    const date = shanghaiDate(parsed);
    if (dayNumber(date) < since) continue;
    entries.push({ date, title: mergeTitle(subject), summary: null });
    if (entries.length >= 100) break;
  }
  return entries;
}

export function adapterFrom(agentsMarkdown) {
  const section = String(agentsMarkdown).match(/^## Agent 协作适配\s*$(.*?)(?=^## |(?![\s\S]))/ms);
  if (!section) return null;
  const result = { isolation: null, commit: null, acceptance: [], merge: null };
  const keys = new Map([['隔离', 'isolation'], ['提交', 'commit'], ['验收', 'acceptance'], ['合并', 'merge']]);
  for (const line of section[1].split(/\r?\n/)) {
    const match = line.trim().match(/^- (隔离|提交|验收|合并)：(.+)$/);
    if (!match) continue;
    const key = keys.get(match[1]);
    const value = match[2].trim();
    const commands = [...value.matchAll(/`([^`]+)`/g)].map(item => item[1]);
    if (key === 'acceptance') {
      result[key] = (commands.length ? commands : [value]).slice(0, 10).map(item => clip(item, 300));
    } else {
      const limit = key === 'isolation' ? 60 : key === 'commit' ? 120 : 300;
      result[key] = clip(commands[0] || value, limit);
    }
  }
  return result;
}

function gitOutput(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function branchesFrom(root, git = args => gitOutput(root, args)) {
  const branches = [];
  let current = null;
  let worktree = null;
  const flush = () => {
    if (!worktree || !current || current === 'main' || path.resolve(worktree) === path.resolve(root)) {
      current = null;
      worktree = null;
      return;
    }
    const ahead = Number.parseInt(git(['rev-list', '--count', `main..${current}`]), 10);
    branches.push({
      name: clip(current, 200),
      ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : 0,
      last_commit_at: git(['log', '-1', '--format=%cI', current]) || null,
      has_fragment: false,
    });
    current = null;
    worktree = null;
  };
  for (const line of `${git(['worktree', 'list', '--porcelain'])}\n`.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) worktree = line.slice(9);
    else if (line.startsWith('branch refs/heads/')) current = line.slice('branch refs/heads/'.length);
    else if (!line) flush();
  }
  return branches.slice(0, 50);
}

export async function buildPayload(root = REPO_ROOT, {
  today,
  generatedAt = new Date().toISOString(),
  git = args => gitOutput(root, args),
} = {}) {
  const projectRoot = path.resolve(root);
  const tasksMarkdown = await readFile(path.join(projectRoot, 'docs/development/tasks/README.md'), 'utf8');
  const agentsMarkdown = await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8');
  return {
    schema: 'workbench.v1',
    generated_at: generatedAt,
    project: { name: 'codepi', rules_path: 'AGENTS.md', adapter: adapterFrom(agentsMarkdown) },
    source: {
      sha: (git(['rev-parse', 'HEAD']) || '').slice(0, 40) || null,
      branch: git(['branch', '--show-current']) || null,
    },
    tasks: tasksFromTable(tasksMarkdown),
    branches: branchesFrom(projectRoot, git),
    changelog: changelogFromGit(projectRoot, { today, git }),
  };
}

export function readKeychainToken(exec = execFileSync) {
  try {
    const token = exec('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'codepi', '-w'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function pushPayload(payload, token, {
  fetchImpl = globalThis.fetch,
  endpoint = ENDPOINT,
} = {}) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'codepi-project-push/1',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    // Keep the HTTP status as the useful error when the server did not return JSON.
  }
  return { status: response.status, result };
}

function parseArgs(argv) {
  const options = { dryRun: false, ifConfigured: false, out: null, root: REPO_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--if-configured') options.ifConfigured = true;
    else if (argument === '--out' || argument === '--root') {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} 需要参数`);
      if (argument === '--out') options.out = value;
      else options.root = value;
    } else throw new Error(`未知参数 ${argument}`);
  }
  return options;
}

function summary(payload, size) {
  return `${payload.tasks.length} 条任务 · ${payload.branches.length} 个分支 · ${payload.changelog.length} 条合并 · ${Math.ceil(size / 1024)} KiB`;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    const options = parseArgs(argv);
    const payload = await buildPayload(options.root, dependencies);
    const body = JSON.stringify(payload);
    const size = Buffer.byteLength(body, 'utf8');
    const text = summary(payload, size);
    const hit = findSecret(payload);
    if (hit) {
      console.error(`快照里有像凭据的内容（字段 ${hit}），没有推送。`);
      return 2;
    }
    if (size > MAX_BODY) {
      console.error(`快照超过 256 KiB（${text}），没有推送。`);
      return 2;
    }
    if (options.out) await writeFile(options.out, JSON.stringify(payload, null, 1), 'utf8');
    if (options.dryRun) {
      console.log(`[dry-run] ${text}`);
      return 0;
    }
    const token = dependencies.token === undefined
      ? (dependencies.readToken || readKeychainToken)()
      : dependencies.token;
    if (!token) {
      if (options.ifConfigured) return 0;
      console.error(`钥匙串里没有推送令牌（服务 ${KEYCHAIN_SERVICE}，账户 codepi）。`);
      return 1;
    }
    const { status, result } = await pushPayload(payload, token, { fetchImpl: dependencies.fetchImpl });
    if (status !== 200) {
      const code = result?.error || 'unknown';
      const field = result?.details?.field;
      console.error(`推送失败：HTTP ${status} ${code}${field ? `（字段 ${field}）` : ''}`);
      return 1;
    }
    const state = result?.deduplicated ? '内容没变' : `新完成 ${result?.newly_done || 0} 条`;
    console.log(`已推送到工作台：${text}，${state}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
