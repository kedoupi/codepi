export interface Env {
  DB: D1Database;
  OURA_CLIENT_ID?: string;
  OURA_CLIENT_SECRET?: string;
  OURA_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SESSION_SECRET?: string;
  ALLOW_DEV_LOGIN?: string;
  FRONTEND_ORIGIN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_PAYMENT_METHOD_TYPES?: string;
  STRIPE_ENABLE_ALIPAY?: string;
  STRIPE_ENABLE_WECHAT_PAY?: string;
}
