"""project 改版板，按 CodePi 设计系统组件（ui/codepi-ui.css 的 cp-*）重做：
Now-Proj-Map 现状功能地图 / Now-Proj-Issues 问题与建议改法 / Map-Proj-v2 改版对照表（覆盖 55/55）。
架构图 Arch-Proj-v2 改由 arch-diagram 的 archdiag.py 生成（data: proj-v2.json）。HN="名=高,…" 覆盖高度。"""
import os, sys, re
sys.argv = sys.argv[:1]  # 首页高度走 H_MAIN / H_HOME 环境变量
os.environ.setdefault("HS", "4096"); os.environ.setdefault("HC", "2457")
from gen import add
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_now import PAGES as NOW_PAGES, OLD, ISSUES
from gen_projv2 import PAGES as V2_PAGES

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HN", "").split(",") if x)}

# 只放版式；颜色、字号、卡片、表格、标签全部用设计系统组件与 token
CSS = """
.bd{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.bd h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.bd .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 40px;max-width:960px}
.bd h2{font-size:var(--app-title);font-weight:600;margin:48px 0 16px}
.bd .stats{display:grid;grid-template-columns:repeat(4,240px);gap:16px}
.bd .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}
.bd .cp-card .cp-table{margin-top:8px}
.bd .cp-table td:last-child,.bd .cp-table th:last-child{text-align:right;white-space:nowrap}
.bd .cp-table th[colspan]{text-align:left;padding-top:16px}
.bd .cp-table small{display:block;font-size:var(--app-meta);color:var(--color-text-muted);margin-top:2px}
.bd .s-warn{color:var(--color-warning)} .bd .s-err{color:var(--color-danger)} .bd .s-ok{color:var(--color-success)}
.bd .cp-legend{margin-top:32px}
.bd .src{font-size:var(--app-meta);color:var(--color-text-subtle);margin-top:16px}
.bd .cp-alert{margin-top:24px}
.bd .cp-alert ol{margin:8px 0 0;padding-left:20px;line-height:1.8}
.bd .cp-alert small{color:var(--color-text-muted)}
"""

NOW_CHIP = {"ok": ("cp-chip", "已画"), "miss": ("cp-chip s-warn", "漏画"), "diff": ("cp-chip s-err", "和代码不一致"), "na": ("cp-chip", "不上界面")}
V2_CHIP = {"keep": ("cp-chip", "保留"), "adj": ("cp-chip s-warn", "调整"), "new": ("cp-chip need", "新增"), "drop": ("cp-chip s-err", "去掉"), "na": ("cp-chip", "后台")}
LEG = '<div class="cp-legend">{}</div>'


def chip(m, k):
    c, t = m[k]
    return f'<span class="{c}">{t}</span>'


def stats(items):
    return '<div class="stats">' + "".join(f'<div class="cp-stat"><div class="cp-stat-num{" " + c if c else ""}">{n}</div><div class="cp-delta">{t}</div></div>' for n, t, c in items) + "</div>"


def now_map():
    cards = ""
    for name, sub, items in NOW_PAGES + [("旧稿", "和现在的 P- 系列并存", [OLD])]:
        rows = "".join(f'<tr><td>{t}{f"<small>{n}</small>" if n else ""}</td><td>{chip(NOW_CHIP, s)}</td></tr>' for t, s, n in items)
        cards += f'<div class="cp-card"><h3 class="cp-card-title">{name}</h3><p class="cp-card-body">{sub}</p><table class="cp-table"><tbody>{rows}</tbody></table></div>'
    leg = LEG.format('<span style="--c:var(--color-surface-2)">已画：稿和代码一致</span><span style="--c:var(--color-warning)">漏画：代码有、稿没画</span><span style="--c:var(--color-danger)">和代码不一致</span><span style="--c:var(--color-border-strong)">不上界面：后台能力</span>')
    return f'''<div class="bd"><h1>project 现状 · 功能地图</h1>
<p class="intro">线上 project 工作台现在真实有的功能，逐项对照画布里的原型。改版时每一项都要在新稿里找到位置，或写明决定去掉。</p>
{stats([("55", "功能点", ""), ("3", "漏画", "s-warn"), ("11", "和代码不一致", "s-err"), ("11", "体验问题", "")])}
<h2>按页面</h2><div class="g3">{cards}</div>{leg}
<p class="src">来源：codepi docs/products/project/inventory.md（2026-11-07 盘点，P-F01–P-F55），部分条目合并显示。</p></div>'''


def now_issues():
    g = ""
    for name, rows in ISSUES:
        r = "".join(f'<tr><td><b>{t}</b><small>{now}</small></td><td>{fix}</td><td><span class="cp-meta">{ids}</span></td></tr>' for t, now, fix, ids in rows)
        g += f'<h2>{name}</h2><div class="cp-card"><table class="cp-table"><thead><tr><th>现在怎样</th><th>建议改法</th><th>功能点</th></tr></thead><tbody>{r}</tbody></table></div>'
    ask = '''<div class="cp-alert cp-alert-success"><div><span class="cp-alert-title">已定：3 件事（张老板 2026-11-07 11:12 按建议）</span><ol>
<li>旧稿 Proj-Today / Proj-Today-Phone 弃用，「记一件事」先不做。</li>
<li>「动态」改名「日报」。</li>
<li>手机底栏：今天 / 日报 / 项目，池子留在今天页分段切换。</li></ol></div></div>'''
    return f'''<div class="bd"><h1>project 现状 · 问题与建议改法</h1>
<p class="intro">从代码里看出来的 11 个体验问题，分「够不着 / 容易点错 / 出错后不好恢复 / 信息不够清楚」四组。建议改法是改版功能树的输入。</p>
{g}{ask}<p class="src">来源：codepi docs/products/project/inventory.md「日常使用流与体验疑点」（推断自代码，未在线上实测）。</p></div>'''


def v2_map():
    cards = ""
    counts = {}
    for name, route, groups in V2_PAGES:
        rows = ""
        for gn, items in groups:
            if gn:
                rows += f'<tr><th colspan="3">{gn}</th></tr>'
            for s, t, i in items:
                counts[s] = counts.get(s, 0) + 1
                rows += f'<tr><td>{t}</td><td><span class="cp-meta">{i}</span></td><td>{chip(V2_CHIP, s)}</td></tr>'
        cards += f'<div class="cp-card"><h3 class="cp-card-title">{name}</h3><p class="cp-card-body"><span class="cp-meta">{route}</span></p><table class="cp-table"><tbody>{rows}</tbody></table></div>'
    leg = LEG.format('<span style="--c:var(--color-surface-2)">保留</span><span style="--c:var(--color-warning)">调整：功能在，改做法</span><span style="--c:var(--brand-soft)">新增</span><span style="--c:var(--color-danger)">去掉：只针对旧稿</span><span style="--c:var(--color-border-strong)">后台：不上界面</span>')
    return f'''<div class="bd"><h1>project · 改版对照表</h1>
<p class="intro">改版功能树每一项落到哪个页面、对应现状哪个功能点。现状 P-F01–P-F55 全部有去处。</p>
{stats([("55/55", "现状功能有去处", "s-ok"), (str(counts.get("new", 0)), "新增", ""), (str(counts.get("adj", 0)), "调整", "s-warn"), (str(counts.get("drop", 0)), "去掉（旧稿）", "s-err")])}
<h2>按页面</h2><div class="g3">{cards}</div>{leg}</div>'''


add("Now-Proj-Map", "project · 现状功能地图", 1440, H.get("Now-Proj-Map", 2400), now_map(), CSS)
add("Now-Proj-Issues", "project · 现状问题与建议改法", 1440, H.get("Now-Proj-Issues", 2000), now_issues(), CSS)
add("Map-Proj-v2", "project · 改版对照表", 1440, H.get("Map-Proj-v2", 3200), v2_map(), CSS)
print("now2 ok")
