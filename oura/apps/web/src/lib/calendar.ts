import { calendarDay } from "../../../../shared/dates.ts";

/** Recheck after background suspension as well as while the page stays open. */
export function watchCalendarDay(onChange: (day: string) => void) {
  let previous = calendarDay();
  const check = () => {
    const current = calendarDay();
    if (current === previous) return;
    previous = current;
    onChange(current);
  };
  const timer = window.setInterval(check, 30_000);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
  };
}
