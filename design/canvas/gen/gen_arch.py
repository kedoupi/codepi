"""专业画法架构图（规范：docs/designs/architecture-diagram-spec-2026-11-07.md）。
Ctx-WWW 上下文图 / Arch-WWW 分层架构图 / Feat-WWW 功能树 / G-Diagram 规范板。HA="名=高,…" 覆盖高度。"""
import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HA", "").split(",") if x)}

CSS = """
.ar{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.ar h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.ar .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 48px;max-width:900px}
.ar .legend{display:flex;gap:24px;align-items:center;justify-content:flex-end;font-size:13px;color:var(--color-text-muted);margin-top:48px;flex-wrap:wrap}
.ar .legend > span{display:inline-flex;gap:8px;align-items:center}
.ar .sw{display:inline-block;width:24px;height:16px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface)}
.ar .sw.hi{border-color:var(--color-action);background:var(--brand-soft)}
.ar .sw.ext{border:1px dashed var(--color-border-strong);background:var(--color-surface-2)}
.ar .sw.strip{background:var(--color-surface-2)}
.ar .sw.person{border-color:var(--color-border-strong);background:var(--color-surface)}
.ar .ln{display:inline-block;width:24px;border-top:2px solid var(--color-border-strong)}
.ar .ln.dash{border-top-style:dashed}
.ar .ref{font-size:12px;font-family:var(--font-mono);padding:2px 8px;border-radius:6px;background:var(--color-surface);border:1px solid var(--color-border);white-space:nowrap}
.ar .ref.m{background:var(--brand-soft);border-color:var(--color-action)}
/* 上下文图 */
.ar .ctx{position:relative;width:1312px;height:560px}
.ar .ctx svg{position:absolute;left:0;top:0;width:1312px;height:560px}
.ar .ctx svg line{stroke:var(--color-border-strong);stroke-width:2}
.ar .ctx svg path.ah{fill:var(--color-border-strong)}
.ar .ctx .box{position:absolute;box-sizing:border-box;width:256px;height:80px;border-radius:var(--radius-card);padding:12px 16px;display:grid;align-content:center;gap:4px}
.ar .ctx .box b{font-size:16px;font-weight:600}
.ar .ctx .box span{font-size:12px;line-height:1.5;color:var(--color-text-muted)}
.ar .ctx .box.ext{border:1px dashed var(--color-border-strong);background:var(--color-surface-2)}
.ar .ctx .box.person{border:1px solid var(--color-border-strong);background:var(--color-surface)}
.ar .ctx .box.core{border:1px solid var(--color-action);background:var(--brand-soft);height:416px;text-align:center;justify-items:center;gap:8px}
.ar .ctx .box.core b{font-size:24px}
.ar .ctx .box.core span{font-size:14px;color:var(--color-text)}
.ar .ctx .lb{position:absolute;box-sizing:border-box;width:160px;text-align:center;font-size:13px;line-height:24px;background:var(--color-background);color:var(--color-text)}
/* 分层架构图 */
.ar .lay{display:grid;grid-template-columns:minmax(0,1fr) 56px 56px;gap:16px}
.ar .rows{display:grid;gap:32px}
.ar .row{display:grid;grid-template-columns:96px minmax(0,1fr);border:1px solid var(--color-border);border-radius:var(--radius-card);overflow:hidden;background:var(--color-surface)}
.ar .row > i{font-style:normal;background:var(--color-surface-2);border-right:1px solid var(--color-border);display:grid;place-items:center;font-size:14px;font-weight:600;text-align:center;padding:8px}
.ar .row > div{padding:16px;display:flex;gap:16px;flex-wrap:wrap}
.ar .blk{box-sizing:border-box;width:144px;height:64px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-background);display:grid;place-items:center;align-content:center;gap:4px;font-size:14px;font-weight:500;text-align:center}
.ar .blk small{font-size:12px;font-weight:400;font-family:var(--font-mono);color:var(--color-text-muted)}
.ar .blk.hi{border-color:var(--color-action);background:var(--brand-soft)}
.ar .vbar{background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-card);display:grid;place-items:center;font-size:14px;font-weight:600;writing-mode:vertical-rl;letter-spacing:.2em;text-align:center}
/* 功能树 */
.ar .ft{display:grid;grid-template-columns:200px minmax(0,1fr);align-items:center}
.ar .ft .root{background:var(--color-text);color:var(--color-background);border-radius:var(--radius-card);padding:24px;display:grid;gap:8px;position:relative}
.ar .ft .root b{font-size:24px;font-weight:600}
.ar .ft .root span{font-size:13px;color:var(--text-inverse-muted)}
.ar .ft .root::after{content:"";position:absolute;right:-32px;top:50%;width:32px;border-top:2px solid var(--color-border-strong)}
.ar .ft .l1{margin-left:32px;border-left:2px solid var(--color-border-strong);display:grid;gap:16px;padding:8px 0}
.ar .ft .mod{position:relative;margin-left:32px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px;align-items:center}
.ar .ft .mod::before{content:"";position:absolute;left:-34px;top:50%;width:32px;border-top:2px solid var(--color-border-strong)}
.ar .ft .mh{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:12px 16px;display:grid;gap:8px;position:relative}
.ar .ft .mh b{font-size:16px;font-weight:600}
.ar .ft .mh code{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted)}
.ar .ft .refs{display:flex;gap:4px;flex-wrap:wrap}
.ar .ft .mh::after{content:"";position:absolute;right:-32px;top:50%;width:32px;border-top:2px solid var(--color-border-strong)}
.ar .ft .lv{border-left:2px solid var(--color-border-strong);padding:4px 0 4px 32px;display:flex;flex-wrap:wrap;gap:8px 16px}
.ar .ft .leaf{position:relative;font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid var(--color-border);background:var(--color-background)}
/* 规范板 */
.ar .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.ar .card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:24px;display:grid;gap:16px;align-content:start}
.ar .card h3{font-size:18px;font-weight:600;margin:0}
.ar .card p{font-size:14px;line-height:1.6;color:var(--color-text-muted);margin:0}
.ar h2{font-size:24px;font-weight:600;margin:48px 0 16px}
.ar .mini{height:160px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-background);position:relative;overflow:hidden}
.ar .mini i{position:absolute;box-sizing:border-box;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface);font-style:normal}
.ar .mini i.hi{border-color:var(--color-action);background:var(--brand-soft)}
.ar .mini i.ex{border:1px dashed var(--color-border-strong);background:var(--color-surface-2)}
.ar .mini i.bar{background:var(--color-surface-2)}
.ar .mini i.ln{border:0;border-top:2px solid var(--color-border-strong);border-radius:0;background:none;height:0}
.ar .mini i.lv{border:0;border-left:2px solid var(--color-border-strong);border-radius:0;background:none;width:0}
.ar .el{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.ar .el > div{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px;display:grid;gap:8px;align-content:start}
.ar .el .demo{height:48px;display:grid;place-items:center;font-size:13px}
.ar .el b{font-size:14px;font-weight:600}
.ar .el span.d{font-size:13px;line-height:1.6;color:var(--color-text-muted)}
.ar .st{display:inline-block;font-size:12px;font-weight:500;padding:2px 8px;border-radius:6px;border:1px solid currentColor}
.ar .pit{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;counter-reset:p}
.ar .pit > div{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px;font-size:14px;line-height:1.6;display:grid;gap:4px;align-content:start}
.ar .pit > div::before{counter-increment:p;content:counter(p);width:24px;height:24px;border-radius:6px;display:grid;place-items:center;font-size:12px;font-weight:600;background:var(--color-text);color:var(--color-background)}
.ar .pit small{font-size:12px;color:var(--color-text-muted)}
"""

ARROW = '<path class="ah" d="M{x} {y} l{dx} -6 l0 12 z"/>'
def line(x1, y1, x2, y2, to_end=True):
    # 水平或垂直线段；箭头指向 (x2,y2)
    if y1 == y2:
        d = 1 if x2 > x1 else -1
        x2e = x2 - 10 * d
        head = f'<path class="ah" d="M{x2} {y2} l{-10*d} -6 l0 12 z"/>'
        return f'<line x1="{x1}" y1="{y1}" x2="{x2e}" y2="{y2}"/>{head}'
    d = 1 if y2 > y1 else -1
    y2e = y2 - 10 * d
    head = f'<path class="ah" d="M{x2} {y2} l-6 {-10*d} l12 0 z"/>'
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2e}"/>{head}'

def legend(items):
    return '<div class="legend">' + "".join(f"<span>{i}</span>" for i in items) + "</div>"

# ───────── 1. 上下文图 ─────────
def ctx():
    L, C, R = 0, 528, 1056
    def box(cls, x, y, b, s):
        return f'<div class="box {cls}" style="left:{x}px;top:{y}px"><b>{b}</b><span>{s}</span></div>'
    def lb(cx, y, t):
        return f'<div class="lb" style="left:{cx-80}px;top:{y-12}px">{t}</div>'
    boxes = (
        box("core", C, 0, "codepi.app 网站", "公开站 + 本人工作台")
        + box("person", L, 40, "访客", "人 · 任何人")
        + box("person", L, 168, "本人", "人 · 站点所有者")
        + box("ext", L, 296, "统一登录", "外部系统 · auth.codepi.app")
        + box("ext", R, 8, "RSS 阅读器", "外部系统")
        + box("ext", R, 112, "AI 客户端", "外部系统 · 经 MCP")
        + box("ext", R, 216, "各应用只读概览", "外部系统 · 健康 / GU / 公众号")
        + box("ext", R, 320, "GitHub", "外部系统 · 源码")
        + box("ext", C, 480, "Cloudflare", "外部系统 · 托管与网络"))
    lines = (line(256, 80, 528, 80) + line(256, 208, 528, 208) + line(528, 336, 256, 336)
             + line(1056, 48, 784, 48) + line(1056, 152, 784, 152) + line(784, 256, 1056, 256) + line(1056, 360, 784, 360)
             + line(656, 416, 656, 480))
    labels = (lb(392, 80, "浏览 页面") + lb(392, 208, "审核 博客") + lb(392, 336, "校验 登录")
              + lb(920, 48, "拉取 RSS") + lb(920, 152, "提交 博客草稿") + lb(920, 256, "读取 概览") + lb(920, 360, "提供 源码")
              + f'<div class="lb" style="left:672px;top:436px;width:96px;text-align:left">托管 运行</div>')
    return f'''<div class="ar"><h1>www · 上下文图</h1><p class="intro">codepi.app 网站和谁打交道：谁来访问、读谁的数据、被谁托管。不画内部结构。</p>
<div class="ctx"><svg aria-hidden="true" viewBox="0 0 1312 560">{lines}</svg>{boxes}{labels}</div>
{legend(['<i class="sw hi"></i>本系统', '<i class="sw person"></i>人', '<i class="sw ext"></i>外部系统', '<i class="ln"></i>箭头 = 动作方向，标签 = 动词 + 对象'])}</div>'''

# ───────── 2. 分层架构图 ─────────
def blk(t, hi=False, sub=""):
    return f'<div class="blk{" hi" if hi else ""}">{t}{f"<small>{sub}</small>" if sub else ""}</div>'
def arch():
    layers = [
        ("渠道层", [blk("公开站", sub="/"), blk("我的工作台", True, "/desk/")]),
        ("应用层", [blk("首页"), blk("博客"), blk("文章"), blk("关于 · 隐私"), blk("工作台概览"), blk("博客审核")]),
        ("能力层", [blk("统一登录"), blk("博客审核流", True), blk("概览聚合"), blk("摘要生成"), blk("RSS 订阅"), blk("草稿预览")]),
        ("数据层", [blk("文章与修订", True, "D1"), blk("分类", sub="D1"), blk("草稿与上传", sub="D1"), blk("博客配图", sub="R2"), blk("登录会话", sub="D1")]),
        ("基础设施", [blk("Worker"), blk("静态资源"), blk("DNS 与域名")]),
    ]
    rows = "".join(f'<div class="row"><i>{n}</i><div>{"".join(b)}</div></div>' for n, b in layers)
    return f'''<div class="ar"><h1>www · 分层架构图</h1><p class="intro">网站由哪些部分组成：自上而下是渠道、应用、能力、数据、基础设施，下层支撑上层；右侧是贯穿各层的支撑体系。</p>
<div class="lay"><div class="rows">{rows}</div><div class="vbar">安全与权限</div><div class="vbar">发布与运维</div></div>
{legend(['<i class="sw strip"></i>层条 / 竖条', '<i class="sw"></i>模块', '<i class="sw hi"></i>重点（博客审核主线）', 'D1 / R2 = 数据库 / 对象存储'])}</div>'''

# ───────── 3. 功能树 ─────────
def ftree():
    mods = [
        ("全站外框", "", "Web-Blog", "Web-Menu-Phone", ["切换导航", "打开手机菜单", "进入工作台", "跳转页脚链接"]),
        ("首页", "/", "Main", "Home-Phone", ["阅读价值主张", "查看示意界面", "了解授权方式", "浏览现在的空间", "阅读最新文章", "进入工作台"]),
        ("博客", "/blog/", "Web-Blog Web-Blog-States", "Web-Blog-Phone", ["筛选分类", "浏览文章列表", "订阅 RSS", "翻页（每页 12 篇）", "查看标签页", "查看系列页"]),
        ("文章", "/blog/:slug", "Web-Post Web-Post-Preview", "Web-Post-Phone", ["阅读正文", "查看目录", "查看资料来源", "切换上下篇", "预览草稿"]),
        ("关于", "/about/", "Web-About", "Web-About-Phone", ["了解理念", "查看生活脉络", "区分公开与私域"]),
        ("隐私说明", "/privacy/", "Web-Privacy", "Web-Privacy-Phone", ["阅读隐私说明"]),
        ("我的工作台", "/desk/", "Web-Desk-Login Web-Desk Web-Desk-Review Web-Desk-Review-More Web-Desk-States", "Web-Desk-Login-Phone Web-Desk-Phone Web-Desk-Review-Phone",
         ["登录工作台", "查看应用概览", "刷新概览", "处理待办事项", "生成按需摘要", "审核博客稿件", "发布或退回稿件", "管理分类", "退出登录"]),
    ]
    rows = ""
    for t, route, d, p, fs in mods:
        refs = "".join(f'<span class="ref">{x}</span>' for x in d.split()) + "".join(f'<span class="ref m">{x}</span>' for x in p.split())
        code = f"<code>{route}</code>" if route else ""
        rows += f'<div class="mod"><div class="mh"><b>{t}</b>{code}<div class="refs">{refs}</div></div><div class="lv">{"".join(f"<span class=leaf>{f}</span>" for f in fs)}</div></div>'
    return f'''<div class="ar"><h1>www · 功能树</h1><p class="intro">网站有哪些功能：从左到右三级，产品 → 页面模块 → 功能点；功能点用动宾短语。</p>
<div class="ft"><div class="root"><b>www</b><span>codepi.app</span></div><div class="l1">{rows}</div></div>
{legend(['<i class="ref">电脑稿</i>', '<i class="ref m">手机稿</i>', '三级：产品 → 模块 → 功能点'])}</div>'''

# ───────── 4. 规范板 ─────────
def mini(*items):
    out = ""
    for cls, x, y, w, h in items:
        out += f'<i class="{cls}" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"></i>'
    return f'<div class="mini">{out}</div>'
def gdiag():
    m1 = mini(("hi", 112, 56, 96, 48), ("ex", 8, 12, 72, 32), ("ex", 8, 112, 72, 32), ("ex", 240, 12, 72, 32), ("ex", 240, 112, 72, 32),
              ("ln", 80, 28, 32, 0), ("ln", 80, 128, 32, 0), ("ln", 208, 28, 32, 0), ("ln", 208, 128, 32, 0))
    rows = ""
    for r, n in enumerate([2, 4, 4, 3]):
        y = 8 + r * 36
        rows += f'<i class="bar" style="left:8px;top:{y}px;width:32px;height:28px"></i>'
        for k in range(n):
            rows += f'<i class="{"hi" if (r == 1 and k == 0) else ""}" style="left:{48 + k * 52}px;top:{y}px;width:44px;height:28px"></i>'
    rows += '<i class="bar" style="left:264px;top:8px;width:20px;height:136px"></i><i class="bar" style="left:288px;top:8px;width:20px;height:136px"></i>'
    m2 = f'<div class="mini">{rows}</div>'
    m3 = mini(("hi", 8, 60, 56, 40), ("lv", 88, 20, 0, 120), ("ln", 64, 80, 24, 0), ("", 100, 12, 56, 24), ("", 100, 68, 56, 24), ("", 100, 124, 56, 24),
              ("ln", 156, 24, 24, 0), ("ln", 156, 80, 24, 0), ("ln", 156, 136, 24, 0), ("", 188, 16, 56, 16), ("", 188, 40, 56, 16), ("", 188, 72, 56, 16), ("", 188, 128, 56, 16), ("", 252, 16, 56, 16), ("", 252, 128, 56, 16))
    cards = f'''<div class="g3">
<div class="card">{m1}<h3>系统上下文图</h3><p>回答：系统和谁打交道。本系统居中用橙色，四周是人和灰色虚线的外部系统；每条线标「动词 + 对象」，元素不超过 10 个。</p></div>
<div class="card">{m2}<h3>分层架构图</h3><p>回答：系统由哪些部分组成。自上而下：渠道 → 应用 → 能力 → 数据 → 基础设施；左边层条，右边竖条写安全与运维；同层并列，下层支撑上层，不画流程。</p></div>
<div class="card">{m3}<h3>功能树</h3><p>回答：有哪些功能。从左往右最多三级：产品 → 模块 → 功能点，叶子用动宾短语；要讲流转时另画泳道图，主路径实线、异常和回程虚线。</p></div></div>'''
    el = '''<div class="el">
<div><div class="demo"><span class="sw strip" style="width:96px;height:32px;display:grid;place-items:center;font-weight:600">渠道层</span></div><b>层条</b><span class="d">左侧窄竖条写层名，浅灰底。</span></div>
<div><div class="demo"><span class="sw" style="width:120px;height:32px;border-radius:10px;display:grid;place-items:center">文章与修订</span></div><b>模块块</b><span class="d">圆角矩形，只写名词短语，不超过 8 个字；同层等宽等高。</span></div>
<div><div class="demo"><span class="sw hi" style="width:120px;height:32px;border-radius:10px;display:grid;place-items:center">我的工作台</span></div><b>重点块</b><span class="d">橙边框浅橙底，入口或核心路径，每图最多 3 块。</span></div>
<div><div class="demo"><span class="sw ext" style="width:120px;height:32px;border-radius:10px;display:grid;place-items:center">GitHub</span></div><b>外部系统</b><span class="d">灰色虚线框、浅灰底；不要画成内部块。</span></div>
<div><div class="demo"><span style="width:120px;height:32px;border:1px dashed var(--color-border-strong);border-radius:10px;display:block"></span></div><b>边界框</b><span class="d">虚线，不填色，左上角写名称；框内是自己的系统。</span></div>
<div><div class="demo"><span style="display:flex;align-items:center;gap:8px"><i class="ln" style="width:40px"></i>读取 概览</span></div><b>实线 + 标签</b><span class="d">直角折线，少交叉；标签是动词 + 对象，不超过 6 字，方向明确。</span></div>
<div><div class="demo"><span style="display:flex;align-items:center;gap:8px"><i class="ln dash" style="width:40px"></i>回程 / 异常</span></div><b>虚线</b><span class="d">流程图里表示异常和回程；主路径用实线。</span></div>
<div><div class="demo"><span style="display:flex;gap:8px"><span class="st" style="color:var(--color-success)">已上线</span><span class="st" style="color:var(--color-warning)">待批</span><span class="st" style="color:var(--color-danger)">故障</span></span></div><b>状态色</b><span class="d">绿 = 正常，警告色 = 待定或要批准，红 = 禁止或故障；只表示状态，不给分类上色。</span></div>
</div>'''
    pits = [("混了多个层级", "一图只讲一个层级"), ("连线没有标签", "每条线写动词 + 对象"), ("没有图例", "放右下，只列用到的"), ("颜色太多", "颜色只表达类型"),
            ("块里写句子", "名词短语，不超过 8 字"), ("功能树和分层图画成一张", "拆成两张图"), ("外部系统画成内部块", "灰色虚线框，放边界外"), ("箭头方向不清", "分不出数据流还是调用")]
    pit = '<div class="pit">' + "".join(f"<div><b>{a}</b><small>{b}</small></div>" for a, b in pits) + "</div>"
    return f'''<div class="ar"><h1>架构图规范</h1><p class="intro">所有架构图共用的版式：一图只讲一个层级，简洁、表达明确。上下文图 → 分层架构图 → 功能树，三张依次画。</p>
<h2 style="margin-top:0">三种图</h2>{cards}<h2>元素与图例</h2>{el}<h2>8 条常见坑</h2>{pit}
{legend(['整张图不超过 25 块，每层不超过 6 块', '字号不小于 12px', '块间距 16–24，层间距 32–48，图边距不少于 40'])}</div>'''

BOARDS = [("Ctx-WWW", "www · 上下文图", ctx(), 760), ("Arch-WWW", "www · 分层架构图", arch(), 1200), ("Feat-WWW", "www · 功能树", ftree(), 1500), ("G-Diagram", "架构图规范", gdiag(), 1500)]
for n, t, body, h in BOARDS:
    add(n, t, 1440, H.get(n, h), body, CSS)
print("arch ok")
