import type { SsoEnv } from "@kedoupi/shared/auth/client";

export interface Env extends SsoEnv {
  MATERIALS?: R2Bucket;
  DESK_SUMMARY_TOKEN?: string;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  SESSION_SECRET?: string;
  OTP_PEPPER?: string;
  UPLOAD_TOKEN?: string;
  RESEND_API_KEY?: string;
  OTP_FROM?: string;
  INVESTMENT_CALENDAR_ID?: string;
}

export type { Row, Dashboard } from "./dashboard-types";
export type { CalendarView, CalendarUpload, CalendarEvent, CalendarState } from "./calendar";
