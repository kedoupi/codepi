import os, random
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, LOGO_BLOB
from gen2 import IC
from gen3 import CHEV_L, CHEV_R, I16, SPARK

LOGO = LOGO_BLOB
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HH", "").split(",") if x)}
CSS = """
.hl{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;position:relative}
.hl a:not(.cp-btn){color:inherit}
.hl .main{max-width:1200px;margin:0 auto;padding:28px 32px 56px;display:grid;gap:18px;align-content:start}
.hl .tabs{display:flex;gap:2px;margin-left:20px}
.hl .tabs a{padding:0 12px;min-height:56px;display:flex;align-items:center;color:var(--color-text-muted);text-decoration:none;font-size:14px;position:relative}
.hl .tabs a[aria-current="page"]{color:var(--color-text);font-weight:600}
.hl .tabs a[aria-current="page"]::after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;background:var(--color-action);border-radius:2px}
.hl .hd{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}
.hl .hd h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0}
.hl .hd .r{margin-left:auto;display:flex;gap:10px;align-items:center}
.hl .box{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:20px 24px}
.hl .box h2{font-size:17px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;letter-spacing:-.005em}
.hl .box h2 small{font-size:12px;font-weight:500;color:var(--color-text-subtle)}
.hl .desc{font-size:13px;color:var(--color-text-muted);margin:0 0 14px;line-height:1.55}
.hl .big{font-size:34px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.hl .big small{font-size:14px;font-weight:400;color:var(--color-text-muted);margin-left:4px}
.hl .tag{font-size:11px;padding:2px 7px;border-radius:5px;font-weight:600}
.hl .tag.lo{background:#FFF1E2;color:#7A4A12}.hl .tag.ok{background:#E6F2EC;color:#1D5E3E}.hl .tag.hi{background:#E8EEF8;color:#2F4F8F}.hl .tag.note{background:var(--color-surface-2);color:var(--color-text-muted)}
.hl .line{position:relative;height:120px}
.hl .heat30{display:grid;grid-template-columns:repeat(30,minmax(0,1fr));gap:3px}
.hl .heat30 i{aspect-ratio:1;border-radius:3px;background:var(--state-desk)}
.hl .heat30 i.miss{background:transparent;border:1px dashed var(--color-border-strong)}
.hl .heat30 i.sel{outline:2px solid var(--color-action);outline-offset:1px}
.hl .stages{display:grid;gap:5px}
.hl .stages > div{display:grid;grid-template-columns:44px 1fr;gap:8px;align-items:center;font-size:11px;color:var(--color-text-subtle)}
.hl .stages .tr{position:relative;height:18px;background:var(--color-surface-2);border-radius:4px}
.hl .stages .tr i{position:absolute;top:0;bottom:0;border-radius:3px}
.hl .night{display:grid;grid-template-columns:72px 1fr 84px;gap:10px;align-items:center;font-size:12px;min-height:28px}
.hl .night .tr{position:relative;height:12px;background:var(--color-surface-2);border-radius:6px}
.hl .night .tr i{position:absolute;top:0;bottom:0;border-radius:6px;background:var(--state-sleep)}
.hl .dots{position:relative;height:56px;border-bottom:1px solid var(--color-border)}
.hl .dots i{position:absolute;width:10px;height:10px;border-radius:50%;transform:translate(-50%,50%)}
.hl .mtable{width:100%;border-collapse:collapse;font-size:14px}
.hl .mtable th{text-align:left;font-size:12px;font-weight:500;color:var(--color-text-subtle);padding:0 10px 8px;border-bottom:1px solid var(--color-border)}
.hl .mtable td{padding:12px 10px;border-bottom:1px solid var(--color-border);font-variant-numeric:tabular-nums}
.hl .mtable tr.open td{background:var(--color-background)}
.hl .snav{display:grid;gap:2px;align-content:start;position:sticky;top:24px}
.hl .batch{display:grid;grid-template-columns:110px 80px minmax(0,1fr) 110px;gap:10px;align-items:center;font-size:13px;min-height:38px;border-top:1px solid var(--color-border)}
"""
PHONE = """
.hl .main{padding:16px 16px 96px;gap:14px}.hl .tabs{display:none}.hl .cp-appbar{padding:0 16px}.hl .hide-m{display:none!important}
.hl .cols,.hl .g3{grid-template-columns:minmax(0,1fr)!important}.hl .g3s{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important}
.hl .cp-tabbar{position:absolute;left:0;right:0;bottom:0}
.hl .hd h1{font-size:22px}.hl .big{font-size:26px}
.hl .heat30{grid-template-columns:repeat(15,minmax(0,1fr))}
.hl .night{grid-template-columns:52px 1fr 64px}
.hl .mtable th:nth-child(5),.hl .mtable td:nth-child(5){display:none}
.hl .setgrid{grid-template-columns:minmax(0,1fr)!important}.hl .snav{display:none}
.hl .batch{grid-template-columns:90px 1fr 80px}.hl .batch span:nth-child(3){display:none}
"""
TABS = ["概览", "睡眠", "近 7 天解读", "对比", "设置"]
def shell(body, cur, phone=False, ai=True):
    tabs = '<nav class="tabs" aria-label="健康">' + "".join(f'<a href="#" {"aria-current=page" if t == cur else ""}>{t}</a>' for t in TABS) + '</nav>'
    aib = f'<button class="cp-btn cp-btn-secondary cp-btn-sm hide-m">{SPARK}AI 解读</button>' if ai else ""
    bar = f'<header class="cp-appbar"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi<small>健康</small></a>{tabs}<div class="right"><span class="cp-chip hide-m">示意数据</span>{aib}<button class="cp-btn cp-btn-ghost cp-btn-sm" aria-label="账号菜单" style="padding:0 6px"><span class="cp-avatar">小</span></button></div></header>'
    tb = ('<nav class="cp-tabbar" aria-label="底部导航" style="grid-template-columns:repeat(5,1fr)">' + "".join(f'<a href="#" {"aria-current=page" if t == cur else ""}>{t.replace("近 7 天解读", "7 天")}</a>' for t in TABS) + '</nav>') if phone else ""
    return f'<div class="hl">{bar}<main class="main">{body}</main>{tb}</div>'

def spark_line(vals, lo=None, hi=None, band=None, w=600, h=120, col="var(--color-text)", dash_avg=None, gaps=()):
    mn, mx = min(v for v in vals if v is not None), max(v for v in vals if v is not None)
    if lo is not None: mn = lo
    if hi is not None: mx = hi
    n = len(vals)
    X = lambda i: 8 + i * (w - 16) / (n - 1)
    Y = lambda v: h - 10 - (v - mn) / (mx - mn) * (h - 24)
    parts = []
    if band:
        parts.append(f'<rect x="0" y="{Y(band[1]):.1f}" width="{w}" height="{Y(band[0]) - Y(band[1]):.1f}" fill="#E6F2EC"/>')
    if dash_avg is not None:
        parts.append(f'<line x1="0" x2="{w}" y1="{Y(dash_avg):.1f}" y2="{Y(dash_avg):.1f}" stroke="var(--color-text-subtle)" stroke-dasharray="4 4"/>')
    seg = []
    for i, v in enumerate(vals):
        if v is None:
            if len(seg) > 1: parts.append('<polyline fill="none" stroke="' + col + '" stroke-width="1.75" points="' + " ".join(seg) + '"/>')
            seg = []; continue
        seg.append(f"{X(i):.1f},{Y(v):.1f}")
    if len(seg) > 1: parts.append('<polyline fill="none" stroke="' + col + '" stroke-width="1.75" points="' + " ".join(seg) + '"/>')
    for i, v in enumerate(vals):
        if v is not None: parts.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="{4 if i == n - 1 else 2.5}" fill="{"var(--color-action)" if i == n - 1 else col}"/>')
    return f'<svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" style="width:100%;height:{h}px;display:block" aria-hidden="true">{"".join(parts)}</svg>'

def bars(vals, h=100, avg=None, on_last=True, col="#D6CEC2"):
    mx = max(v for v in vals if v)
    b = "".join(f'<i style="flex:1;height:{(v / mx * 100) if v else 0}%;background:{"var(--color-action)" if (on_last and i == len(vals) - 1) else col};border-radius:3px 3px 0 0{";border:1px dashed var(--color-border-strong);height:14px;background:transparent" if not v else ""}"></i>' for i, v in enumerate(vals))
    a = f'<span style="position:absolute;left:0;right:0;bottom:{avg / mx * 100}%;border-top:1px dashed var(--color-text-subtle)"></span>' if avg else ""
    return f'<div style="position:relative;display:flex;align-items:flex-end;gap:4px;height:{h}px;border-bottom:1px solid var(--color-border)">{b}{a}</div>'

def sync_compact(kind="done"):
    k = {"done": ("cp-fresh", "本次自动同步已完成", "官方评分 · 已完成 · 详细记录 30 / 30 批次"),
         "run": ("cp-fresh stale", "后台正在更新数据", "官方评分 · 等待后台刷新 · 详细记录 12 / 30 批次，18 批待执行"),
         "limited": ("cp-fresh stale", "可获取数据已更新", "2 类数据因 Oura 上游访问受限暂停；已有记录保留，其他继续更新"),
         "partial": ("cp-fresh stale", "本次自动同步部分完成", "详细记录 24 / 30 批次 · 4 批待执行 · 2 批失败"),
         "fail": ("cp-fresh dead", "授权失效，自动同步暂停", "重新连接 Oura 后继续；已有记录保留")}[kind]
    return f'<div class="box" style="display:flex;align-items:center;gap:16px;padding:12px 18px;flex-wrap:wrap"><span class="{k[0]}" style="font-size:13px;color:var(--color-text);font-weight:600">{k[1]}</span><span class="cp-meta">{k[2]}</span><a href="#" class="cp-meta" style="margin-left:auto;color:var(--color-action-hover);font-weight:600">查看同步详情 →</a></div>'

def score_cards(empty=False):
    rows = [("睡眠", 72, -6, "lo", "偏低"), ("准备度", 70, -1, "ok", "平稳"), ("活动", 90, 8, "hi", "偏高")]
    out = ""
    for n, v, d, c, t in rows:
        if empty:
            out += f'<div class="box"><div class="cp-head"><span>{n} · Oura 评分</span></div><div class="big" style="color:var(--color-text-subtle)">—</div><div class="cp-delta">记录不足，暂不比较</div></div>'
        else:
            out += f'<div class="box"><div class="cp-head"><span>{n} · Oura 评分</span><span class="tag {c}">{t}</span></div><div class="big">{v}</div><div class="cp-delta">{"+" if d > 0 else "−"}{abs(d)} 较前 7 天均值</div>{spark_line([74, 79, 77, 80, 76, 78, v] if n == "睡眠" else ([71, 70, 72, 69, 71, 70, v] if n == "准备度" else [80, 84, 78, 82, 85, 81, v]), h=44)}</div>'
    return f'<div class="g3 g3s" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">{out}</div>'

def overview(phone=False):
    random.seed(5)
    heat = "".join(f'<i class="{"miss" if i in (6, 7) else ""}{" sel" if i == 22 else ""}" style="opacity:{.35 + random.random() * .65:.2f}"></i>' for i in range(30))
    body = f'''<div class="hd"><div><span class="cp-meta">2026 年 11 月 6 日 星期五 · 北京时间</span><h1 style="margin-top:6px">今天，从自己的节奏开始。</h1></div><div class="r"><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">我的每日简报</a></div></div>
{sync_compact()}
<section class="box" style="background:var(--brand-soft);border-color:#F3D3C2"><div class="cp-head" style="margin-bottom:6px"><span style="color:var(--color-text)">记录中的变化</span><a href="#" class="cp-meta" style="color:var(--color-action-hover);font-weight:600">查看评分依据</a></div><h2 style="font-size:20px">睡眠评分低于近期均值</h2><p class="desc" style="margin:4px 0 0;color:var(--color-text)">11 月 6 日睡眠较此前 7 天均值 −6 分，基于 7 天有效记录。</p></section>
{score_cards()}<p class="cp-meta" style="margin:-6px 0 0">评分日期 2026-11-06 · 评分与差值用于记录变化，不作健康判断。</p>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
<section class="box"><h2>主睡眠 HRV <a href="#" class="cp-meta" style="color:var(--color-action-hover);font-weight:600">查看睡眠</a></h2><p class="desc">记录每晚的变化，与自己的历史对照。绿色带是个人参考范围（需 14 天以上有效记录）。</p><div class="big">30<small>ms · 11 月 6 日</small></div>{spark_line([28, 31, 27, 33, 29, None, 32, 30, 34, 31, 28, 33, 29, 30], lo=20, hi=40, band=(27, 34))}<details style="margin-top:8px"><summary class="cp-meta" style="cursor:pointer">查看数据表</summary></details></section>
<section class="box"><h2>睡眠，是否回到你的节奏？ <span class="cp-seg" role="group" aria-label="范围"><button aria-pressed="false">7 天</button><button aria-pressed="true">14 天</button><button aria-pressed="false">30 天</button></span></h2><div class="big" style="margin-top:8px">6<small>小时</small> 40<small>分 · 11 月 6 日</small></div><div style="margin-top:12px">{bars([7.2, 6.8, 7.5, 0, 7.1, 6.5, 7.8, 7.0, 6.9, 7.3, 6.2, 7.4, 6.6, 6.7], avg=7.0)}</div><p class="cp-meta" style="margin:8px 0 0">近 14 天每日总睡眠，主睡眠、小睡与休息合并；空缺不是 0。虚线为均值。</p></section></div>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
<section class="box"><h2>活动的起伏</h2><div class="big">6,420<small>步 · 11 月 6 日</small></div><div style="margin-top:12px">{bars([8200, 7600, 9100, 5400, 7000, 6800, 6420], avg=7200, h=80)}</div></section>
<section class="box"><h2>过去 30 天的准备度 <small>浅 → 深：评分低 → 高 · 空框：缺失</small></h2><div class="heat30" style="margin-top:14px">{heat}</div><div class="cp-axis"><span>10-08</span><span>11-06</span></div><div class="cp-kv" style="margin-top:10px"><span>10 月 30 日 · 准备度</span><b>78 / 100</b></div></section></div>
<details class="box"><summary style="cursor:pointer;font-weight:600;font-size:15px">展开评分趋势与数据依据</summary></details>
<div class="box" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:14px 20px"><span class="cp-meta">Oura 官方评分 · 90 / 90 天有记录 · 同步于 11 月 6 日 07:13</span><button class="cp-btn cp-btn-secondary cp-btn-sm" style="margin-left:auto">{SPARK}AI 分析 · 30 天</button><button class="cp-btn cp-btn-ghost cp-btn-sm">更新数据</button></div>
<p class="cp-meta">供个人观察与记录，不用于诊断。</p>'''
    return shell(body, "概览", phone)

def overview_empty():
    body = f'''<div class="hd"><div><span class="cp-meta">2026 年 11 月 6 日 星期五 · 北京时间</span><h1 style="margin-top:6px">今天，从自己的节奏开始。</h1></div></div>
<section class="box"><h2>从第一份记录，开始认识自己的节奏</h2><p class="desc" style="margin:0">积累至少 3 天有效评分后，展示与此前一周的比较。</p></section>{score_cards(True)}
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">{"".join(f'<div class="cp-empty"><b>{a}</b>{b}<a class="cp-btn cp-btn-ghost cp-btn-sm" href="#" style="margin-top:6px">{c}</a></div>' for a, b, c in [("— ms · 等待主睡眠记录", "近 30 天还没有保存的详细睡眠记录。", "查看睡眠与同步"), ("— · 暂无睡眠记录", "已检查近 30 天，暂无睡眠记录。空缺不是 0。", "睡眠详情"), ("— 步 · 暂无活动记录", "连接后会每天同步步数与活动。", "数据设置")])}</div>'''
    return shell(body, "概览")

def landing(phone=False):
    feats = "".join(f'<div class="box" style="display:grid;gap:8px"><b style="font-size:17px">{a}</b><p class="desc" style="margin:0">{b}</p></div>' for a, b in [("睡眠", "从每一晚的时长与节律，认识自己的休息。"), ("恢复", "结合准备度与心率变异性，回顾身体的变化。"), ("活动", "把步数与活动放回日常，观察长期的节奏。")])
    return f'''<div class="hl"><header class="cp-appbar"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi<small>健康</small></a><div class="right"><div class="cp-seg hide-m" role="group" aria-label="语言"><button aria-pressed="true">跟随系统</button><button aria-pressed="false">中文</button><button aria-pressed="false">English</button></div><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">个人空间</a></div></header>
<main class="main" style="padding-top:80px"><div class="cols" style="display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center"><div><h1 style="font-size:52px;line-height:1.12;letter-spacing:-.03em;font-weight:600;margin:0">照顾好自己，<br>从理解每天开始。</h1><p style="font-size:18px;line-height:1.65;color:var(--color-text-muted);margin:20px 0 28px;max-width:480px">这里是我的个人健康空间。把睡眠、恢复与活动的记录放在一起，慢慢认识自己的长期变化。</p><div class="row"><a class="cp-btn cp-btn-primary" href="#">登录健康空间</a><a class="cp-btn cp-btn-secondary" href="#">关于这个应用</a></div><p class="cp-meta" style="margin-top:14px">使用 CodePi 统一账号，健康记录仅本人可见。</p></div>
<div class="box" style="display:grid;gap:12px"><span class="cp-meta">示意 · 登录后才显示个人记录</span>{spark_line([72, 75, 71, 78, 74, 77, 80], h=110)}<div class="g3 g3s" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">{"".join(f'<div><span class="cp-meta">{a}</span><div style="font-size:22px;font-weight:600">{b}</div></div>' for a, b in [("睡眠", "—"), ("准备度", "—"), ("活动", "—")])}</div></div></div>
<div class="g3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:56px">{feats}</div>
<section class="box" style="margin-top:24px;display:grid;gap:8px"><h2>记录可以积累，生活慢慢连接。</h2><p class="desc" style="margin:0">日常看板、睡眠回顾、阶段对比与 AI 解读，沿用同一份记录。需要时可以授权 AI 应用只读访问，并随时撤销。</p></section>
<p class="cp-meta">数据来源：Oura · 个人记录与回顾 · 供个人观察，不用于诊断。</p></main></div>'''

def landing_states():
    return f'''<div class="hl" style="padding:40px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start">
<div style="display:grid;gap:12px"><p class="cp-head" style="margin:0"><span>A 启动加载 · B 登录失败（主按钮下方）</span></p><div class="box cp-pageload" style="min-height:90px">{IC["loader"]}正在加载…</div>{"".join(f'<div class="cp-banner err">{IC["error"]}<span>{t}</span></div>' for t in ["登录未完成或链接已过期，请重新登录。", "登录服务暂时不可用，请稍后重新登录。", "无法连接 API，请稍后重试。"])}
<p class="cp-head" style="margin:8px 0 0"><span>C 全局提示条（所有已登录页顶部共用）</span></p><div class="cp-banner err">{IC["error"]}<span>服务暂时不可用，请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div><div class="cp-banner">{IC["alert"]}<span>Oura 返回的账号标识与已有连接不同。若仍用原账号，可在设置的「账号」中修复连接。</span></div></div>
<div><p class="cp-head"><span>D 已登录但还没连接 Oura（没有任何记录时，各页都显示这一页；设置页可进）</span></p><div class="box" style="padding:48px;display:grid;gap:14px;justify-items:start"><span class="cp-chip">健康</span><h2 style="font-size:28px">连接你的 Oura</h2><p class="desc" style="margin:0;font-size:15px">网站账号已登录。连接 Oura 后即可同步健康记录。</p><div class="row"><a class="cp-btn cp-btn-primary" href="#">连接 Oura</a><a class="cp-btn cp-btn-secondary" href="#">设置</a><a class="cp-btn cp-btn-ghost" href="#">退出登录</a></div></div></div></div>'''

def sync_states():
    return '<div class="hl" style="padding:40px;display:grid;gap:12px">' + "".join(f'<p class="cp-head" style="margin:8px 0 0"><span>{t}</span></p>{sync_compact(k)}' for t, k in [("A 进行中", "run"), ("B 已完成", "done"), ("C 已完成，但部分类别因 Oura 访问受限暂停", "limited"), ("D 部分完成（有失败批次）", "partial"), ("E 失败：授权失效，自动同步暂停", "fail")]) + '</div>'

def stages_block():
    st = [("清醒", "var(--state-unknown)", [(0, 2), (41, 2), (92, 6)]), ("REM", "#7FA3DA", [(16, 7), (49, 9), (80, 10)]), ("浅睡", "#4E73B8", [(2, 14), (25, 16), (58, 20)]), ("深睡", "#2F4F8F", [(7, 9), (31, 10), (66, 8)])]
    return '<div class="stages">' + "".join(f'<div><span>{n}</span><div class="tr">' + "".join(f'<i style="left:{s}%;width:{w}%;background:{c}"></i>' for s, w in seg) + '</div></div>' for n, c, seg in st) + '</div><div class="cp-axis" style="margin-left:52px"><span>00:10</span><span>02:00</span><span>04:00</span><span>06:00</span><span>07:30</span></div>'

def sleep(phone=False):
    nights = [("10/31 周五", None, None), ("11/01 周六", 23.5, 7.8), ("11/02 周日", 0.2, 8.1), ("11/03 周一", 23.8, 7.2), ("11/04 周二", 0.7, 7.0), ("11/05 周三", 23.9, 7.1), ("11/06 周四", 0.17, 7.5)]
    def pos(t): return ((t - 22) % 24) / 10 * 100
    def nrow(d, s, e):
        bar = "" if s is None else '<i style="left:%.0f%%;width:%.0f%%"></i>' % (pos(s), pos(e) - pos(s))
        dur = "无主睡眠记录" if s is None else "%d 小时 %02d 分" % divmod(int(((e - s) % 24) * 60), 60)
        return f'<div class="night"><span>{d}</span><div class="tr">{bar}</div><span class="cp-meta" style="text-align:right">{dur}</span></div>'
    nr = "".join(nrow(*x) for x in nights)
    met = "".join(f'<div><span class="cp-meta">{a}</span><div style="font-size:20px;font-weight:600;font-variant-numeric:tabular-nums">{b}</div></div>' for a, b in [("实际睡眠", "4 小时 44 分"), ("卧床", "5 小时 14 分"), ("入睡用时", "8 分钟"), ("清醒时长", "31 分钟"), ("睡眠效率", "90%")])
    comp = "".join(f'<div class="cp-hbar" style="grid-template-columns:52px 1fr 92px"><span>{n}</span><div class="t"><i style="width:{p}%;--c:{c}"></i></div><b>{t}</b></div>' for n, p, c, t in [("深睡", 16, "#2F4F8F", "0 小时 44 分"), ("REM", 19, "#7FA3DA", "0 小时 54 分"), ("浅睡", 66, "#4E73B8", "3 小时 07 分"), ("清醒", 11, "var(--state-unknown)", "0 小时 31 分")])
    body = f'''<div class="hd"><div><h1>睡眠与恢复</h1></div><div class="r"><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前一晚">{CHEV_L}</button><button class="cp-btn cp-btn-ghost cp-btn-sm" style="font-size:16px;font-weight:600">11 月 6 日 {I16("chev")}</button><button class="cp-iconbtn" aria-label="后一晚" aria-disabled="true">{CHEV_R}</button></div></div></div>
<section class="box"><span class="cp-meta">主睡眠 · 00:10 — 07:30 · 较此前 9 晚主睡眠中位数</span><h2 style="font-size:24px;margin-top:6px">比个人近期水平少睡了 38 分钟</h2><div class="g3s" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:16px">{met}</div></section>
<section class="box"><h2>这一晚的睡眠 <a href="#" class="cp-meta" style="color:var(--color-action-hover);font-weight:600">查看数据 →</a></h2><div style="margin-top:14px">{stages_block()}</div>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px"><div><div class="cp-head"><span>夜间心率</span><span>平均 71 · 最低 65 bpm</span></div>{spark_line([74, 70, 68, 66, 65, 67, 69, 71, 73], h=70)}</div><div><div class="cp-head"><span>夜间 HRV</span><span>平均 26 ms</span></div>{spark_line([22, 25, 28, 30, 27, 26, 24, 25, 23], h=70, col="var(--state-desk)")}</div></div></section>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start"><section class="box"><h2>睡眠组成</h2><div style="display:grid;gap:4px;margin-top:10px">{comp}</div></section>
<section class="box"><h2>与自己的历史对照</h2><div class="big" style="margin-top:6px">26<small>ms · 主睡眠 HRV</small></div><p class="desc" style="margin:8px 0 0">历史不足 14 晚，先积累更多记录再形成个人参考范围。</p></section></div>
<section class="box"><h2>最近 7 晚的作息 <span style="display:flex;gap:10px;align-items:center"><span class="cp-seg" role="group" aria-label="范围"><button aria-pressed="true">7 天</button><button aria-pressed="false">30 天</button></span><a href="#" class="cp-meta hide-m" style="color:var(--color-action-hover);font-weight:600">查看 7 天解读 →</a></span></h2><p class="desc">把睡眠时长放回入睡与起床的时间里。</p>{nr}<div class="cp-axis" style="margin:0 94px 0 82px"><span>22:00</span><span>02:00</span><span>06:00</span><span>08:00</span></div></section>'''
    return shell(body, "睡眠", phone)

def sleep_states():
    return f'''<div class="hl" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div style="grid-column:span 3"><p class="cp-head"><span>A 这一天只有小睡或休息（顶部提示，其余照常）</span></p><div class="cp-banner">{IC["info"]}<span>这一天 Oura 没有返回主睡眠记录；下面是小睡或休息时段，不代表夜间睡眠。主睡眠 HRV 对照不含小睡。</span></div></div>
<div><p class="cp-head"><span>B 加载 · C 读取失败</span></p><div class="box cp-pageload" style="min-height:80px;grid-auto-flow:column">{IC["loader"]}正在读取详细睡眠…</div><div class="box" style="margin-top:12px;display:grid;gap:8px"><b>暂时无法读取睡眠</b><span class="cp-help">服务暂时不可用，请稍后重试。</span><button class="cp-btn cp-btn-secondary cp-btn-sm" style="justify-self:start">重试</button></div></div>
<div><p class="cp-head"><span>D 已检查近 30 天，Oura 没有返回 · E 还没采集</span></p><div class="cp-empty"><b>近 30 天暂无睡眠记录</b>已检查这个区间，Oura 没有返回记录。<a class="cp-btn cp-btn-secondary cp-btn-sm" href="#" style="margin-top:6px">前往数据设置</a></div><div class="cp-empty" style="margin-top:12px"><b>还没有保存的睡眠细节</b>点「同步近 30 天」开始采集，或在数据设置里补齐最近 90 天。<button class="cp-btn cp-btn-primary cp-btn-sm" style="margin-top:6px">同步近 30 天</button></div></div>
<div><p class="cp-head"><span>F 选中日期没有记录 · 非个人账号</span></p><div class="cp-empty"><b>这一天没有保存的睡眠记录</b>请选择其他日期。</div><div class="cp-alert" style="margin-top:12px">{IC["info"]}<div>详细睡眠目前仅向个人工作区开放。</div></div></div></div>'''

def weekly(phone=False):
    def card(t, title, val, prev, rec, chart, link):
        return f'<section class="box" style="display:grid;gap:10px;align-content:start"><span class="cp-meta">{t}</span><h2 style="font-size:18px">{title}</h2><div style="display:flex;gap:16px;align-items:baseline"><div class="big" style="font-size:28px">{val}</div><span class="cp-meta">此前 {prev}</span></div><span class="cp-meta">{rec}</span>{chart}<a href="#" class="cp-meta" style="color:var(--color-action-hover);font-weight:600">{link} →</a></section>'
    tags = "".join(f'<div style="display:grid;gap:6px;justify-items:center;font-size:12px"><span class="cp-meta">{d}</span><span class="cp-chip">{t}</span></div>' for d, t in [("10/31 六", "聚会"), ("11/01 日", "—"), ("11/02 一", "—"), ("11/03 二", "加班"), ("11/04 三", "—"), ("11/05 四", "运动"), ("11/06 五", "—")])
    body = f'''<div class="hd"><div><h1>7 天解读</h1><span class="cp-meta">对照 10/24 — 10/30 · 北京时间</span></div><div class="r"><div class="cp-datebar"><button class="cp-iconbtn" aria-label="上一周">{CHEV_L}</button><span style="font-weight:600;padding:0 8px">10/31 — 11/06</span><button class="cp-iconbtn" aria-label="下一周" aria-disabled="true">{CHEV_R}</button></div></div></div>
<section class="box" style="background:var(--brand-soft);border-color:#F3D3C2"><h2 style="font-size:22px">平均每晚少睡了 48 分钟，夜间 HRV 有所上移</h2><p class="desc" style="margin:6px 0 0;color:var(--color-text)">变化集中在哪几天，可以从记录里继续往下看。睡眠 6/7 晚 · HRV 6/7 晚 · 压力与恢复 6/7 天</p><a href="#" class="cp-btn cp-btn-secondary cp-btn-sm" style="margin-top:12px">打开完整对比</a></section>
<div class="g3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
{card("睡眠", "平均每晚少睡了 48 分钟", "6:14", "7:02", "有效记录 6/7 晚 · 对照 7/7 晚", bars([6.2, 7.6, 5.8, 7.4, 6.0, 0, 5.9], avg=7.0, on_last=False, h=80), "查看这几晚的睡眠")}
{card("夜间恢复记录", "主睡眠 HRV 均值上移 4 ms", "33 ms", "29 ms", "有效记录 6/7 晚 · 对照 7/7 晚", spark_line([30, 34, 31, None, 35, 33, 34], h=80, dash_avg=29, col="var(--state-desk)"), "查看逐晚记录")}
{card("压力与恢复", "有记录日，恢复时长增加 7 分钟", "48 分/日", "41 分/日", "有效记录 6/7 天 · 对照 7/7 天", bars([40, 52, 45, 0, 50, 47, 55], avg=41, on_last=False, h=80, col="#9FD0BF"), "查看对比")}</div>
<section class="box"><h2>这七天里的生活记录 <small>生活记录提供时间线索，不表示因果关系</small></h2><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:12px">{tags}</div></section>
<section class="box"><h2>继续观察</h2><p class="desc" style="margin:0">11/01、11/03 两晚较长；继续记录，观察每天的起伏。</p></section>'''
    return shell(body, "近 7 天解读", phone)

def weekly_states():
    return f'''<div class="hl" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>A 加载 · B 读取失败（授权失效时多一个重新连接）</span></p><div class="box cp-pageload" style="min-height:70px;grid-auto-flow:column">{IC["loader"]}正在加载…</div><div class="cp-banner err" style="margin-top:12px">{IC["error"]}<span>Oura 授权已失效，请重新连接。</span></div><div class="row" style="margin-top:10px"><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button><button class="cp-btn cp-btn-primary cp-btn-sm">重新连接 Oura</button></div></div>
<div><p class="cp-head"><span>C 数据不足 · E 记录还在积累</span></p><div class="cp-empty"><b>数据不足，暂无解读</b>至少 3 天有效记录后再来看。</div><section class="box" style="margin-top:12px"><h2>记录还在积累，先看已有的变化</h2><p class="desc" style="margin:4px 0 0">睡眠记录尚不足以比较 · 主睡眠 HRV 尚不足以比较 · 恢复记录尚不足以比较</p></section></div>
<div><p class="cp-head"><span>D 非个人账号：只有摘要 · F 没有生活标签</span></p><section class="box"><h2>这一周的记录摘要</h2><div class="cp-kv"><span>睡眠评分均值</span><b>72</b></div><div class="cp-kv"><span>活动评分均值</span><b>88</b></div><p class="cp-meta" style="margin:8px 0 0">当前账号可查看摘要；完整建议需要个人账号权限。</p></section><div class="cp-empty" style="margin-top:12px"><b>这七天还没有保存生活标签</b>生活记录只提供时间线索。</div></div></div>'''

def dots_row(cur, ref, lo, hi):
    X = lambda v: (v - lo) / (hi - lo) * 100
    c = "".join(f'<i style="left:{X(v):.1f}%;bottom:30px;background:var(--color-action)"></i>' for v in cur)
    r = "".join(f'<i style="left:{X(v):.1f}%;bottom:8px;background:#B9B1A6"></i>' for v in ref)
    return f'<div class="dots">{c}{r}</div>'

def compare(phone=False, cat="睡眠与恢复"):
    rows = {"睡眠与恢复": [("主睡眠时长", "6 小时 14 分", "—", "样本不足", "6/7 晚 · 0/7 晚", True), ("睡眠效率", "90.8%", "—", "样本不足", "6/7 · 0/7", False), ("入睡用时", "18.3 分钟", "—", "样本不足", "6/7 · 0/7", False), ("主睡眠 HRV", "33 ms", "29 ms", "+4 ms", "6/7 · 7/7", False)],
            "活动": [("日均步数", "6,200 步", "7,400 步", "−16%", "7/7 天 · 7/7 天", True)], "压力": [("日间压力时长", "120 分钟", "95 分钟", "+25 分钟", "6/7 · 7/7", False), ("恢复时长", "48 分钟", "41 分钟", "+7 分钟", "6/7 · 7/7", False)]}[cat]
    tr = "".join(f'<tr class="{"open" if o else ""}"><td><b style="font-weight:500">{a}</b></td><td>{b}</td><td>{c}</td><td style="color:{"var(--color-text-subtle)" if d == "样本不足" else "var(--color-text)"}">{d}</td><td class="cp-meta">{e}</td><td style="width:24px">{"⌄" if o else "›"}</td></tr>' for a, b, c, d, e, o in rows)
    det_cur, det_ref, lo, hi, unit = ([6.2, 7.6, 5.8, 7.4, 6.0, 5.9], [], 4.1, 7.9, "小时") if cat != "活动" else ([5200, 6400, 7000, 5800, 6900, 6100, 6000], [7200, 7600, 8100, 6800, 7400, 7900, 6900], 4500, 8200, "步")
    detail = f'''<div class="cols" style="display:grid;grid-template-columns:1.2fr 1fr;gap:20px;padding:16px 4px 4px"><div><div class="cp-head"><span>逐日记录 · 按区间第 1–7 天对齐</span></div>{spark_line(det_cur + ([None] if len(det_cur) < 7 else []), h=90)}<div class="cp-legend" style="margin-top:6px"><span style="--c:var(--color-text)">10/31 — 11/06</span><span style="--c:#B9B1A6">10/24 — 10/30</span></div></div>
<div><div class="cp-head"><span>两期的分布 · 每个点代表一天，缺失不补零</span></div>{dots_row(det_cur, det_ref, lo, hi)}<div class="cp-axis"><span>{lo:,}</span><span>{hi:,} {unit}</span></div><p class="cp-meta" style="margin:8px 0 0">{"样本不足时保留原值，暂停比较。11/03、11/01 两晚较长。" if cat != "活动" else "均值 −16%。"}</p>{"<a href=# class=cp-meta style=color:var(--color-action-hover);font-weight:600>查看对应睡眠 →</a>" if cat != "活动" else ""}</div></div>'''
    body = f'''<div class="hd"><div><h1>对比</h1><span class="cp-meta">把两个时间段放在一起，看清变化。</span></div><div class="r"><div class="cp-seg" role="group" aria-label="模式"><button aria-pressed="true">区间比较</button><button aria-pressed="false">个人历史参照</button></div></div></div>
<section class="box" style="display:flex;gap:20px;flex-wrap:wrap;align-items:center"><div><span class="cp-meta">当前区间</span><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前移">{CHEV_L}</button><b style="padding:0 6px">10/31 — 11/06</b><button class="cp-iconbtn" aria-label="后移" aria-disabled="true">{CHEV_R}</button></div></div><div><span class="cp-meta">对照区间</span><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前移">{CHEV_L}</button><b style="padding:0 6px">10/24 — 10/30</b><button class="cp-iconbtn" aria-label="后移">{CHEV_R}</button></div></div><div class="cp-seg" role="group" aria-label="长度"><button aria-pressed="true">7 天</button><button aria-pressed="false">30 天</button><button aria-pressed="false">自定义</button></div><span class="cp-meta" style="margin-left:auto">7 天对 7 天 · 日期不重叠 · 北京时间</span></section>
<section class="box"><div class="cp-tablist" role="tablist" style="margin:-6px 0 12px">{"".join(f'<button class="cp-tab" role="tab" aria-selected="{"true" if c == cat else "false"}">{c}</button>' for c in ["睡眠与恢复", "活动", "压力"])}</div>
<div style="overflow-x:auto"><table class="mtable"><thead><tr><th>指标</th><th>当前 10/31—11/06</th><th>对照 10/24—10/30</th><th>变化</th><th>有效记录</th><th></th></tr></thead><tbody>{tr}</tbody></table></div>
<div style="border-top:1px solid var(--color-border);margin-top:4px"><h2 style="font-size:15px;margin:14px 0 0">{rows[0][0]}：变化发生在哪几天？</h2>{detail}</div></section>'''
    return shell(body, "对比", phone)

def compare_more():
    return f'''<div class="hl" style="padding:40px;display:grid;gap:28px">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start"><div><p class="cp-head"><span>A 活动：展开日均步数（不带「查看对应睡眠」）</span></p>{compare(cat="活动").split('<main class="main">')[1].split('</main>')[0].split('<section class="box"><div class="cp-tablist"')[1].join(['<section class="box"><div class="cp-tablist"', '']) if False else ""}<section class="box">{_table_only("活动")}</section></div>
<div><p class="cp-head"><span>B 压力：两行都未展开</span></p><section class="box">{_table_only("压力")}</section>
<p class="cp-head" style="margin-top:20px"><span>C 个人历史参照：逐日与历史均值对照，没有对照区间</span></p><section class="box"><div class="cp-head"><span>主睡眠 HRV · 逐日记录与历史均值</span><span>均值 +2.3 ms</span></div>{spark_line([30, 34, 31, None, 35, 33, 34], h=90, dash_avg=31, col="var(--state-desk)")}<p class="cp-meta" style="margin:8px 0 0">缺失的一天不画点、断线；样本不足时只给文案，不给变化值。</p></section></div></div></div>'''

def _table_only(cat):
    html = compare(cat=cat)
    s = html.split('<div style="overflow-x:auto"><table class="mtable">')[1].split('</table></div>')[0]
    tabs = "".join(f'<button class="cp-tab" role="tab" aria-selected="{"true" if c == cat else "false"}">{c}</button>' for c in ["睡眠与恢复", "活动", "压力"])
    extra = ""
    if cat == "活动":
        extra = '<div style="border-top:1px solid var(--color-border)">' + html.split('变化发生在哪几天？</h2>')[1].split('</div></section>')[0] + '</div>'
    return f'<div class="cp-tablist" role="tablist" style="margin:-6px 0 12px">{tabs}</div><div style="overflow-x:auto"><table class="mtable">{s}</table></div>{extra}'

def settings(phone=False):
    cats = [("详细睡眠", "540 条", "2026-08-09 — 11-06", "已有数据"), ("睡眠评分", "90 条", "2026-08-09 — 11-06", "已有数据"), ("准备度", "90 条", "2026-08-09 — 11-06", "已有数据"), ("活动", "90 条", "2026-08-09 — 11-06", "已有数据"), ("心率", "12,840 条", "逐日同步", "已有数据"), ("压力", "—", "—", "上游受限，暂停")]
    cr = "".join(f'<div class="batch"><span style="font-weight:500">{a}</span><span class="cp-meta">{b}</span><span class="cp-meta">{c}</span><span style="text-align:right;font-size:12px;color:{"var(--color-warning)" if "受限" in d else "var(--color-success)"}">{d}</span></div>' for a, b, c, d in cats)
    body = f'''<div class="hd"><div><span class="cp-meta">健康空间</span><h1>设置</h1><span class="cp-meta">管理你的数据、应用连接与使用偏好。</span></div><div class="r"><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">返回看板</a></div></div>
<div class="setgrid" style="display:grid;grid-template-columns:180px minmax(0,1fr);gap:24px;align-items:start"><nav class="cp-nav snav" aria-label="设置分组"><a href="#" aria-current="page"><span>偏好</span></a><a href="#"><span>数据同步</span></a><a href="#"><span>账号</span></a><a href="#"><span>应用连接</span></a></nav>
<div style="display:grid;gap:16px">
<section class="box"><h2>界面语言</h2><p class="desc">默认跟随系统：中文环境用中文，其他用英文。可在此覆盖并记住。</p><div class="cp-seg" role="group" aria-label="语言"><button aria-pressed="true">跟随系统</button><button aria-pressed="false">中文</button><button aria-pressed="false">English</button></div></section>
<section class="box"><h2>数据采集与历史记录 <small>14 / 18 类已有数据</small></h2><p class="desc">每天 09:00 刷新最近 90 天官方评分；可访问类别的详情刷新最近 7 天并补齐最近 90 天缺失。任务保存在服务端，关闭页面也会继续。</p>
<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px 14px;background:var(--color-background);border-radius:10px"><span class="cp-fresh" style="color:var(--color-text);font-weight:600">本次自动同步已完成</span><span class="cp-meta">官方评分 · 已完成 · 详细记录 30 / 30 批次</span><span class="cp-meta">最近更新 11 月 6 日 09:02 · 下次 11 月 7 日 09:00</span><button class="cp-btn cp-btn-primary cp-btn-sm" style="margin-left:auto">更新数据</button></div>
<div style="margin-top:14px">{cr}</div></section>
<section class="box"><h2>账号</h2><div class="cp-kv" style="min-height:44px"><span>个人工作区</span><span style="color:var(--color-text)">当前账号可使用完整解读与数据同步</span></div><div class="cp-kv" style="min-height:44px"><span>网站账号</span><span style="color:var(--color-text)">示例账号 · CodePi 统一登录</span></div><div class="cp-kv" style="min-height:44px"><span>Oura</span><span style="color:var(--color-success)">已连接 · 11 月 1 日授权</span></div><div class="row" style="margin-top:12px"><button class="cp-btn cp-btn-secondary cp-btn-sm">重新连接 Oura</button><button class="cp-btn cp-btn-ghost cp-btn-sm">原账号连接修复</button></div></section>
<section class="box"><h2>应用连接 <small>授权 AI 应用只读访问，随时撤销</small></h2><div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">CodePi MCP</div><span class="cp-meta">只读 · 健康日汇总与睡眠 · 最近使用 2 小时前</span></div><button class="cp-btn cp-btn-secondary cp-btn-sm">撤销</button></div><p class="cp-meta" style="margin:10px 0 0">非医疗建议 / Not medical advice</p></section></div></div>'''
    return shell(body, "设置", phone, ai=False)

def settings_states():
    batch = "".join(f'<div class="batch"><span>{a}</span><span class="cp-meta">{b}</span><span class="cp-meta">{c}</span><span style="text-align:right;font-size:12px;color:{col}">{d}</span></div>' for a, b, c, d, col in [("睡眠评分", "下一批次", "10-14 — 10-20", "执行中", "var(--color-action-hover)"), ("详细睡眠", "第 12 批", "10-07 — 10-13", "已完成", "var(--color-success)"), ("心率", "第 4 批", "10-21", "失败 · 将重试", "var(--color-danger)")])
    return f'''<div class="hl" style="padding:40px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start">
<div><p class="cp-head"><span>数据同步进行中：按钮禁用「更新中…」，下一批次高亮</span></p><section class="box"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="cp-fresh stale" style="font-weight:600">后台正在更新数据</span><span class="cp-meta">详细记录 12 / 30 批次 · 18 批待执行</span><button class="cp-btn cp-btn-primary cp-btn-sm" aria-disabled="true" style="margin-left:auto">更新中…</button></div><div class="cp-progress" style="margin:12px 0"><i style="width:40%"></i></div>{batch}<p class="cp-meta" style="margin:10px 0 0">小批次执行中，每两分钟继续；可重试的失败批次会延后执行。</p></section></div>
<div style="display:grid;gap:16px"><div><p class="cp-head"><span>非个人账号：分组只剩「偏好」，多一块账号权限</span></p><section class="box"><h2>账号权限</h2><p class="desc" style="margin:0">当前账号可查看日汇总与周报摘要。完整解读、数据同步及应用连接仅向个人工作区所有者开放。</p></section></div>
<div><p class="cp-head"><span>Oura 尚未连接：不显示数据同步面板</span></p><section class="box"><div class="cp-kv"><span>Oura</span><span>尚未连接</span></div><button class="cp-btn cp-btn-primary cp-btn-sm" style="margin-top:12px">连接 Oura</button></section></div>
<div><p class="cp-head"><span>语言保存中</span></p><div class="row"><div class="cp-seg" role="group" aria-label="语言"><button aria-pressed="false">跟随系统</button><button aria-pressed="true">中文</button><button aria-pressed="false">English</button></div><span class="cp-meta">{IC["loader"]} 保存中…</span></div></div></div></div>'''

def ai_states():
    head = f'<header><div style="flex:1"><span class="cp-meta">{SPARK} 数据解读 · 近 7 天</span><h3 style="margin-top:6px">2026-10-31 — 11-06</h3></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>'
    res = f'''{head}<div class="bd"><span class="cp-meta">已验证模型辅助排序 · 示例模型</span><div style="font-size:16px;font-weight:600;line-height:1.5">睡眠略低于近期水平，其他评分接近日常节奏。</div>
<div style="display:grid;gap:10px"><span class="cp-head" style="margin:0"><span>主要发现</span></span>{"".join(f'<div class="ho" style="border:1px solid var(--color-border);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.55"><div style="display:flex;justify-content:space-between"><b>{a}</b><span class="tag {c}">{t}</span></div>{d}</div>' for a, t, c, d in [("睡眠评分低于近期均值", "偏低", "lo", "11/06 睡眠评分 72，较此前 7 天均值 −6 分。"), ("准备度保持平稳", "正常", "ok", "近 7 天准备度均值 70，与此前接近。"), ("HRV 记录不足", "注意", "note", "主睡眠 HRV 仅 4/7 晚有效，暂不比较。")])}</div>
<div style="display:grid;gap:6px;font-size:14px"><span class="cp-head" style="margin:0"><span>可以关注</span></span><span>1　回看 11/04 前后的作息时间。</span><span>2　继续记录，观察主睡眠 HRV。</span></div><p class="cp-meta" style="margin:0">数据说明：只读你授权的 Oura 记录；不作诊断。</p></div>'''
    return f'''<div class="hl" style="padding:40px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>A 生成中</span></p><aside class="cp-drawer" style="width:auto;border:1px solid var(--color-border);border-radius:14px;min-height:560px">{head}<div class="bd"><div class="cp-pageload" style="min-height:120px">{IC["loader"]}正在整理数据解读<br><span class="cp-meta">整理近 7 天的 Oura 信号…</span></div></div></aside></div>
<div style="grid-column:span 2"><p class="cp-head"><span>B 结果：结论、主要发现、可以关注、数据说明</span></p><aside class="cp-drawer" style="width:auto;border:1px solid var(--color-border);border-radius:14px">{res}</aside></div>
<div><p class="cp-head"><span>C 失败 · D 回退为规则摘要</span></p><aside class="cp-drawer" style="width:auto;border:1px solid var(--color-border);border-radius:14px;min-height:260px">{head}<div class="bd"><div class="cp-banner err">{IC["error"]}<span>解读生成失败，请稍后重试。</span></div><button class="cp-btn cp-btn-secondary cp-btn-sm" style="justify-self:start">重试</button></div></aside><div class="cp-alert" style="margin-top:12px">{IC["info"]}<div>模型暂时不可用，下面是按规则生成的摘要。</div></div></div></div>'''

DESK = [("H-Landing", "落地页（未登录）", landing, 1100), ("H-Landing-States", "未登录与未连接", landing_states, 620), ("H-Overview", "概览", overview, 1700), ("H-Overview-Empty", "概览 · 新账号没有记录", overview_empty, 700),
        ("H-Sync-States", "同步状态 · 紧凑形态", sync_states, 520), ("H-Sleep", "睡眠与恢复", sleep, 1500), ("H-Sleep-States", "睡眠 · 状态", sleep_states, 620), ("H-Weekly", "近 7 天解读", weekly, 1100),
        ("H-Weekly-States", "7 天解读 · 状态", weekly_states, 460), ("H-Compare", "对比 · 区间比较", compare, 1000), ("H-Compare-More", "对比 · 活动、压力、个人历史参照", compare_more, 900),
        ("H-Settings", "设置", settings, 1300), ("H-Settings-States", "设置 · 同步中、非个人、未连接", settings_states, 560), ("H-AI", "AI 解读抽屉 · 状态", ai_states, 800)]
PH = [("H-Landing-Phone", "落地页 · 手机", lambda: landing(True), 1800), ("H-Overview-Phone", "概览 · 手机", lambda: overview(True), 3000), ("H-Sleep-Phone", "睡眠 · 手机", lambda: sleep(True), 2400),
      ("H-Weekly-Phone", "7 天解读 · 手机", lambda: weekly(True), 2200), ("H-Compare-Phone", "对比 · 手机", lambda: compare(True), 1800), ("H-Settings-Phone", "设置 · 手机", lambda: settings(True), 2000)]
for n, t, fn, h in DESK:
    add(n, t, 1440, H.get(n, h), fn(), CSS)
for n, t, fn, h in PH:
    add(n, t, 390, H.get(n, h), fn(), CSS + PHONE)
print("health ok")
