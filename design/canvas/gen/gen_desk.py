"""我的工作台（线上 /desk/）设计稿画板。产品逻辑与线上一致，只重做 UI；全部为示例数据。"""
import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
import gen
_real_add = gen.add
gen.add = lambda *a, **k: None          # 导入 gen_www 时不重写官网其他画板
from gen_www import page as _page, SITE_CSS, PHONE
gen.add = _real_add
from gen import add
from gen2 import IC

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HD", "").split(",") if x)}


def _svg(d, cls="cp-icon"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{d}</svg>'


I = {
    "heart": _svg('<path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 7.5 6.5Z"/>'),
    "chart": _svg('<path d="M4 19h16M7 15l4-4 3 3 5-6"/>'),
    "pen": _svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    "doc": _svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
    "eye": _svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', "cp-icon cp-icon-16"),
    "refresh": _svg('<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>', "cp-icon cp-icon-16"),
    "shield": _svg('<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/>', "cp-icon cp-icon-16"),
    "lock": _svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', "cp-icon cp-icon-16"),
    "undo": _svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', "cp-icon cp-icon-16"),
    "key": _svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
    "clock": _svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', "cp-icon cp-icon-16"),
    "arrow": '<span aria-hidden="true">↗</span>',
}
CHECK16 = IC["check"].replace('class="cp-icon"', 'class="cp-icon cp-icon-16"')
INFO16 = IC["info"].replace('class="cp-icon"', 'class="cp-icon cp-icon-16"')


def page(inner):
    """官网外壳；顶栏「我的工作台」为当前项。当前项用次按钮 + aria-current，主按钮留给页面主操作。"""
    html = _page("我的工作台", inner)
    return html.replace('<a class="cp-btn cp-btn-primary cp-btn-sm" href="#">我的工作台</a>',
                        '<a class="cp-btn cp-btn-secondary cp-btn-sm dk-navon" href="#" aria-current="page">我的工作台</a>')


CSS = SITE_CSS + """
.site .dk-navon{background:var(--brand-soft);border-color:var(--color-action)}
.site .dk{padding:48px 0 0}
.site .dk-hd{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.site .dk-hd h1{font-size:40px;line-height:1.15;letter-spacing:-.025em}
.site .dk-eyebrow{margin:0 0 8px;font-size:12px;font-weight:500;letter-spacing:.06em;color:var(--color-text-muted)}
.site .dk-date{margin:12px 0 0;font-size:15px;color:var(--color-text-muted);display:flex;align-items:center;gap:8px}
.site .dk-acts{display:flex;align-items:center;gap:8px}
.site .dk-status{margin:24px 0 0;font-size:13px;color:var(--color-text-muted);display:flex;align-items:center;gap:8px}
.site .dk-apps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:24px}
.site .dk-app{display:flex;flex-direction:column;gap:16px}
.site .dk-app-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.site .dk-app-id{display:flex;gap:12px;align-items:center}
.site .dk-ico{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:var(--color-surface-2);color:var(--color-text);flex:none}
.site .dk-app h2,.site .dk-sec h2{font-size:20px;line-height:1.3;letter-spacing:-.01em}
.site .dk-app h2 small{font-size:13px;font-weight:400;color:var(--color-text-muted);margin-left:8px;letter-spacing:0}
.site .dk-app .dk-eyebrow{margin:0 0 4px}
.site .dk-badge{display:inline-flex;align-items:center;gap:8px;height:24px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--color-surface-2);color:var(--color-text)}
.site .dk-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.site .dk-badge.ok{background:var(--tint-ok);color:var(--on-tint-ok)}
.site .dk-badge.warn{background:var(--tint-warn);color:var(--on-tint-warn)}
.site .dk-badge.off{background:var(--tint-danger);color:var(--color-danger)}
.site .dk-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;padding:16px 0;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border)}
.site .dk-metrics dt{font-size:12px;color:var(--color-text-muted);margin:0 0 4px}
.site .dk-metrics dd{margin:0;font-size:24px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.25}
.site .dk-metrics dd small{font-size:13px;font-weight:400;color:var(--color-text-muted);margin-left:4px;letter-spacing:0}
.site .dk-metrics dd.na{font-size:15px;font-weight:500;color:var(--color-text-muted);letter-spacing:0}
.site .dk-note{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-muted)}
.site .dk-app > .dk-note{flex:1}
.site .cp-field .cp-help{margin:0}
.site .dk-app-ft{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px;border-top:1px solid var(--color-border)}
.site a.dk-go{display:inline-flex;align-items:center;gap:4px;min-height:36px;font-size:14px;font-weight:600;color:var(--color-action-hover);text-decoration:none;white-space:nowrap}
.site .dk-hide{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-radius:10px;background:var(--color-surface-2);font-size:13px;color:var(--color-text)}
.site .dk-cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:24px;margin-top:24px;align-items:start}
.site .dk-sec-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.site .dk-lead{margin:8px 0 0;font-size:14px;color:var(--color-text-muted);line-height:1.6}
.site .dk-form{display:grid;gap:24px;margin-top:24px}
.site .dk-fs{border:0;margin:0;padding:0;min-width:0}
.site .dk-fs legend{font-size:14px;font-weight:600;padding:0;margin:0 0 8px}
.site .dk-opts{display:flex;flex-wrap:wrap;gap:8px}
.site .dk-opt{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:1px solid var(--color-border-strong);border-radius:10px;background:var(--color-surface);font-size:14px;cursor:pointer;box-sizing:border-box}
.site .dk-opt input{accent-color:var(--color-action);width:16px;height:16px;margin:0;padding:0}
.site .dk-opt.on{border-color:var(--color-action);background:var(--brand-soft);font-weight:500}
.site .dk-fs .cp-help{margin:8px 0 0}
.site .dk-genrow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.site .dk-genrow .cp-help{margin:0}
.site .dk-out{margin-top:24px}
.site .dk-out .cp-empty{padding:32px 24px}
.site .dk-out .cp-empty p{margin:0}
.site .dk-empty-ico{width:48px;height:48px;border-radius:999px;display:grid;place-items:center;background:var(--color-surface-2);color:var(--color-text-muted)}
.site .dk-todo{list-style:none;margin:16px 0 0;padding:0;display:grid}
.site .dk-todo li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;padding:16px 0;border-top:1px solid var(--color-border)}
.site .dk-todo li:first-child{border-top:0;padding-top:4px}
.site .dk-todo .ic{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--tint-warn);color:var(--on-tint-warn)}
.site .dk-todo .t{font-size:15px;font-weight:500;line-height:1.5;margin:0}
.site .dk-todo .d{font-size:13px;line-height:1.5;color:var(--color-text-muted);margin:4px 0 0}
.site .dk-todo .m{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;flex-wrap:wrap}
.site .dk-fnote{margin:16px 0 0;padding-top:16px;border-top:1px solid var(--color-border);font-size:13px;line-height:1.6;color:var(--color-text-muted)}
.site .dk-entry{margin-top:24px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center}
.site .dk-sum{display:flex;gap:32px;margin-top:16px;flex-wrap:wrap}
.site .dk-sum div{display:grid;gap:4px;font-size:13px;color:var(--color-text-muted)}
.site .dk-sum b{font-size:28px;font-weight:600;color:var(--color-text);font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.1}
.site .dk-sum b small{font-size:14px;font-weight:400;color:var(--color-text-muted);margin-left:4px}
.site .dk-entry-list{display:grid;gap:8px;margin:16px 0 0;padding:0;list-style:none;font-size:14px}
.site .dk-entry-list li{display:flex;gap:8px;align-items:center}
.site .dk-bottom{margin:32px 0 0;text-align:center;font-size:13px;color:var(--color-text-muted)}
/* 登录 */
.site .dk-login-wrap{display:grid;grid-template-columns:minmax(0,560px) minmax(0,1fr);gap:48px;margin-top:32px;align-items:start}
.site .dk-login{padding:48px;display:grid;gap:16px;justify-items:start}
.site .dk-login h2{font-size:28px;line-height:1.3}
.site .dk-login p{margin:0}
.site .dk-login .lead2{font-size:16px;line-height:1.7;color:var(--color-text-muted)}
.site .dk-login .btns{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.site .dk-trust{display:flex;gap:8px;flex-wrap:wrap;padding-top:16px;margin-top:8px;border-top:1px solid var(--color-border);width:100%}
.site .dk-trust span{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 12px;border-radius:999px;background:var(--color-surface-2);font-size:13px;color:var(--color-text)}
.site .dk-preview{display:grid;gap:12px}
.site .dk-preview h3{font-size:14px;font-weight:600;color:var(--color-text-muted);margin:0 0 4px}
.site .dk-pv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;padding:16px 24px}
.site .dk-pv b{font-size:15px;font-weight:600;display:block}
.site .dk-pv span{font-size:14px;color:var(--color-text-muted);line-height:1.6}
/* 审核 */
.site .dk-rv{display:grid;grid-template-columns:360px minmax(0,1fr);gap:24px;margin-top:24px;align-items:start}
.site .dk-statusrow{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px;padding:12px 16px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);font-size:14px}
.site .dk-statusrow span{display:inline-flex;align-items:center;gap:8px}
.site .dk-queue{display:grid;gap:8px}
.site .dk-queue h2{font-size:15px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:baseline}
.site .dk-q{display:grid;gap:4px;width:100%;text-align:left;padding:16px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);font:inherit;color:var(--color-text);cursor:pointer;box-sizing:border-box}
.site .dk-q[aria-current="true"]{border-color:var(--color-action);box-shadow:inset 3px 0 0 var(--color-action)}
.site .dk-q .tt{font-size:15px;font-weight:600;line-height:1.45}
.site .dk-q .st{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--color-text-muted)}
.site .dk-q .note{font-size:13px;line-height:1.5;color:var(--on-tint-warn);background:var(--tint-warn);border-radius:6px;padding:8px 12px;margin-top:4px}
.site .dk-q .rj{font-size:13px;line-height:1.5;color:var(--color-text-muted);margin-top:4px}
.site .dk-detail{padding:32px}
.site .dk-detail h2{font-size:28px;line-height:1.3;letter-spacing:-.02em;margin:12px 0 0}
.site .dk-detail .cp-meta,.site .dk-q .cp-meta{white-space:normal}
.site .dk-detail .by{margin:8px 0 0;font-size:13px;color:var(--color-text-muted)}
.site .dk-props{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px 16px;margin:24px 0 0;font-size:14px;line-height:1.6}
.site .dk-props dt{color:var(--color-text-muted)}
.site .dk-props dd{margin:0}
.site .dk-tags{display:flex;gap:8px;flex-wrap:wrap}
.site .dk-btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}
.site .dk-block{margin-top:24px;padding-top:24px;border-top:1px solid var(--color-border)}
.site .dk-block h3{font-size:16px;font-weight:600;margin:0 0 12px}
.site .dk-checks{display:grid;gap:4px}
.site .dk-chk{min-height:40px;font-size:15px;cursor:pointer;position:relative}
.site .dk-sr{position:absolute;width:1px;height:1px;margin:0;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.site .dk-checks .cp-meta{margin:4px 0 0}
.site textarea.cp-input{min-height:96px;padding:12px;line-height:1.6;resize:vertical;font-size:15px}
.site textarea.dk-mono{font-family:var(--font-mono);font-size:13px;min-height:160px}
.site .dk-acts2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.site .dk-acts2 .sp{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.site .dk-why{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--on-tint-warn);background:var(--tint-warn);border-radius:10px;padding:12px 16px;margin:0 0 16px}
.site .dk-back{display:inline-flex;align-items:center;gap:8px;min-height:36px;font-size:14px;color:var(--color-text-muted);text-decoration:none;background:none;border:0;padding:0;font-family:inherit;cursor:pointer}
/* 更多 */
.site .dk-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:24px;align-items:start}
.site .dk-num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:999px;background:var(--color-text);color:var(--color-background);font-size:12px;font-weight:600;margin-right:8px;vertical-align:2px}
.site .dk-diff{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px 16px;font-size:14px;line-height:1.6;margin:16px 0 0}
.site .dk-diff dt{color:var(--color-text-muted)}
.site .dk-diff dd{margin:0;display:grid;gap:4px}
.site .dk-del,.site .dk-add{border-radius:6px;padding:4px 8px;color:var(--color-text)}
.site .dk-del{background:var(--tint-danger);text-decoration:line-through;text-decoration-color:var(--color-danger)}
.site .dk-add{background:var(--tint-ok)}
.site .dk-same{display:flex;gap:8px;align-items:center;margin:16px 0 0;font-size:14px;color:var(--on-tint-ok)}
.site .dk-fields{display:grid;gap:16px;margin-top:16px}
.site .dk-inline{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:16px}
.site .dk-li{display:flex;align-items:center;gap:12px;min-height:56px;padding:12px 0;border-top:1px solid var(--color-border)}
.site .dk-li:first-child{border-top:0}
.site .dk-li .tx{flex:1;min-width:0}
.site .dk-li .tt{font-size:15px;font-weight:500;line-height:1.5}
.site .dk-li .cp-meta{white-space:normal}
.site .dk-li .bt{display:flex;gap:8px;flex:none}
.site .dk-danger{color:var(--color-danger)}
.site .dk-stage{border-radius:14px;padding:48px;display:grid;place-items:center;margin-top:16px}
/* 状态 */
.site .dk-states{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px 24px;margin-top:32px}
.site .dk-st{display:grid;gap:12px;align-content:start}
.site .dk-st > h3{font-size:13px;font-weight:600;color:var(--color-text-muted);margin:0;display:flex;align-items:center;gap:8px}
.site .dk-st > h3::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--color-border-strong)}
.site .dk-wide{grid-column:span 2}
.site .dk-mini{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.site .dk-mini .cp-card{padding:16px;display:grid;gap:8px;font-size:14px}
.site .dk-mini b{font-size:15px}
.site .dk-mini .dk-badge{justify-self:start}
.site .dk-dg{display:grid;gap:16px}
.site .dk-dg article{padding:16px 0;border-top:1px solid var(--color-border);display:grid;gap:8px}
.site .dk-dg article:first-of-type{border-top:0;padding-top:0}
.site .dk-dg h4{font-size:15px;font-weight:600;margin:0;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.site .dk-dg p{margin:0;font-size:14px;line-height:1.7}
.site .dk-dg .ft{display:flex;justify-content:space-between;align-items:center;gap:12px}
.site .dk-masked{display:grid;gap:12px;padding:16px;border:1px dashed var(--color-border-strong);border-radius:14px;font-size:14px;color:var(--color-text-muted);text-align:center}
.site .dk-btn-row{display:flex;gap:8px;flex-wrap:wrap}
"""

PH_CSS = CSS + PHONE + """
.site .dk{padding-top:32px}
.site .dk-hd{align-items:flex-start;gap:16px}
.site .dk-hd h1{font-size:32px}
.site .dk-acts{width:100%}
.site .dk-apps,.site .dk-cols,.site .dk-rv,.site .dk-g2,.site .dk-login-wrap,.site .dk-entry{grid-template-columns:minmax(0,1fr)}
.site .dk-apps,.site .dk-cols{gap:16px;margin-top:16px}
.site .dk-entry{gap:16px}
.site .dk-entry .cp-btn,.site .dk-acts2 .cp-btn-primary{width:100%;box-sizing:border-box}
.site .dk-metrics dd{font-size:20px}
.site .dk-metrics dd small{font-size:12px}
.site .dk-login{padding:32px 24px}
.site .dk-login h2{font-size:24px}
.site .dk-login-wrap{gap:32px;margin-top:24px}
.site .dk-detail{padding:24px}
.site .dk-detail h2{font-size:22px}
.site .dk-props{grid-template-columns:64px minmax(0,1fr)}
.site .dk-acts2 .sp{margin-left:0}
.site .dk-statusrow{flex-wrap:wrap}
.site .dk-bottom{text-align:left;line-height:1.7}
.site .dk-phase{display:flex;align-items:center;gap:12px;margin:32px 0 16px;font-size:13px;font-weight:600;color:var(--color-text-muted)}
.site .dk-phase::after{content:"";flex:1;border-top:1px dashed var(--color-border-strong)}
"""


# ───────────────────────── 片段 ─────────────────────────
def header(actions=True, sub="2026 年 11 月 6 日 周五 · 北京时间"):
    acts = ('<div class="dk-acts"><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">' + I["refresh"] + '刷新概览</button>'
            '<button class="cp-btn cp-btn-ghost cp-btn-sm" type="button">退出登录</button></div>') if actions else ""
    return f'''<header class="dk-hd"><div><p class="dk-eyebrow">私域控制中心 · 统一工作空间</p><h1>我的工作台</h1><p class="dk-date">{sub}</p></div>{acts}</header>'''


APPS = [
    dict(k="health", cat="生活", name="健康", en="Health", icon="heart", state=("ok", "已读取"),
         metrics=[("昨晚睡眠", "7", "小时 12 分"), ("准备度", "78", ""), ("近 7 天步数", "6,840", "日均")],
         note="睡眠比近 30 天均值多 24 分钟，准备度连续 3 天在 75 以上。", time="数据日期：11-06 08:40", go="进入健康"),
    dict(k="gu", cat="投资", name="投资理财", en="GU", icon="chart", state=("warn", "请核对时效"),
         metrics=[("持仓", "12", "只"), ("待复盘", "2", "笔"), ("规则提醒", "1", "条")],
         note="持仓批次来自 11-04 收盘，可能未包含此后的交易。", time="批次：11-04 15:30", go="进入投资理财", hidden=True),
    dict(k="gzh", cat="表达", name="珂抖屁公众号", en="GZH", icon="pen", state=("off", "暂不可用"),
         metrics=[("待审稿件", None, ""), ("本周预览", None, ""), ("已排期", None, "")],
         note="连接暂不可用，请稍后重试。数据未读取，不代表没有稿件。", time="查询时间：11-06 09:41", go="进入公众号"),
]


def app_card(a):
    st, sl = a["state"]
    mets = ""
    for dt, v, unit in a["metrics"]:
        if v is None:
            mets += f'<div><dt>{dt}</dt><dd class="na">暂无数据</dd></div>'
        else:
            u = f"<small>{unit}</small>" if unit else ""
            mets += f'<div><dt>{dt}</dt><dd>{v}{u}</dd></div>'
    hide = ""
    if a.get("hidden"):
        hide = ('<div class="dk-hide"><span>资产金额默认隐藏</span><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button" aria-pressed="false">'
                + I["eye"] + '查看资产金额</button></div>')
    return f'''<article class="cp-card dk-app" aria-labelledby="app-{a["k"]}"><div class="dk-app-top"><div class="dk-app-id"><span class="dk-ico">{I[a["icon"]]}</span><div><p class="dk-eyebrow">{a["cat"]}</p><h2 id="app-{a["k"]}">{a["name"]}<small>{a["en"]}</small></h2></div></div><span class="dk-badge {st}">{sl}</span></div>
<dl class="dk-metrics">{mets}</dl>{hide}<p class="dk-note">{a["note"]}</p>
<div class="dk-app-ft"><span class="cp-meta">{a["time"]}</span><a class="dk-go" href="#">{a["go"]} {I["arrow"]}</a></div></article>'''


def apps():
    return '<section class="dk-apps" aria-label="应用概览">' + "".join(app_card(a) for a in APPS) + "</section>"


def opt(kind, name, val, label, on, pid):
    chk = " checked" if on else ""
    cls = "dk-opt on" if on else "dk-opt"
    return f'<label class="{cls}" for="{pid}-{name}-{val}"><input type="{kind}" id="{pid}-{name}-{val}" name="{pid}-{name}" value="{val}"{chk}>{label}</label>'


def digest_form(pid, range_week=False, sources=(True, True, True)):
    rng = opt("radio", "range", "current", "当前概览", not range_week, pid) + opt("radio", "range", "week", "最近 7 天", range_week, pid)
    src = "".join(opt("checkbox", "src", v, l, on, pid) for (v, l), on in zip([("health", "健康"), ("gu", "投资理财"), ("gzh", "公众号")], sources))
    return f'''<form class="dk-form"><fieldset class="dk-fs"><legend>回顾范围</legend><div class="dk-opts">{rng}</div><p class="cp-help">最近 7 天会附上每日快照；来自快照的内容会单独标注来源。</p></fieldset>
<fieldset class="dk-fs"><legend>纳入的应用</legend><div class="dk-opts">{src}</div></fieldset>
<div class="dk-genrow"><button class="cp-btn cp-btn-primary" type="submit">生成摘要 <span aria-hidden="true">→</span></button><p class="cp-help">基于已保存的数据整理，不触发同步。</p></div></form>'''


def digest_empty():
    return f'''<div class="dk-out" role="status" aria-live="polite"><div class="cp-empty"><span class="dk-empty-ico">{I["doc"]}</span><b>为一次回顾，留一点空间</b><p>生成后，摘要会按应用呈现，并附上数据日期与查看入口。</p><p class="cp-meta">摘要只保留在当前页面。</p></div></div>'''


def digest_card(pid="dg"):
    return f'''<section class="cp-card dk-sec" aria-labelledby="{pid}-t"><div class="dk-sec-hd"><div><p class="dk-eyebrow">回顾</p><h2 id="{pid}-t">按需摘要</h2></div><span class="cp-chip need">由你发起</span></div>
<p class="dk-lead">选好范围，把此刻关心的事整理在一起。</p>{digest_form(pid)}{digest_empty()}</section>'''


TODOS = [("chart", "持仓批次停在 11-04，请核对时效", "可能未包含 11-05 之后的交易，复盘前先在 GU 刷新批次。", "投资理财", "进入投资理财"),
         ("heart", "昨晚的睡眠记录还没有同步完整", "Oura 最近一次同步为 11-06 06:10，深睡分期暂缺。", "健康", "进入健康"),
         ("chart", "2 笔交易还没有写复盘", "11-03 买入、11-04 减仓各 1 笔，复盘说明为空。", "投资理财", "进入投资理财")]


def attention(pid="at"):
    items = "".join(f'''<li><span class="ic">{I[ic]}</span><div><p class="t">{t}</p><p class="d">{d}</p><div class="m"><span class="cp-chip">来源 · {src}</span><a class="dk-go" href="#">{go} {I["arrow"]}</a></div></div></li>''' for ic, t, d, src, go in TODOS)
    return f'''<aside class="cp-card dk-sec" aria-labelledby="{pid}-t"><div class="dk-sec-hd"><div><p class="dk-eyebrow">接下来</p><h2 id="{pid}-t">需要处理</h2></div><span class="cp-meta">3 项</span></div>
<p class="dk-lead">从真实状态出发。</p><ul class="dk-todo">{items}</ul><p class="dk-fnote">在原应用中查看详情、完成操作。这里的刷新只读取已有记录。</p></aside>'''


def review_entry():
    return f'''<section class="cp-card dk-sec dk-entry" aria-labelledby="rv-entry"><div><p class="dk-eyebrow">审核 · 博客</p><h2 id="rv-entry">博客审核</h2>
<div class="dk-sum"><div>待审核<b>2<small>篇</small></b></div><div>已发布<b>3<small>篇</small></b></div><div>最近提交<b style="font-size:20px;line-height:1.4">11-06 21:40</b></div></div>
<ul class="dk-entry-list"><li><span class="cp-chip need">更新待审核</span>从 TCP/UDP 到 mihomo 与 sing-box（修订 3）</li><li><span class="cp-chip">待审核</span>一个人的周末，如何安排一次长距离骑行</li></ul></div>
<a class="cp-btn cp-btn-secondary" href="#">进入博客审核 <span aria-hidden="true">→</span></a></section>'''


BOTTOM = '<p class="dk-bottom">仅本人可见 · 各应用保留自己的数据日期 · 退出会撤销此浏览器的统一登录会话</p>'
STATUS = f'<p class="dk-status" role="status">{CHECK16}概览已读取 · 11-06 09:42（北京时间）· 部分来源暂不可用</p>'


def desk():
    return page(f'''<div class="wrap dk">{header()}{STATUS}{apps()}<div class="dk-cols">{digest_card()}{attention()}</div>{review_entry()}{BOTTOM}</div>''')


def desk_phone():
    return page(f'''<div class="wrap dk">{header()}{STATUS}{apps()}<div class="dk-cols">{attention()}{digest_card()}</div>{review_entry()}{BOTTOM}</div>''')


# ───────────────────────── 登录 ─────────────────────────
def login_card(pid="lg"):
    return f'''<section class="cp-card dk-login" aria-labelledby="{pid}-t"><span class="dk-ico" style="width:48px;height:48px">{I["key"]}</span><h2 id="{pid}-t">留给自己的工作空间</h2>
<p class="lead2">登录后，查看三个应用的近况，整理一份此刻需要的摘要。</p>
<div class="btns"><a class="cp-btn cp-btn-primary" href="#">本人登录 <span aria-hidden="true">→</span></a><button class="cp-btn cp-btn-ghost" type="button">{I["refresh"]}重新检查连接</button></div>
<p class="cp-help">与 Health、GU、珂抖屁公众号共用统一登录。</p>
<div class="dk-trust" aria-label="安全说明"><span>{I["shield"]}SSO 统一鉴权</span><span>{I["lock"]}私域数据隔离</span><span>{I["undo"]}随时撤回会话</span></div></section>'''


def login():
    pv = "".join(f'<div class="cp-card dk-pv"><span class="dk-ico">{I[ic]}</span><div><b>{n}</b><span>{d}</span></div></div>' for ic, n, d in [
        ("heart", "健康", "睡眠、准备度与活动的最近一次记录"), ("chart", "投资理财", "持仓批次、待复盘交易与规则提醒；金额默认隐藏"), ("pen", "珂抖屁公众号", "待审稿件与预览进度")])
    side = f'<div class="dk-preview"><h3>登录后，这里会出现</h3>{pv}<p class="cp-help" style="margin:8px 0 0">每张卡片保留各自应用的数据日期；读取失败时如实标注，不当作没有数据。</p></div>'
    return page(f'''<div class="wrap dk">{header(False, "健康、投资与内容工作，在这里回顾。")}<p class="dk-status" role="status">{INFO16}尚未登录 · 概览数据只在本人登录后读取</p><div class="dk-login-wrap">{login_card()}{side}</div></div>''')


# ───────────────────────── 审核 ─────────────────────────
QUEUE = [("从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理的内核与 DNS", "更新待审核", 3, "11-06 21:40", True, "当前公开版本为修订 2，发布更新前继续保留。", None),
         ("一个人的周末，如何安排一次长距离骑行", "待审核", 1, "11-06 18:05", False, None, None),
         ("记账三个月后，我对「月度预算」的新理解", "已拒绝", 2, "11-05 10:12", False, None, "审阅说明：第二节缺少数据来源，请补充后重新提交。")]


def queue(sel=0, pid="q"):
    out = ""
    for i, (t, st, rev, upd, _, note, rj) in enumerate(QUEUE):
        cur = ' aria-current="true"' if i == sel else ""
        chip = "cp-chip need" if st == "更新待审核" else "cp-chip"
        extra = f'<span class="note">{note}</span>' if note else ""
        extra += f'<span class="rj">{rj}</span>' if rj else ""
        out += f'''<button class="dk-q" type="button"{cur}><span class="tt">{t}</span><span class="st"><span class="{chip}">{st}</span>修订 {rev}</span><span class="cp-meta">更新于 {upd}（北京时间）</span>{extra}</button>'''
    return f'<div class="dk-queue" aria-label="待审核稿件列表"><h2>待审核稿件<span class="cp-meta">3 篇 · 含 1 篇已拒绝</span></h2>{out}</div>'


CHECKLIST = [("标题、摘要、分类与标签已核对", True), ("事实有来源，未编造个人经历", True), ("头图与配图合规，alt 与图注完整", True), ("无敏感数据、凭证或私人信息", False)]


def detail(pid="d", back=False):
    chks = ""
    for i, (l, on) in enumerate(CHECKLIST):
        c = " checked" if on else ""
        cls = "cp-checkbox on dk-chk" if on else "cp-checkbox dk-chk"
        chks += f'<label class="{cls}" for="{pid}-c{i}"><input class="dk-sr" type="checkbox" id="{pid}-c{i}"{c}><i aria-hidden="true"></i>{l}</label>'
    bk = '<button class="dk-back" type="button">← 返回列表</button>' if back else ""
    return f'''<section class="cp-card dk-detail" aria-label="稿件审核详情">{bk}<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="cp-chip need">更新待审核</span><span class="cp-meta">修订 3 · 来自 Claude（MCP）· 更新于 11-06 21:40（北京时间）</span></div>
<h2>从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理的内核与 DNS</h2>
<dl class="dk-props"><dt>分类</dt><dd>网络技术科普</dd><dt>标签</dt><dd class="dk-tags"><span class="cp-chip">代理</span><span class="cp-chip">DNS</span><span class="cp-chip">网络基础</span></dd><dt>系列</dt><dd>网络从零到一 · 第 2 篇</dd>
<dt>摘要</dt><dd>从 IP、端口、TCP、UDP、QUIC、TLS 等网络基础讲起，梳理三大代理内核的差异，对比常见协议的优劣与选型，解释两种 DNS 模式。</dd></dl>
<div class="dk-btnrow"><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">预览草稿 {I["arrow"]}</a><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">与上一版对比</button><button class="cp-btn cp-btn-ghost cp-btn-sm" type="button" aria-expanded="false">阅读全文与配图</button></div>
<div class="dk-block"><fieldset class="dk-fs"><legend style="font-size:16px;margin-bottom:12px">审核清单（全部确认后才能发布）</legend><div class="dk-checks">{chks}<p class="cp-meta">已确认 3 / 4 项</p></div></fieldset></div>
<div class="dk-block"><div class="cp-field"><label class="cp-label" for="{pid}-note">审阅说明（退回时可选）</label><textarea class="cp-input" id="{pid}-note" rows="3" placeholder="写给提交者：需要补充或修改的地方"></textarea><p class="cp-help">退回或拒绝时会随稿件保存，提交者下次读取时可见。</p></div></div>
<div class="dk-block"><p class="dk-why" id="{pid}-why">{INFO16}<span>还有 1 项未确认：「无敏感数据、凭证或私人信息」。全部确认后才能发布。</span></p>
<div class="dk-acts2"><button class="cp-btn cp-btn-primary" type="button" aria-disabled="true" aria-describedby="{pid}-why">发布修订 3</button><button class="cp-btn cp-btn-secondary" type="button">退回</button>
<div class="sp"><button class="cp-btn cp-btn-ghost" type="button">归档</button><button class="cp-btn cp-btn-destructive" type="button">拒绝</button></div></div></div></section>'''


def rv_head(phone=False):
    return f'''<header class="dk-hd"><div><a class="cp-back" href="#">← 返回工作台</a><h1 style="margin-top:8px">博客审核</h1><p class="dk-date">通过 MCP 提交的草稿，在这里阅读、核对并决定是否公开。</p></div></header>
<div class="dk-statusrow" role="status"><span>{CHECK16}2 篇待审核，3 篇已发布。</span><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">{I["refresh"]}重新读取</button></div>'''


def review():
    return page(f'''<div class="wrap dk">{rv_head()}<div class="dk-rv">{queue()}{detail()}</div></div>''')


def review_phone():
    return page(f'''<div class="wrap dk">{rv_head(True)}<p class="dk-phase">① 列表</p>{queue(sel=-1)}<p class="dk-phase">② 选中后 · 详情</p>{detail("pd", back=True)}</div>''')


def review_more():
    diff = f'''<section class="cp-card dk-sec" aria-labelledby="m1"><h2 id="m1"><span class="dk-num">1</span>与上一版对比</h2><p class="dk-lead">修订 2 → 修订 3（当前公开为修订 2）</p>
<dl class="dk-diff"><dt>标题</dt><dd><span class="dk-del">从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理</span><span class="dk-add">从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理的内核与 DNS</span></dd>
<dt>摘要</dt><dd><span class="dk-del">梳理三大代理内核的差异与常见协议。</span><span class="dk-add">从 IP、端口、TCP、UDP、QUIC、TLS 等网络基础讲起，梳理三大代理内核的差异，解释两种 DNS 模式。</span></dd></dl>
<p class="dk-same">{CHECK16}正文与上一版一致。</p></section>'''
    edit = '''<section class="cp-card dk-sec" aria-labelledby="m2"><h2 id="m2"><span class="dk-num">2</span>小改（标题、摘要、错字）</h2><p class="dk-lead">只做文字层面的修正；保存后生成新修订，需要重新审核清单。</p>
<div class="dk-fields"><div class="cp-field"><label class="cp-label" for="e-title">标题</label><input class="cp-input" id="e-title" value="从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理的内核与 DNS"></div>
<div class="cp-field"><label class="cp-label" for="e-sum">摘要</label><textarea class="cp-input" id="e-sum" rows="3">从 IP、端口、TCP、UDP、QUIC、TLS 等网络基础讲起，梳理三大代理内核的差异，解释两种 DNS 模式。</textarea></div>
<div class="cp-field"><label class="cp-label" for="e-body">正文 Markdown</label><textarea class="cp-input dk-mono" id="e-body" rows="7">## 先从一个请求说起

打开网页时，浏览器先通过 DNS 找到地址，再建立连接……</textarea></div>
<div class="dk-btn-row"><button class="cp-btn cp-btn-secondary" type="button">保存小改（生成新修订）</button><button class="cp-btn cp-btn-primary" type="button">小改后发布</button></div></div></section>'''
    cats = [("网络技术科普", "network-basics", 1, False), ("AI 深度观察", "ai-insight", 1, False), ("生活感悟", "life-notes", 1, False), ("AI 周报", "ai-weekly", 0, True)]
    crow = ""
    for n, s, c, can in cats:
        if can:
            b = f'<button class="cp-btn cp-btn-ghost cp-btn-sm dk-danger" type="button" aria-label="删除分类 {s}">删除</button>'
            meta = f"{n}（{s}）· 暂无已发布文章"
        else:
            b = f'<button class="cp-btn cp-btn-ghost cp-btn-sm" type="button" aria-disabled="true" aria-label="删除分类 {s}（有文章使用，不能删除）">删除</button>'
            meta = f"{n}（{s}）· {c} 篇已发布"
        crow += f'<div class="dk-li"><div class="tx"><div class="tt">{meta}</div></div><div class="bt">{b}</div></div>'
    catsec = f'''<section class="cp-card dk-sec" aria-labelledby="m3"><h2 id="m3"><span class="dk-num">3</span>管理分类（AI 只能从这里选择）</h2><p class="dk-lead">只有没有稿件使用的分类才能删除。</p>
<div style="margin-top:16px">{crow}</div>
<form class="dk-inline"><div class="cp-field"><label class="cp-label" for="c-slug">分类 slug</label><input class="cp-input" id="c-slug" placeholder="ai-weekly" maxlength="40"></div><div class="cp-field"><label class="cp-label" for="c-name">分类名称</label><input class="cp-input" id="c-name" placeholder="AI 周报" maxlength="20"></div><button class="cp-btn cp-btn-secondary" type="submit">{IC["plus"]}添加分类</button></form>
<p class="cp-help" style="margin:8px 0 0">slug 用小写字母、数字与连字符，最多 40 个字符。</p></section>'''
    pubs = [("从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理", "修订 2 公开 · 修订 3 待审核 · 发布于 10-27", True),
            ("OpenAI 进入 Google Cloud：当 AI 巨头开始互相销售对方的模型", "修订 1 · 发布于 10-27", False),
            ("工作 19 年后，我发现自己不会休息了", "修订 2 · 发布于 10-27 · 更新于 10-30", False)]
    prow = ""
    for t, m, upd in pubs:
        ub = '<button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">发布更新</button>' if upd else ""
        prow += f'<div class="dk-li"><div class="tx"><div class="tt">{t}</div><div class="cp-meta">{m}</div></div><div class="bt"><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">查看文章 {I["arrow"]}</a>{ub}<button class="cp-btn cp-btn-ghost cp-btn-sm dk-danger" type="button">下架</button></div></div>'
    pub = f'''<section class="cp-card dk-sec" aria-labelledby="m4"><h2 id="m4"><span class="dk-num">4</span>已发布文章</h2><p class="dk-lead">此处显示最近 3 篇已发布文章。下架后公开页面无法访问，稿件保留。</p><div style="margin-top:16px">{prow}</div></section>'''
    arch = '''<section class="cp-card dk-sec" aria-labelledby="m5"><h2 id="m5"><span class="dk-num">5</span>测试与归档</h2><p class="dk-lead">测试稿件只用于联调，不进审核队列，也不能发布。</p><div style="margin-top:16px">
<div class="dk-li"><span class="cp-chip">测试稿件</span><div class="tx"><div class="tt">MCP 联调 · 图片上传检查</div><div class="cp-meta">修订 1 · 11-05 14:20（北京时间）</div></div></div>
<div class="dk-li"><span class="cp-chip">已归档</span><div class="tx"><div class="tt">十月读书笔记（草稿）</div><div class="cp-meta">修订 2 · 归档于 11-02 09:30（北京时间）</div></div><div class="bt"><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">恢复到审核队列</button></div></div></div></section>'''
    dlg = '''<section class="cp-card dk-sec" aria-labelledby="m6"><h2 id="m6"><span class="dk-num">6</span>确认对话框</h2><p class="dk-lead">发布、下架、归档、删除分类前都先确认；破坏性操作用红色按钮，焦点默认落在「取消」。</p>
<div class="dk-stage cp-scrim"><div class="cp-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-b"><h3 class="cp-dialog-title" id="dlg-t">下架《工作 19 年后，我发现自己不会休息了》？</h3><p class="cp-dialog-body" id="dlg-b">公开页面将无法访问。稿件与修订记录保留，之后可以重新发布。</p>
<div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary" type="button">取消</button><button class="cp-btn cp-btn-destructive" type="button">下架</button></div></div></div></section>'''
    return page(f'''<div class="wrap dk"><header class="dk-hd"><div><a class="cp-back" href="#">← 返回工作台</a><h1 style="margin-top:8px">博客审核 · 其余部分</h1><p class="dk-date">同一审核区里，对比、小改、分类、已发布与归档的分区。</p></div></header>
<div class="dk-g2"><div style="display:grid;gap:24px">{diff}{catsec}{arch}</div><div style="display:grid;gap:24px">{edit}{pub}{dlg}</div></div></div>''')


# ───────────────────────── 状态合集 ─────────────────────────
def st(title, body, wide=False):
    cls = "dk-st dk-wide" if wide else "dk-st"
    return f'<div class="{cls}"><h3>{title}</h3>{body}</div>'


def skel(w, h=16):
    return f'<div class="cp-skel" style="width:{w};height:{h}px"></div>'


def states():
    loading = f'''<div class="cp-card" style="display:grid;gap:16px" aria-busy="true"><p class="dk-status" role="status" style="margin:0">{IC["loader"]}正在确认登录状态…</p>{skel("40%", 24)}{skel("70%")}<div class="dk-mini">{"".join('<div class="cp-card">' + skel("60%") + skel("90%", 24) + '</div>' for _ in range(3))}</div></div>'''
    conn = f'''<div class="cp-alert cp-alert-error" role="alert">{IC["error"]}<div><span class="cp-alert-title">工作台连接暂不可用</span>若首次部署尚未完成，请稍后重新检查连接。<div style="margin-top:12px"><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">{I["refresh"]}重新检查连接</button></div></div></div>'''
    sess = f'''<div style="display:grid;gap:12px"><div class="cp-alert cp-alert-warning" role="alert">{IC["alert"]}<div><span class="cp-alert-title">会话暂时无法验证，数据已隐藏</span>请重新检查连接；确认身份前，不显示任何应用数据。<div style="margin-top:12px"><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">{I["refresh"]}重新检查连接</button></div></div></div><div class="dk-masked">{I["lock"]}三张应用卡片的数据已隐藏</div></div>'''
    exp = f'''<div class="cp-card" style="display:grid;gap:12px;justify-items:start"><span class="dk-badge warn">会话已结束</span><p style="margin:0;font-size:15px;line-height:1.6">登录已到期或已退出，请重新登录后继续。</p><p class="cp-help" style="margin:0">未保存的审阅说明不会保留；摘要只存在于当时的页面。</p><a class="cp-btn cp-btn-primary cp-btn-sm" href="#">本人登录 <span aria-hidden="true">→</span></a></div>'''
    mini = "".join(f'<div class="cp-card"><b>{n}</b><span class="dk-badge {c}">{s}</span><span class="cp-meta">{t}</span></div>' for n, c, s, t in [("健康", "ok", "已读取", "数据日期：11-06"), ("投资理财", "ok", "已读取", "批次：11-06 15:30"), ("公众号", "off", "暂不可用", "查询时间：09:41")])
    partial = f'''<div style="display:grid;gap:12px"><div class="cp-banner" role="status">{IC["alert"]}<span>部分来源暂不可用 · 11-06 09:42（北京时间）。其余应用照常显示，失败的来源不计为 0。</span></div><div class="dk-mini">{mini}</div></div>'''
    dg = [("健康", "数据日期：11-06 08:40", "昨晚睡眠 7 小时 12 分，比近 30 天均值多 24 分钟；准备度 78，连续 3 天在 75 以上。", "进入健康"),
          ("投资理财", "批次：11-04 15:30", "持仓 12 只；2 笔交易尚未复盘，1 条规则提醒待查看。批次较早，结论请核对时效。", "进入投资理财"),
          ("珂抖屁公众号", "查询时间：11-06 09:41", "待审稿件 1 篇（《十一月选题清单》），本周已预览 2 次。", "进入公众号")]
    arts = "".join(f'<article><h4>{n}<span class="cp-meta">{d}</span></h4><p>{p}</p><div class="ft"><span class="cp-meta">来自当前概览</span><a class="dk-go" href="#">{g} {I["arrow"]}</a></div></article>' for n, d, p, g in dg)
    done = f'''<div class="cp-card"><p class="dk-status" role="status" style="margin:0 0 16px">{CHECK16}摘要已生成 · 当前概览 · 11-06 09:45（北京时间）</p><div class="dk-dg">{arts}</div><p class="cp-meta" style="margin:16px 0 0">摘要只保留在当前页面。</p></div>'''
    changed = f'''<div class="cp-card" style="display:grid;gap:16px"><div class="cp-banner" role="status">{INFO16}<span>范围已更改，请生成新的摘要。</span><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">生成新的摘要</button></div>
<div class="dk-opts">{opt("radio", "range", "current", "当前概览", False, "sc")}{opt("radio", "range", "week", "最近 7 天", True, "sc")}</div><p class="cp-help" style="margin:0">下方仍是「当前概览」的摘要，生成前不会混用两个范围的内容。</p></div>'''
    att0 = '''<div class="cp-card"><h4 style="margin:0;font-size:16px;font-weight:600">需要处理</h4><div class="cp-empty" style="margin-top:16px;padding:24px 16px"><b>已读取的状态中，暂无待处理事项。</b><span>只代表成功读取的应用；暂不可用的来源不计入。</span></div></div>'''
    rv0 = '''<div class="cp-card"><h4 style="margin:0;font-size:16px;font-weight:600">博客审核</h4><div class="cp-empty" style="margin-top:16px;padding:24px 16px"><b>暂无待审核的草稿。</b><span>通过 MCP 提交的草稿会出现在这里。</span></div></div>'''
    out1 = f'''<div class="cp-card" style="display:grid;gap:12px;justify-items:start"><button class="cp-btn cp-btn-ghost cp-btn-sm" type="button" aria-busy="true">{IC["loader"]}正在退出统一登录…</button><p class="cp-help" style="margin:0">页面数据已先行清除，正在撤销此浏览器的统一登录会话。</p></div>'''
    out2 = f'''<div class="cp-alert cp-alert-success" role="status">{IC["check"]}<div><span class="cp-alert-title">已退出</span>已退出此浏览器的统一登录，工作台数据已清除。</div></div>'''
    out3 = f'''<div class="cp-alert cp-alert-warning" role="alert">{IC["alert"]}<div><span class="cp-alert-title">退出尚未完成</span>页面数据已隐藏，但退出尚未完成。请重试退出登录。<div style="margin-top:12px"><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button">重试退出登录</button></div></div></div>'''
    grid = "".join([
        st("正在确认登录状态（加载）", loading), st("工作台连接暂不可用", conn), st("会话暂时无法验证，数据已隐藏", sess),
        st("登录已到期或已退出", exp), st("部分来源暂不可用（部分完成）", partial, wide=True),
        st("摘要已生成", done, wide=True), st("范围已更改，请生成新的摘要", changed),
        st("需要处理为空", att0), st("博客审核为空", rv0), st("退出中", out1),
        st("已退出", out2), st("退出失败（重试）", out3)])
    return page(f'''<div class="wrap dk"><header class="dk-hd"><div><p class="dk-eyebrow">我的工作台</p><h1>状态合集</h1><p class="dk-date">加载、出错、会话、部分完成、摘要与空态。每个状态都说明发生了什么、数据是否可信、下一步做什么。</p></div></header><div class="dk-states">{grid}</div></div>''')


def login_phone():
    return page(f'''<div class="wrap dk">{header(False, "健康、投资与内容工作，在这里回顾。")}<div class="dk-login-wrap">{login_card()}</div></div>''')


BOARDS = [("Web-Desk-Login", "我的工作台 · 登录", 1440, login, 1000, CSS),
          ("Web-Desk", "我的工作台", 1440, desk, 1900, CSS),
          ("Web-Desk-Review", "我的工作台 · 博客审核", 1440, review, 1600, CSS),
          ("Web-Desk-Review-More", "我的工作台 · 审核其余部分", 1440, review_more, 1900, CSS),
          ("Web-Desk-States", "我的工作台 · 状态合集", 1440, states, 1700, CSS),
          ("Web-Desk-Login-Phone", "我的工作台 · 登录 · 手机", 390, login_phone, 1100, PH_CSS),
          ("Web-Desk-Phone", "我的工作台 · 手机", 390, desk_phone, 3800, PH_CSS),
          ("Web-Desk-Review-Phone", "我的工作台 · 博客审核 · 手机", 390, review_phone, 2600, PH_CSS)]
for n, t, w, fn, h, css in BOARDS:
    add(n, t, w, H.get(n, h), fn(), css)
print("desk ok", [b[0] for b in BOARDS])
