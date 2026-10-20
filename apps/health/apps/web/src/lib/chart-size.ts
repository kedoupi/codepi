/** Defer size-driven chart layout until after ResizeObserver delivery. */
export function chartWidth(node: HTMLElement, onWidth: (width: number) => void) {
  let measured = node.clientWidth;
  let frame = 0;
  if (measured > 0) onWidth(measured);
  const observer = new ResizeObserver(() => {
    const next = node.clientWidth;
    if (next <= 0 || next === measured) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      measured = next;
      onWidth(next);
    });
  });
  observer.observe(node);
  return { destroy() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
