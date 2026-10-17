// Cloudflare 治理静态守门：读取 Wrangler 配置与资源登记表，在部署前阻断
// 非生产环境连接生产资源。只读取仓库文件，绝不访问 Cloudflare 或远程数据库。
// 规则见 docs/development/cloudflare-governance.md 第 8 节。
// 守门是 fail-closed：任何缺失、重复或冲突的声明都会违规，不会静默放过。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRY = 'docs/development/cloudflare-resource-registry.md';

const PROD_HOSTS = new Set(['codepi.app', 'www.codepi.app', 'auth.codepi.app',
  'gu.codepi.app', 'gzh.codepi.app', 'health.codepi.app']);
const STAGING_HOSTS = new Set(['staging.codepi.app', 'auth-staging.codepi.app',
  'gu-staging.codepi.app', 'gzh-staging.codepi.app', 'health-staging.codepi.app']);
const ENV_SUFFIX = /-(staging|pr-\d+)$/;
const ASSETS_HEADER = '[assets]';

// ---- 轻量解析（沿用 oura/scripts/lib/wrangler-config.mjs 的分段模式，不引入依赖）----

function splitToml(text) {
  const headers = [...text.matchAll(/^[ \t]*(\[\[?[^\]\r\n]+\]\]?)[ \t]*(?:#[^\n]*)?$/gm)];
  const root = text.slice(0, headers[0]?.index ?? text.length);
  const tables = headers.map((match, i) => ({
    header: normalizeTomlHeader(match[1]),
    body: text.slice(match.index + match[0].length, headers[i + 1]?.index ?? text.length),
  }));
  return { root, tables };
}

// TOML 表头规范化：去空格、去掉 quoted key 的引号，使
// [ env.staging.assets ] / [env.staging."assets"] 等合法变体都归一为
// 规范拼写再比较。守门是 fail-closed，不能因为写法变体放过覆盖声明。
function normalizeTomlHeader(header) {
  const double = header.startsWith('[[');
  const inner = header.slice(double ? 2 : 1, double ? -2 : -1).trim();
  const parts = inner.split('.').map(part => {
    const p = part.trim();
    return p.length >= 2 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
  });
  return `${double ? '[[' : '['}${parts.join('.')}${double ? ']]' : ']'}`;
}

function tomlString(section, key) {
  const m = [...section.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*("(?:[^"\\\\]|\\\\.)*")[ \\t]*(?:#[^\\n]*)?$`, 'gm'))];
  return m[0] ? JSON.parse(m[0][1]) : undefined;
}

function tomlStringCount(section, key) {
  return [...section.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*=`, 'gm'))].length;
}

function tomlTableBodies(tables, header) {
  return tables.filter(t => t.header === header).map(t => t.body);
}

function tomlCrons(tables, header) {
  const bodies = tomlTableBodies(tables, header);
  const matches = bodies.flatMap(body => [...body.matchAll(/^[ \t]*crons[ \t]*=[ \t]*(\[[\s\S]*?\])[ \t]*(?:#[^\n]*)?$/gm)]);
  if (matches.length !== 1) return { value: [], count: matches.length, valid: matches.length === 0 };
  try {
    const value = JSON.parse(matches[0][1]);
    return { value, count: 1, valid: Array.isArray(value) && value.every(cron => typeof cron === 'string') };
  } catch { return { value: [], count: 1, valid: false }; }
}

function tomlRoutes(section) {
  const assignments = [...section.matchAll(/^[ \t]*routes[ \t]*=/gm)];
  if (!assignments.length) return { patterns: [], entries: [], count: 0, valid: true };
  const array = section.match(/^[ \t]*routes[ \t]*=[ \t]*(\[[\s\S]*?^\s*\])/m)?.[1];
  if (assignments.length !== 1 || !array) return { patterns: [], entries: [], count: assignments.length, valid: false };
  const entries = [...array.matchAll(/\{([^{}]*)\}/g)].map(match => {
    const rawPattern = match[1].match(/\bpattern[ \t]*=[ \t]*("(?:[^"\\]|\\.)*")/);
    return {
      pattern: rawPattern ? JSON.parse(rawPattern[1]) : undefined,
      customDomain: /\bcustom_domain\s*=\s*true\b/.test(match[1]),
    };
  });
  return {
    patterns: entries.map(entry => entry.pattern).filter(Boolean),
    entries,
    count: 1,
    valid: entries.length > 0 && entries.every(entry => typeof entry.pattern === 'string'),
  };
}

function hostOf(value) {
  if (!value) return undefined;
  try { return new URL(value).host; } catch { return undefined; }
}

function stripJsonc(text) {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    out += c;
  }
  return out;
}

function normalizeBindings(value, fields) {
  if (value === undefined) return { all: [], malformed: false };
  if (!Array.isArray(value)) return { all: [], malformed: true };
  const all = value.map(item => Object.fromEntries(fields.map(field => [field, item?.[field]])));
  return { all, malformed: all.some(item => fields.some(field => typeof item[field] !== 'string' || !item[field])) };
}

// ---- 配置归一化：每个服务产出 production 与 staging 两份完整描述 ----

function parseTomlEnv(root, tables, prefix) {
  const section = prefix ? tomlTableBodies(tables, `[${prefix}]`).join('\n') : root;
  const varsBody = prefix ? tomlTableBodies(tables, `[${prefix}.vars]`).join('\n') : tomlTableBodies(tables, '[vars]').join('\n');
  const p = prefix ? `${prefix}.` : '';
  const d1All = tomlTableBodies(tables, `[[${p}d1_databases]]`)
    .map(body => ({ binding: tomlString(body, 'binding'), name: tomlString(body, 'database_name'), id: tomlString(body, 'database_id') }));
  const servicesAll = tomlTableBodies(tables, `[[${p}services]]`)
    .map(body => ({ binding: tomlString(body, 'binding'), service: tomlString(body, 'service') }));
  const routes = tomlRoutes(section);
  const crons = tomlCrons(tables, `[${p}triggers]`);
  const duplicate = (all, field) => [...new Set(all.map(item => item[field]).filter((value, i, values) => value && values.indexOf(value) !== i))];
  return {
    present: prefix ? section.length > 0 || varsBody.length > 0 || d1All.length > 0 || servicesAll.length > 0 : true,
    name: tomlString(section, 'name'),
    environment: tomlString(varsBody, 'ENVIRONMENT'),
    environmentCount: tomlStringCount(varsBody, 'ENVIRONMENT'),
    authOrigin: tomlString(varsBody, 'AUTH_ORIGIN'),
    frontendOrigin: tomlString(varsBody, 'FRONTEND_ORIGIN'),
    frontendOrigins: tomlString(varsBody, 'FRONTEND_ORIGINS'),
    ouraRedirect: tomlString(varsBody, 'OURA_REDIRECT_URI'),
    autoSync: tomlString(varsBody, 'AUTO_SYNC_ENABLED'),
    allowDevLogin: tomlString(varsBody, 'ALLOW_DEV_LOGIN'),
    d1All, d1Malformed: d1All.some(d => !d.binding || !d.name || !d.id),
    duplicateD1Bindings: duplicate(d1All, 'binding'),
    servicesAll, servicesMalformed: servicesAll.some(s => !s.binding || !s.service),
    duplicateServiceBindings: duplicate(servicesAll, 'binding'),
    routePatterns: routes.patterns, routeEntries: routes.entries, routeCount: routes.count, routesValid: routes.valid,
    crons: crons.value, cronCount: crons.count, cronsValid: crons.valid,
  };
}

function normalizeTomlService(text, envKey) {
  const { root, tables } = splitToml(text);
  return {
    production: parseTomlEnv(root, tables, null),
    staging: parseTomlEnv(root, tables, `env.${envKey}`),
    assetsTables: tomlTableBodies(tables, ASSETS_HEADER),
    envAssetsHeaders: tables.filter(t => /^\[env\..+\.assets\]$/.test(t.header)).map(t => t.header),
  };
}

function normalizeJsoncService(text) {
  const cfg = JSON.parse(stripJsonc(text));
  const pick = (src, present) => {
    const d1 = normalizeBindings(Array.isArray(src.d1_databases)
      ? src.d1_databases.map(database => ({ binding: database?.binding, name: database?.database_name, id: database?.database_id }))
      : src.d1_databases, ['binding', 'name', 'id']);
    const services = normalizeBindings(src.services, ['binding', 'service']);
    const routeEntries = Array.isArray(src.routes)
      ? src.routes.map(route => ({ pattern: route?.pattern, customDomain: route?.custom_domain }))
      : [];
    const crons = src.triggers?.crons;
    const duplicate = (all, field) => [...new Set(all.map(item => item[field]).filter((value, i, values) => value && values.indexOf(value) !== i))];
    return {
      present, name: src.name, environment: src.vars?.ENVIRONMENT,
      environmentCount: src.vars?.ENVIRONMENT === undefined ? 0 : 1,
      authOrigin: src.vars?.AUTH_ORIGIN, frontendOrigin: src.vars?.FRONTEND_ORIGIN,
      frontendOrigins: src.vars?.FRONTEND_ORIGINS, ouraRedirect: src.vars?.OURA_REDIRECT_URI,
      autoSync: src.vars?.AUTO_SYNC_ENABLED, allowDevLogin: src.vars?.ALLOW_DEV_LOGIN,
      d1All: d1.all, d1Malformed: d1.malformed, duplicateD1Bindings: duplicate(d1.all, 'binding'),
      servicesAll: services.all, servicesMalformed: services.malformed, duplicateServiceBindings: duplicate(services.all, 'binding'),
      routePatterns: routeEntries.map(route => route?.pattern).filter(Boolean), routeEntries,
      routeCount: src.routes === undefined ? 0 : 1,
      routesValid: Array.isArray(src.routes) && routeEntries.length > 0
        && routeEntries.every(route => route && typeof route.pattern === 'string'),
      crons: Array.isArray(crons) ? crons : [], cronCount: crons === undefined ? 0 : 1,
      cronsValid: Array.isArray(crons) && crons.every(cron => typeof cron === 'string'),
      ssoExtra: src.vars?.SSO_EXTRA_REDIRECT_URIS,
    };
  };
  return {
    production: pick(cfg, true),
    staging: cfg.env?.staging ? pick(cfg.env.staging, true) : pick({}, false),
  };
}

// ---- 登记表 ----

export function parseRegistry(text) {
  const rows = [];
  const table = text.match(/<!-- registry-table:begin -->([\s\S]*?)<!-- registry-table:end -->/);
  if (!table) throw new Error('registry table markers not found');
  for (const line of table[1].split('\n')) {
    if (!line.startsWith('|') || /^\|[-\s|]+\|$/.test(line) || line.includes('logical_id')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 12) continue;
    rows.push({
      logical_id: cells[0], environment: cells[1], resource_type: cells[2],
      physical_name: cells[3], hostname_or_route: cells[8], status: cells[10],
    });
  }
  return rows;
}

// token → 匹配行。匹配 physical_name 主 token、括号内 UUID 或
// hostname_or_route 的空白/逗号/箭头分隔 token。
function registryIndex(rows) {
  const map = new Map();
  const add = (key, row) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  for (const row of rows) {
    add(row.physical_name.split(/\s+/)[0], row);
    const uuid = row.physical_name.match(/\(([0-9a-f-]{36})\)/i)?.[1];
    if (uuid) add(uuid, row);
    for (const token of row.hostname_or_route.split(/[\s,→]+/).filter(Boolean)) add(token, row);
  }
  return map;
}

const HOST_TYPES = new Set(['pages', 'pages-domain', 'worker', 'zone']);
const BAD_STATUSES = ['legacy-pending-retirement', 'legacy-preview', 'unknown'];

// ---- 规则 ----

function checkService(spec, cfg, index, violations) {
  const at = (msg) => violations.push(`${spec.id}: ${msg}`);
  const { production: prod, staging, assetsTables = [], envAssetsHeaders = [] } = cfg;
  const environments = [['production', prod], ['staging', staging]];
  const checkRef = (token, env, typeHint, label) => {
    if (!token) return;
    const rows = index.get(token);
    if (!rows?.length) { at(`referenced ${label} ${token} has no registry record`); return; }
    for (const bad of BAD_STATUSES) if (rows.some(row => row.status === bad)) at(`referenced ${label} ${token} is registered as ${bad}`);
    if (!rows.some(row => row.status === 'managed' && row.environment === env
      && (typeHint === 'host' ? HOST_TYPES.has(row.resource_type) : row.resource_type === typeHint))) {
      at(`referenced ${label} ${token} has no managed ${env} registry row`);
    }
  };
  const checkD1 = (d1, env) => {
    if (!d1?.name || !d1.id) return;
    checkRef(d1.name, env, 'd1', 'D1');
    checkRef(d1.id, env, 'd1', 'D1');
    const rows = [...new Set([...(index.get(d1.name) ?? []), ...(index.get(d1.id) ?? [])])];
    for (const bad of BAD_STATUSES) {
      if (rows.some(row => row.status === bad)) at(`referenced D1 ${d1.name} is registered as ${bad}`);
    }
    if (!rows.some(row => row.status === 'managed' && row.environment === env && row.resource_type === 'd1'
      && row.physical_name.startsWith(`${d1.name} (`) && row.physical_name.includes(`(${d1.id})`))) {
      at(`${env} D1 ${d1.name} (${d1.id}) has no managed ${env} registry row matching both name and database_id`);
    }
  };
  const expectedServices = (env) => Object.entries(spec.serviceBindings ?? {})
    .map(([binding, names]) => [binding, names[env]]);
  const checkServices = (env, envName) => {
    if (env.servicesMalformed) at(`${envName} has malformed service binding declaration`);
    for (const binding of env.duplicateServiceBindings) at(`${envName} has duplicate service binding "${binding}"`);
    const expected = new Map(expectedServices(envName));
    for (const { binding, service } of env.servicesAll) {
      if (!expected.has(binding)) at(`${envName} has unexpected service binding "${binding}"`);
      else if (service !== expected.get(binding)) at(`${envName} service binding "${binding}" must be ${expected.get(binding)}, got ${service}`);
    }
    for (const [binding, service] of expected) {
      if (!env.servicesAll.some(entry => entry.binding === binding && entry.service === service)) {
        at(`${envName} service binding "${binding}" is missing (expected ${service})`);
      }
    }
  };
  const checkD1s = (env, envName) => {
    const expectedName = envName === 'production' ? spec.d1Name : `${spec.d1Name}-staging`;
    if (env.d1All.length !== 1) at(`${envName} must declare exactly one D1 DB binding (got ${env.d1All.length})`);
    if (env.d1Malformed) at(`${envName} has malformed D1 declaration`);
    for (const binding of env.duplicateD1Bindings) at(`${envName} has duplicate D1 binding "${binding}"`);
    const d1 = env.d1All[0];
    if (!d1) return;
    if (d1.binding !== 'DB') at(`${envName} D1 binding must be "DB", got ${d1.binding}`);
    if (d1.name !== expectedName) at(`${envName} D1 database_name must be ${expectedName}, got ${d1.name}`);
    if (!d1.id) at(`${envName} D1 database_id is missing`);
    checkD1(d1, envName);
  };

  for (const [envName, env] of environments) {
    if (env.environmentCount > 1) at(`${envName} declares ENVIRONMENT more than once`);
    if (!env.cronsValid) at(`${envName} [triggers] crons declaration is malformed`);
    if (spec.routesRequired && !env.routesValid) at(`${envName} routes declaration is malformed`);
  }

  if (prod.name !== spec.prodName) at(`production name ${prod.name} != ${spec.prodName}`);
  if (ENV_SUFFIX.test(prod.name || '')) at(`production name ${prod.name} carries an environment suffix`);
  if (prod.environment !== 'production') at(`production ENVIRONMENT must be "production", got ${prod.environment}`);
  if (spec.stagingName && staging.name !== spec.stagingName) at(`staging name ${staging.name} != ${spec.stagingName}`);
  if (staging.environment !== 'staging') at(`staging ENVIRONMENT must be "staging", got ${staging.environment}`);

  for (const [envName, env] of environments) {
    checkD1s(env, envName);
    checkServices(env, envName);
    const expectedAuthOrigin = envName === 'production' ? 'https://auth.codepi.app' : 'https://auth-staging.codepi.app';
    if (env.authOrigin !== expectedAuthOrigin) at(`${envName} AUTH_ORIGIN must be ${expectedAuthOrigin}`);
  }
  if (prod.d1All[0]?.id && staging.d1All[0]?.id && prod.d1All[0].id === staging.d1All[0].id) {
    at(`staging D1 database_id ${staging.d1All[0].id} equals production D1 (${prod.d1All[0].name})`);
  }

  for (const [envName, env] of environments) {
    for (const pattern of env.routePatterns) {
      const host = pattern.replace(/\/.*$/, '');
      if (host.endsWith('.kdp.cool') || host === 'kdp.cool') at(`route host ${host} uses retired kdp.cool`);
      if (host === 'api.codepi.app') at('api.codepi.app is not allowed without an explicit API boundary');
      if (envName === 'staging' && PROD_HOSTS.has(host)) at(`health staging route ${pattern} uses a production hostname`);
      const hosts = envName === 'production' ? PROD_HOSTS : STAGING_HOSTS;
      if (!hosts.has(host) && !host.endsWith('.workers.dev')) at(`${envName} route host ${host} violates the hostname contract`);
    }
  }

  if (spec.routesRequired) {
    for (const [envName, env] of environments) {
      if (!env.routePatterns.length) at(`${envName} worker routes must be declared explicitly`);
    }
  }
  if (spec.cronsRequired) {
    for (const [envName, env] of environments) {
      if (env.cronCount !== 1 || !env.crons.length) at(`${envName} [triggers] crons must be declared exactly once`);
    }
  }

  if (spec.authRoutes) {
    for (const [envName, env] of environments) {
      const expected = envName === 'production' ? 'auth.codepi.app' : 'auth-staging.codepi.app';
      if (env.routeEntries.length !== 1 || env.routeEntries[0]?.pattern !== expected || env.routeEntries[0]?.customDomain !== true) {
        at(`${envName} auth route must be exactly custom_domain ${expected}`);
      }
    }
  }

  if (spec.kind === 'worker-assets') {
    if (assetsTables.length !== 1) {
      at(`[assets] must be declared exactly once (got ${assetsTables.length})`);
    }
    const assetsBody = assetsTables[0] ?? '';
    if (tomlStringCount(assetsBody, 'directory') !== 1
      || tomlString(assetsBody, 'directory') !== './dist') {
      at('[assets] must declare directory = "./dist" exactly once');
    }
    if (tomlStringCount(assetsBody, 'binding') !== 1 || tomlString(assetsBody, 'binding') !== 'ASSETS') {
      at('[assets] must declare binding = "ASSETS" exactly once');
    }
    // 全量匹配赋值：布尔数组或重复声明都不满足"唯一 true"。
    const workerFirstAll = [...assetsBody.matchAll(/^[ \t]*run_worker_first[ \t]*=/gm)];
    const workerFirst = [...assetsBody.matchAll(/^[ \t]*run_worker_first[ \t]*=[ \t]*true[ \t]*(?:#[^\n]*)?$/gm)];
    if (workerFirstAll.length !== 1) {
      at(`[assets] must declare run_worker_first exactly once (got ${workerFirstAll.length})`);
    }
    if (workerFirstAll.length === 1 && workerFirst.length !== 1) {
      at('[assets] must declare run_worker_first = true exactly once (authenticated app must not bypass the Worker; array form is not allowed)');
    }
    if (tomlStringCount(assetsBody, 'not_found_handling') > 0) {
      at('[assets] must not declare not_found_handling (404/page semantics stay in the Hono router)');
    }
    if (envAssetsHeaders.length > 0) {
      at(`per-environment assets overrides are forbidden; staging inherits the top-level [assets] (found ${envAssetsHeaders.join(', ')})`);
    }
  }

  if (spec.requiredRoutes) {
    for (const [envName, env] of environments) {
      const actual = [...env.routePatterns].sort();
      const expected = [...spec.requiredRoutes[envName === 'production' ? 'prod' : 'staging']].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) at(`${envName} routes must be exactly [${expected.join(', ')}]`);
    }
  }

  if (spec.health) {
    for (const [envName, env] of environments) {
      const host = envName === 'production' ? 'health.codepi.app' : 'health-staging.codepi.app';
      const origin = `https://${host}`;
      if (envName === 'staging') {
        for (const [label, value] of [['FRONTEND_ORIGIN', env.frontendOrigin], ['FRONTEND_ORIGINS', env.frontendOrigins], ['OURA_REDIRECT_URI', env.ouraRedirect]]) {
          if (PROD_HOSTS.has(hostOf(value))) at(`health staging ${label} uses a production hostname`);
        }
      }
      if (env.frontendOrigin !== origin) at(`${envName} FRONTEND_ORIGIN must be ${origin}`);
      if (env.frontendOrigins !== origin) at(`${envName} FRONTEND_ORIGINS must be ${origin}`);
      if (env.ouraRedirect !== `${origin}/api/auth/oura/callback`) at(`${envName} OURA_REDIRECT_URI must be the Health callback`);
      if (env.allowDevLogin !== '0') at(`health ${envName} ALLOW_DEV_LOGIN must be "0"`);
    }
    if (spec.id === 'health-api' && staging.autoSync !== '0') at(`health staging AUTO_SYNC_ENABLED must be "0"`);
  }

  if (spec.id === 'auth') {
    const expectedCallbacks = {
      production: {
        gu: ['https://gu.kdp.cool/api/auth/callback', 'https://gu.codepi.app/api/auth/callback'],
        oura: ['https://health.kdp.cool/api/auth/callback', 'https://health.codepi.app/api/auth/callback'],
        gzh: ['https://gzh.codepi.app/api/auth/callback'],
        desk: ['https://kdp.cool/api/auth/callback', 'https://codepi.app/api/auth/callback'],
      },
      staging: {
        gu: ['https://gu-staging.codepi.app/api/auth/callback'],
        oura: ['https://health-staging.codepi.app/api/auth/callback'],
        gzh: ['https://gzh-staging.codepi.app/api/auth/callback'],
        desk: ['https://staging.codepi.app/api/auth/callback'],
      },
    };
    for (const [envName, env] of environments) {
      let callbacks;
      try { callbacks = JSON.parse(env.ssoExtra); } catch { at(`auth ${envName} SSO_EXTRA_REDIRECT_URIS must be valid JSON`); continue; }
      const expected = expectedCallbacks[envName];
      if (!callbacks || Array.isArray(callbacks) || typeof callbacks !== 'object'
        || JSON.stringify(Object.keys(callbacks).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
        at(`auth ${envName} SSO callback clients must be exactly gu, oura, gzh, desk`);
        continue;
      }
      for (const [client, urls] of Object.entries(expected)) {
        if (!Array.isArray(callbacks[client]) || callbacks[client].length !== urls.length
          || urls.some(url => !callbacks[client].includes(url)) || new Set(callbacks[client]).size !== callbacks[client].length) {
          at(`auth ${envName} SSO callback for client ${client} is invalid`);
        }
      }
    }
  }

  const refs = [[prod.name, 'production', spec.kind === 'pages' ? 'pages' : 'worker', 'name']];
  if (spec.stagingName) refs.push([staging.name, 'staging', 'worker', 'staging name']);
  for (const [envName, env] of environments) {
    for (const service of env.servicesAll) refs.push([service.service, envName, 'worker', `service binding ${service.binding}`]);
    for (const pattern of env.routePatterns) refs.push([pattern.replace(/\/.*$/, ''), envName, 'host', 'route host']);
    const authHost = hostOf(env.authOrigin);
    if (authHost) refs.push([authHost, envName, 'host', 'AUTH_ORIGIN host']);
    for (const origin of [env.frontendOrigin, env.frontendOrigins]) {
      const host = hostOf(origin);
      if (host) refs.push([host, envName, 'host', 'frontend origin host']);
    }
    const redirectHost = hostOf(env.ouraRedirect);
    if (redirectHost) refs.push([redirectHost, envName, 'host', 'OURA_REDIRECT_URI host']);
  }
  for (const [token, env, typeHint, label] of refs) checkRef(token, env, typeHint, label);
}

export function collectViolations({ root = ROOT, registryFile = REGISTRY, requireAll = true } = {}) {
  const specs = [
    { id: 'www', file: 'apps/web/wrangler.toml', format: 'toml', kind: 'pages', prodName: 'codepi-www', d1Name: 'codepi-desk', envKey: 'preview',
      serviceBindings: { AUTH: { production: 'codepi-auth', staging: 'codepi-auth-staging' } } },
    { id: 'gu', file: 'apps/gu/wrangler.toml', format: 'toml', kind: 'worker-assets', prodName: 'codepi-gu', stagingName: 'codepi-gu-staging', d1Name: 'codepi-gu', envKey: 'staging',
      serviceBindings: { AUTH: { production: 'codepi-auth', staging: 'codepi-auth-staging' } } },
    { id: 'gzh', file: 'apps/gzh/wrangler.toml', format: 'toml', kind: 'pages', prodName: 'codepi-gzh', d1Name: 'codepi-gzh', envKey: 'preview',
      serviceBindings: { AUTH: { production: 'codepi-auth', staging: 'codepi-auth-staging' } } },
    { id: 'health-pages', file: 'apps/oura/apps/web/wrangler.toml', format: 'toml', kind: 'pages', prodName: 'codepi-health', d1Name: 'codepi-health', envKey: 'preview', health: true,
      serviceBindings: { AUTH: { production: 'codepi-auth', staging: 'codepi-auth-staging' }, WORKER: { production: 'codepi-health-api', staging: 'codepi-health-api-staging' } } },
    { id: 'auth', file: 'services/auth/wrangler.jsonc', format: 'jsonc', kind: 'worker', prodName: 'codepi-auth', stagingName: 'codepi-auth-staging', d1Name: 'codepi-auth', envKey: 'staging',
      routesRequired: true, cronsRequired: true, authRoutes: true },
    { id: 'health-api', file: 'apps/oura/workers/api/wrangler.toml', format: 'toml', kind: 'worker', prodName: 'codepi-health-api', stagingName: 'codepi-health-api-staging', d1Name: 'codepi-health', envKey: 'staging',
      health: true, routesRequired: true, cronsRequired: true,
      serviceBindings: { AUTH: { production: 'codepi-auth', staging: 'codepi-auth-staging' } },
      requiredRoutes: {
        prod: ['health.codepi.app/api/*', 'health.codepi.app/mcp', 'health.codepi.app/oauth*', 'health.codepi.app/.well-known*'],
        staging: ['health-staging.codepi.app/api/*', 'health-staging.codepi.app/mcp', 'health-staging.codepi.app/oauth*', 'health-staging.codepi.app/.well-known*'],
      } },
  ];
  const registryPath = path.join(root, registryFile);
  if (!existsSync(registryPath)) throw new Error(`registry not found: ${registryPath}`);
  const index = registryIndex(parseRegistry(readFileSync(registryPath, 'utf8')));
  const violations = [];
  for (const spec of specs) {
    const file = path.join(root, spec.file);
    if (!existsSync(file)) {
      if (requireAll) violations.push(`${spec.id}: missing config ${spec.file}`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const cfg = spec.format === 'jsonc' ? normalizeJsoncService(text) : normalizeTomlService(text, spec.envKey);
    checkService(spec, cfg, index, violations);
  }
  return violations;
}

export function main(args = process.argv.slice(2)) {
  let root = ROOT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root' && args[i + 1] && !args[i + 1].startsWith('-')) root = path.resolve(args[++i]);
    else {
      console.error(`Unknown option: ${args[i]}`);
      return 1;
    }
  }
  const violations = collectViolations({ root });
  if (violations.length) {
    console.error('Cloudflare governance violations:');
    for (const v of violations) console.error(`  ✗ ${v}`);
    return 1;
  }
  console.log('Cloudflare governance check passed: all runtime configs satisfy the naming, isolation and registry rules.');
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exit(main());
}
