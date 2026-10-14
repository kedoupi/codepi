export const SLOTS = ["早", "中", "晚"] as const;
export type Slot = (typeof SLOTS)[number];

export const STATUSES = ["draft", "待审", "需改", "可推箱", "已进箱"] as const;
export type Status = (typeof STATUSES)[number];

export const REVIEW_ACTIONS = ["过", "要改", "拒"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const ROLES = ["owner", "editor", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const SESSION_COOKIE = "fagao_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OTP_TTL_MS = 8 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export interface Account {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  active: number;
}

export interface SessionRow {
  id: string;
  account_id: string;
  expires_at: string;
}

export interface PostRow {
  id: string;
  account_id: string;
  title: string;
  slot: Slot | null;
  publish_date: string;
  status: Status;
  preview_path: string | null;
  note: string | null;
  digest: string | null;
  is_demo: number;
  cover?: string | null;
  has_html?: number;
  created_at: string;
  updated_at: string;
}

export interface ReviewRow {
  id: string;
  post_id: string;
  actor_account_id: string;
  action: ReviewAction;
  from_status: Status;
  to_status: Status;
  note: string | null;
  created_at: string;
}

export interface AuthedAccount extends Account {}
