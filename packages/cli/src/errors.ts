export const EXIT = {
  OK: 0,
  ARGUMENT: 1,
  AUTH: 2,
  SCOPE: 3,
  REMOTE: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly code: string;
  readonly scope?: string;

  constructor(
    message: string,
    exitCode: ExitCode = EXIT.REMOTE,
    options: { code?: string; scope?: string } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = options.code ?? "cli_error";
    if (options.scope !== undefined) this.scope = options.scope;
  }
}

export function argumentError(message: string): CliError {
  return new CliError(message, EXIT.ARGUMENT, { code: "invalid_arguments" });
}

export function authError(message = "未登录或凭证已失效，请运行 `codepi login`。"): CliError {
  return new CliError(message, EXIT.AUTH, { code: "authentication_required" });
}

export function scopeError(message: string, scope?: string): CliError {
  return new CliError(message, EXIT.SCOPE, {
    code: "insufficient_scope",
    ...(scope === undefined ? {} : { scope }),
  });
}

export function redact(value: string): string {
  return value
    .replace(/(access_token|refresh_token|client_secret)\s*[:=]\s*["']?[^\s"',}]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return redact(error.message);
  return redact(String(error));
}
