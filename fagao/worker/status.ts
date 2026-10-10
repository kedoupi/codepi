import type { ReviewAction, Role, Status } from "./types";

export function reviewNextStatus(action: ReviewAction): Status {
  if (action === "过") return "可推箱";
  if (action === "要改") return "需改";
  return "draft";
}

export function canReview(status: Status): boolean {
  return status === "待审";
}

export function canSubmit(status: Status): boolean {
  return status === "draft" || status === "需改";
}

export function canMarkBoxed(status: Status): boolean {
  return status === "可推箱";
}

export function canWithdraw(status: Status): boolean {
  return status === "需改" || status === "可推箱" || status === "已进箱";
}

export function canEditCopy(status: Status): boolean {
  return status !== "已进箱";
}

export function canReviewRole(role: Role): boolean {
  return role === "owner" || role === "reviewer";
}

export function canEditRole(role: Role): boolean {
  return role === "owner" || role === "editor";
}
