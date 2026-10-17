/** 简单的 CSS.escape polyfill；workerd 测试环境不一定有。 */
import { session } from "./state.svelte";

export const cssEscape = (value: string) =>
  window.CSS && typeof window.CSS.escape === "function"
    ? window.CSS.escape(value)
    : value.replace(
        /([\\\"\'\:\;\,\.\#\@\$\(\)\[\]\{\}\*\+\=\<\>\!\?])/g,
        "\\$1",
      );

/** 高亮停留时长：够读完一行数字，又不至于一直挂在页面上。 */
const HIGHLIGHT_HOLD_MS = 6000;
/** 淡出时长，必须与 CSS 里的 transition 时长一致。 */
const HIGHLIGHT_FADE_MS = 600;

let highlightFadeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 跳到持仓页后高亮指定 ticker。
 *
 * 桌面表格行（tr.position-row）和 <=900px 才显示的 position-card 都带
 * [data-position]，两侧同时打标；只滚到当前真正可见的那一个，因为
 * scrollIntoView 对 display:none 的节点是空操作。
 *
 * 高亮停留 HIGHLIGHT_HOLD_MS 后淡出，而不是直接移除 class：直接移除会让
 * 背景和左侧色条在同一帧消失，视觉上像闪烁。淡出期间保留 is-active 并
 * 叠加 is-fading，由 CSS 过渡透明度，最后再摘掉两个 class。
 */
export function focusPositionRow(ticker: string) {
  const selector = `[data-position="${cssEscape(ticker)}"]`;
  const targets = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (!targets.length) return;
  clearHighlight();
  targets.forEach((el) => el.classList.add("is-active"));
  // getClientRects().length 为 0 表示被 display:none 挡掉（另一个视图）。
  const visible =
    targets.find((el) => el.getClientRects().length > 0) ?? targets[0];
  visible.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightFadeTimer = setTimeout(() => {
    const fading = Array.from(
      document.querySelectorAll<HTMLElement>(".is-active"),
    );
    if (!fading.length) return;
    fading.forEach((el) => el.classList.add("is-fading"));
    highlightFadeTimer = setTimeout(() => {
      fading.forEach((el) => el.classList.remove("is-active", "is-fading"));
    }, HIGHLIGHT_FADE_MS);
  }, HIGHLIGHT_HOLD_MS);
}

/** 立刻清掉高亮与待执行的淡出计时器（点击其它标的、或 DOM 即将重建时）。 */
export function clearHighlight() {
  clearTimeout(highlightFadeTimer);
  highlightFadeTimer = undefined;
  document
    .querySelectorAll<HTMLElement>(".is-active, .is-fading")
    .forEach((el) => el.classList.remove("is-active", "is-fading"));
}

/**
 * 消费一次性的持仓聚焦请求。必须在 Positions 页渲染完成后调用（组件内
 * afterUpdate），早于这一刻会落在旧节点上。
 */
export function consumePendingPositionFocus() {
  const ticker = session.pendingPositionFocus;
  if (!ticker) return;
  session.pendingPositionFocus = null;
  focusPositionRow(ticker);
}
