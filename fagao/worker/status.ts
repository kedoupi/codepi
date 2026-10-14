import type { ReviewAction, Role, Status } from "./types";

export function reviewNextStatus(action: ReviewAction): Status {
  if (action === "过") return "可推箱";
  // 要改 / 拒 都进「需改」，避免第三态 draft 与需改双轨
  if (action === "要改" || action === "拒") return "需改";
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
  return status !== "已进箱" && status !== "弃用";
}

/** 已进箱是终点，弃用不重复弃用；其余状态都可弃用（释放档位）。 */
export function canDiscard(status: Status): boolean {
  return status !== "已进箱" && status !== "弃用";
}

export function canReviewRole(role: Role): boolean {
  return role === "owner" || role === "reviewer";
}

export function canEditRole(role: Role): boolean {
  return role === "owner" || role === "editor";
}
