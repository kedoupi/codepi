import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CredentialStore } from '../../../packages/cli/dist/config.js';
import { callMcpTool } from '../../../packages/cli/dist/mcp.js';
import { expandProjectListPages } from '../../../packages/cli/dist/project-list.js';
import { fixture, ORIGIN } from './runtime.mjs';

test('real CLI SDK client reads context, writes task handoffs, refreshes and reports restricted grants', async t => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'codepi-cli-rpc-'));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const f = await fixture(t);
  const store = new CredentialStore(ORIGIN, { configDir });
  async function credentials(grant, expiresAt = Date.now() + 3600000) {
    await store.write({
      version: 1, server: ORIGIN,
      client: { client_id: grant.client.client_id, redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none', issuer: ORIGIN },
      metadata: { issuer: ORIGIN, authorization_endpoint: ORIGIN + '/oauth/authorize',
        token_endpoint: ORIGIN + '/oauth/token', registration_endpoint: ORIGIN + '/oauth/register',
        revocation_endpoint: ORIGIN + '/oauth/revoke', resource: ORIGIN + '/mcp',
        code_challenge_methods_supported: ['S256'], scopes_supported: grant.scope.split(' ') },
      tokens: { access_token: grant.access_token, refresh_token: grant.refresh_token,
        scope: grant.scope, token_type: 'Bearer', expires_at: expiresAt, issuer: ORIGIN },
    });
  }
  const call = (name, args = {}) => callMcpTool({ server: ORIGIN, name, args, configDir, fetchImpl: f.fetch });
  const grant = await f.grant({ scope: 'context.read projects.read projects.write' });
  await credentials(grant, Date.now() + 10000);
  assert.deepEqual((await call('get_context')).structured.sources.map(s => s.id), ['health', 'project', 'me', 'gu', 'blog']);
  const rotated = await store.read();
  assert.notEqual(rotated.tokens.refresh_token, grant.refresh_token);
  assert.equal(rotated.tokens.scope, f.allScopes);
  const args = { project: 'synthetic/repo', task_id: 'cli-integration', status: 'ready_for_review',
    summary: 'Synthetic integration', next: 'Review', branch: 'codex/cli-integration',
    base_sha: 'a'.repeat(40), request_id: 'cli-integration' };
  assert.equal((await call('project_handoff_save', args)).structured.status, 'ready_for_review');
  const card = (await call('project_get', { project: args.project })).structured;
  assert.equal(card.task_progress[0].task_id, args.task_id);
  assert.equal(card.task_progress[0].latest.client, 'Synthetic client');
  await f.projectDb.batch(Array.from({ length: 25 }, (_, index) => f.projectDb.prepare(
    'INSERT INTO projects(id,repo,name,status) VALUES(?,?,?,?)',
  ).bind(`cli-list-${index}`, `synthetic/list-${index}`, `Synthetic ${index}`, 'paused')));
  const offsets = [];
  const listPage = async (offset, revision) => {
    offsets.push(offset);
    const page = await call('projects_list', { status: 'paused', limit: 10, offset, ...(revision ? { revision } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(page.structured)) <= 12 * 1024);
    return page;
  };
  const firstListPage = await listPage(0);
  const list = await expandProjectListPages(firstListPage, listPage);
  assert.deepEqual(offsets, [0, 10, 20]);
  assert.equal(list.structured.projects.length, 25);
  assert.equal(new Set(list.structured.projects.map(project => project.id)).size, 25);
  assert.ok(list.structured.projects.every(project => project.status === 'paused'));
  await f.projectDb.prepare("UPDATE projects SET status='active' WHERE id=?")
    .bind(firstListPage.structured.projects[0].id).run();
  await assert.rejects(listPage(10, firstListPage.structured.revision),
    error => error.exitCode === 4 && /cursor_stale/.test(error.message));
  const reader = await f.grant({ scope: 'projects.read' });
  await credentials(reader);
  await assert.rejects(call('project_handoff_save', args), error => error.exitCode === 3);
  assert.equal((await f.projectDb.prepare('SELECT COUNT(*) AS n FROM handoffs').first()).n, 1);
});
