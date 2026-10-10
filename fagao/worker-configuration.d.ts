// Bindings match wrangler.toml / wrangler.test.toml.
// Secrets (RESEND_API_KEY, SESSION_SECRET, OTP_PEPPER) are wrangler secrets, never committed.
interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ALLOWLIST: string;
  OTP_FROM: string;
  ACCOUNT_BRAND: string;
  ENVIRONMENT: string;
  RESEND_API_KEY?: string;
  SESSION_SECRET: string;
  OTP_PEPPER: string;
}
