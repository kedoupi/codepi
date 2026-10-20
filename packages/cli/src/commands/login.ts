import { CredentialStore } from "../config.js";
import { CliError, EXIT } from "../errors.js";
import {
  authorizationUrl,
  discoverAuthorizationMetadata,
  exchangeAuthorizationCode,
  normalizeScopes,
  openBrowser,
  pkcePair,
  randomState,
  registerClient,
  startLoopbackCallback,
} from "../oauth.js";
import { acquireLock } from "../lock.js";

export interface LoginOptions {
  server: string;
  scopes?: string;
  json: boolean;
}

export interface Io {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function login(options: LoginOptions, io: Io = process): Promise<void> {
  const scopes = normalizeScopes(options.scopes);
  const store = new CredentialStore(options.server);
  const metadata = await discoverAuthorizationMetadata(store.server);
  if (metadata.scopes_supported &&
      scopes.some((scope) => !metadata.scopes_supported?.includes(scope))) {
    const unsupported = scopes.filter((scope) => !metadata.scopes_supported?.includes(scope));
    throw new CliError(`授权服务器不支持 scope：${unsupported.join(", ")}`, EXIT.ARGUMENT, {
      code: "unsupported_scope",
    });
  }

  const existing = await store.read();
  const existingClient = existing?.client?.issuer === metadata.issuer
    ? existing.client
    : undefined;
  const client = existingClient ?? await registerClient(metadata, scopes);
  const recordLock = await acquireLock(store.lockPath);
  try {
    const current = await store.read();
    await store.write({
      ...current,
      version: 1,
      server: store.server,
      client,
      metadata,
    });
  } finally {
    await recordLock.release();
  }

  const state = randomState();
  const pkce = pkcePair();
  const callback = await startLoopbackCallback(state);
  try {
    const url = authorizationUrl(metadata, client.client_id, callback.redirectUri, state, scopes, pkce.challenge);
    const opened = await openBrowser(url);
    if (!opened) io.stderr.write(`请在浏览器打开：\n${url}\n`);
    else if (!options.json) io.stderr.write("浏览器已打开；完成授权后会回到本机回调。\n");
    const code = await callback.waitForCode();
    const tokens = await exchangeAuthorizationCode(
      metadata,
      client.client_id,
      code,
      pkce.verifier,
      callback.redirectUri,
    );
    const lock = await acquireLock(store.lockPath);
    try {
      const current = await store.read();
      await store.write({
        version: 1,
        server: store.server,
        client: current?.client ?? client,
        metadata,
        tokens,
      });
    } finally {
      await lock.release();
    }
    if (options.json) {
      io.stdout.write(`${JSON.stringify({
        server: store.server,
        scope: tokens.scope,
        expires_at: new Date(tokens.expires_at).toISOString(),
      }, null, 2)}\n`);
    } else {
      io.stdout.write(`已登录 ${store.server}\nscope: ${tokens.scope}\n`);
    }
  } finally {
    await callback.close();
  }
}
