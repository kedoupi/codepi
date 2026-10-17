import { applyChartStyles } from "./dom";

/**
 * Svelte action：{@html} 注入的图表几何走 data-* 属性，CSP（style-src 'self'）
 * 不允许内联 style，所以在内容插入后统一经 CSSOM 应用。
 *
 * Svelte 只会在 action 参数变化时调用 update()，而 {@html} 的内容替换不会
 * 触发；因此这里用 MutationObserver 盯住子树，刷新批次替换图表节点后
 * 重新执行 applyChartStyles()，而不是依赖 update 生命周期。
 */
export function chartStyles(node: HTMLElement) {
  applyChartStyles(node);
  const observer = new MutationObserver(() => applyChartStyles(node));
  observer.observe(node, { childList: true, subtree: true });
  return {
    destroy() {
      observer.disconnect();
    },
  };
}
