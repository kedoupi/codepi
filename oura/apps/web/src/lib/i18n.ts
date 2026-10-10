export type Locale = "zh" | "en";
export type LocalePref = "system" | "zh" | "en";

export const LOCALE_STORAGE_KEY = "oura_kdp_locale_pref";

const dict = {
  zh: {
    loading: "正在加载…",
    apiUnreachable: "无法连接 API，请稍后重试。",
    landingTitle: "Oura 健康看板",
    landingLead: "睡眠 · 准备度 · 活动，一目了然。",
    loginOura: "用 Oura 登录",
    skipToContent: "跳到内容",
    landingKickerAfter: "登录之后",
    landingGet: "三块，就这些。",
    featSleep: "睡眠",
    featSleepText: "周 / 30 / 90 天分数与趋势。",
    featReady: "准备度",
    featReadyText: "早晨状态，一眼看见起伏。",
    featAct: "活动",
    featActText: "步数、热量、档位分布。",
    landingKickerMulti: "多人可用",
    landingHow: "每人登录，看自己的。",
    chipAuth: "Oura 授权",
    chipAuthText: "用自己的账号，看自己的看板。需要有效 Oura 会员才能同步官方日数据。",
    chipToken: "令牌在服务端",
    chipTokenText: "加密存放，浏览器拿不到。",
    chipYours: "数据只属于你",
    chipYoursText: "不出售，也不做公开皮肤。",
    landingDisclaimer: "本工具用于观察自己的 Oura 日数据，属于教育与自我记录，不是医疗建议。",
    company: "小桃子智能科技有限公司",
    devLogin: "DEV 演示登录",
    langZh: "中文",
    langEn: "English",
    followSystem: "跟随系统",
    navHealth: "健康",
    navInsights: "本周解读",
    navCompare: "对比",
    navSettings: "设置",
    logout: "退出",
    aiAnalyze: "AI 分析",
    dashTitle: "健康看板",
    dashSubFallback: "睡眠 · 准备度 · 活动 · 近一周",
    rangeAria: "时间范围",
    rangeWeek: "周",
    loadingOura: "正在加载 Oura 数据…",
    insightEntryTitle: "本周解读",
    insightEntryLead: "对照官方分数的中文二次解读",
    insightEntryMeta: "非医疗建议 · 未订阅可看前三行",
    weeklyTitle: "本周解读",
    weeklyKicker: "二次解读 · 不改官方分数",
    weeklyPhaseNote: "",
    weeklyTipsTitle: "可执行建议",
    weeklyEmpty: "数据不足，暂无解读。",
    compareTitle: "对比",
    compareKicker: "关键指标两列对照",
    compareWeek: "本周 vs 上周",
    compareRange: "近 7 天 vs 近 30 天",
    compareLocked: "完整对比需要订阅。",
    metricLabel: "指标",
    metricSleep: "睡眠",
    metricReady: "准备度",
    metricAct: "活动",
    metricSteps: "步数",
    settingsTitle: "设置",
    settingsLang: "界面语言",
    settingsLangHint: "默认跟随系统：中文环境用中文，其他用英文。可在此覆盖并记住。",
    settingsBilling: "订阅",
    settingsPrice: "¥39/月",
    settingsPriceHint: "B 档占位价。用 Stripe Checkout 开通，Customer Portal 取消。",
    settingsStatus: "当前状态",
    settingsSubscribe: "开通订阅",
    settingsManage: "管理 / 取消订阅",
    settingsUnpaid: "未订阅",
    settingsPaid: "已订阅",
    paywallTitle: "订阅后查看全文",
    paywallBody: "未订阅可看本周解读前三行。完整建议与对比页需要订阅。",
    notMedical: "非医疗建议",
    notMedicalEn: "Not medical advice",
    checkoutSuccess: "已完成结账，正在刷新订阅状态。",
    checkoutCancel: "已取消结账。",
    stripeMissing: "预览环境尚未配置 Stripe 密钥，可用下方 DEV 开关点验付费墙。",
    devGrantOn: "DEV：模拟已订阅",
    devGrantOff: "DEV：恢复未订阅",
    backDash: "返回看板",
    daysUnit: "天",
    bodyZhOnly: "Phase 1 解读正文仅为中文模板。",
    membershipNote: "需要有效的 Oura 会员才能从官方接口同步日数据。本层不替代官方分数。",
    footData: "数据来自 Oura API · 小桃子智能科技有限公司 · 仅个人看板",
  },
  en: {
    loading: "Loading…",
    apiUnreachable: "Could not reach the API. Please try again later.",
    landingTitle: "Oura health board",
    landingLead: "Sleep, readiness, and activity at a glance.",
    loginOura: "Sign in with Oura",
    skipToContent: "Skip to content",
    landingKickerAfter: "After sign-in",
    landingGet: "Three blocks. That is it.",
    featSleep: "Sleep",
    featSleepText: "Weekly / 30 / 90-day scores and trends.",
    featReady: "Readiness",
    featReadyText: "Morning status, easy to scan.",
    featAct: "Activity",
    featActText: "Steps, calories, and buckets.",
    landingKickerMulti: "Multi-user",
    landingHow: "Each person signs in and sees their own board.",
    chipAuth: "Oura OAuth",
    chipAuthText: "Your account, your board. An active Oura membership is required to sync official daily data.",
    chipToken: "Tokens stay on the server",
    chipTokenText: "Encrypted at rest. The browser never holds them.",
    chipYours: "Your data stays yours",
    chipYoursText: "Not sold. No public skins.",
    landingDisclaimer:
      "This tool is for observing your own Oura daily data. Education and self-tracking only — not medical advice.",
    company: "Xiaotaozi Intelligent Technology Co., Ltd.",
    devLogin: "DEV demo login",
    langZh: "中文",
    langEn: "English",
    followSystem: "System default",
    navHealth: "Health",
    navInsights: "Weekly insights",
    navCompare: "Compare",
    navSettings: "Settings",
    logout: "Log out",
    aiAnalyze: "AI analysis",
    dashTitle: "Health board",
    dashSubFallback: "Sleep · Readiness · Activity · This week",
    rangeAria: "Date range",
    rangeWeek: "Week",
    loadingOura: "Loading Oura data…",
    insightEntryTitle: "Weekly insights",
    insightEntryLead: "A Chinese secondary reading of official scores",
    insightEntryMeta: "Not medical advice · First three lines are free",
    weeklyTitle: "Weekly insights",
    weeklyKicker: "Secondary reading · official scores unchanged",
    weeklyPhaseNote: "Phase 1 insight body is Chinese-only.",
    weeklyTipsTitle: "Actionable tips",
    weeklyEmpty: "Not enough data for a reading yet.",
    compareTitle: "Compare",
    compareKicker: "Key metrics in two columns",
    compareWeek: "This week vs last week",
    compareRange: "Last 7 days vs last 30 days",
    compareLocked: "The full compare view requires a subscription.",
    metricLabel: "Metric",
    metricSleep: "Sleep",
    metricReady: "Readiness",
    metricAct: "Activity",
    metricSteps: "Steps",
    settingsTitle: "Settings",
    settingsLang: "Language",
    settingsLangHint: "Defaults to the system: zh* → Chinese, otherwise English. Override is remembered.",
    settingsBilling: "Subscription",
    settingsPrice: "¥39/month",
    settingsPriceHint: "Placeholder B-tier price. Stripe Checkout to subscribe, Customer Portal to cancel.",
    settingsStatus: "Status",
    settingsSubscribe: "Subscribe",
    settingsManage: "Manage / cancel",
    settingsUnpaid: "Not subscribed",
    settingsPaid: "Subscribed",
    paywallTitle: "Subscribe for the full reading",
    paywallBody: "The first three lines of the weekly summary are free. Full tips and compare require a subscription.",
    notMedical: "非医疗建议",
    notMedicalEn: "Not medical advice",
    checkoutSuccess: "Checkout finished. Refreshing subscription status.",
    checkoutCancel: "Checkout canceled.",
    stripeMissing: "Stripe secrets are not configured on this preview. Use the DEV toggle to click-test the paywall.",
    devGrantOn: "DEV: simulate subscribed",
    devGrantOff: "DEV: back to unpaid",
    backDash: "Back to board",
    daysUnit: "days",
    bodyZhOnly: "Phase 1 insight body is Chinese-only.",
    membershipNote:
      "An active Oura membership is required to sync official daily data. This layer does not replace official scores.",
    footData: "Data from the Oura API · Xiaotaozi Intelligent Technology Co., Ltd. · Personal board only",
  },
} as const;

export type MessageKey = keyof typeof dict.zh;

export function detectSystemLocale(
  language = typeof navigator !== "undefined" ? navigator.language : "en",
): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function normalizeLocalePref(value: unknown): LocalePref | null {
  if (value === "system" || value === "zh" || value === "en") return value;
  return null;
}

export function readStoredLocalePref(): LocalePref | null {
  try {
    return normalizeLocalePref(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLocalePref(pref: LocalePref): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    // ignore quota / private mode
  }
}

export function resolveLocale(pref: LocalePref | null | undefined): Locale {
  if (pref === "zh" || pref === "en") return pref;
  return detectSystemLocale();
}

export function t(locale: Locale, key: MessageKey): string {
  return dict[locale][key];
}
