function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const READ_HINT = "请先通读全文";
export const READ_DONE_LABEL = "已读完，解锁审核";
export const READ_GATE_SLACK_PX = 64;

export function isReadComplete(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  slackPx = READ_GATE_SLACK_PX,
): boolean {
  const { scrollTop, clientHeight, scrollHeight } = metrics;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) {
    return false;
  }
  if (scrollHeight <= clientHeight + slackPx) return true;
  return scrollTop + clientHeight >= scrollHeight - slackPx;
}

export function reviewDockLockClass(options: { locked: boolean; allowManualUnlock: boolean }): string {
  const bits = ["dock", "dock-review"];
  if (options.locked) bits.push("is-locked");
  if (options.locked && options.allowManualUnlock) bits.push("has-manual-unlock");
  return bits.join(" ");
}

/** Pending 过/要改/拒 markup. Locked until read-complete. */
export function pendingReviewActionsHtml(slug: string, locked = true): string {
  const disabled = locked ? " disabled" : "";
  const safeSlug = escapeHtml(slug);
  return `
        <p class="read-hint" data-read-hint role="status">${READ_HINT}</p>
        <button class="secondary read-done-btn" type="button" data-read-done>${READ_DONE_LABEL}</button>
        <div class="dock-actions" data-review-actions>
          <button class="btn-pass" type="button" data-review="过" data-slug="${safeSlug}"${disabled}>过</button>
          <button class="btn-change" type="button" data-review="要改" data-slug="${safeSlug}"${disabled}>要改</button>
          <button class="btn-reject" type="button" data-review="拒" data-slug="${safeSlug}"${disabled}>拒</button>
        </div>
        <details class="dock-note" data-review-note>
          <summary>写意见（可选）</summary>
          <label class="sr-only" for="review_note">审核意见</label>
          <textarea id="review_note" name="review_note" placeholder="要改时建议写清；拒也可以写原因"></textarea>
        </details>
  `;
}

export function reviewActionsAreLocked(html: string): boolean {
  return (
    html.includes(READ_HINT) &&
    html.includes('data-review="过"') &&
    html.includes(" disabled") &&
    html.includes(READ_DONE_LABEL)
  );
}
