import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const guDir = fileURLToPath(new URL("../", import.meta.url));
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const assetPattern = /(?:src|href)=["'](\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css))["']/g;

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateConfig(config) {
  const production = config.d1_databases?.find(db => db.binding === "DB");
  const preview = config.env?.preview?.d1_databases?.find(db => db.binding === "DB");
  requireCheck(config.name === "kdp-gu" && config.pages_build_output_dir, "GU Pages project/output configuration is missing.");
  requireCheck(config.vars?.ENVIRONMENT === "production" && config.env?.preview?.vars?.ENVIRONMENT === "preview",
    "Production and preview environment markers must be explicit.");
  for (const db of [production, preview]) {
    requireCheck(db?.database_name && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(db.database_id)
      && !db.database_id.startsWith("00000000-0000-0000-0000-"),
    "Provision real production and preview D1 DB bindings; placeholders are not accepted.");
  }
  requireCheck(production.database_id.toLowerCase() !== preview.database_id.toLowerCase()
    && production.database_name !== preview.database_name, "Production and preview D1 databases must be separate.");
}

export async function checkConfig() {
  // Use the existing Wrangler parser rather than interpreting TOML with regexes.
  const { experimental_readRawConfig } = await import("wrangler");
  let rawConfig;
  try {
    ({ rawConfig } = experimental_readRawConfig({ config: path.join(guDir, "wrangler.toml") }));
  } catch {
    throw new Error("Unable to parse GU wrangler.toml.");
  }
  validateConfig(rawConfig);
  return "Production/preview D1 configuration and isolation passed (secrets and deployment not checked).";
}

export function deploymentOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Provide a valid deployment origin with --url."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  requireCheck(url.protocol === "https:" || (url.protocol === "http:" && local), "Deployment checks require HTTPS (HTTP is allowed only on loopback).");
  requireCheck(!url.username && !url["password"] && url.pathname === "/" && !url.search && !url.hash,
    "--url must be an origin without credentials, a path, query or fragment.");
  return url.origin;
}

async function getResponse(fetcher, origin, pathname) {
  try {
    return await fetcher(`${origin}${pathname}`, {
      method: "GET", redirect: "manual", credentials: "omit",
      headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`${pathname}: network/TLS failure or timeout.`);
  }
}

async function readResponse(response, pathname) {
  requireCheck(Number(response.headers.get("Content-Length") || 0) <= MAX_RESPONSE_BYTES, `${pathname}: response is too large.`);
  const reader = response.body?.getReader();
  requireCheck(reader, `${pathname}: response body is missing.`);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      requireCheck(size <= MAX_RESPONSE_BYTES, `${pathname}: response is too large.`);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readJson(response, pathname) {
  requireCheck(response.headers.get("Content-Type")?.includes("application/json"), `${pathname}: expected JSON, received another content type.`);
  requireCheck(/\bno-store\b/i.test(response.headers.get("Cache-Control") || ""), `${pathname}: missing no-store.`);
  const body = await readResponse(response, pathname);
  try { return JSON.parse(body.toString("utf8")); } catch { throw new Error(`${pathname}: invalid JSON.`); }
}

function assets(html) {
  return [...new Set(Array.from(html.matchAll(assetPattern), match => match[1]))].sort();
}

export async function checkHealth(origin, { distDir = path.join(guDir, "dist"), fetcher = fetch } = {}) {
  const health = await getResponse(fetcher, origin, "/api/health");
  requireCheck(health.status === 200, `/api/health: expected 200, received ${health.status}.`);
  requireCheck((await readJson(health, "/api/health"))?.ok === true, "/api/health: expected ok=true.");
  let localIndex;
  try { localIndex = await readFile(path.join(distDir, "index.html")); } catch {
    throw new Error("Local dist/index.html is missing; run npm run build before checking the deployed asset version.");
  }
  const expectedAssets = assets(localIndex.toString("utf8"));
  requireCheck(expectedAssets.some(asset => asset.endsWith(".js")) && expectedAssets.some(asset => asset.endsWith(".css")),
    "Local build does not reference compiled JS and CSS assets.");
  const login = await getResponse(fetcher, origin, "/login");
  requireCheck(login.status === 200, `/login: expected 200, received ${login.status}.`);
  requireCheck(login.headers.get("Content-Type")?.includes("text/html"), "/login: expected HTML.");
  const loginHtml = (await readResponse(login, "/login")).toString("utf8");
  requireCheck(JSON.stringify(assets(loginHtml)) === JSON.stringify(expectedAssets),
    "/login: deployed asset references differ from the local build.");
  for (const asset of expectedAssets) {
    const response = await getResponse(fetcher, origin, asset);
    requireCheck(response.status === 200, `${asset}: expected 200, received ${response.status}.`);
    const contentType = response.headers.get("Content-Type") || "";
    requireCheck(asset.endsWith(".css") ? contentType.includes("text/css") : /(?:java|ecma)script/i.test(contentType),
      `${asset}: unexpected content type.`);
    const remote = await readResponse(response, asset);
    const local = await readFile(path.join(distDir, asset.slice(1)));
    requireCheck(remote.equals(local), `${asset}: deployed bytes differ from the local build.`);
  }
  const fingerprint = createHash("sha256").update(localIndex).digest("hex");
  return `Health/login passed; ${expectedAssets.length} deployed assets match local build, index_sha256=${fingerprint}.`;
}

export async function checkAuth(origin, { fetcher = fetch } = {}) {
  for (const endpoint of ["/api/me", "/api/dashboard", "/api/calendar"]) {
    const response = await getResponse(fetcher, origin, endpoint);
    requireCheck(response.status === 401, `${endpoint}: expected unauthenticated 401, received ${response.status}.`);
    const body = await readJson(response, endpoint);
    requireCheck(body && typeof body.error === "string" && Object.keys(body).every(key => key === "error"),
      `${endpoint}: expected an error-only response without private data.`);
  }
  return "Private APIs return error-only 401 without credentials (authenticated data and OTP delivery not checked).";
}

export async function main(args = process.argv.slice(2)) {
  const options = { mode: undefined, url: undefined, distDir: path.join(guDir, "dist"), commit: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Usage: npm run check:deploy -- [--mode config|health|auth|all] [--url https://host] [--dist DIR] [--commit SHA]");
      console.log("Default: config only; providing --url defaults to all. Health compares online assets with a local build.");
      return;
    }
    const field = { "--mode": "mode", "--url": "url", "--dist": "distDir", "--commit": "commit" }[arg];
    requireCheck(field && args[i + 1] && !args[i + 1].startsWith("--"), "Unknown option or missing value; use --help.");
    options[field] = args[++i];
  }
  const mode = options.mode || (options.url ? "all" : "config");
  requireCheck(["config", "health", "auth", "all"].includes(mode), "Invalid --mode; use config, health, auth or all.");
  requireCheck(!options.commit || /^[0-9a-f]{7,40}$/i.test(options.commit), "--commit must be a Git SHA.");
  const origin = mode === "config" ? undefined : deploymentOrigin(options.url);
  console.log(`GU acceptance: mode=${mode}${origin ? ` url=${origin}` : ""}${options.commit ? ` expected_commit=${options.commit}` : ""}`);
  let failed = false;
  for (const [name, check] of [
    ["config", () => checkConfig()],
    ["health", () => checkHealth(origin, { distDir: path.resolve(options.distDir) })],
    ["auth", () => checkAuth(origin)],
  ]) {
    if (mode !== "all" && mode !== name) continue;
    try { console.log(`[${name}] PASS: ${await check()}`); } catch (error) {
      failed = true;
      console.error(`[${name}] FAIL: ${error.message}`);
    }
  }
  requireCheck(!failed, "Selected acceptance checks failed. Do not proceed with publishing.");
  console.log("Selected checks passed. This does not publish code/data or verify logged-in data, email delivery, DNS bindings or commit provenance.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
