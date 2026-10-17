import { applyChartStyles } from "./dom";

/**
 * Svelte action：{@html} 注入的图表几何走 data-* 属性，CSP（style-src 'self'）
 * 不允许内联 style，所以在内容插入后统一经 CSSOM 应用。use:chartStyles
 * 放在 {@html} 所在节点上，内容每次更新都会重新执行。
 */
export function chartStyles(node: HTMLElement) {
  applyChartStyles(node);
  return {
    update() {
      applyChartStyles(node);
    },
  };
}
