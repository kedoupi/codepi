export const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

/** The product's current calendar day; never use this to rewrite an Oura day. */
export function calendarDay(now = new Date()): string {
  const parts = dayFormatter.formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

export function calendarWindow(count: number, end = calendarDay()) {
  return { from: shiftDay(end, 1 - count), to: end };
}
