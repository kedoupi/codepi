"""Generate CodePi 设计规范 canvas boards (首页 / 组件 / 规范). Writes board .dc.html and local preview .html."""
import json, re, sys
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
CANVAS = _os.path.dirname(HERE)  # design/canvas
REPO = _os.path.dirname(_os.path.dirname(CANVAS))
# 输出目录（画板与预览），默认 design/canvas/build/，不入库；可用环境变量 CANVAS_BUILD 改
ROOT = _os.environ.get("CANVAS_BUILD", _os.path.join(CANVAS, "build")).rstrip("/") + "/"
LOGO_BLOB = "/_blob/3e2c94fc8dc2369e81d7096f10727c09"
LOGO_LOCAL = _os.path.join(REPO, "apps/web/public/brand/codepi-symbol-512.png")
FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Noto+Sans+SC:wght@400;500;600&amp;display=swap"

def board(title, w, h, body, css, root_style):
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="ui/codepi-ui.css">
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="{FONTS}">
<style>body{{margin:0}}
{css}</style>
</helmet>
<div style="{root_style}">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
"""

def preview(title, body, css, root_style, width):
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<link rel="stylesheet" href="{FONTS.replace('&amp;','&')}"><link rel="stylesheet" href="file://{ROOT}project/ui/codepi-ui.css">
<style>body{{margin:0}}{css}</style></head><body><div style="{root_style}">{body}</div></body></html>""".replace(LOGO_BLOB, LOGO_LOCAL).replace('src="charts/', f'src="file://{ROOT}project/charts/')

# ───────────────────────── 首页 ─────────────────────────
SEG = [(430, "sleep"), (55, "home"), (50, "commute"), (195, "desk"), (50, "away"), (60, "desk"), (60, "meeting"), (30, "desk")]
def day(cls="cp-day", now=True):
    bars = "".join(f'<i style="flex:{m};background:var(--state-{s})"></i>' for m, s in SEG) + '<i style="flex:510;background:var(--state-future)"></i>'
    mark = '<span class="cp-day-now" style="left:64.6%"></span>' if now else ""
    return f'<div class="{cls}" role="img" aria-label="示意：一天的作息分布">{bars}{mark}</div>'

LEGEND = '<div class="cp-legend"><span style="--c:var(--state-sleep)">睡眠</span><span style="--c:var(--state-commute)">通勤</span><span style="--c:var(--state-desk)">在电脑前 4:45</span><span style="--c:var(--state-meeting)">开会 1:00</span><span style="--c:var(--state-away)">离座</span></div>'
TASKS = '''<div class="cp-task"><span class="cp-check"></span>回复房东关于续租的邮件<span class="cp-meta">3-20 截止</span></div>
<div class="cp-task"><span class="cp-check ai"></span>整理本周读书笔记<span class="cp-meta">AI 在做</span></div>
<div class="cp-task"><span class="cp-check ai"></span>汇总三月睡眠变化<span class="cp-meta">排队</span></div>'''
BARS = '<div class="cp-bars"><i style="height:52%"></i><i style="height:66%"></i><i style="height:58%"></i><i style="height:74%"></i><i style="height:61%"></i><i style="height:70%"></i><i class="on" style="height:82%"></i></div>'
MOM = [("07:10", "起床"), ("08:05", "出门"), ("08:55", "开始工作"), ("12:10", "午饭"), ("13:00", "回来"), ("14:00", "开会"), ("15:30", "现在")]
MOMENTS = "".join(f'<div class="{"now" if l == "现在" else ""}"><b>{t}</b>{l}</div>' for t, l in MOM)

# ───── 品牌首页：一天的光，从四面汇聚到「你」 ─────
import math

# 生活片段：角度、半径、标签、颜色（示例，不是真实数据）
FRAGS = [
    (-150, 250, "07:10 醒来", "--state-sleep", ""),
    (-112, 262, "晨跑 5 公里", "--state-away", "opt"),
    (-68, 255, "读书笔记", "--state-home", ""),
    (-28, 250, "项目交接", "--state-desk", ""),
    (18, 258, "下午的会", "--state-meeting", "opt"),
    (62, 252, "回家路上", "--state-commute", ""),
    (118, 258, "一笔复盘", "--state-out", "opt"),
    (160, 250, "睡前的想法", "--state-sleep", ""),
]

def _pt(cx, cy, ang, r):
    a = math.radians(ang)
    return cx + r * math.cos(a), cy + r * math.sin(a)

def conv_svg(cls="conv", labels=True, size=560, faint=30, gate=False):
    """汇聚图：细线从外围弯向中心的一点。gate=True 时画出授权边界环。"""
    c = size / 2
    sc = size / 560
    out = []
    # 背景细线：没有名字的片段
    for i in range(faint):
        ang = i * (360 / faint) + 7
        r = (236 + (i * 37) % 40) * sc
        x0, y0 = _pt(c, c, ang, r)
        qx, qy = _pt(c, c, ang + 24, r * 0.52)
        out.append(f'<path d="M{x0:.1f} {y0:.1f} Q{qx:.1f} {qy:.1f} {c:.1f} {c:.1f}" stroke="var(--chart-muted)" stroke-width="1" fill="none"/>')
    # 有名字的片段
    for ang, r, lab, col, opt in FRAGS:
        r = r * sc
        x0, y0 = _pt(c, c, ang, r)
        qx, qy = _pt(c, c, ang + 26, r * 0.5)
        out.append(f'<path d="M{x0:.1f} {y0:.1f} Q{qx:.1f} {qy:.1f} {c:.1f} {c:.1f}" stroke="var({col})" stroke-width="{2.25 * max(sc, .8):.2f}" fill="none" stroke-linecap="round"/>')
        out.append(f'<circle cx="{x0:.1f}" cy="{y0:.1f}" r="{4 * max(sc, .8):.1f}" fill="var({col})"/>')
        if labels:
            lx, ly = _pt(c, c, ang, r + 14)
            anchor = "start" if math.cos(math.radians(ang)) > 0.2 else ("end" if math.cos(math.radians(ang)) < -0.2 else "middle")
            dy = 4 if abs(math.sin(math.radians(ang))) < .7 else (14 if math.sin(math.radians(ang)) > 0 else -6)
            out.append(f'<text class="{opt}" x="{lx:.1f}" y="{ly + dy:.1f}" text-anchor="{anchor}">{lab}</text>')
    # 中心：你
    out.append(f'<circle cx="{c}" cy="{c}" r="{84 * sc:.1f}" fill="none" stroke="var(--color-border)"/>')
    out.append(f'<circle cx="{c}" cy="{c}" r="{46 * sc:.1f}" fill="var(--color-background)" stroke="var(--tint-accent-line)"/>')
    out.append(f'<circle cx="{c}" cy="{c}" r="{9 * max(sc, .7):.1f}" fill="var(--color-action)"/>')
    if labels:
        out.append(f'<text class="you" x="{c}" y="{c + 32 * sc:.1f}" text-anchor="middle">你</text>')
    return f'<svg class="{cls}" viewBox="-72 -8 {size + 144} {size + 16}" aria-hidden="true" focusable="false">{"".join(out)}</svg>'

def glyph(kind):
    """章节小图，沿用汇聚图的语汇：汇聚 / 授权 / 释放。"""
    c, o = 60, []
    cols = ["--state-sleep", "--state-desk", "--state-commute", "--state-home", "--state-meeting", "--state-away"]
    for i in range(6):
        ang = i * 60 - 80
        x0, y0 = _pt(c, c, ang, 54)
        if kind == "gather":
            qx, qy = _pt(c, c, ang + 28, 26)
            o.append(f'<path d="M{x0:.1f} {y0:.1f} Q{qx:.1f} {qy:.1f} {c} {c}" stroke="var({cols[i]})" stroke-width="1.5" fill="none"/>')
            o.append(f'<circle cx="{x0:.1f}" cy="{y0:.1f}" r="3" fill="var({cols[i]})"/>')
        elif kind == "permit":
            x1, y1 = _pt(c, c, ang, 34 if i not in (1, 4) else 8)
            col = cols[i] if i in (1, 4) else "--chart-faint"
            o.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="var({col})" stroke-width="1.5"/>')
            o.append(f'<circle cx="{x0:.1f}" cy="{y0:.1f}" r="3" fill="var({col})"/>')
    if kind == "permit":
        o.append(f'<circle cx="{c}" cy="{c}" r="30" fill="none" stroke="var(--color-border-strong)" stroke-dasharray="3 5"/>')
    if kind == "release":
        for r in (52, 38, 24):
            o.append(f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="var(--chart-muted)"/>')
    o.append(f'<circle cx="{c}" cy="{c}" r="6" fill="var(--color-action)"/>')
    return f'<svg class="glyph" viewBox="0 0 120 120" aria-hidden="true" focusable="false">{"".join(o)}</svg>'

def ring_svg():
    """授权圆环：外环是你划的边界，两条线被允许穿过。"""
    c, o = 180, []
    for i in range(14):
        ang = i * (360 / 14) + 5
        allowed = i in (2, 6, 10)
        x0, y0 = _pt(c, c, ang, 172)
        x1, y1 = _pt(c, c, ang, 22 if allowed else 104)
        col = "--accent-inverse" if allowed else "--line-inverse"
        o.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="var({col})" stroke-width="{1.75 if allowed else 1.25}" stroke-linecap="round"/>')
    o.append(f'<circle cx="{c}" cy="{c}" r="96" fill="none" stroke="var(--text-inverse-muted)" stroke-dasharray="2 7" stroke-linecap="round"/>')
    o.append(f'<circle cx="{c}" cy="{c}" r="40" fill="none" stroke="var(--line-inverse)"/>')
    o.append(f'<circle cx="{c}" cy="{c}" r="10" fill="var(--accent-inverse)"/>')
    return f'<svg class="ring" viewBox="0 0 360 360" aria-hidden="true" focusable="false">{"".join(o)}</svg>'

FULLDAY = [(420, "sleep"), (60, "home"), (60, "commute"), (180, "desk"), (60, "away"), (60, "desk"), (60, "meeting"), (180, "desk"), (60, "commute"), (240, "home"), (60, "sleep")]
def rhythm():
    bars = "".join(f'<i style="flex:{m};background:var(--state-{s})"></i>' for m, s in FULLDAY)
    marks = [("07:00", "晨起", "从身体的节律开始，知道今天的自己在哪里。", 29.17, ""),
             ("14:00", "专注", "把手头正在推进的事，放回更长期的思考里。", 58.33, ""),
             ("23:00", "沉淀", "让今天的记录与想法，成为明天可以轻松接续的起点。", 95.83, "end")]
    ticks = "".join(f'<span class="tick" style="left:{p}%"></span>' for _, _, _, p, _ in marks)
    items = "".join(f'<li class="{e}" style="--x:{p}%"><time>{t}</time><b>{n}</b><p>{d}</p></li>' for t, n, d, p, e in marks)
    return f'''<div class="rhythm"><div class="rbar" role="img" aria-label="示意：一天的作息，从 0 点到 24 点">{bars}{ticks}</div>
<div class="raxis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
<ol class="marks">{items}</ol></div>'''

SPACES = [("健康", "Health", "记录睡眠、恢复与活动，理解自己的长期变化。", "health.codepi.app"),
          ("作息", "Rhythm", "看清自己一天的作息与工作节奏。", "jw.codepi.app"),
          ("项目", "Project", "让项目进展、任务交接与仓库动态保持连贯。", "project.codepi.app"),
          ("个人", "Me", "保存经过自己确认的偏好、背景与经历。", "me.codepi.app"),
          ("投资理财", "GU", "整理持仓、研究与决策，让每一次判断有迹可循。", "gu.codepi.app"),
          ("公众号", "GZH", "稿件、预览与审核，收在同一个工作台。", "gzh.codepi.app")]
def spaces():
    rows = "".join(f'<li><a href="#"><span class="nm">{n}<small>{en}</small></span><span class="ds">{d}</span><span class="hn">{h}</span></a></li>' for n, en, d, h in SPACES)
    return f'<ul class="dir">{rows}<li class="next"><span class="nm">下一个空间</span><span class="ds">由你的生活决定，它不会预设上限。</span></li></ul>'

HOME_CSS = """
.home{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased}
.home a:not(.cp-btn){color:inherit}
.home a:focus-visible,.home button:focus-visible{outline:2px solid var(--color-focus);outline-offset:4px;border-radius:6px}
.home .wrap{max-width:1200px;margin:0 auto;padding:0 32px}
.home .menu-m{display:none}
.home h1,.home h2{font-weight:600;margin:0;text-wrap:balance}
.home p{margin:0}
/* 首屏 */
.home .hero .wrap{display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:48px;align-items:center;min-height:720px;padding-top:32px;padding-bottom:32px}
.home .tag{font-size:15px;color:var(--color-text-muted);margin-bottom:24px}
.home h1{font-size:var(--site-display);line-height:1.08;letter-spacing:-.035em}
.home .lead{font-size:var(--site-lead);line-height:1.6;color:var(--color-text-muted);margin-top:32px;max-width:480px;text-wrap:pretty}
.home .cta{display:flex;gap:12px;margin-top:48px;flex-wrap:wrap}
.home .conv{width:100%;height:auto;display:block;overflow:visible}
.home .conv text{font-size:13px;fill:var(--color-text-muted);font-family:var(--font-sans)}
.home .conv text.you{font-size:15px;fill:var(--color-text);font-weight:600}
.home .hint{font-size:13px;color:var(--color-text-muted);margin-top:16px;text-align:center}
/* 三个章节 */
.home .acts{padding:128px 0 0}
.home .acts h2{font-size:var(--site-h2);line-height:1.2;letter-spacing:-.025em;max-width:720px}
.home .acts ol{list-style:none;margin:64px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:64px}
.home .acts li{border-top:1px solid var(--color-text);padding-top:24px}
.home .acts .glyph{width:96px;height:96px;display:block;margin-bottom:32px}
.home .acts .k{font-size:14px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.home .acts b{display:block;font-size:24px;line-height:1.35;font-weight:600;letter-spacing:-.01em;margin-top:8px}
.home .acts p{font-size:16px;line-height:1.75;color:var(--color-text-muted);margin-top:12px;max-width:320px}
/* 反白：主权 */
.home .night{background:var(--surface-inverse);color:var(--text-inverse);margin-top:128px;padding:128px 0}
.home .night .wrap{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:96px;align-items:center}
.home .night h2{font-size:56px;line-height:1.15;letter-spacing:-.03em}
.home .night p{font-size:18px;line-height:1.75;color:var(--text-inverse-muted);margin-top:32px;max-width:520px}
.home .night .gate{display:grid;justify-items:center;gap:16px}
.home .ring{width:360px;height:360px;display:block}
.home .toggle{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--text-inverse-muted);background:transparent;color:var(--text-inverse);font:500 15px/1 var(--font-sans);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.home .toggle::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent-inverse)}
.home .toggle:hover{border-color:var(--text-inverse)}
.home .night .status{font-size:14px;color:var(--text-inverse-muted);margin:0}
/* 连续的生活 */
.home .life{padding:128px 0 0}
.home .life h2,.home .grow h2,.home .words h2{font-size:var(--site-h2);line-height:1.2;letter-spacing:-.025em}
.home .life .sub{font-size:18px;line-height:1.7;color:var(--color-text-muted);margin-top:16px;max-width:560px}
.home .rhythm{margin-top:64px}
.home .rbar{display:flex;height:12px;border-radius:6px;overflow:visible;position:relative}
.home .rbar i{display:block;height:100%}
.home .rbar i:first-child{border-radius:6px 0 0 6px}.home .rbar i:nth-last-child(4){border-radius:0 6px 6px 0}
.home .rbar .tick{position:absolute;top:-8px;bottom:-8px;width:2px;margin-left:-1px;background:var(--color-text)}
.home .raxis{display:flex;justify-content:space-between;font-size:12px;color:var(--color-text-muted);margin-top:12px;font-variant-numeric:tabular-nums}
.home .marks{list-style:none;margin:32px 0 0;padding:0;position:relative;height:160px}
.home .marks li{position:absolute;left:var(--x);width:280px;border-left:1px solid var(--color-border-strong);padding-left:16px}
.home .marks li:nth-child(2){width:216px}
.home .marks li.end{left:auto;width:184px;right:calc(100% - var(--x));border-left:0;border-right:1px solid var(--color-border-strong);padding:0 16px 0 0;text-align:right}
.home .marks time{font-size:14px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.home .marks b{display:block;font-size:28px;font-weight:600;letter-spacing:-.02em;margin-top:4px}
.home .marks p{font-size:15px;line-height:1.65;color:var(--color-text-muted);margin-top:8px}
.home .pull{font-size:40px;line-height:1.3;letter-spacing:-.025em;font-weight:500;margin:96px 0 0;max-width:880px}
/* 现在的空间 */
.home .grow{padding:128px 0 0}
.home .grow .wrap{display:grid;grid-template-columns:400px minmax(0,1fr);gap:96px;align-items:start}
.home .grow .sub{font-size:16px;line-height:1.75;color:var(--color-text-muted);margin-top:24px}
.home .dir{list-style:none;margin:0;padding:0;border-top:1px solid var(--color-text)}
.home .dir li{border-bottom:1px solid var(--color-border)}
.home .dir a,.home .dir .next{display:grid;grid-template-columns:200px minmax(0,1fr) 160px;gap:24px;align-items:baseline;padding:24px 0;text-decoration:none}
.home .dir a:hover .nm{color:var(--color-action-hover)}
.home .dir .nm{font-size:24px;font-weight:500;letter-spacing:-.01em;transition:color var(--motion-fast) var(--ease)}
.home .dir .nm small{font-size:13px;font-weight:400;color:var(--color-text-muted);margin-left:8px;letter-spacing:0}
.home .dir .ds{font-size:15px;line-height:1.6;color:var(--color-text-muted)}
.home .dir .hn{font-size:13px;color:var(--color-text-muted);text-align:right}
.home .dir li.next{border-bottom:1px dashed var(--color-border-strong)}
.home .dir .next .nm{color:var(--color-text-muted)}
/* 写下的 */
.home .words{padding:128px 0 0}
.home .words .wh{display:flex;justify-content:space-between;align-items:baseline;gap:24px}
.home .words .wh a{font-size:15px;font-weight:500;text-underline-offset:4px}
.home .quotes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:64px;margin-top:48px}
.home .quote{text-decoration:none;display:block;border-top:1px solid var(--color-text);padding-top:32px}
.home .quote q{display:block;font-size:32px;line-height:1.35;font-weight:500;letter-spacing:-.02em;quotes:"「" "」";text-wrap:balance}
.home .quote:hover q{text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:1px}
.home .quote p{font-size:16px;line-height:1.75;color:var(--color-text-muted);margin-top:16px;max-width:480px}
.home .quote .by{display:block;font-size:13px;color:var(--color-text-muted);margin-top:24px}
/* 收尾 */
.home .end{padding:128px 0 128px}
.home .end .wrap{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:64px;align-items:end}
.home .end h2{font-size:var(--site-display);line-height:1.1;letter-spacing:-.035em}
.home .end .lead{margin-top:32px}
.home .end .glyph{width:240px;height:240px;display:block}
.home footer{border-top:1px solid var(--color-border);padding:32px 0 48px;font-size:13px;color:var(--color-text-muted)}
.home footer .wrap{display:flex;gap:24px}.home footer .wrap span:first-child{margin-right:auto}
.home footer a{text-decoration:none}
.home footer a:hover{color:var(--color-text)}
@media (prefers-reduced-motion:reduce){.home *{transition:none!important}}
"""
PHONE_CSS = """
.home .wrap{padding:0 16px}
.home .cp-topnav{gap:12px}.home .cp-topnav .links{display:none}
.home .cp-topnav .right>a.cp-btn{display:none}.home .menu-m{display:inline-grid}
.home .hero .wrap{grid-template-columns:minmax(0,1fr);min-height:0;gap:32px;padding-top:48px;padding-bottom:0}
.home .tag{font-size:14px;margin-bottom:16px}
.home h1{font-size:44px;line-height:1.15}
.home .lead{font-size:18px;margin-top:24px}
.home .cta{margin-top:32px}.home .cta .cp-btn{flex:1 1 100%}
.home .conv text{font-size:22px}.home .conv text.opt{display:none}.home .conv text.you{font-size:24px}
.home .acts{padding-top:96px}
.home .acts h2,.home .life h2,.home .grow h2,.home .words h2{font-size:32px}
.home .acts ol{grid-template-columns:minmax(0,1fr);gap:48px;margin-top:48px}
.home .acts .glyph{width:64px;height:64px;margin-bottom:24px}
.home .acts b{font-size:22px}
.home .night{margin-top:96px;padding:96px 0}
.home .night .wrap{grid-template-columns:minmax(0,1fr);gap:48px}
.home .night h2{font-size:40px}.home .night p{font-size:16px;margin-top:24px}
.home .ring{width:280px;height:280px}
.home .life{padding-top:96px}.home .life .sub{font-size:16px}
.home .rhythm{margin-top:48px}
.home .marks{height:auto;display:grid;gap:24px}
.home .marks li,.home .marks li:nth-child(2),.home .marks li.end{position:static;width:auto;border:0;border-left:1px solid var(--color-border-strong);padding:0 0 0 16px;text-align:left}
.home .marks b{font-size:24px}
.home .pull{font-size:28px;margin-top:64px}
.home .grow{padding-top:96px}.home .grow .wrap{grid-template-columns:minmax(0,1fr);gap:48px}
.home .dir a,.home .dir .next{grid-template-columns:minmax(0,1fr);gap:4px;padding:16px 0}
.home .dir .nm{font-size:22px}.home .dir .hn{text-align:left}
.home .words{padding-top:96px}.home .words .wh{flex-direction:column;gap:12px}
.home .quotes{grid-template-columns:minmax(0,1fr);gap:48px;margin-top:32px}
.home .quote{padding-top:24px}.home .quote q{font-size:24px}
.home .end{padding:96px 0}.home .end .wrap{grid-template-columns:minmax(0,1fr);gap:32px}
.home .end h2{font-size:44px}.home .end .glyph{display:none}
.home footer .wrap{flex-wrap:wrap;gap:12px 24px}
.home footer .wrap span:first-child{flex:1 1 100%}
"""

def home_body():
    return f'''<div class="home">
<header class="cp-topnav" style="padding:0 max(32px, calc((100% - 1200px) / 2 + 32px))">
  <a class="brand" href="#"><img src="{LOGO_BLOB}" alt="">CodePi</a>
  <nav class="links" aria-label="主导航"><a href="#" aria-current="page" style="color:var(--color-text);font-weight:600">首页</a><a href="#">博客</a><a href="#">关于</a><a href="#">隐私说明</a></nav>
  <div class="right"><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">我的工作台</a><button class="cp-iconbtn menu-m" aria-label="打开菜单"><svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg></button></div>
</header>
<main>
<section class="hero" aria-labelledby="h-hero"><div class="wrap">
  <div>
    <p class="tag">把自己的数据，交给自己的 AI</p>
    <h1 id="h-hero">AI，<br>先从你开始。</h1>
    <p class="lead">它不替你生活。它只从你已经拥有的生活里，慢慢学会靠近。</p>
    <div class="cta"><a class="cp-btn cp-btn-primary" href="#spaces">看看现在的空间</a><a class="cp-btn cp-btn-secondary" href="#">了解空间理念</a></div>
  </div>
  <figure style="margin:0">{conv_svg()}<figcaption class="hint">生活里的每个片段，都回到同一个你。图中片段为示例。</figcaption></figure>
</div></section>

<section class="acts" aria-labelledby="h-acts"><div class="wrap">
  <h2 id="h-acts">先汇聚，再由你授权，<br>最后把注意力还给生活。</h2>
  <ol>
    <li>{glyph("gather")}<span class="k">第一步 · 汇聚</span><b>凝聚你的生活上下文。</b><p>晨起的节律、白天的专注、夜晚的记录。每一个真实的片段，都在这里汇聚成专属你的理解。</p></li>
    <li>{glyph("permit")}<span class="k">第二步 · 授权</span><b>你决定，它能听见什么。</b><p>每一次靠近都经过你的允许。没有默认的窥探，只有你授予的边界与信任。</p></li>
    <li>{glyph("release")}<span class="k">第三步 · 释放</span><b>然后，把注意力还给生活。</b><p>最强大的智能，是在你需要时及时出现，在日常中安静守候。</p></li>
  </ol>
</div></section>

<section class="night" aria-labelledby="h-night"><div class="wrap">
  <div>
    <h2 id="h-night">不拥有你，<br>才有资格理解你。</h2>
    <p>你的数据不是训练材料，也不是等待被算法切片的燃料。它只是你愿意交出来、并且随时可以收回的真实生活。</p>
    <p>AI 可以离你很近，但靠近与否，决定权始终握在你手里。</p>
  </div>
  <div class="gate">{ring_svg()}<button class="toggle" type="button" aria-pressed="true">收回授权</button><p class="status" aria-live="polite">正在允许 AI 靠近</p></div>
</div></section>

<section class="life" aria-labelledby="h-life"><div class="wrap">
  <h2 id="h-life">生活，本就是连续的。</h2>
  <p class="sub">醒来、专注、沉淀。每一个片段都属于同一个你，也是明天可以继续的线索。</p>
  {rhythm()}
  <p class="pull">不是把生活交给 AI，<br>是让 AI 学会回到生活。</p>
</div></section>

<section class="grow" id="spaces" aria-labelledby="h-grow"><div class="wrap">
  <div><h2 id="h-grow">从现在开始，<br>向未知生长。</h2><p class="sub">健康、投资、思考、创作，当前的空间只是一个起点。每个空间只记录一段真实生活，进入任何一个，都用同一个账号。</p></div>
  {spaces()}
</div></section>

<section class="words" aria-labelledby="h-words"><div class="wrap">
  <div class="wh"><h2 id="h-words">写下来的</h2><a href="#">看全部文章</a></div>
  <div class="quotes">
    <a class="quote" href="#"><q>工作 19 年后，我发现自己不会休息了</q><p>从程序员到独立创业，终于拥有更多自由，却发现自己只有做事才能安心。</p><span class="by">生活感悟，8 分钟读完</span></a>
    <a class="quote" href="#"><q>把数据留在自己手里，是一种什么体验</q><p>一个人的睡眠、作息和想法，放回自己能看见、也能收回的地方之后，发生了什么。</p><span class="by">随笔，4 分钟读完</span></a>
  </div>
</div></section>

<section class="end" aria-labelledby="h-end"><div class="wrap">
  <div>
    <h2 id="h-end">把自己的数据，<br>交给自己的 AI。</h2>
    <p class="lead">你的世界越完整，AI 越应该保持克制。让它更懂你，但不拥有你。</p>
    <div class="cta"><a class="cp-btn cp-btn-secondary" href="#spaces">看看现在的空间</a><a class="cp-btn cp-btn-ghost" href="#">了解空间理念</a></div>
  </div>
  {glyph("release")}
</div></section>
</main>
<footer><div class="wrap"><span>生活、工作与思考，在这里连接。 © 2026 kedoupi（codepi）</span><a href="#">首页</a><a href="#">博客</a><a href="#">关于</a><a href="#">隐私说明</a><a href="#">我的工作台</a></div></footer>
</div>'''

BOARDS = {}
def add(name, title, w, h, body, css):
    from norm import normalize
    strict = name in ("Main", "Home-Phone", "C-WWW") or name.startswith("Web-")  # www 页只用规范字阶
    body, css = normalize(body, strict), normalize(css, strict)
    root = f"width:{w}px;min-height:{h}px"
    BOARDS[name] = (title, w, h)
    open(ROOT + "project/" + name + ".dc.html", "w").write(board(title, w, h, body, css, root))
    open(ROOT + "preview/" + name + ".html", "w").write(preview(title, body, css, root, w))

import os
os.makedirs(ROOT + "preview", exist_ok=True)
os.makedirs(ROOT + "project/ui", exist_ok=True)
import shutil as _sh
_sh.copy(_os.path.join(CANVAS, "assets/ui/codepi-ui.css"), ROOT + "project/ui/codepi-ui.css")
# 首页高度：环境变量 H_MAIN / H_HOME 优先（被其他生成器 import 时也一致），其次命令行参数
H_DESK = int(os.environ.get("H_MAIN") or (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else 3471))
H_PHONE = int(os.environ.get("H_HOME") or (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].isdigit() else 4900))
add("Main", "官网首页", 1440, H_DESK, home_body(), HOME_CSS)
add("Home-Phone", "官网首页 · 手机", 390, H_PHONE, home_body(), HOME_CSS + PHONE_CSS)
print("ok", list(BOARDS))
