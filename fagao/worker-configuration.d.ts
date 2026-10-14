// Bindings match wrangler.toml / wrangler.test.toml.
// Secrets (RESEND_API_KEY, SESSION_SECRET, OTP_PEPPER) are wrangler secrets, never committed.
interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ALLOWLIST: string;
  /** 逗号分隔：这些邮箱登录即 editor（可交稿/标进箱），也自动允许登录 */
  EDITORS?: string;
  OTP_FROM: string;
  ACCOUNT_BRAND: string;
  ENVIRONMENT: string;
  RESEND_API_KEY?: string;
  SESSION_SECRET: string;
  OTP_PEPPER: string;
  /** 交稿脚本 Bearer token（wrangler pages secret）；未配置则 token 交稿关闭 */
  SUBMIT_TOKEN?: string;
}
