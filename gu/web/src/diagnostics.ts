/**
 * 行情拉取的错误归一化为底部显示文案。
 *
 * Python urllib 抛出的连接超时、DNS 失败、TLS 握手失败在 raw 上都很像——
 * 全是 `query2.finance.yahoo.com: <urlopen error _ssl.c:1112: The handshake
 * operation timed out>`。直接显示既吓走运维，也吓走用户；
 * 完全静默又让人误以为行情正常。下面把几类已知错误映射到中文短句，
 * 未识别则剥掉 Python 内部栈前缀，只留外部可读的句尾。
 */
const KNOWN_PATTERNS: Array<{ test: RegExp; message: string }> = [
  {
    test: /handshake operation timed out/i,
    message: "TLS 握手超时（可能是 Yahoo 临时屏蔽或网络环境拦截）",
  },
  {
    test: /Connection reset by peer/i,
    message: "Yahoo 主动断开连接，可稍后重试",
  },
  {
    test: /Temporary failure in name resolution/i,
    message: "DNS 解析失败，检查网络连通性",
  },
  { test: /Connection refused/i, message: "Yahoo 拒绝连接" },
  {
    test: /nodename nor servname provided/i,
    message: "无法解析行情域名（请确认主机能否访问 Yahoo Finance）",
  },
  {
    test: /No data found/i,
    message: "Yahoo 没有返回数据（停牌、退市或代码错误）",
  },
  { test: /delisted/i, message: "代码已退市，请核对 ticker" },
  { test: /HTTP Error 429/i, message: "请求频率超限，被 Yahoo 限流" },
  { test: /HTTP Error 404/i, message: "Yahoo 没有该代号的行情记录" },
  { test: /HTTP Error 5\d\d/i, message: "Yahoo 服务端错误" },
  {
    test: /timed out|connect timeout|read timeout/i,
    message: "行情请求超时（可能 Yahoo 临时屏蔽）",
  },
];

/** 把已知 Python 异常类替换成可读短语，未识别时剥掉栈前缀只留尾巴。 */
export function humanizeQuoteError(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  for (const { test, message } of KNOWN_PATTERNS) {
    if (test.test(raw)) return message;
  }
  // 剥掉 `query2.finance.yahoo.com: <urlopen error ...>` 这类前缀，避免给
  // 非工程用户看 Python 内部模块路径。
  const tail = raw
    .replace(/^[^:<>\[\]]+:\s*/, "")
    .replace(/^<urlopen error /, "")
    .replace(/>$/, "");
  return tail.length < raw.length && tail.length > 0 ? tail : raw;
}

/**
 * 根据提示文本推断 .notice 的四级色调。
 *
 * info    —— 中性说明，例如「刷新只读取已同步数据」
 * success —— 已完成或状态正常，例如「已检查，当前已是最新同步批次」
 * warning —— 提醒但未触发硬刹车，例如「价格时刻未确认」
 * danger  —— 触发规则、硬刹车或加载失败，例如「NVDA 7.0% 已触发停买」
 *
 * 用句首匹配而不是全文搜索，避免「刷新只读取已同步数据」被「已同步」误判成 success。
 */
export function noticeTone(
  text: string,
): "info" | "success" | "warning" | "danger" {
  const t = text.trim();
  if (/(触发|硬刹车|越线|刷新失败|加载失败|读取失败|同步失败|上传失败)/.test(t))
    return "danger";
  if (
    /(失败|错误|超时|限流|无法|停牌|退市|未确认|待核对|尚未补齐|未补齐|待核实|未评估|未记录|阶段未确认)/.test(
      t,
    )
  )
    return "warning";
  if (/^(已检查|已载入|已同步|已确认|未触发|已更新)/.test(t)) return "success";
  return "info";
}
