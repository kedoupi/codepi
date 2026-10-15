// change_pct from the Python quote provider is already in percentage points.
export function marketChange(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—";
}
