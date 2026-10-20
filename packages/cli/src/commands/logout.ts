import { CredentialStore, type AuthorizationMetadataRecord } from "../config.js";
import { acquireLock } from "../lock.js";
import { revokeAuthorization } from "../oauth.js";
import type { Io } from "./login.js";

export interface LogoutOptions {
  server: string;
  json: boolean;
}

export async function logout(options: LogoutOptions, io: Io = process): Promise<void> {
  const store = new CredentialStore(options.server);
  let revocation: {
    metadata: AuthorizationMetadataRecord;
    clientId: string;
    token: string;
  } | undefined;
  const lock = await acquireLock(store.lockPath);
  try {
    const record = await store.read();
    if (record?.tokens && record.metadata && record.client) {
      revocation = {
        metadata: record.metadata,
        clientId: record.client.client_id,
        token: record.tokens.refresh_token ?? record.tokens.access_token,
      };
    }
    await store.clearTokens();
  } finally {
    await lock.release();
  }

  let warning: string | null = null;
  if (revocation) {
    try {
      await revokeAuthorization(
        revocation.metadata,
        revocation.clientId,
        revocation.token,
        store.server,
      );
    } catch {
      warning = "远端撤销请求失败；本地凭证仍已删除。";
    }
  }
  if (warning) io.stderr.write(`${warning}\n`);
  if (options.json) io.stdout.write(`${JSON.stringify({ logged_out: true, server: store.server })}\n`);
  else io.stdout.write(`已退出 ${store.server}\n`);
}
