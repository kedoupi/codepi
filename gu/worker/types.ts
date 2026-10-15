import type { SsoEnv } from "../../shared/auth/client";

export interface Env extends SsoEnv {
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  SESSION_SECRET?: string;
  OTP_PEPPER?: string;
  UPLOAD_TOKEN?: string;
  RESEND_API_KEY?: string;
  OTP_FROM?: string;
}

export type { Row, Dashboard } from "./dashboard-types";
