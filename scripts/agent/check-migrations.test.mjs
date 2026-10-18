import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  numericPrefix, findDuplicatePrefixes, findModifiedBaseline, sha256,
} from './check-migrations.mjs';

test('numericPrefix extracts the leading sequence', () => {
  assert.equal(numericPrefix('0001_init.sql'), '0001');
  assert.equal(numericPrefix('0011_repair.sql'), '0011');
  assert.equal(numericPrefix('no-number.sql'), null);
});

test('duplicate prefixes are flagged beyond the GU baseline allowlist', () => {
  const entries = [
    { rel: 'apps/gu/migrations/0002_calendar.sql', prefix: '0002' },
    { rel: 'apps/gu/migrations/0002_sso.sql', prefix: '0002' },
    { rel: 'apps/web/migrations/0003_a.sql', prefix: '0003' },
    { rel: 'apps/web/migrations/0003_b.sql', prefix: '0003' },
  ];
  const duplicates = findDuplicatePrefixes(entries);
  assert.equal(duplicates.length, 1, 'GU 0002 is allowlisted; web 0003 must fail');
  assert.equal(duplicates[0].key, 'apps/web/migrations/0003');
});

test('the historical GU pair does not allow a third migration with the same number', () => {
  const entries = ['0002_calendar.sql', '0002_sso.sql', '0002_new.sql'].map(name => ({
    rel: `apps/gu/migrations/${name}`, prefix: numericPrefix(name),
  }));
  assert.equal(findDuplicatePrefixes(entries).length, 1);
  assert.equal(findDuplicatePrefixes(entries.slice(1)).length, 1, 'renamed duplicates are not grandfathered');
});

test('padding cannot disguise a duplicate migration number', () => {
  const entries = ['0003_first.sql', '003_second.sql'].map(name => ({
    rel: `apps/web/migrations/${name}`, prefix: numericPrefix(name),
  }));
  assert.equal(findDuplicatePrefixes(entries).length, 1);
});

test('baseline drift detects modified and deleted migrations', () => {
  const baseline = {
    'apps/web/migrations/0001_a.sql': sha256('original'),
    'apps/web/migrations/0002_b.sql': sha256('gone'),
  };
  const entries = [{ rel: 'apps/web/migrations/0001_a.sql', hash: sha256('edited') }];
  const drift = findModifiedBaseline(entries, baseline);
  assert.deepEqual(
    drift.map(d => `${d.kind}:${d.rel}`).sort(),
    ['deleted:apps/web/migrations/0002_b.sql', 'modified:apps/web/migrations/0001_a.sql'],
  );
});

test('baseline drift ignores brand-new migrations', () => {
  const baseline = { 'apps/web/migrations/0001_a.sql': sha256('original') };
  const entries = [
    { rel: 'apps/web/migrations/0001_a.sql', hash: sha256('original') },
    { rel: 'apps/web/migrations/0002_new.sql', hash: sha256('new file') },
  ];
  assert.deepEqual(findModifiedBaseline(entries, baseline), []);
});
