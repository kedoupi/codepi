import os, random
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, LOGO_BLOB
from gen2 import IC
from gen3 import CHEV_L, CHEV_R, I16, cal

LOGO = LOGO_BLOB
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HJ", "").split(",") if x)}
HATCH = "repeating-linear-gradient(135deg,var(--state-unknown) 0 4px,#F4F1EC 4px 8px)"

CSS = """
.jw{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;position:relative}
.jw a:not(.cp-btn){color:inherit}
.jw .body{display:grid;grid-template-columns:200px minmax(0,1fr)}
.jw .side{border-right:1px solid var(--color-border);background:var(--color-surface);padding:10px 8px;display:flex;flex-direction:column;gap:2px}
.jw .side .note{margin-top:auto;padding:16px 10px;font-size:12px;line-height:1.6;color:var(--color-text-subtle)}
.jw .main{padding:28px 32px 48px;display:grid;gap:18px;align-content:start;max-width:1180px}
.jw .hd{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}
.jw .hd h1{font-size:22px;font-weight:600;letter-spacing:-.015em;margin:0}
.jw .hd .r{margin-left:auto;display:flex;gap:10px;align-items:center}
.jw .box{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:18px 22px}
.jw .box h2{font-size:16px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.jw .box h2 small{font-size:12px;font-weight:500;color:var(--color-text-subtle)}
.jw .box .desc{font-size:13px;color:var(--color-text-muted);margin:0 0 14px;line-height:1.55}
.jw .ev{font-size:11px;padding:1px 6px;border-radius:5px;background:var(--color-surface-2);color:var(--color-text-muted);font-weight:500}
.jw .ev.inf{background:#FFF1E2;color:#7A4A12}.jw .ev.none{background:transparent;border:1px dashed var(--color-border-strong)}
.jw .cur{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 18px;align-items:center;border-left:4px solid var(--state-desk)}
.jw .cur .big{font-size:28px;font-weight:600;letter-spacing:-.02em;grid-row:span 2}
.jw .stat4{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.jw .bars24{display:flex;align-items:flex-end;gap:10px;height:220px}
.jw .bars24 .c{flex:1;display:flex;flex-direction:column;height:100%;border-radius:4px;overflow:hidden;gap:1px}
.jw .bars24 .c i{display:block}
.jw .tabs-a{display:flex;gap:4px;flex-wrap:wrap}
.jw .tabs-a a{font-size:13px;padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--color-text-muted);background:var(--color-surface);border:1px solid var(--color-border)}
.jw .range{display:grid;grid-template-columns:80px minmax(0,1fr) 120px;gap:12px;align-items:center;font-size:14px;min-height:40px;border-top:1px solid var(--color-border)}
.jw .range .track{position:relative;height:20px}
.jw .range .track::before{content:"";position:absolute;left:0;right:0;top:9px;height:2px;background:var(--color-surface-2)}
.jw .range .track i{position:absolute;top:7px;height:6px;border-radius:3px;background:var(--c)}
.jw .range .track b{position:absolute;top:3px;width:14px;height:14px;border-radius:50%;background:var(--color-surface);border:3px solid var(--c);box-sizing:border-box;transform:translateX(-50%)}
.jw .hh{display:grid;grid-template-columns:44px repeat(12,minmax(0,1fr));gap:3px;font-size:11px;color:var(--color-text-subtle);align-items:center}
.jw .hh i{height:22px;border-radius:3px;background:var(--state-desk)}
.jw .hh i.hot{background:var(--color-action)}
.jw .catrow{display:grid;grid-template-columns:96px minmax(0,1fr) 120px 130px;gap:12px;align-items:center;min-height:36px;border-top:1px solid var(--color-border);font-size:14px}
.jw .catrow .t{height:8px;border-radius:4px;background:var(--color-surface-2);overflow:hidden}.jw .catrow .t i{display:block;height:100%;background:var(--c)}
.jw .catrow .d{font-size:12px;color:var(--color-text-subtle);text-align:right}
.jw .rule{display:grid;grid-template-columns:120px 60px minmax(0,1fr);gap:12px;align-items:baseline;font-size:14px;padding:12px 0;border-top:1px solid var(--color-border)}
.jw .rule i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:-1px}
.jw .catcard{border:1px solid var(--color-border);border-radius:12px;padding:12px 14px;font-size:13px;display:grid;gap:4px}
.jw .catcard b{font-size:14px;display:flex;gap:8px;align-items:center}
"""
PHONE = """
.jw .body{grid-template-columns:minmax(0,1fr)}.jw .side{display:none}.jw .main{padding:16px 16px 96px;gap:14px}
.jw .cp-appbar{padding:0 16px}.jw .hide-m{display:none!important}
.jw .stat4,.jw .cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.jw .one-m{grid-template-columns:minmax(0,1fr)!important}
.jw .cp-tabbar{position:absolute;left:0;right:0;bottom:0}
.jw .catrow{grid-template-columns:80px minmax(0,1fr) 70px}.jw .catrow .d{display:none}
.jw .range{grid-template-columns:64px minmax(0,1fr) 92px}
.jw .bars24{gap:4px;height:180px}
.jw .rule{grid-template-columns:96px 52px minmax(0,1fr)}
.jw .hd h1{font-size:22px}.jw .cur .big{font-size:22px}
"""

NAV = ["今天", "工作", "趋势", "来源", "设置"]
def shell(body, cur, phone=False):
    side = '<nav class="cp-nav side" aria-label="作息">' + "".join(f'<a href="#" {"aria-current=page" if n == cur else ""}><span>{n}</span></a>' for n in NAV) + '<div class="note">设备在线不等于人在。<br><a href="#" style="color:var(--color-action-hover)">查看来源与口径</a></div></nav>'
    bar = f'<header class="cp-appbar"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi<small>作息</small></a><div class="right"><span class="cp-fresh hide-m">数据 16:03 更新</span><span class="cp-chip hide-m">示意数据</span><button class="cp-btn cp-btn-ghost cp-btn-sm">退出</button></div></header>'
    tb = ('<nav class="cp-tabbar" aria-label="底部导航" style="grid-template-columns:repeat(5,1fr)">' + "".join(f'<a href="#" {"aria-current=page" if n == cur else ""}>{n}</a>' for n in NAV) + '</nav>') if phone else ""
    return f'<div class="jw">{bar}<div class="body">{side}<main class="main">{body}</main></div>{tb}</div>'

SEG = [(0, 456, "sleep"), (456, 476, "home"), (476, 548, "commute"), (548, 655, "desk"), (655, 705, "meeting"), (705, 740, "desk"), (740, 785, "away"), (785, 967, "desk")]
def day24(now=967, extra=None, h=30):
    segs = extra or SEG
    out = []
    last = 0
    for s, e, st in segs:
        out.append(f'<i style="position:absolute;left:{s / 14.4}%;width:{(e - s) / 14.4}%;top:0;bottom:0;background:var(--state-{st})"></i>')
        last = e
    out.append(f'<i style="position:absolute;left:{last / 14.4}%;right:0;top:0;bottom:0;background:var(--state-future)"></i>')
    if now: out.append(f'<span class="cp-day-now" style="left:{now / 14.4}%"></span>')
    return f'<div style="position:relative;height:{h}px;border-radius:6px;overflow:hidden;background:var(--state-future)" role="img" aria-label="0–24 点作息">{"".join(out)}</div><div class="cp-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>'

LEG = [("卧室", "sleep"), ("在家", "home"), ("通勤", "commute"), ("在电脑前", "desk"), ("开会", "meeting"), ("离座", "away"), ("在外", "out"), ("其他网络", "unknown")]
def legend():
    return '<div class="cp-legend">' + "".join(f'<span style="--c:var(--state-{c})">{n}</span>' for n, c in LEG) + f'<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:14px;height:8px;border-radius:2px;background:{HATCH}"></i>未知</span><span style="--c:var(--state-future)">还没到</span></div>'

def datebar():
    return f'<div class="cp-datebar"><button class="cp-iconbtn" aria-label="前一个有数据的日子">{CHEV_L}</button><button class="cp-btn cp-btn-ghost cp-btn-sm" style="font-size:18px;font-weight:600;padding:0 8px">11 月 6 日 周五 {I16("chev")}</button><button class="cp-iconbtn" aria-label="后一个有数据的日子" aria-disabled="true">{CHEV_R}</button></div>'

def cur_card(kind="live"):
    if kind == "stale":
        return '<div class="box cur" style="border-left-color:var(--state-unknown)"><span class="big" style="color:var(--color-text-subtle)">未知</span><span>16:07 · 最近 20 分钟没有可判断的数据</span><span class="cp-meta"><span class="ev none">无数据</span> 工作机每 15 分钟上传一次</span></div>'
    if kind == "past":
        return '<div class="box cur" style="border-left-color:var(--state-sleep)"><span class="big">卧室</span><span>23:59 · 所选日期最后一个可判断的状态</span><span class="cp-meta"><span class="ev">看到</span> 看以前的日期</span></div>'
    return '<div class="box cur"><span class="big">在电脑前</span><span>16:07 · 公司网络，有键鼠操作</span><span class="cp-meta"><span class="ev">看到</span> 截至 16:03 · 工作机每 15 分钟上传一次</span></div>'

def stats(nophone=False):
    rows = [("上班通勤", "1:12" if not nophone else "未知", "上限 · 含到公司后未开电脑的时间", "inf"), ("下班通勤", "—" if not nophone else "未知", "上限 · 还没下班", "inf"),
            ("在电脑前", "5:24", "公司网络且有键鼠", ""), ("开会", "0:50", "1 场 · 电池供电推断", "inf"),
            ("在家", "7:56", "卧室 7:36 · 客厅 0:20" if not nophone else "未分房间 7:56（未指定手机）", "")]
    return '<div class="stat4">' + "".join(f'<div class="cp-stat"><div class="cp-head"><span>{a}</span>{"<span class=ev style=background:#FFF1E2;color:#7A4A12>推断</span>" if e else ""}</div><div class="cp-stat-num" style="font-size:24px{";color:var(--color-text-subtle)" if b in ("未知", "—") else ""}">{b}</div><div class="cp-delta">{c}</div></div>' for a, b, c, e in rows) + '</div>'

MOM = [(456, "起床"), (476, "出门"), (548, "开始工作"), (655, "开会"), (705, "散会"), (740, "午饭"), (785, "回来")]
def moments():
    out = []
    for i, (m, l) in enumerate(MOM):
        out.append(f'<div class="m{" lo" if i % 2 else ""}" style="left:{m / 14.4}%;--c:var(--color-text)"><b>{m // 60:02d}:{m % 60:02d}</b>{l}</div>')
    return f'<div class="cp-moments">{"".join(out)}</div>'

def today(phone=False, nophone=False):
    banner = f'<div class="cp-banner">{IC["alert"]}<span>还没指定本人手机，家里的部分记为未知。</span><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">去设置里选择</a></div>' if nophone else ""
    blocks = [("09:08–10:55", "在电脑前", "1:47", "desk"), ("10:55–11:45", "开会", "0:50", "meeting"), ("11:45–12:20", "在电脑前", "0:35", "desk"), ("12:20–13:05", "离座", "0:45", "away"), ("13:05–现在", "在电脑前", "3:02", "desk")]
    bl = "".join(f'<div class="cp-kv" style="min-height:42px"><span style="display:flex;gap:10px;align-items:center;color:var(--color-text)"><i style="width:10px;height:10px;border-radius:3px;background:var(--state-{c})"></i>{t}　<b style="font-weight:500">{n}</b></span><b>{d}</b></div>' for t, n, d, c in blocks)
    apps = [("示例编辑器", "#2E6DB4", 240, "4:00"), ("示例沟通", "#E08A2E", 46, "0:46"), ("示例会议", "#9A5A1C", 44, "0:44"), ("示例浏览器", "#3BA39B", 38, "0:38")]
    ar = "".join(f'<div class="cp-hbar" style="grid-template-columns:96px 1fr 48px"><span>{n}</span><div class="t"><i style="width:{m / 2.4}%;--c:{c}"></i></div><b>{t}</b></div>' for n, c, m, t in apps)
    body = f'''<div class="hd"><div>{datebar()}<p class="cp-meta" style="margin:6px 0 0 4px">所有时间按北京时间显示</p></div><div class="r hide-m"><button class="cp-btn cp-btn-secondary cp-btn-sm">回到今天</button></div></div>
{banner}{cur_card()}{stats(nophone)}
<section class="box"><h2>0–24 点 <small>点按或悬停一段看明细</small></h2><div style="margin-top:12px">{day24()}</div><div style="margin-top:12px">{legend()}</div>{"" if phone else moments()}
<div class="cp-alert" style="margin-top:{"14px" if phone else "4px"};max-width:420px">{IC["info"]}<div><span class="cp-alert-title">12:20–13:05 离座 · 45 分钟</span><span class="ev inf">推断</span> 锁屏或没有操作，且夹在两段办公之间</div></div></section>
<div class="cols one-m" style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start"><section class="box"><h2>工作时段 <small>按连续时间块</small></h2><div style="margin-top:6px">{bl}</div></section><section class="box"><h2>用得最多的 App <small>在电脑前 5:24</small></h2><div style="display:grid;gap:4px;margin-top:10px">{ar}</div></section></div>'''
    return shell(body, "今天", phone)

def today_states():
    return f'''<div class="jw" style="padding:40px;display:grid;gap:24px">
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px"><div><p class="cp-head"><span>当前状态 · 今天且有数据</span></p>{cur_card()}</div><div><p class="cp-head"><span>今天但最近 20 分钟没数据</span></p>{cur_card("stale")}</div><div><p class="cp-head"><span>看以前的日期</span></p>{cur_card("past")}</div></div>
<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:28px;align-items:start"><div><p class="cp-head"><span>日期选择：只能选有数据的日子；前一天 / 后一天跳到上一个、下一个有数据的日子</span></p>{datebar()}<div style="margin-top:8px">{cal()}</div></div>
<div style="display:grid;gap:14px"><p class="cp-head" style="margin:0"><span>未指定本人手机：顶部提示，通勤和房间显示未知</span></p><div class="cp-banner">{IC["alert"]}<span>还没指定本人手机，家里的部分记为未知。</span><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">去设置里选择</a></div>{stats(True)}
<p class="cp-head" style="margin:8px 0 0"><span>加载 · 出错 · 没有这一天的数据</span></p><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px"><div class="box cp-pageload" style="min-height:120px">{IC["loader"]}正在读取今天…</div><div class="box" style="display:grid;gap:10px;align-content:center"><b>数据暂不可用</b><span class="cp-help">请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm" style="justify-self:start">重试</button></div><div class="cp-empty"><b>这一天没有数据</b>家中设备和工作机都没上报。</div></div></div></div></div>'''

CATS = [("AI 编程", "#2E6DB4", 156, 68, "比上周 +1:10"), ("AI 对话", "#7FA3DA", 0, 0, "与上周相同"), ("工作沟通", "#E08A2E", 46, 14, "−0:12"), ("会议", "#9A5A1C", 44, 13, "+0:44"), ("文档", "#8A63B8", 0, 0, "与上周相同"),
        ("浏览", "#3BA39B", 38, 11, "+0:05"), ("私人", "#C7B27A", 0, 0, "与上周相同"), ("其他", "#B5B1A6", 0, 0, "与上周相同")]
def work(week=False, phone=False):
    scale = 5 if week else 1
    rows = "".join(f'<div class="catrow"><span>{n}</span><div class="t"><i style="width:{p}%;--c:{c}"></i></div><b style="font-weight:500;font-variant-numeric:tabular-nums">{(m * scale) // 60}:{(m * scale) % 60:02d} · {p}%</b><span class="d">{d}</span></div>' for n, c, m, p, d in CATS)
    rows += f'<div class="catrow"><span>离座</span><div class="t"><i style="width:3%;--c:var(--state-away)"></i></div><b style="font-weight:500">0:45 · 3%</b><span class="d">+0:04</span></div>'
    random.seed(7)
    hh = '<div class="hh"><span></span>' + "".join(f'<span style="text-align:center">{h:02d}</span>' for h in range(8, 20))
    for dname in (["工作日平均"] if not week else ["周一", "周二", "周三", "周四", "周五"]):
        hh += f'<span>{dname}</span>' + "".join(f'<i style="opacity:{v}"></i>' for v in [random.choice([.2, .45, .7, .95]) if h not in (12,) else .12 for h in range(8, 20)])
    hh += '</div>'
    focus = '<div style="position:relative;height:26px;background:var(--color-surface-2);border-radius:6px;margin-top:12px">' + "".join(f'<i style="position:absolute;left:{(s - 480) / 7.2}%;width:{(e - s) / 7.2}%;top:0;bottom:0;background:var(--state-desk);border-radius:5px"></i>' for s, e in [(548, 655), (785, 900), (915, 967)]) + '<span style="position:absolute;left:24.4%;top:-4px;bottom:-4px;width:2px;background:var(--color-action)"></span></div><div class="cp-axis"><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span></div>'
    inter = '<div style="display:flex;align-items:flex-end;gap:6px;height:80px;margin-top:12px">' + "".join(f'<i style="flex:1;height:{v * 10}%;background:{"var(--color-action)" if v >= 6 else "#E2DCD2"};border-radius:3px 3px 0 0"></i>' for v in [2, 3, 6, 4, 1, 2, 7, 3, 2, 1, 1, 0]) + '</div><div class="cp-axis"><span>08</span><span>12</span><span>16</span><span>19</span></div>'
    week_strip = ""
    if week:
        week_strip = '<div class="cp-week">' + "".join(f'<div class="{"on" if d == "周五" else ""}"><span>{d}</span><b>{w}</b>开会 {m}</div>' for d, w, m in [("周一", "9:10", "0:30"), ("周二", "8:40", "1:10"), ("周三", "9:05", "0:00"), ("周四", "8:55", "0:45"), ("周五", "6:14", "0:50")]) + '<div class="none"><span>周六</span><b>暂无</b></div><div class="none"><span>周日</span><b>—</b></div></div>'
    rng = "2026-11-02 至 11-06" if week else "2026-11-06"
    body = f'''<div class="hd"><div><h1>工作</h1><span class="cp-meta">{rng} · 公司网络且有键鼠操作的分钟</span></div><div class="r"><div class="cp-seg" role="group" aria-label="范围"><button aria-pressed="{"false" if week else "true"}">今天</button><button aria-pressed="{"true" if week else "false"}">本周</button></div></div></div>
{week_strip}
<div class="stat4">{"".join(f'<div class="cp-stat"><div class="cp-head"><span>{a}</span></div><div class="cp-stat-num" style="font-size:24px">{b}</div><div class="cp-delta">{c}</div></div>' for a, b, c in [("在公司", "41:30" if week else "6:14", "第一次到最后一次操作"), ("在电脑前", "39:11" if week else "5:24", "比上周 −4:50" if week else "比上周五 +0:32"), ("开会", "3:15" if week else "0:50", "开会占 8%" if week else "1 场"), ("专注", "7:50" if week else "2:26", "最长一段 5:30" if week else "最长一段 1:52"), ("被打断", "23 次" if week else "6 次", "沟通 App 为主")])}</div>
<section class="box"><h2>工作时间花在哪 <small>App 按设置里的八类归类 · 离座单独列出</small></h2>{rows}</section>
<div class="cols one-m" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
<section class="box"><h2>专注 <small>连续 ≥25 分钟，没切到沟通或私人 App</small></h2>{focus}<p class="cp-meta" style="margin:10px 0 0">橙线是一次被打断：10:55 开会。</p></section>
<section class="box"><h2>被打断 <small>橙色高于当天平均 1.5 倍</small></h2>{inter}</section></div>
<section class="box"><h2>哪些钟头最出活 <small>近 4 周工作日平均 · 08:00–19:00</small></h2><div style="margin-top:12px">{hh}</div></section>
<p class="cp-meta">口径：只算公司网络且有键鼠操作的分钟；离座 = 锁屏或无操作且夹在两段办公之间；开会 = 公司网络、电池供电、未锁屏。分钟采样，是近似值。</p>'''
    return shell(body, "工作", phone)

def work_states():
    nd = '<span style="color:var(--color-text-subtle)">暂无数据</span>'
    return f'''<div class="jw" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>出错：红框 + 重试，下面不再显示内容</span></p><div class="cp-banner err">{IC["error"]}<span>数据暂不可用，请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div></div>
<div><p class="cp-head"><span>加载：首次进入或切换范围</span></p><div class="box cp-pageload" style="min-height:120px">{IC["loader"]}正在读取工作数据…</div></div>
<div><p class="cp-head"><span>缺数据：每一块都写「暂无数据」，不画成 0</span></p><div class="box" style="display:grid;gap:10px"><div class="cp-kv"><span>在公司</span>{nd}</div><div class="cp-kv"><span>专注总时长</span>{nd}</div><div class="cp-kv"><span>用得最多的 App</span>{nd}</div><div class="cp-kv"><span>被打断</span>{nd}</div></div></div></div>'''

def trends(phone=False, d30=False):
    random.seed(3)
    days = ["10/30", "10/31", "11/1", "11/2", "11/3", "11/4", "11/5"]
    cols = ""
    for i, d in enumerate(days):
        we = d in ("11/1", "11/2")
        if d30 and i in (1, 2):
            cols += f'<div style="flex:1;display:grid;gap:4px"><div class="c" style="height:200px;background:{HATCH};border-radius:4px"></div><span class="cp-meta" style="text-align:center">{d}</span></div>'
            continue
        parts = [("sleep", 7.5), ("home", 4 if not we else 12), ("commute", 2.4 if not we else 0), ("desk", 9 if not we else 0), ("meeting", .8 if not we else 0), ("away", .3 if not we else 0), ("out", 0 if not we else 4.5)]
        tot = sum(v for _, v in parts); parts.append(("unknown", 24 - tot))
        seg = "".join(f'<i style="flex:{v};background:var(--state-{s})"></i>' for s, v in parts if v > 0)
        cols += f'<div style="flex:1;display:grid;gap:4px"><div class="c" style="height:200px;display:flex;flex-direction:column;border-radius:4px;overflow:hidden;gap:1px">{seg}</div><span class="cp-meta" style="text-align:center">{d}</span></div>'
    cols += f'<div style="flex:1;display:grid;gap:4px;border-left:1px dashed var(--color-border-strong);padding-left:10px"><div class="c" style="height:200px;display:flex;flex-direction:column;border-radius:4px;overflow:hidden;gap:1px"><i style="flex:7.6;background:var(--state-sleep)"></i><i style="flex:4.8;background:var(--state-home)"></i><i style="flex:2.5;background:var(--state-commute)"></i><i style="flex:8.2;background:var(--state-desk)"></i><i style="flex:.8;background:var(--state-meeting)"></i></div><span class="cp-meta" style="text-align:center">工作日均</span></div>'
    cmp = "".join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td><td style="color:{col}">{d}</td></tr>' for a, b, c, d, col in [("上班通勤（上限）", "1:12", "1:12", "持平", "var(--color-text-muted)"), ("下班通勤（上限）", "1:19", "1:13", "+6 分", "var(--color-warning)"), ("在电脑前", "8:58", "9:30", "−32 分", "var(--color-warning)"), ("开会", "0:39", "0:21", "+18 分", "var(--color-text)"), ("在家", "12:24", "12:10", "+14 分", "var(--color-text)")])
    rng = [("离家", "07:40", 30, 38, 34, "commute"), ("开始办公", "09:05", 37, 41, 38, "desk"), ("离开电脑", "18:10", 72, 80, 75, "away"), ("到家", "19:20", 77, 86, 80, "home")]
    rr = "".join(f'<div class="range"><span>{n}</span><div class="track" style="--c:var(--state-{c})"><i style="left:{a}%;width:{b - a}%"></i><b style="left:{m}%"></b></div><span class="cp-meta" style="text-align:right;color:var(--color-text)">平均 {t}</span></div>' for n, t, a, b, m, c in rng)
    note = f'<div class="cp-banner">{IC["alert"]}<span>这 30 天里只有 11 天有汇总，平均和比较都按实际天数算；没汇总的日子画成斜纹。</span></div>' if d30 else ""
    body = f'''<div class="hd"><div><h1>趋势</h1><span class="cp-meta">{"2026-10-07 至 11-05 · 实际有汇总 11 天" if d30 else "2026-10-30 至 11-05 · 实际有汇总 7 天"} · 今天还没过完，不进平均</span></div><div class="r"><div class="cp-seg" role="group" aria-label="范围"><button aria-pressed="{"false" if d30 else "true"}">近 7 天</button><button aria-pressed="{"true" if d30 else "false"}">近 30 天</button></div></div></div>
{note}<nav class="tabs-a hide-m" aria-label="跳到">{"".join(f'<a href="#">{t}</a>' for t in ["各状态时长", "本周和上周", "每天几点", "不一样的日子", "可信度"])}</nav>
<section class="box"><h2>每天各状态各占几小时 <small>每根柱子合计 24 小时 · 斜纹是未知 · 最右是工作日平均</small></h2><div class="bars24" style="margin-top:14px">{cols}</div><div style="margin-top:12px">{legend()}</div><p class="cp-meta" style="margin:10px 0 0">工作日平均：在家 12.4 小时，在电脑前 9.0 小时，通勤 2.5 小时，开会 0.8 小时。</p></section>
<div class="cols one-m" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
<section class="box"><h2>本周和上周 <small>工作日按日平均 · 本周 4 天 vs 上周同期 4 天</small></h2><div style="overflow-x:auto"><table class="cp-table" style="margin-top:8px"><thead><tr><th>指标</th><th>本周</th><th>上周</th><th>变化</th></tr></thead><tbody>{cmp}</tbody></table></div></section>
<section class="box"><h2>每天几点 <small>只算已过完的日子 · 点是平均，横线是范围</small></h2><div style="margin-top:6px">{rr}</div><div class="cp-axis" style="margin-left:92px;margin-right:132px"><span>06</span><span>12</span><span>18</span><span>24</span></div></section></div>
<div class="cols one-m" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
<section class="box"><h2>不一样的日子 <small>和同类日平均比</small></h2><div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">11 月 1 日 周六</div><span class="cp-meta">在外 4.5 小时，周六平均 0.8 小时</span></div><span class="cp-chip need">偏多</span></div><div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">11 月 4 日 周二</div><span class="cp-meta">00:40 才回卧室</span></div><span class="cp-chip">晚睡</span></div><p class="cp-meta" style="margin:8px 0 0">同类日样本不足 5 天的日子单列，不参与比较。</p></section>
<section class="box"><h2>可信度 <small>每天两路信号是否齐全</small></h2><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-top:12px;text-align:center;font-size:12px">{"".join(f'<div style="display:grid;gap:6px;justify-items:center"><span class="cp-tier {t}"><i></i><i></i><i></i></span><span class="cp-meta">{d}</span></div>' for d, t in zip(days, ["hi", "mid", "lo", "hi", "hi", "hi", "mid"]))}</div><p class="cp-meta" style="margin:12px 0 0">高：两路都在　中：只有一路　低：大段缺数据</p></section></div>'''
    return shell(body, "趋势", phone)

def trends_states():
    return f'''<div class="jw" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>出错：任一接口失败，图表全部不画</span></p><div class="cp-banner err">{IC["error"]}<span>数据暂不可用，请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div><p class="cp-head" style="margin-top:20px"><span>加载</span></p><div class="box cp-pageload" style="min-height:100px">{IC["loader"]}正在读取趋势…</div></div>
<div><p class="cp-head"><span>没有已汇总的工作日：工作日均柱消失</span></p><div class="box"><h2>每天各状态各占几小时</h2><div style="height:140px;border-radius:6px;background:{HATCH};margin-top:10px"></div><p class="cp-meta" style="margin:10px 0 0">还没有已汇总的工作日，暂时算不出平均。</p></div></div>
<div><p class="cp-head"><span>每天几点没有数据 · 不一样的日子为空</span></p><div class="box">{"".join(f'<div class="range"><span>{n}</span><div class="track"></div><span class="cp-meta" style="text-align:right">暂无数据</span></div>' for n in ["离家", "开始办公", "离开电脑", "到家"])}</div><div class="cp-empty" style="margin-top:12px"><b>没有不一样的日子</b>这段时间每天都和平时差不多。</div></div></div>'''

RULES = [("卧室", "sleep", "看到", "本人手机在线，房间标签是卧室。"), ("客厅", "home", "看到", "本人手机在线，房间标签是客厅。"), ("在家", "home", "看到", "本人手机在线但房间标签为空；或工作机连的是家里网络。"),
         ("在电脑前", "desk", "看到", "工作机连公司网络，最近几分钟有键鼠操作、未锁屏。"), ("开会", "meeting", "推断", "公司网络、电池供电且未锁屏。"), ("离座", "away", "推断", "公司网络，锁屏或无操作，且夹在两段办公之间。"),
         ("通勤", "commute", "推断", "手机最后一次在家到第一次在公司之间，不超过 2 小时；下班方向相反。"), ("在外", "out", "推断", "离开公司到回家之间超过 2 小时，家里扫描正常但没看到手机。"),
         ("其他网络", "unknown", "看到", "工作机连的是其他网络，显示网络名称。"), ("未知", None, "无数据", "两路都没有新鲜数据，或扫描中断。")]
def sources(phone=False):
    src = [("家中设备扫描", "新鲜 · 8 分钟前", "", "家中扫描器定期采集设备心跳，判断手机是否在家、在哪个房间。", "11 月 6 日 16:00"), ("工作机采样", "过期 · 25 分钟前", "stale", "工作机每分钟记录网络、电源与键鼠空闲，每 15 分钟上传一次，判断是否在电脑前。", "11 月 6 日 15:42")]
    sc = "".join(f'<section class="box"><h2>{n} <span class="cp-fresh {c}">{f}</span></h2><p class="desc">{d}</p><span class="cp-meta">最近：{t}</span></section>' for n, f, c, d, t in src)
    rl = "".join(f'<div class="rule"><span><i style="background:{("var(--state-" + c + ")") if c else HATCH}"></i>{n}</span><span class="ev{" inf" if e == "推断" else (" none" if e == "无数据" else "")}">{e}</span><span style="color:var(--color-text-muted)">{d}</span></div>' for n, c, e, d in RULES)
    body = f'''<div class="hd"><div><h1>来源与口径</h1><span class="cp-meta">两路只读信号，按北京时间解释。设备在线不等于人在。</span></div></div>
<div class="cols one-m" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">{sc}</div>
<section class="box"><h2>每个状态怎么判断 <small>看到 = 直接观察　推断 = 由前后状态推出</small></h2>{rl}</section>
<p class="cp-meta">已指定手机：示例手机 · App 分类：7 个</p>'''
    return shell(body, "来源", phone)

def settings(phone=False):
    cards = "".join(f'<div class="catcard"><b><i style="width:10px;height:10px;border-radius:3px;background:{c}"></i>{n}</b><span class="cp-meta">{a}</span></div>' for n, c, a in [("AI 编程", "#2E6DB4", "示例编辑器"), ("AI 对话", "#7FA3DA", "还没有归类的 App"), ("工作沟通", "#E08A2E", "示例沟通"), ("会议", "#9A5A1C", "示例会议"), ("文档", "#8A63B8", "还没有归类的 App"), ("浏览", "#3BA39B", "示例浏览器"), ("私人", "#C7B27A", "还没有归类的 App"), ("其他", "#B5B1A6", "还没有归类的 App")])
    rows = "".join(f'<tr><td><input class="cp-input" value="{a}" aria-label="App 名称" style="min-height:36px;font-size:14px"><div class="cp-meta" style="margin-top:4px">近 7 天 {t}</div></td><td style="width:180px"><div class="cp-select-wrap"><select class="cp-select" aria-label="类别" style="min-height:36px;font-size:14px"><option>{b}</option></select>{IC["chev"]}</div></td><td style="width:44px"><button class="cp-iconbtn" aria-label="删除 {a}">{IC["x"]}</button></td></tr>' for a, b, t in [("示例编辑器", "AI 编程", "26:12"), ("示例沟通", "工作沟通", "4:10"), ("示例会议", "会议", "3:15"), ("示例浏览器", "浏览", "2:40")])
    nets = f'<tr><td><input class="cp-input" value="示例网络标识" aria-label="网络标识" style="min-height:36px;font-size:14px"></td><td><input class="cp-input" value="咖啡馆" aria-label="显示名称" style="min-height:36px;font-size:14px"></td><td style="width:44px"><button class="cp-iconbtn" aria-label="删除">{IC["x"]}</button></td></tr>'
    body = f'''<div class="hd"><div><h1>设置</h1><span class="cp-meta">只影响本看板怎么解释数据，不会改动任何设备。</span></div></div>
<div class="cp-banner">{IC["alert"]}<span>有 28 天需要重算：10-09 至 11-05 是按旧设置算的。凌晨只自动重算最近 3 天。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重算这些日子</button></div>
<section class="box"><h2>App 归类 <small>工作沟通、私人会打断专注 · 保存后已有汇总标记为待重算</small></h2><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 18px" class="cols">{cards}</div>
<div style="overflow-x:auto"><table class="cp-table"><thead><tr><th>全部 App · 7 个</th><th>类别</th><th></th></tr></thead><tbody>{rows}</tbody></table></div><button class="cp-btn cp-btn-ghost cp-btn-sm" style="margin-top:10px">{IC["plus"]}添加 App</button></section>
<section class="box"><h2>其他网络改名 <small>只在本看板显示</small></h2><div style="overflow-x:auto"><table class="cp-table" style="margin-top:8px"><thead><tr><th>网络标识或名称</th><th>显示为</th><th></th></tr></thead><tbody>{nets}</tbody></table></div><button class="cp-btn cp-btn-ghost cp-btn-sm" style="margin-top:10px">{IC["plus"]}添加网络</button></section>
<div style="display:flex;gap:14px;align-items:center"><button class="cp-btn cp-btn-primary">保存设置</button><span class="cp-help" style="color:var(--color-success);display:flex;gap:4px;align-items:center">{I16("check")}已保存。已汇总的日子标记为需要重算，不会自动大批量重算。</span></div>'''
    return shell(body, "设置", phone)

def settings_states():
    return f'''<div class="jw" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>读取中 · 读取失败（只有红框 + 重试，表单不出现）</span></p><div class="box cp-pageload" style="min-height:90px;grid-auto-flow:column">{IC["loader"]}正在读取设置…</div><div class="cp-banner err" style="margin-top:12px">{IC["error"]}<span>设置暂不可用，请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div></div>
<div><p class="cp-head"><span>重算中 · 中断 · 完成</span></p><div style="display:grid;gap:12px"><div class="box" style="display:grid;gap:10px"><button class="cp-btn cp-btn-secondary cp-btn-sm" aria-busy="true" style="justify-self:start">{IC["loader"]}正在重算 14 / 28 天</button><div class="cp-progress"><i style="width:50%"></i></div></div><div class="cp-banner err">{IC["error"]}<span>重算中断（已完成 14 天），请稍后继续。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">继续</button></div><div class="cp-alert cp-alert-success">{IC["check"]}<div>已重算 28 天，上面的黄框会消失。</div></div></div></div>
<div><p class="cp-head"><span>保存中 · 校验失败（前端拦截，不发请求）· 保存失败</span></p><div style="display:grid;gap:12px"><button class="cp-btn cp-btn-primary" aria-busy="true" style="justify-self:start">{IC["loader"]}保存中</button><span class="cp-error">{I16("error")}App 归类有一行没填完整</span><span class="cp-error">{I16("error")}网络改名里「示例网络标识」重复了</span><div class="cp-banner err">{IC["error"]}<span>保存失败，数据暂不可用。</span></div></div></div></div>'''

def login():
    return f'''<div class="jw" style="min-height:760px;display:grid;grid-template-columns:1.1fr .9fr">
<div style="padding:72px 64px;display:grid;align-content:space-between;background:var(--color-surface);border-right:1px solid var(--color-border)"><div style="display:flex;gap:10px;align-items:center;font-weight:600"><img src="{LOGO}" alt="" style="width:26px">CodePi<span class="cp-meta" style="font-weight:400">作息</span></div>
<div><h1 style="font-size:48px;line-height:1.15;letter-spacing:-.03em;font-weight:600;margin:0">看清自己一天的<br>作息与工作节奏。</h1><p style="font-size:18px;line-height:1.6;color:var(--color-text-muted);max-width:480px;margin:20px 0 28px">把家中设备与工作机的只读信号，整理成一条可以回看的时间线。</p>{day24(now=0, h=18)}</div><span class="cp-meta">仅本人访问 · 私人作息分析 · 示意数据</span></div>
<div style="display:grid;place-items:center;padding:48px"><div class="box" style="width:380px;padding:32px;display:grid;gap:16px"><h2 style="font-size:22px;margin:0">进入作息</h2><p class="cp-help" style="margin:0;font-size:15px">用 CodePi 账户登录。</p><button class="cp-btn cp-btn-primary">统一登录</button><p class="cp-meta" style="margin:0;line-height:1.6">登录状态最多保留 7 天。退出会同时退出其他应用。</p></div></div></div>'''

DESK = [("J-Today", "今天", today, 1300), ("J-Today-States", "今天 · 状态、日期选择、未指定手机", today_states, 1100), ("J-Work-Day", "工作 · 今天", work, 1300), ("J-Work-Week", "工作 · 本周", lambda: work(True), 1450),
        ("J-Work-States", "工作 · 出错、加载、缺数据", work_states, 420), ("J-Trends", "趋势 · 近 7 天", trends, 1450), ("J-Trends-30", "趋势 · 近 30 天（不足 30 天）", lambda: trends(d30=True), 1500), ("J-Trends-States", "趋势 · 出错与缺数据", trends_states, 520),
        ("J-Sources", "来源与口径", sources, 1000), ("J-Settings", "设置", settings, 1200), ("J-Settings-States", "设置 · 状态", settings_states, 480), ("J-Login", "登录", login, 760)]
PH = [("J-Today-Phone", "今天 · 手机", lambda: today(True), 2000), ("J-Work-Phone", "工作 · 手机", lambda: work(False, True), 2200), ("J-Trends-Phone", "趋势 · 手机", lambda: trends(True), 2600),
      ("J-Sources-Phone", "来源 · 手机", lambda: sources(True), 1800), ("J-Settings-Phone", "设置 · 手机", lambda: settings(True), 2200)]
for n, t, fn, h in DESK:
    add(n, t, 1440, H.get(n, h), fn(), CSS)
for n, t, fn, h in PH:
    add(n, t, 390, H.get(n, h), fn(), CSS + PHONE)
print("jw ok")
