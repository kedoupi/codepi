import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MAX_RESTORE_STATEMENT_BYTES, prepareRestoreSql } from './d1-restore-sql.mjs';

const literal = value => `'${value.replaceAll("'", "''")}'`;

function importLimited(sql) {
  const db = new DatabaseSync(':memory:');
  try {
    let offset = 0, statements = 0;
    while (sql.slice(offset).trim()) {
      const statement = db.prepare(sql.slice(offset));
      assert.ok(Buffer.byteLength(statement.sourceSQL) <= MAX_RESTORE_STATEMENT_BYTES);
      statement.setReadBigInts(true);
      statement.run();
      offset += statement.sourceSQL.length;
      statements++;
    }
    return { db, statements };
  } catch (error) { db.close(); throw error; }
}

test('large report text survives bounded import with quotes, semicolons and Unicode intact', () => {
  const body = "report '; -- /* text */ \u4e2d\u6587 \ud83d\udcc4\n".repeat(9000);
  const sql = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE reports(id INTEGER PRIMARY KEY,body TEXT NOT NULL,extra TEXT);
INSERT INTO reports VALUES(1,${literal(body)},${literal(body.slice(0, 90000))});
CREATE UNIQUE INDEX reports_body ON reports(id);
CREATE VIEW report_view AS SELECT body FROM reports;
CREATE TRIGGER report_audit AFTER UPDATE ON reports BEGIN
  UPDATE reports SET extra='changed; safely' WHERE id=NEW.id;
END;`;
  const transformed = prepareRestoreSql(sql);
  const { db, statements } = importLimited(transformed);
  try {
    assert.ok(statements > 10);
    const row = db.prepare('SELECT * FROM reports').get();
    assert.equal(row.body, body);
    assert.equal(row.extra, body.slice(0, 90000));
    assert.equal(db.prepare('SELECT body FROM report_view').get().body, body);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name GLOB '__codepi_restore_text_*'").get().n, 0);
    db.exec("UPDATE reports SET extra='probe' WHERE id=1");
    assert.equal(db.prepare('SELECT extra FROM reports').get().extra, 'changed; safely');
  } finally { db.close(); }
});

test('ordinary exports stay byte-for-byte unchanged, including many short statements', () => {
  const short = 'CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT);\n';
  assert.equal(prepareRestoreSql(Buffer.from(short)), short);
  const long = short + Array.from({ length: 4000 }, (_, i) => `INSERT INTO t VALUES(${i},'x;''y');\n`).join('');
  assert.ok(Buffer.byteLength(long) > MAX_RESTORE_STATEMENT_BYTES);
  assert.equal(prepareRestoreSql(long), long);
});

test('many ordinary rows do not repeatedly send the remaining export to SQLite', () => {
  const sql = 'CREATE TABLE t(id INTEGER PRIMARY KEY,body TEXT);\n' +
    Array.from({ length: 1000 }, (_, id) => `INSERT INTO t VALUES(${id},'${'x'.repeat(256)}');\n`).join('');
  const original = DatabaseSync.prototype.prepare;
  let parsedBytes = 0;
  DatabaseSync.prototype.prepare = function (input, ...args) {
    parsedBytes += Buffer.byteLength(input);
    return original.call(this, input, ...args);
  };
  try {
    assert.equal(prepareRestoreSql(sql), sql);
  } finally {
    DatabaseSync.prototype.prepare = original;
  }
  assert.ok(parsedBytes < Buffer.byteLength(sql) * 8,
    `SQLite parsed ${parsedBytes} bytes for a ${Buffer.byteLength(sql)} byte export`);
});

test('a valid SQL prefix at the parser window boundary does not truncate a multirow insert', () => {
  const prefix = "\nINSERT INTO t VALUES(1,'";
  const ending = "')";
  const firstRow = prefix + 'x'.repeat(1024 - prefix.length - ending.length) + ending;
  const sql = 'CREATE TABLE t(id INTEGER PRIMARY KEY,body TEXT);' +
    firstRow + ",(2,'second');\n" + ' '.repeat(MAX_RESTORE_STATEMENT_BYTES);
  const prepared = prepareRestoreSql(sql);
  assert.equal(prepared, sql);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(prepared);
    assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    assert.equal(db.prepare('SELECT body FROM t WHERE id=2').get().body, 'second');
  } finally { db.close(); }
});

test('identifiers, blobs, nulls and 64-bit integers beside large text retain their types and values', () => {
  const text = "'".repeat(90000);
  const sql = `-- leading comment
CREATE TABLE "quote'table"("a'b" INTEGER PRIMARY KEY,body TEXT,bytes BLOB,nothing_value TEXT);
INSERT INTO "quote'table" VALUES(9223372036854775807,${literal(text)},X'0027ff',NULL);
-- trailing comment`;
  const { db } = importLimited(prepareRestoreSql(sql));
  try {
    const query = db.prepare('SELECT * FROM "quote\'table"');
    query.setReadBigInts(true);
    const row = query.get();
    assert.equal(row["a'b"], 9223372036854775807n);
    assert.equal(row.body, text);
    assert.deepEqual(Array.from(row.bytes), [0, 39, 255]);
    assert.equal(row.nothing_value, null);
  } finally { db.close(); }
});

test('unsafe or unsupported oversized exports fail without leaking source text', () => {
  for (const sql of [
    `CREATE TABLE t(v BLOB);INSERT INTO t VALUES(X'${'ab'.repeat(50000)}');`,
    `CREATE TABLE t(v TEXT);INSERT INTO missing VALUES(${literal('PRIVATE'.repeat(20000))});`,
    `ATTACH DATABASE '/tmp/private-restore-test' AS other; -- ${'x'.repeat(90000)}`,
  ]) assert.throws(() => prepareRestoreSql(sql), error =>
    /Cannot safely prepare/.test(error.message) && !/PRIVATE|missing|private-restore-test/.test(error.message));
});
