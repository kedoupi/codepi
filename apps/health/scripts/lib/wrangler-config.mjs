import { existsSync, readFileSync } from 'node:fs';

/** Stamp a full config, preserving all production vars and service bindings. */
export function withBuildSha(text, sha) {
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) throw new Error('BUILD_SHA must be a Git commit SHA');
  const varsHeader = '[vars]';
  const tables = [...text.matchAll(/^[ \t]*(\[\[?[^\]\r\n]+\]\]?)[ \t]*(?:#[^\n]*)?$/gm)];
  const vars = tables.filter(match => match[1] === varsHeader);
  if (vars.length > 1) throw new Error(`wrangler.toml has ambiguous ${varsHeader} tables`);
  if (!vars.length) return `${text}\n${varsHeader}\nBUILD_SHA = ${JSON.stringify(sha)}\n`;
  const index = tables.indexOf(vars[0]);
  const start = vars[0].index + vars[0][0].length;
  const end = tables[index + 1]?.index ?? text.length;
  const body = text.slice(start, end);
  const key = /^[ \t]*BUILD_SHA[ \t]*=.*$/gm;
  const entries = [...body.matchAll(key)];
  if (entries.length > 1) throw new Error('wrangler.toml has ambiguous BUILD_SHA values');
  const stamped = entries.length ? body.replace(key, `BUILD_SHA = ${JSON.stringify(sha)}`)
    : `\nBUILD_SHA = ${JSON.stringify(sha)}` + body;
  return text.slice(0, start) + stamped + text.slice(end);
}

/**
 * Reads the Worker settings the deploy script depends on and fails loudly on
 * anything ambiguous, so a deploy can stop before it touches production.
 */
export function parseWranglerConfig(text, { dir, fileExists = existsSync } = {}) {
  // Read only the production root, DB binding and trigger table. Searching the
  // whole TOML can accidentally select another environment or D1 database.
  const headers = [...text.matchAll(/^[ \t]*(\[\[?[^\]\r\n]+\]\]?)[ \t]*(?:#[^\n]*)?$/gm)];
  const root = text.slice(0, headers[0]?.index ?? text.length);
  const tables = headers.map((match, i) => ({
    header: match[1],
    body: text.slice(match.index + match[0].length, headers[i + 1]?.index ?? text.length),
  }));
  const stringValue = (section, key) => {
    const matches = [...section.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*("(?:[^"\\\\]|\\\\.)*")[ \\t]*(?:#[^\\n]*)?$`, 'gm'))];
    if (matches.length > 1) throw new Error(`wrangler.toml has ambiguous ${key} values`);
    return matches[0] ? JSON.parse(matches[0][1]) : undefined;
  };
  const name = stringValue(root, 'name');
  const main = stringValue(root, 'main');
  const databases = tables.filter(table => table.header === '[[d1_databases]]' && stringValue(table.body, 'binding') === 'DB');
  if (databases.length > 1) throw new Error('wrangler.toml has ambiguous D1 DB bindings');
  const databaseName = databases[0] && stringValue(databases[0].body, 'database_name');
  const triggers = tables.filter(table => table.header === '[triggers]');
  if (triggers.length > 1) throw new Error('wrangler.toml has ambiguous [triggers] tables');
  const cronLine = triggers[0]?.body.match(/^[ \t]*crons[ \t]*=[ \t]*(\[[\s\S]*?\])[ \t]*(?:#[^\n]*)?$/m)?.[1];
  if (!name) throw new Error('wrangler.toml is missing the Worker name');
  if (!main) throw new Error('wrangler.toml is missing the Worker entrypoint (main)');
  if (dir && !fileExists(`${dir}/${main}`)) throw new Error(`Worker entrypoint ${main} does not exist`);
  if (!databaseName) throw new Error('wrangler.toml is missing the D1 database_name binding');
  if (!cronLine) throw new Error('wrangler.toml is missing the [triggers] crons list');
  let crons;
  try {
    crons = JSON.parse(cronLine);
  } catch {
    throw new Error(`wrangler.toml crons is not valid JSON: ${cronLine}`);
  }
  if (!Array.isArray(crons) || crons.length === 0 || crons.some(cron => typeof cron !== 'string' || !cron.trim())) {
    throw new Error(`wrangler.toml crons must be a non-empty list of cron strings: ${cronLine}`);
  }
  return { name, main, databaseName, crons };
}

export function readWranglerConfig(path, options) {
  return parseWranglerConfig(readFileSync(path, 'utf8'), options);
}
