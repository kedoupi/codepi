import type { BoardDailyPayload } from "../lib/daily.ts";
import {
  READINESS_CONTRIBUTOR_KEYS,
  SLEEP_CONTRIBUTOR_KEYS,
  type ReadinessContributors,
  type SleepContributors,
} from "../lib/pickers.ts";
import { shiftDay } from "../../../../shared/dates.ts";

// Entirely generated fixture. No person, provider export or live endpoint is used.
const days: BoardDailyPayload["days"] = Array.from({ length: 30 }, (_, i) => ({
  date: shiftDay("2000-01-01", i),
  sleep: {
    score: 70 + i % 20,
    contributors: Object.fromEntries(SLEEP_CONTRIBUTOR_KEYS.map((key, j) => [key, 60 + (i + j) % 35])) as SleepContributors,
  },
  readiness: {
    score: 65 + i % 25,
    temperature_deviation: (i % 5 - 2) / 10,
    temperature_trend_deviation: (i % 3 - 1) / 10,
    contributors: Object.fromEntries(READINESS_CONTRIBUTOR_KEYS.map((key, j) => [key, 65 + (i + j) % 30])) as ReadinessContributors,
  },
  // Deliberate gaps exercise missing-data handling without personal records.
  activity: i === 21 || i === 22 ? null : {
    score: 60 + i % 30,
    steps: 4000 + i * 100,
    active_calories: 200 + i * 10,
  },
}));

export const SYNTHETIC_BOARD_SAMPLE: BoardDailyPayload = {
  ok: true,
  user_id: "synthetic-user",
  from: days[0]!.date,
  to: days.at(-1)!.date,
  count: days.length,
  days,
};
