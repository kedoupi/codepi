export type AiFinding = {
  title?: string;
  detail?: string;
  level?: string;
};

export type AiPrescription = {
  workout?: string;
  sleep?: string;
  move?: string;
};

export type AiReport = {
  train?: string;
  trainReason?: string;
  verdict?: string;
  findings?: AiFinding[];
  actions?: string[];
  prescription?: AiPrescription;
  sleep?: string;
  readiness?: string;
  activity?: string;
};

export type AiResponse = {
  ok?: boolean;
  error?: string;
  text?: string;
  report?: AiReport;
  days?: number;
  from?: string;
  to?: string;
  model?: string;
  now?: {
    timeStr?: string;
    hoursToSleep?: number | null;
    label?: string;
  };
};

export function stripMarkdown(text: string): string {
  let t = String(text || "");
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```/g, ""));
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1");
  t = t.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, "· ");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export const AI_THINK_LINES = [
  "正在读睡眠与准备度…",
  "对照这几天的波动…",
  "在写主要发现…",
  "生成今日处方…",
];

export async function fetchAi(rangeDays: number): Promise<AiResponse> {
  const nowIso = new Date().toISOString();
  const url =
    "/api/me/ai?days=" +
    encodeURIComponent(String(rangeDays)) +
    "&now=" +
    encodeURIComponent(nowIso);
  const res = await fetch(url, { cache: "no-store", credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as AiResponse;
  const hasReport = data && data.report && typeof data.report === "object";
  if (!res.ok || !data || !data.ok || (!hasReport && !data.text)) {
    const err = data && data.error ? data.error : "HTTP " + res.status;
    throw new Error(err);
  }
  return data;
}
