import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeState, pushUrlState } from './url-state.js';
import { getSkillBuilderUrlState, skillBuilderUrlOwnedKeys } from './skill-builder-url-state.js';

const defaults = {
  template: 'code-review',
  client: 'codex',
  name: 'Default name',
  purpose: 'Default purpose',
  trigger: 'Default trigger',
  steps: 'Default steps',
  inputs: 'Default inputs',
  output: 'Default output',
  limits: 'Default limits',
  safety: true,
};

function pushSkillBuilderState(search, data) {
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: { pathname: '/skill-builder/', search },
    history: { replaceState: (...args) => calls.push(args) },
  };

  try {
    const { state, ownedKeys } = getSkillBuilderUrlState(data);
    pushUrlState(state, { ownedKeys });
    return new URL(calls[0][2], 'https://codepi.app');
  } finally {
    globalThis.window = previousWindow;
  }
}

test('Skill Builder keeps free-text fields out of updated URLs', () => {
  const data = {
    ...defaults,
    name: 'PRIVATE_NAME_TOKEN',
    purpose: 'PRIVATE_PURPOSE_TOKEN',
    trigger: 'PRIVATE_TRIGGER_TOKEN',
    steps: 'PRIVATE_STEPS_TOKEN',
    inputs: 'PRIVATE_INPUTS_TOKEN',
    output: 'PRIVATE_OUTPUT_TOKEN',
    limits: 'PRIVATE_LIMITS_TOKEN',
    safety: false,
  };
  const url = pushSkillBuilderState('?lang=zh&utm_source=test&unknown=value', data);

  assert.equal(url.searchParams.get('template'), data.template);
  assert.equal(url.searchParams.get('client'), data.client);
  assert.equal(url.searchParams.get('lang'), 'zh');
  assert.equal(url.searchParams.get('utm_source'), 'test');
  assert.equal(url.searchParams.get('unknown'), 'value');
  for (const key of skillBuilderUrlOwnedKeys.slice(2)) {
    assert.equal(url.searchParams.has(key), false, `${key} must not be persisted`);
  }
  for (const value of Object.values(data).slice(2)) {
    assert.equal(url.search.includes(encodeURIComponent(String(value))), false);
  }
});

test('Skill Builder reads historical fields once and removes them on the next update', () => {
  const historicalSearch = '?name=Legacy%20Name&purpose=Legacy%20Purpose&template=seo&client=claude&lang=zh&utm_source=test&unknown=value';
  const decoded = decodeState(historicalSearch, defaults);

  assert.equal(decoded.name, 'Legacy Name');
  assert.equal(decoded.purpose, 'Legacy Purpose');

  const url = pushSkillBuilderState(historicalSearch, decoded);

  assert.equal(url.searchParams.get('template'), 'seo');
  assert.equal(url.searchParams.get('client'), 'claude');
  assert.equal(url.searchParams.get('lang'), 'zh');
  assert.equal(url.searchParams.get('utm_source'), 'test');
  assert.equal(url.searchParams.get('unknown'), 'value');
  assert.equal(url.searchParams.has('name'), false);
  assert.equal(url.searchParams.has('purpose'), false);
});
