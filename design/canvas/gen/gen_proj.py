import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, LOGO_BLOB
from gen2 import IC
from gen3 import CHEV_L, CHEV_R, I16, COPY

LOGO = LOGO_BLOB
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HP", "").split(",") if x)}

CSS = """
.pj{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;position:relative}
.pj a:not(.cp-btn){color:inherit}
.pj .body{display:grid;grid-template-columns:232px minmax(0,1fr)}
.pj .side{border-right:1px solid var(--color-border);background:var(--color-surface);padding:10px 8px;align-content:start;min-height:100%}
.pj .main{padding:28px 32px 48px;display:grid;gap:20px;align-content:start}
.pj .hd{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}
.pj .hd h1{font-size:22px;font-weight:600;letter-spacing:-.015em;margin:0}
.pj .hd .r{margin-left:auto;display:flex;gap:12px;align-items:center}
.pj .box{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:18px 22px}
.pj .box h2{font-size:15px;font-weight:600;margin:0;display:flex;justify-content:space-between;align-items:baseline}
.pj .box h2 small{font-size:12px;font-weight:500;color:var(--color-text-subtle)}
.pj .grp{border-top:1px solid var(--color-border);margin-top:12px;padding-top:4px}
.pj .grp summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;min-height:34px}
.pj .grp summary::before{content:"";width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--color-text-subtle);margin-right:8px}
.pj .row-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:9px 8px;margin:0 -8px;border-radius:8px;font-size:14px}
.pj .row-item:hover,.pj .row-item.hl{background:var(--color-background)}
.pj .row-item .t{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.45}
.pj .row-item .m{grid-column:1;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pj .row-item .acts{grid-row:1 / span 2;grid-column:2;display:flex;gap:6px}
.pj .row-item .acts .cp-btn{min-height:30px;padding:0 10px;font-size:13px}
.pj .lane{margin-top:14px}
.pj .lane h3{font-size:13px;font-weight:600;margin:0;display:flex;justify-content:space-between;align-items:baseline}
.pj .lane h3 small{font-weight:400;color:var(--color-text-subtle);font-size:12px}
.pj .ph-empty{margin-top:8px;padding:14px;border:1px dashed var(--color-border-strong);border-radius:10px;text-align:center;font-size:13px;color:var(--color-text-muted)}
.pj .days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.pj .days button{display:grid;gap:2px;justify-items:start;padding:10px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);font:inherit;text-align:left;cursor:pointer}
.pj .days button span{font-size:11px;color:var(--color-text-subtle)}
.pj .days button b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.pj .days button i{display:block;height:4px;border-radius:2px;background:var(--color-action);margin-top:6px}
.pj .days button.zero b{color:var(--color-text-subtle);font-weight:500}
.pj .days button.on{border-color:var(--color-action);box-shadow:inset 0 0 0 1px var(--color-action)}
.pj .dayh{display:flex;justify-content:space-between;align-items:baseline;font-size:15px;font-weight:600;padding:14px 0 6px;border-top:1px solid var(--color-border)}
.pj .kind{font-size:12px;font-weight:600;color:var(--color-text-subtle);margin:10px 0 2px;display:flex;gap:6px}
.pj .ent{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:baseline;font-size:14px;padding:5px 0}
.pj .ent .cp-meta{font-size:12px}
.pj .bar{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px}
.pj .kvgrid{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px 16px;font-size:14px}
.pj .kvgrid span{color:var(--color-text-subtle)}
.pj .ro{font-size:12px;color:var(--color-text-subtle);border-top:1px solid var(--color-border);padding-top:12px}
.pj .ho{border:1px solid var(--color-border);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6}
.pj .ho b{font-weight:600}
.pj .codebox{font-family:var(--font-mono);font-size:12px;background:var(--color-surface-2);border-radius:8px;padding:10px 12px;line-height:1.6;word-break:break-all}
"""
PHONE = """
.pj .body{grid-template-columns:minmax(0,1fr)}.pj .side{display:none}.pj .main{padding:16px 16px 96px;gap:14px}
.pj .cp-appbar{padding:0 16px}.pj .hide-m{display:none!important}
.pj .cols{grid-template-columns:minmax(0,1fr)!important}
.pj .days{grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.pj .days button{padding:6px 4px;justify-items:center}.pj .days button b{font-size:15px}
.pj .cp-tabbar{position:absolute;left:0;right:0;bottom:0}
.pj .hd h1{font-size:22px}
"""

PROJS = [("示例编辑器", 4), ("示例网关", 2)]
def side(cur="今天", proj=None):
    items = f'<a href="#" {"aria-current=page" if cur == "今天" else ""}><span>今天</span><span>3</span></a><a href="#" {"aria-current=page" if cur == "动态" else ""}><span>动态</span></a>'
    ps = "".join(f'<a href="#" {"aria-current=page" if proj == n else ""}><span>{n}</span><span>{c}</span></a>' for n, c in PROJS)
    return f'<nav class="cp-nav side" aria-label="工作台">{items}<div class="cp-nav-h" style="display:flex;justify-content:space-between;align-items:center">项目<button class="cp-iconbtn" aria-label="添加项目" style="width:26px;height:26px">{IC["plus"]}</button></div>{ps}<div style="height:24px"></div><a href="#" style="color:var(--color-text-subtle)"><span>退出登录</span></a></nav>'

def appbar():
    return f'<header class="cp-appbar"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi<small>工作台</small></a><div class="right"><span class="cp-chip hide-m">示意数据</span><span class="cp-avatar">小</span></div></header>'

def shell(body, cur="今天", proj=None, phone=False, tab="今天"):
    tb = ""
    if phone:
        tb = '<nav class="cp-tabbar" aria-label="底部导航">' + "".join(f'<a href="#" {"aria-current=page" if t == tab else ""}>{t}</a>' for t in ["今天", "池子", "动态", "项目"]) + '</nav>'
    return f'<div class="pj">{appbar()}<div class="body">{side(cur, proj)}<main class="main">{body}</main></div>{tb}</div>'

def item(t, meta="", acts="", hl=False):
    return f'<div class="row-item{" hl" if hl else ""}"><span class="t">{t}</span><span class="acts">{acts}</span><span class="m">{meta}</span></div>'

POOL = [("发布", [("授权示例上线", "截止 11-13 周五", True, ""), ("发布示例版本说明", "", False, "")]),
        ("网关", [("修复示例缺陷", "截止 11-09 周一", False, "缺陷"), ("示例网关限流调整", "", False, "查过 2 次 · 最近 11-05 12:00")]),
        ("流程", [("确认示例设置", "截止 11-07 周六", True, ""), ("示例想法：整理周报模板", "", False, "查过 1 次 · 最近 11-06 09:30")])]
PUT = '<button class="cp-btn cp-btn-secondary">放进今天</button><button class="cp-btn cp-btn-ghost" style="color:var(--color-text-muted)">删除</button>'
def pool_box(filtered=False, empty=False, q=""):
    groups = ""
    if not empty:
        for g, items in POOL:
            its = [x for x in items if (not filtered or x[2])]
            if not its: continue
            rows = "".join(item(t, (f'<span class="cp-chip need">需要你</span>' if need else "") + (f'<span class="cp-meta">{d}</span>' if d else "") + (f'<span class="cp-meta">{n}</span>' if n else ""), PUT, hl=(i == 0 and g == "发布")) for i, (t, d, need, n) in enumerate(its))
            groups += f'<details class="grp" open><summary><span style="flex:1">{g}</span><span class="cp-meta">{len(its)}</span></summary>{rows}</details>'
    else:
        clr = '<br><button class="cp-btn cp-btn-ghost cp-btn-sm" style="margin-top:6px">清除筛选</button>' if filtered else ""
        groups = f'<div class="ph-empty" style="margin-top:14px">没有符合条件的池子任务。{clr}</div>'
    cnt = "3 / 6" if filtered and not empty else ("0 / 6" if filtered else ("0 / 0" if empty else "6 / 6"))
    seg_need = 'aria-pressed="true"' if filtered else 'aria-pressed="false"'
    clear = '<button class="cp-btn cp-btn-ghost cp-btn-sm" style="min-height:32px">清除筛选</button>' if filtered else ""
    return f'''<section class="box"><h2>池子 <small>{cnt}</small></h2>
<div style="position:relative;margin:12px 0 10px"><input class="cp-input" placeholder="搜索标题或分类" value="{q}" aria-label="搜索池子" style="padding-left:36px;min-height:40px;font-size:14px"><span style="position:absolute;left:12px;top:12px;color:var(--color-text-subtle)">{IC["search"]}</span></div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div class="cp-seg" role="group" aria-label="筛选"><button {seg_need}>只看需要你 · 3</button><button aria-pressed="false">7 天内到期 · 3</button></div>{clear}</div>{groups}</section>'''

DONE_ACT = '<button class="cp-btn cp-btn-ghost" style="color:var(--color-text-muted)">退回池子</button><button class="cp-btn cp-btn-secondary">完成</button>'
def today_box(empty_mine=False, empty_all=False):
    mine = '<div class="ph-empty">从池子拿一件过来</div>' if (empty_mine or empty_all) else (
        item("选择示例方案", '<span class="cp-chip need">需要你</span><span class="cp-meta" style="color:var(--color-warning)">昨天没做完</span>', DONE_ACT) +
        item("续费示例服务器（这条标题故意写得很长，用来检查卡片两行截断与窄屏不溢出）", '<span class="cp-meta">截止 11-08 周日</span>', DONE_ACT))
    jg = '<div class="ph-empty">从池子拿一件过来</div>' if empty_all else item("整理示例变更记录", '<span class="cp-chip"><span class="cp-dot live"></span>执行中</span><span class="cp-meta">截止 11-09 周一</span>', '<button class="cp-btn cp-btn-ghost" style="color:var(--color-text-muted)">退回池子</button>')
    n = 0 if empty_all else (1 if empty_mine else 3)
    return f'''<section class="box"><h2>今天 <small>{n}</small></h2>
<div class="lane"><h3>你的 <small>做完点「完成」</small></h3>{mine}</div>
<div class="lane" style="margin-top:18px"><h3>建国的 <small>合并后自动移到做完</small></h3>{jg}</div></section>'''

def done_box(empty=False):
    rows = '<div class="ph-empty">还没有</div>' if empty else "".join(f'<div class="cp-task"><span class="cp-check done"></span><span style="flex:1">{t}</span><span class="cp-meta">{w}</span></div>' for t, w in [("确认示例设置", "18:30"), ("发布示例说明", "15:02"), ("更新示例文档", "10:15")])
    return f'<section class="box"><h2>做完 <small>{0 if empty else 3}</small></h2><div style="margin-top:8px">{rows}</div></section>'

def head_today(done="3 / 6", pct=50):
    return f'<div class="hd"><div><h1>今天</h1><span class="cp-meta">11 月 6 日 · 周五</span></div><div class="r" style="min-width:220px;display:grid;gap:6px;justify-items:end"><span class="cp-meta">已完成 <b style="color:var(--color-text);font-size:15px">{done}</b></span><div class="cp-progress" style="width:220px"><i style="width:{pct}%"></i></div></div></div>'

def today(phone=False):
    cols = f'<div class="cols" style="display:grid;grid-template-columns:1.25fr 1fr .75fr;gap:16px;align-items:start">{pool_box() if not phone else ""}{today_box()}{done_box()}</div>'
    return shell(head_today() + cols, phone=phone)

def today_states():
    banner = f'<div class="cp-banner err">{IC["error"]}<span>操作失败：网络断开，请再试一次。</span></div>'
    busy = item("授权示例上线", '<span class="cp-chip need">需要你</span>', '<button class="cp-btn cp-btn-secondary" aria-disabled="true">放进今天</button><button class="cp-btn cp-btn-ghost" aria-disabled="true">删除</button>')
    return shell(f'''{head_today("0 / 0", 0)}
<p class="cp-head" style="margin:0"><span>① 什么都没有：池子空、今天空、做完空</span></p>
<div class="cols" style="display:grid;grid-template-columns:1.25fr 1fr .75fr;gap:16px;align-items:start">{pool_box(empty=True)}{today_box(empty_all=True)}{done_box(empty=True)}</div>
<p class="cp-head" style="margin:12px 0 0"><span>② 筛选后没有结果（可清除）；今天只剩建国的</span></p>
<div class="cols" style="display:grid;grid-template-columns:1.25fr 1fr .75fr;gap:16px;align-items:start">{pool_box(filtered=True, empty=True, q="不存在的词")}{today_box(empty_mine=True)}{done_box()}</div>
<p class="cp-head" style="margin:12px 0 0"><span>③ 筛选「只看需要你」有结果 · ④ 操作失败提示 · ⑤ 请求进行中按钮全部变灰</span></p>
<div class="cols" style="display:grid;grid-template-columns:1.25fr 1fr .75fr;gap:16px;align-items:start">{pool_box(filtered=True)}<div style="display:grid;gap:12px">{banner}<section class="box">{busy}</section></div><div></div></div>''')

HAND = '''<div class="ho"><div style="display:flex;justify-content:space-between"><span><span class="cp-chip"><span class="cp-dot live"></span>进行中</span> <b>Codex</b></span><span class="cp-meta">11/5 14:20</span></div><p style="margin:6px 0 0">已完成示例的第一部分。</p><p style="margin:2px 0 0;color:var(--color-text-muted)">下一步：补充示例验收项。</p></div>
<div class="ho"><div style="display:flex;justify-content:space-between"><span><span class="cp-chip need">受阻</span> <b>Claude</b></span><span class="cp-meta">11/4 09:10</span></div><p style="margin:6px 0 0">等待示例授权。</p><p style="margin:2px 0 0;color:var(--color-text-muted)">下一步：授权后继续。</p><p style="margin:2px 0 0;color:var(--color-danger)">卡点：缺少示例令牌。</p></div>'''
def drawer_inner(kind="full"):
    if kind == "loading":
        return f'<header><h3 style="color:var(--color-text-subtle)">正在读取…</h3><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header><div class="bd">' + "".join(f'<div class="cp-skel" style="height:{h}px;width:{w}"></div>' for h, w in [(14, "40%"), (16, "90%"), (16, "70%"), (60, "100%")]) + '</div>'
    if kind == "error":
        return f'<header><h3>待办</h3><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header><div class="bd"><div class="cp-empty"><b>这条待办已不存在</b>可能已在仓库里删除。关掉后列表会刷新。</div></div>'
    if kind == "done":
        return f'''<header><div style="flex:1"><span class="cp-chip" style="color:var(--color-success)">已完成</span><h3 style="margin-top:8px">确认示例设置</h3></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>
<div class="bd"><div class="kvgrid"><span>项目</span><b style="font-weight:500">示例编辑器 · 流程</b><span>是什么</span><span style="color:var(--color-text)">示例说明。</span><span>出处</span><code style="font-size:13px">docs/a.md</code><span>记录</span><span style="color:var(--color-text)">2026-11-03 · 完成于 11/5 18:30</span></div><p class="ro">内容来自仓库里的待办，网页只读；要改请在仓库里改，下次推送后更新。</p></div>'''
    if kind == "min":
        return f'''<header><div style="flex:1"><span class="cp-chip">想法</span><h3 style="margin-top:8px">示例想法：整理周报模板</h3></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>
<div class="bd"><div class="kvgrid"><span>项目</span><b style="font-weight:500">示例网关 · 流程</b><span>记录</span><span style="color:var(--color-text)">—</span></div><p class="ro">可选字段为空时整行不出现；没有交接就没有「交接」段。</p></div>'''
    return f'''<header><div style="flex:1"><div class="row" style="gap:6px"><span class="cp-chip">待决定</span><span class="cp-chip need">需要你：决定</span></div><h3 style="margin-top:10px">选择示例方案</h3><span class="cp-meta">截止 2026-11-08 · 2 天后</span></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>
<div class="bd"><div class="kvgrid"><span>项目</span><b style="font-weight:500">示例编辑器 · 流程</b><span>是什么</span><span style="color:var(--color-text)">在两个方案里选一个。</span><span>不做会怎样</span><span style="color:var(--color-text)">发布推迟。</span><span>建议</span><span style="color:var(--color-text)">选方案 A。</span><span>出处</span><code style="font-size:13px">docs/a.md</code><span>关联</span><code style="font-size:13px">docs/b.md · docs/c.md</code><span>记录</span><span style="color:var(--color-text)">2026-11-03</span></div>
<div style="display:grid;gap:10px"><p class="cp-head" style="margin:0"><span style="color:var(--color-text);font-weight:600;font-size:14px">交接</span><span>每个执行者最新一条</span></p>{HAND}</div>
<p class="ro">内容来自仓库里的待办，网页只读；要改请在仓库里改，下次推送后更新。</p></div>'''

def drawer_page():
    cols = f'<div style="display:grid;grid-template-columns:1.25fr 1fr .75fr;gap:16px;align-items:start;opacity:.5">{pool_box()}{today_box()}{done_box()}</div>'
    return f'''<div class="pj" style="position:relative">{appbar()}<div class="body">{side()}<main class="main">{head_today()}{cols}</main></div>
<div style="position:absolute;inset:56px 0 0 0;display:flex"><div class="cp-scrim" style="flex:1"></div><aside class="cp-drawer" style="width:460px" aria-label="任务详情">{drawer_inner()}</aside></div></div>'''

def drawer_states():
    return '<div class="pj" style="padding:40px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;align-items:start">' + "".join(f'<div><p class="cp-head"><span>{t}</span></p><aside class="cp-drawer" style="width:auto;border:1px solid var(--color-border);border-radius:14px;min-height:420px">{drawer_inner(k)}</aside></div>' for t, k in [("已完成：只有「已完成」，不显示需要你和截止", "done"), ("只有基础字段", "min"), ("正在读取", "loading"), ("读取失败 / 已删除", "error")]) + '</div>'

def jdays(counts, labels, on=None):
    mx = max(counts) or 1
    return '<div class="days" role="group" aria-label="本周每天">' + "".join(f'<button class="{"zero" if c == 0 else ""}{" on" if l == on else ""}"><span>{l}</span><b>{c}</b><i style="width:{int(c / mx * 100)}%;{"background:transparent" if c == 0 else ""}"></i></button>' for c, l in zip(counts, labels)) + '</div>'

def day_block(title, n, body=None, collapsed=False):
    if body is None:
        body = '<p class="cp-meta" style="margin:4px 0 12px">当天没有记录。</p>' if n == 0 else ""
    return f'<div class="dayh"><span>{title}</span><span class="cp-meta">{n} 条</span></div>{"" if collapsed else body}'

def jbody_today():
    return '''<div class="kind">上线 · 1</div><div class="ent"><span style="color:var(--color-action)">↑</span><span>示例上线：工作台日报</span><span class="cp-meta">示例编辑器</span></div>
<div class="kind">完成 · 4</div><div class="ent"><span style="color:var(--color-success)">✓</span><span>完成示例 1</span><span class="cp-meta">示例编辑器</span></div><div class="ent"><span style="color:var(--color-success)">✓</span><span>完成示例 2</span><span class="cp-meta">示例编辑器</span></div><div class="ent"><span style="color:var(--color-success)">✓</span><span>完成示例 3</span><span class="cp-meta">示例网关</span></div><button class="cp-btn cp-btn-ghost cp-btn-sm" style="min-height:28px;padding:0;color:var(--color-text-muted)">另 1 件</button>
<div class="kind">查过 · 2</div><div class="ent"><span style="color:var(--color-text-subtle)">⌕</span><span>已检查的示例 <span class="cp-meta">· 结论：持平</span></span><span class="cp-meta">示例网关</span></div><div class="ent"><span style="color:var(--color-text-subtle)">⌕</span><span>另一个已检查的示例 <span class="cp-meta">· 结论：无回信</span></span><span class="cp-meta">示例编辑器</span></div>
<details style="margin:6px 0 12px"><summary class="cp-meta" style="cursor:pointer">另有 1 条改动</summary></details>'''

def journal_head(rng="2026-11-02 至 11-08", proj="全部项目", sums=(14, 4, 3)):
    return f'''<div class="hd"><div><h1>动态</h1><span class="cp-meta">工作日报 · {rng}</span></div><div class="r"><div class="cp-select-wrap" style="width:160px"><select class="cp-select" aria-label="项目" style="min-height:36px;font-size:14px"><option>{proj}</option></select>{IC["chev"]}</div>
<div class="cp-datebar"><button class="cp-iconbtn" aria-label="上一周">{CHEV_L}</button><button class="cp-btn cp-btn-secondary cp-btn-sm">本周</button><button class="cp-iconbtn" aria-label="下一周" aria-disabled="true">{CHEV_R}</button></div></div></div>
<div class="cols" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">{"".join(f'<div class="cp-stat" style="padding:12px 16px"><div class="cp-head" style="margin:0 0 4px"><span>{k}</span></div><div class="cp-stat-num" style="font-size:26px">{v}</div></div>' for k, v in zip(["完成", "上线", "查过"], sums))}</div>'''

def journal(phone=False):
    labels = ["一 11-02", "二 11-03", "三 11-04", "四 11-05", "五 11-06", "六 11-07", "日 11-08"] if not phone else ["一", "二", "三", "四", "五", "六", "日"]
    days = [("11 月 2 日 周一", 2, True), ("11 月 3 日 周二", 0, True), ("11 月 4 日 周三", 5, True), ("11 月 5 日 周四", 9, True), ("11 月 6 日 周五 · 今天", 6, False), ("11 月 7 日 周六", 0, False), ("11 月 8 日 周日", 0, False)]
    blocks = "".join(day_block(t, n, jbody_today() if "今天" in t else None, collapsed=c) for t, n, c in days)
    return shell(journal_head() + jdays([2, 0, 5, 9, 6, 0, 0], labels, labels[4]) + f'<section class="box" style="padding-top:4px">{blocks}</section>', cur="动态", phone=phone, tab="动态")

def journal_states():
    past = day_block("10 月 29 日 周四", 9, '''<div class="kind">上线 · 2</div><div class="ent"><span style="color:var(--color-action)">↑</span><span>示例上线：网关限流</span><span class="cp-meta">示例网关</span></div><div class="ent"><span style="color:var(--color-action)">↑</span><span>示例上线：编辑器草稿</span><span class="cp-meta">示例编辑器</span></div>
<div class="kind">完成 · 5</div>''' + "".join(f'<div class="ent"><span style="color:var(--color-success)">✓</span><span>完成示例 {i}</span><span class="cp-meta">示例{"编辑器" if i % 2 else "网关"}</span></div>' for i in range(1, 6)) + '<button class="cp-btn cp-btn-ghost cp-btn-sm" style="min-height:28px;padding:0;color:var(--color-text-muted)">收起完成事项</button><details open style="margin:6px 0 12px"><summary class="cp-meta" style="cursor:pointer">另有 2 条改动</summary><div class="ent"><span></span><span>其他改动示例 1</span><span class="cp-meta">示例编辑器</span></div><div class="ent"><span></span><span>其他改动示例 2</span><span class="cp-meta">示例网关</span></div></details>')
    empty_week = "".join(day_block(f"10 月 {d} 日", 0, collapsed=True) for d in (19, 20, 21))
    return f'''<div class="pj" style="padding:40px;display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start">
<div style="display:grid;gap:14px"><p class="cp-head" style="margin:0"><span>过去某周 · 点某天展开</span></p>{journal_head("2026-10-26 至 11-01", "全部项目", (17, 6, 2))}{jdays([1, 3, 0, 9, 4, 2, 0], ["一", "二", "三", "四", "五", "六", "日"], "四")}<section class="box" style="padding-top:4px">{day_block("10 月 28 日 周三", 0, collapsed=True)}{past}</section></div>
<div style="display:grid;gap:14px"><p class="cp-head" style="margin:0"><span>空周：每天默认折叠，只剩标题与「0 条」</span></p>{journal_head("2026-10-19 至 10-25", "全部项目", (0, 0, 0))}<section class="box" style="padding-top:4px">{empty_week}<p class="cp-meta" style="margin:10px 0 4px">……其余 4 天同样折叠</p></section>
<p class="cp-head" style="margin:14px 0 0"><span>按项目筛选：汇总、每天格子、条数同步重算</span></p>{journal_head("2026-11-02 至 11-08", "示例网关", (2, 1, 1))}
<p class="cp-head" style="margin:14px 0 0"><span>加载 · 失败 · 数据过多被截断</span></p><div class="box cp-pageload" style="min-height:80px;grid-auto-flow:column">{IC["loader"]}正在读取工作日报…</div><div class="cp-banner err">{IC["error"]}<span>读取失败</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div><div class="cp-banner">{IC["alert"]}<span>本周数据超过 500 条，日报已截断。</span></div>
<p class="cp-meta">只有 1 个项目时：不显示项目下拉，条目右侧也不写项目名。</p></div></div>'''

def project_page(phone=False, empty=False):
    if empty:
        body = f'''<div class="hd"><div><h1>示例网关</h1><span class="cp-meta">本地仓库 · 推送 从未</span></div></div>
<div class="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">{"".join(f'<section class="box"><h2>{t}</h2><div class="ph-empty" style="margin-top:12px">{e}</div></section>' for t, e in [("待办构成", "还没有推送过待办。"), ("项目卡", "规则入口、隔离、提交、验收、合并都还没填。"), ("进行中分支", "没有进行中的分支。"), ("这个项目的待办", "没有未完成的待办。"), ("最近变更", "还没有变更记录。"), ("交接", "还没有交接记录。")])}</div>
{settings_box(no_token=True)}'''
        return shell(body, cur=None, proj="示例网关", phone=phone, tab="项目")
    stat = [("待决定", 3, "#D9822B"), ("执行", 4, "var(--state-desk)"), ("缺陷", 2, "var(--color-danger)"), ("待确认", 2, "#7FA3DA"), ("想法", 1, "var(--state-unknown)")]
    bar = '<div class="bar" style="margin:12px 0 10px">' + "".join(f'<i style="flex:{n};background:{c}"></i>' for _, n, c in stat) + '</div><div class="cp-legend">' + "".join(f'<span style="--c:{c}">{k} {n}</span>' for k, n, c in stat) + '</div>'
    todos = [("续费示例服务器（这条标题故意写得很长，用来检查卡片两行截断与窄屏不溢出）", "到场", "11/6", "基础设施"), ("选择示例方案", "决定", "11/4", "流程"), ("授权示例上线", "授权", "11/13", "发布"), ("确认示例设置", "确认", "11/20", "流程"), ("修复示例缺陷", "", "11/9", "网关"), ("示例想法：整理周报模板", "", "", "流程")]
    tl = "".join(item(t, (f'<span class="cp-chip need">需要你：{n}</span>' if n else "") + (f'<span class="cp-meta">{d}</span>' if d else "") + f'<span class="cp-meta">{c}</span>') for t, n, d, c in todos)
    body = f'''<div class="hd"><div><h1>示例编辑器</h1><span class="cp-meta">example/editor · 推送 5 分钟前 · <code>a1b2c3d</code></span></div><div class="r"><span class="cp-fresh">推送正常</span></div></div>
<div class="cols" style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start">
<div style="display:grid;gap:16px"><section class="box"><h2>待办构成 <small>12 条未完成 · 4 条需要你 · 7 天完成 3</small></h2>{bar}</section>
<section class="box"><h2>这个项目的待办 <small>点开看详情</small></h2><div style="margin-top:8px">{tl}</div></section>
<section class="box"><h2>最近变更</h2><div style="margin-top:8px">{"".join(f'<div class="cp-kv"><span>{d}</span><span style="color:var(--color-text)">{t}</span></div>' for d, t in [("11-06", "示例变更：工作台日报改版"), ("11-05", "示例变更：网关限流调整"), ("11-05", "示例变更：文档链接修正"), ("11-04", "示例变更：新增检查项")])}</div></section></div>
<div style="display:grid;gap:16px"><section class="box"><h2>项目卡 <small>取自仓库规则的「Agent 协作适配」段</small></h2><div class="kvgrid" style="margin-top:12px"><span>规则入口</span><code>AGENTS.md</code><span>隔离</span><span style="color:var(--color-text)">worktree</span><span>提交</span><span style="color:var(--color-text)">允许</span><span>验收</span><code>pnpm check</code><span>合并</span><code>agent-team merge</code></div></section>
<section class="box"><h2>进行中分支 <small>2</small></h2><div style="margin-top:8px"><div class="cp-kv" style="min-height:44px"><div><code style="color:var(--color-text)">team/example-work</code><div class="cp-meta">领先 3 · 5 分钟前</div></div><span class="cp-chip">有记录</span></div><div class="cp-kv" style="min-height:44px"><div><code style="color:var(--color-text)">fix/example-bug</code><div class="cp-meta">领先 1 · 2 小时前</div></div></div></div></section>
<section class="box"><h2>交接 <small>每个任务最新一条</small></h2><div style="display:grid;gap:10px;margin-top:10px">{HAND}</div></section>
{settings_box()}</div></div>'''
    return shell(body, cur=None, proj="示例编辑器", phone=phone, tab="项目")

def settings_box(no_token=False, confirm=False, reveal=False, copied=False, failed=False):
    tok = "没有令牌" if no_token else ("生成于 11/6 10:20，最近使用 刚刚" if reveal else "生成于 11/3 10:20，最近使用 5 分钟前")
    extra = ""
    if confirm:
        extra = f'<div class="cp-alert cp-alert-warning" style="margin-top:12px">{IC["alert"]}<div>重新生成后旧令牌立即失效，仓库里配置的令牌要一起换掉。<div class="row" style="margin-top:10px"><button class="cp-btn cp-btn-destructive cp-btn-sm">确认重新生成</button><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button></div></div></div>'
    if reveal:
        extra = f'''<div style="margin-top:12px;display:grid;gap:10px;padding:14px;border:1px solid var(--color-action);border-radius:12px;background:var(--brand-soft)"><b style="font-size:14px">推送令牌只显示这一次</b><span class="cp-help" style="color:var(--color-text)">存进仓库所在电脑的钥匙串，不要写进仓库、聊天或文档。</span>
<div class="cp-copy"><input class="cp-input" readonly value="[示例令牌，占位]" aria-label="推送令牌" style="min-height:40px"><button class="cp-btn cp-btn-secondary cp-btn-sm">{COPY}{"已复制" if copied else "复制"}</button></div><div class="codebox">POST /api/ingest/example-editor<br>Authorization: Bearer &lt;令牌&gt;</div></div>'''
    if failed:
        extra = f'<div class="cp-banner err" style="margin-top:12px">{IC["error"]}<span>重新生成令牌失败，旧令牌仍然有效。</span></div>'
    btn = "" if (confirm or reveal) else f'<button class="cp-btn cp-btn-secondary cp-btn-sm" style="margin-top:14px">{"生成推送令牌" if no_token else "重新生成推送令牌"}</button>'
    return f'''<section class="box"><h2>推送与设置</h2><div class="kvgrid" style="margin-top:12px;align-items:center"><span>推送令牌</span><span style="color:var(--color-text)">{tok}</span><span>状态</span><div class="cp-seg" role="group" aria-label="项目状态"><button aria-pressed="true">进行中</button><button aria-pressed="false">暂停</button><button aria-pressed="false">归档</button></div></div>{btn}{extra}</section>'''

def project_states():
    return f'''<div class="pj" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start">
<div><p class="cp-head"><span>默认：状态分段点一下立即保存</span></p>{settings_box()}</div>
<div><p class="cp-head"><span>点「重新生成」后二次确认</span></p>{settings_box(confirm=True)}</div>
<div><p class="cp-head"><span>重新生成失败</span></p>{settings_box(failed=True)}</div>
<div style="grid-column:span 2"><p class="cp-head"><span>新令牌只显示一次（复制后按钮变「已复制」；剪贴板被拒绝时改为选中文本）</span></p>{settings_box(reveal=True, copied=True)}</div>
<div><p class="cp-head"><span>项目页加载与出错</span></p><div style="display:grid;gap:12px"><div class="box cp-pageload" style="min-height:90px;grid-auto-flow:column">{IC["loader"]}正在读取项目…</div><div class="cp-empty"><b>没有这个项目</b>可能已经归档，或者链接写错了。<a class="cp-btn cp-btn-secondary cp-btn-sm" href="#" style="margin-top:6px">回到今天</a></div></div></div></div>'''

def dialogs():
    def dlg(step, idv, name, repo, foot, err=""):
        e = f'<span class="cp-error">{I16("error")}{err}</span>' if err else ""
        return f'''<div><p class="cp-head"><span>{step}</span></p><div class="cp-dialog" style="width:auto"><div style="display:flex;justify-content:space-between;align-items:flex-start"><h3 class="cp-dialog-title">添加项目</h3><button class="cp-iconbtn" aria-label="关闭" style="border:0">{IC["x"]}</button></div>
<div style="display:grid;gap:14px;margin:18px 0 22px"><div class="cp-field"><label class="cp-label">ID</label><input class="cp-input" value="{idv}" placeholder="例如 mybrain" {"aria-invalid=true" if err else ""} {"style='outline:2px solid var(--color-focus);outline-offset:2px'" if step.startswith("①") else ""}><span class="cp-help">用在推送地址里，建好后不能改</span>{e}</div>
<div class="cp-field"><label class="cp-label">名称</label><input class="cp-input" value="{name}"></div><div class="cp-field"><label class="cp-label">GitHub 仓库 <span style="font-weight:400;color:var(--color-text-subtle)">可选</span></label><input class="cp-input" value="{repo}" placeholder="owner/repo"><span class="cp-help">便于命令行识别</span></div></div>
<div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button>{foot}</div></div></div>'''
    pri = '<button class="cp-btn cp-btn-primary cp-btn-sm">建项目并生成令牌</button>'
    return f'''<div class="pj" style="padding:40px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;align-items:start">
{dlg("① 打开：焦点在 ID；Esc、点遮罩或 × 关闭", "", "", "", pri)}
{dlg("② 填写中", "example-new", "示例项目", "example/new", pri)}
{dlg("③ 提交中：按钮忙碌，阻止重复提交", "example-new", "示例项目", "example/new", '<button class="cp-btn cp-btn-primary cp-btn-sm" aria-busy="true">' + IC["loader"] + '正在建…</button>')}
{dlg("④ 出错：ID 已存在", "example-new", "示例项目", "example/new", pri, "这个 ID 已经有项目了，换一个")}
<div style="grid-column:span 2"><p class="cp-head"><span>⑤ 建好后：令牌只显示一次，「完成」关闭</span></p><div class="cp-dialog" style="width:auto"><h3 class="cp-dialog-title">「示例项目」建好了</h3><div style="margin:14px 0 20px;display:grid;gap:10px"><span class="cp-help" style="color:var(--color-text)">推送令牌只显示这一次。存进仓库所在电脑的钥匙串，不要写进仓库、聊天或文档。</span><div class="cp-copy"><input class="cp-input" readonly value="[示例令牌，占位]" aria-label="推送令牌" style="min-height:40px"><button class="cp-btn cp-btn-secondary cp-btn-sm">{COPY}复制</button></div><div class="codebox">POST /api/ingest/example-new<br>Authorization: Bearer &lt;令牌&gt;</div></div><div class="cp-dialog-actions"><button class="cp-btn cp-btn-primary cp-btn-sm">完成</button></div></div></div></div>'''

def login():
    return f'''<div class="pj" style="min-height:760px;display:grid;grid-template-columns:1.1fr .9fr">
<div style="padding:72px 64px;display:grid;align-content:space-between;background:var(--color-surface);border-right:1px solid var(--color-border)"><div style="display:flex;gap:10px;align-items:center;font-weight:600"><img src="{LOGO}" alt="" style="width:26px">CodePi<span class="cp-meta" style="font-weight:400">工作台</span></div>
<div><h1 style="font-size:48px;line-height:1.15;letter-spacing:-.03em;font-weight:600;margin:0">所有项目要做的事，<br>一处看。</h1><p style="font-size:18px;line-height:1.6;color:var(--color-text-muted);max-width:480px;margin:20px 0 0">待办、要你拍板的事、进行中的分支和最近做完的事，由各个仓库推上来。</p></div><span class="cp-meta">kedoupi（codepi）· 私人项目空间 · 仅本人访问</span></div>
<div style="display:grid;place-items:center;padding:48px"><div class="box" style="width:380px;padding:32px;display:grid;gap:16px"><h2 style="font-size:22px">进入项目工作台</h2><p class="cp-help" style="margin:0;font-size:15px">通过 CodePi 统一登录。</p><button class="cp-btn cp-btn-primary">统一登录</button><p class="cp-meta" style="margin:0;line-height:1.6">登录状态最多保留 7 天。退出会同时撤销统一浏览器会话。</p></div></div></div>'''

def global_states():
    return f'''<div class="pj" style="padding:40px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:stretch">
<div class="box cp-pageload" style="min-height:260px"><img src="{LOGO}" alt="">正在读取项目工作台…</div>
<div class="box" style="display:grid;gap:12px;align-content:center;justify-items:start;padding:32px"><span class="cp-chip need">打不开</span><h2 style="font-size:22px">工作台暂时打不开</h2><p class="cp-help" style="margin:0">读取账号或项目列表失败，可能是网络断开或服务正在更新。</p><button class="cp-btn cp-btn-primary">重新加载</button></div>
<div class="box" style="display:grid;gap:12px;align-content:center;padding:32px"><h2 style="font-size:18px">登录过期</h2><p class="cp-help" style="margin:0">接口返回 401 时直接回到登录页，并带上原来的地址；页面上没有单独的「未登录」状态。</p></div>
<div class="box"><h2>今天 · 主区加载</h2><div style="display:grid;gap:10px;margin-top:14px">{"".join(f'<div class="cp-skel" style="height:{h}px;width:{w}"></div>' for h, w in [(36, "100%"), (16, "80%"), (16, "90%"), (16, "60%")])}</div></div>
<div class="box"><h2>今天 · 读取失败（还没有数据）</h2><div class="cp-banner err" style="margin-top:14px">{IC["error"]}<span>读取失败</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div></div>
<div class="box"><h2>路由兜底</h2><p class="cp-help" style="margin:12px 0 0">不认识的地址回到「今天」。</p></div></div>'''

def pool_phone():
    return shell(head_today() + pool_box(), phone=True, tab="池子")
def task_phone():
    return f'<div class="pj" style="min-height:100%"><aside class="cp-drawer" style="width:auto;border:0;box-shadow:none;min-height:844px">{drawer_inner()}</aside></div>'

DESK = [("P-Today", "今天", today, 1100), ("P-Today-States", "今天 · 空、筛选、失败、忙碌", today_states, 2200), ("P-Drawer", "今天 · 任务抽屉", drawer_page, 1000), ("P-Drawer-States", "任务抽屉 · 状态", drawer_states, 560),
        ("P-Journal", "动态 · 本周", journal, 1250), ("P-Journal-States", "动态 · 过去、空周、筛选、加载", journal_states, 1500), ("P-Project", "项目页", project_page, 1500),
        ("P-Project-Empty", "项目页 · 全空", lambda: project_page(empty=True), 900), ("P-Project-States", "项目页 · 推送与设置", project_states, 900), ("P-Dialogs", "添加项目", dialogs, 1200), ("P-Login", "登录", login, 800), ("P-Global-States", "全局状态", global_states, 700)]
PH = [("P-Today-Phone", "今天 · 手机", lambda: today(True), 1300), ("P-Pool-Phone", "池子 · 手机", pool_phone, 1500), ("P-Journal-Phone", "动态 · 手机", lambda: journal(True), 1800), ("P-Project-Phone", "项目页 · 手机", lambda: project_page(True), 3000), ("P-Task-Phone", "任务详情 · 手机", task_phone, 1100)]
for n, t, fn, h in DESK:
    add(n, t, 1440, H.get(n, h), fn(), CSS)
for n, t, fn, h in PH:
    add(n, t, 390, H.get(n, h), fn(), CSS + PHONE)
print("proj ok")
