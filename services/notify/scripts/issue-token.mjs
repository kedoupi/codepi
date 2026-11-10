import { createHash, randomBytes } from 'node:crypto';
import { chmod, open, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const rulesFile = new URL('../src/rules.ts', import.meta.url);
const allowedBySource = new Map();
for (const match of readFileSync(rulesFile, 'utf8').matchAll(/\{ kind: "([^"]+)", sources: \[([^\]]+)\]/g)) {
  const sources = [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1]);
  for (const source of sources) {
    if (!allowedBySource.has(source)) allowedBySource.set(source, new Set());
    allowedBySource.get(source).add(match[1]);
  }
}
function arg(name, args) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
export function issueToken({ source, kinds, out, sql, randomId = randomBytes(9), randomSecret = randomBytes(24) }) {
  if (!source || !out || !sql || !kinds) throw new Error('Usage: --source <source> --kinds <kinds> --out <path> --sql <path>');
  if (source === "rpc") throw new Error('rpc source is not issuable');
  const allowed = allowedBySource.get(source);
  if (!allowed) throw new Error(`unknown source: ${source}`);
  const selected = kinds.split(',').map(value => value.trim()).filter(Boolean);
  if (!selected.length || selected.some(kind => !allowed.has(kind))) throw new Error('kind is not allowed for source');
  const id = randomId.toString('base64url').slice(0, 12);
  const token = `cpn_${id}_${randomSecret.toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const created = new Date().toISOString();
  const escaped = value => value.replaceAll("'", "''");
  const insert = `INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES ('${escaped(id)}', '${hash}', '${escaped(source)}', '${escaped(JSON.stringify(selected))}', '${created}');\n`;
  return { id, token, hash, insert, selected };
}
async function main(args = process.argv.slice(2)) {
  const result = issueToken({ source: arg('--source', args), kinds: arg('--kinds', args), out: arg('--out', args), sql: arg('--sql', args) });
  const out = arg('--out', args); const sql = arg('--sql', args);
  let handle;
  try { handle = await open(out, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('token output already exists'); throw error; }
  try { await handle.writeFile(`${result.token}\n`, { encoding: 'utf8' }); } finally { await handle.close(); }
  await chmod(out, 0o600);
  await writeFile(sql, result.insert, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ id: result.id, source: arg('--source', args), kinds: result.selected }));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); process.exitCode = 1; });
