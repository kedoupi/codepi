import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError, EXIT } from "./errors.js";
import { normalizeServer } from "./server.js";

export interface OAuthClientRecord {
  client_id: string;
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: "none";
  issuer?: string;
}

export interface AuthorizationMetadataRecord {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  resource: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  token_type: "Bearer";
  scope: string;
  expires_at: number;
  issuer?: string;
}

export interface CredentialRecord {
  version: 1;
  server: string;
  client?: OAuthClientRecord;
  metadata?: AuthorizationMetadataRecord;
  tokens?: StoredTokens;
}

export interface CredentialStoreOptions {
  configDir?: string;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEPI_CONFIG_DIR) return env.CODEPI_CONFIG_DIR;
  if (process.platform === "win32") {
    return join(env.APPDATA ?? homedir(), "codepi");
  }
  if (env.XDG_CONFIG_HOME?.startsWith("/")) {
    return join(env.XDG_CONFIG_HOME, "codepi");
  }
  return join(homedir(), ".config", "codepi");
}

export function serverDigest(server: string): string {
  return createHash("sha256").update(normalizeServer(server)).digest("hex").slice(0, 32);
}

export class CredentialStore {
  readonly server: string;
  readonly configDir: string;
  readonly serverDir: string;
  readonly filePath: string;
  readonly lockDir: string;
  readonly lockPath: string;

  constructor(server: string, options: CredentialStoreOptions = {}) {
    this.server = normalizeServer(server);
    this.configDir = options.configDir ?? defaultConfigDir();
    this.serverDir = join(this.configDir, "servers");
    this.filePath = join(this.serverDir, `${serverDigest(this.server)}.json`);
    this.lockDir = join(this.configDir, "locks");
    this.lockPath = join(this.lockDir, `${serverDigest(this.server)}.refresh.lock`);
  }

  async ensureDirectories(): Promise<void> {
    await ensurePrivateDirectory(this.configDir);
    await ensurePrivateDirectory(this.serverDir);
    await ensurePrivateDirectory(this.lockDir);
  }

  async read(): Promise<CredentialRecord | null> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new CliError("无法读取本地凭证", EXIT.AUTH, { code: "credentials_unreadable" });
    }
    try {
      const parsed = JSON.parse(text) as Partial<CredentialRecord>;
      if (parsed.version !== 1 || parsed.server !== this.server) throw new Error();
      return parsed as CredentialRecord;
    } catch {
      throw new CliError("本地凭证格式无效，请运行 `codepi login`。", EXIT.AUTH, {
        code: "credentials_invalid",
      });
    }
  }

  async write(record: CredentialRecord): Promise<void> {
    if (record.version !== 1 || record.server !== this.server) {
      throw new CliError("拒绝写入不匹配的 server 凭证", EXIT.AUTH, { code: "credentials_server_mismatch" });
    }
    await this.ensureDirectories();
    await atomicWriteJson(this.filePath, record);
  }

  async clearTokens(): Promise<void> {
    const record = await this.read();
    if (!record) return;
    const { tokens: _tokens, ...rest } = record;
    await this.write(rest);
  }

  async delete(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await fs.chmod(path, 0o700).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const temporary = join(
    directory,
    `.${randomBytes(12).toString("hex")}.${process.pid}.tmp`,
  );
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (process.platform !== "win32") await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, path);
    if (process.platform !== "win32") await fs.chmod(path, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "ENOTSUP", "EBADF", "EISDIR"].includes(code ?? "")) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
