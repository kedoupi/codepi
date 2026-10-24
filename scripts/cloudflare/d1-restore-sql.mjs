import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const MAX_RESTORE_STATEMENT_BYTES = 80_000;
const bytes = value => Buffer.byteLength(value, 'utf8');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const withoutLeadingComments = value => value.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');

function stringLiterals(sql) {
  const literals = [];
  for (let at = 0; at < sql.length;) {
    if (sql.startsWith('--', at)) { at = sql.indexOf('\n', at); if (at < 0) break; continue; }
    if (sql.startsWith('/*', at)) { at = sql.indexOf('*/', at + 2) + 2; if (at < 2) throw new Error(); continue; }
    const mark = sql[at];
    if (!["'", '"', '`', '['].includes(mark)) { at++; continue; }
    const start = at++, close = mark === '[' ? ']' : mark;
    let value = '', ended = false;
    while (at < sql.length) {
      if (sql[at] === close) {
        if (mark !== '[' && sql[at + 1] === close) { value += close; at += 2; continue; }
        at++; ended = true; break;
      }
      value += sql[at++];
    }
    if (!ended) throw new Error();
    // A blob literal must stay a blob; unsupported oversized statements fail closed.
    if (mark === "'" && !/[xX]/.test(sql[start - 1] || '')) literals.push({ start, end: at, value });
  }
  return literals;
}

function stagedInsert(sql, table) {
  if (!/^INSERT\s+INTO\b/i.test(withoutLeadingComments(sql))) throw new Error();
  const candidates = stringLiterals(sql).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const selected = [];
  let remainingBytes = bytes(sql);
  for (const candidate of candidates) {
    if (remainingBytes <= MAX_RESTORE_STATEMENT_BYTES) break;
    const id = selected.length + 1;
    const replacement = `(SELECT value FROM "${table}" WHERE id=${id})`;
    if (bytes(sql.slice(candidate.start, candidate.end)) <= bytes(replacement)) continue;
    remainingBytes += bytes(replacement) - bytes(sql.slice(candidate.start, candidate.end));
    selected.push({ ...candidate, id, replacement });
  }
  if (remainingBytes > MAX_RESTORE_STATEMENT_BYTES) throw new Error();
  const statements = [];
  for (const literal of selected) {
    const points = Array.from(literal.value);
    for (let at = 0; at < points.length; at += 4000) {
      const chunk = quote(points.slice(at, at + 4000).join(''));
      statements.push(at === 0
        ? `INSERT INTO "${table}"(id,value) VALUES(${literal.id},${chunk});`
        : `UPDATE "${table}" SET value=value||${chunk} WHERE id=${literal.id};`);
    }
  }
  let rewritten = sql;
  for (const literal of selected.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, literal.start) + literal.replacement + rewritten.slice(literal.end);
  }
  statements.push(rewritten, `DELETE FROM "${table}";`);
  if (statements.some(statement => bytes(statement) > MAX_RESTORE_STATEMENT_BYTES)) throw new Error();
  return statements;
}

function firstStatement(db, sql) {
  let length = Math.min(1024, sql.length);
  for (;;) {
    try {
      const statement = db.prepare(sql.slice(0, length));
      // A prefix can be valid SQL before the real statement ends (for example
      // before another VALUES row). Accept it only when SQLite stops before
      // the prefix boundary, or the entire remaining export has been supplied.
      if (length === sql.length || statement.sourceSQL.length < length) return statement;
    } catch (error) {
      if (length === sql.length) throw error;
    }
    length = Math.min(sql.length, length * 2);
  }
}

// D1 exports can contain a valid large TEXT value inside an over-limit INSERT.
// Stage only those literals, retaining Wrangler's atomic import and the original schema.
export function prepareRestoreSql(input) {
  const sql = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (bytes(sql) <= MAX_RESTORE_STATEMENT_BYTES) return sql;
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    const statements = [];
    let offset = 0;
    while (offset < sql.length) {
      const rest = sql.slice(offset);
      if (!withoutLeadingComments(rest)) break;
      // Use SQLite's parser so semicolons inside strings and trigger bodies stay intact.
      const command = withoutLeadingComments(rest);
      if (!/^(?:PRAGMA\s+defer_foreign_keys\s*=\s*(?:TRUE|ON|1)\s*;|CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX|TRIGGER|VIEW)\b|INSERT\s+INTO\b|DELETE\s+FROM\s+sqlite_sequence\b)/i.test(command)) {
        throw new Error();
      }
      const statement = firstStatement(db, rest);
      if (!statement.sourceSQL || !rest.startsWith(statement.sourceSQL)) throw new Error();
      statement.setReadBigInts(true);
      statement.run();
      statements.push(statement.sourceSQL);
      offset += statement.sourceSQL.length;
    }
    if (statements.every(statement => bytes(statement) <= MAX_RESTORE_STATEMENT_BYTES)) return sql;
    const table = `__codepi_restore_text_${randomUUID().replaceAll('-', '')}`;
    if (db.prepare('SELECT 1 FROM sqlite_master WHERE name=? COLLATE NOCASE').get(table)) throw new Error();
    return [
      `CREATE TABLE "${table}"(id INTEGER PRIMARY KEY,value TEXT NOT NULL);`,
      ...statements.flatMap(statement => bytes(statement) > MAX_RESTORE_STATEMENT_BYTES
        ? stagedInsert(statement, table) : [statement]),
      `DROP TABLE "${table}";`,
    ].join('\n');
  } catch {
    // SQLite diagnostics may contain private values or identifiers from the export.
    throw new Error('Cannot safely prepare this D1 export for the SQL statement limit; no import was started');
  } finally {
    db.close();
  }
}
function executeSql(db, sql) {
  let offset = 0;
  while (sql.slice(offset).trim()) {
    const statement = db.prepare(sql.slice(offset));
    statement.setReadBigInts(true);
    statement.run();
    offset += statement.sourceSQL.length;
  }
}

export function inspectRestoreSql(input) {
  const sql = prepareRestoreSql(input);
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    executeSql(db, sql);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' ORDER BY name",
    ).all();
    return tables.map(({ name }) => {
      const identifier = `"${name.replaceAll('"', '""')}"`;
      const row = db.prepare(`SELECT count(*) AS n FROM ${identifier}`).get();
      const count = Number(row.n);
      if (!Number.isSafeInteger(count)) throw new Error();
      return { name, count };
    });
  } catch {
    throw new Error('Cannot inspect this D1 export safely; no import was started');
  } finally {
    db.close();
  }
}
