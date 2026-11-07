import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, day, LOGO_BLOB
from gen2 import IC

LOGO = LOGO_BLOB
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HW", "").split(",") if x)}

SITE_CSS = """
.site{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);-webkit-font-smoothing:antialiased}
.site a:not(.cp-btn){color:inherit}
.site .wrap{max-width:1200px;margin:0 auto;padding:0 32px}
.site .narrow{max-width:760px;margin:0 auto;padding:0 32px}
.site .cp-topnav .links a.on{color:var(--color-text);font-weight:600}
.site .menu-m{display:none}
.site .cp-topnav .right a[aria-current="page"]{background:var(--brand-soft);border-color:var(--tint-accent-line)}
.site .ph{padding:96px 0 48px}
.site h1{font-size:56px;line-height:1.1;letter-spacing:-.03em;font-weight:600;margin:0;text-wrap:balance}
.site .lead{font-size:20px;line-height:1.6;color:var(--color-text-muted);margin:20px 0 0;max-width:640px;text-wrap:pretty}
.site h2{font-size:32px;line-height:1.25;letter-spacing:-.02em;font-weight:600;margin:0;text-wrap:balance}
.site h2 .sub{display:block;color:var(--color-text-subtle);font-size:20px;font-weight:500;letter-spacing:-.005em;margin-top:10px;max-width:640px;line-height:1.5}
.site .sec{padding:112px 0 0}
.site .card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card)}
.site .foot{border-top:1px solid var(--color-border);margin-top:120px;padding:28px 0 40px;font-size:13px;color:var(--color-text-subtle)}
.site .foot .wrap{display:flex;gap:24px;align-items:center}
.site .foot .wrap span:first-child{margin-right:auto}
.site .foot a{text-decoration:none}
.site .cp-prose h1{font-size:44px;line-height:1.2;margin:0 0 14px;text-wrap:pretty}
.site .cp-prose h2{font-size:24px;line-height:1.35;margin:40px 0 12px}
.site .legal h2{font-size:22px;margin:40px 0 10px}
.site .legal p{font-size:16px;line-height:1.8;color:var(--color-text);margin:0}
.site .post-card{display:grid;grid-template-columns:140px minmax(0,1fr);gap:24px;padding:28px 0;border-top:1px solid var(--color-border);text-decoration:none}
.site .post-card h3{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0 0 8px;line-height:1.35}
.site .post-card p{margin:0;font-size:15px;line-height:1.7;color:var(--color-text-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.site .filters{display:flex;gap:6px;flex-wrap:wrap}
.site .filters a{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);font-size:14px;text-decoration:none;color:var(--color-text-muted)}
.site .filters a b{font-weight:500;color:var(--color-text-subtle);font-size:12px}
.site .filters a[aria-current="true"]{background:var(--color-text);border-color:var(--color-text);color:var(--color-background)}
.site .filters a[aria-current="true"] b{color:#C6BFB5}
.site .filters a.zero{opacity:.55}
.site .appcard{padding:28px;display:flex;flex-direction:column;gap:10px;min-height:300px;text-decoration:none}
.site .appcard .n{display:flex;align-items:baseline;gap:8px;font-size:22px;font-weight:600}
.site .appcard .n small{font-size:13px;font-weight:400;color:var(--color-text-subtle)}
.site .appcard p{margin:0;font-size:15px;line-height:1.65;color:var(--color-text-muted)}
.site .appcard .go{margin-top:auto;display:flex;justify-content:space-between;align-items:center;padding-top:16px;border-top:1px solid var(--color-border);font-size:13px;color:var(--color-text-subtle)}
.site .appcard .go b{color:var(--color-action-hover);font-weight:600;font-size:14px}
"""
PHONE = """
.site .wrap,.site .narrow{padding:0 16px}
.site .cp-topnav .links,.site .cp-topnav .right>a.cp-btn{display:none}
.site .menu-m{display:inline-grid}
.site .ph{padding:48px 0 28px}.site h1{font-size:34px;line-height:1.2}.site .lead{font-size:16px}
.site h2{font-size:24px}.site h2 .sub{font-size:16px}.site .sec{padding-top:64px}
.site .g2,.site .g3,.site .g4{grid-template-columns:minmax(0,1fr)!important}
.site .post-card{grid-template-columns:minmax(0,1fr);gap:8px;padding:20px 0}.site .post-card h3{font-size:18px}
.site .filters{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px;padding:0 16px}
.site .foot{margin-top:72px}.site .foot .wrap{flex-wrap:wrap;gap:10px 18px}
.site .cp-prose{font-size:16px}.site .cp-prose h1{font-size:28px}
.site .postgrid{grid-template-columns:minmax(0,1fr)!important}.site .postgrid aside{display:none}
.site .cp-pager{grid-template-columns:minmax(0,1fr)}
.site .appcard{min-height:0}
"""

def nav(on):
    links = "".join(f'<a href="#" class="{"on" if n == on else ""}"{AC if n == on else ""}>{n}</a>' for n in NAV)
    cur = AC if on == "我的工作台" else ""
    return f'''<header class="cp-topnav" style="padding:0 max(32px, calc((100% - 1200px) / 2 + 32px));background:var(--color-background)"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi</a>
<nav class="links" aria-label="主导航">{links}</nav><div class="right"><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#"{cur}>我的工作台</a><button class="cp-iconbtn menu-m" aria-label="打开菜单">{MENU_SVG}</button></div></header>'''

AC = ' aria-current="page"'
NAV = ["首页", "博客", "关于", "隐私说明"]
MENU_SVG = '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>'
FOOT = '<footer class="foot"><div class="wrap"><span>生活、工作与思考，在这里连接。 © 2026 kedoupi（codepi）</span><a href="#">首页</a><a href="#">博客</a><a href="#">关于</a><a href="#">隐私说明</a><a href="#">我的工作台</a></div></footer>'
def page(on, inner): return f'<div class="site">{nav(on)}<main>{inner}</main>{FOOT}</div>'

APPS = [("项目", "Project", "让项目进展、任务交接与仓库动态保持连贯。", "把项目卡、并行任务和交接放在一起，保留分支、版本与数据来源，供本人和已授权的 AI 客户端查阅。", "本人使用", "project.codepi.app"),
        ("个人", "Me", "保存经过自己确认的偏好、背景与经历。", "来自不同 AI 的记忆先进入待确认区；确认后，成为本人可以管理、授权读取的个人背景。", "本人使用", "me.codepi.app"),
        ("健康", "Health", "记录睡眠、恢复与活动，理解自己的长期变化。", "从 Oura 的日常记录出发，关注睡眠、恢复和活动的变化。健康是长期的主题，设备是记录的来源。", "本人使用", "health.codepi.app"),
        ("作息", "Rhythm", "看清自己一天的作息与工作节奏。", "把家中设备与工作机的只读信号，整理成一条可以回看的时间线，并公开每个结论的判断方法与口径。", "本人使用", "jw.codepi.app"),
        ("投资理财", "GU", "整理持仓、研究与决策，让每一次判断有迹可循。", "把持仓、研究和决策放在一起回顾，保留数据来源和更新时间，为长期复盘留下依据。", "本人使用", "gu.codepi.app"),
        ("珂抖屁公众号", "GZH", "稿件、预览与审核，收在同一个工作台。", "围绕珂抖屁公众号整理稿件、预览和审核进度。审核完成后，再到微信后台人工发布。", "授权使用", "gzh.codepi.app")]

def apps():
    cards = "".join(f'<a class="card appcard" href="#"><div style="display:flex;justify-content:space-between;align-items:center"><div class="n">{n}<small>{e}</small></div><span class="cp-chip{" need" if acc == "授权使用" else ""}">{acc}</span></div><p style="color:var(--color-text);font-size:16px">{d}</p><p>{dt}</p><div class="go"><span>{h} · 进入后需要登录</span><b>进入应用 ↗</b></div></a>' for n, e, d, dt, acc, h in APPS)
    return page("应用", f'''<section class="ph"><div class="wrap"><h1>从生活出发的应用</h1><p class="lead">把数据留给自己，把智能带给生活。每个应用只记录一段真实生活，各自独立，又在同一个私域里彼此呼应。</p>
<div class="row" style="margin-top:28px;gap:8px"><span class="cp-chip">6 个应用</span><span class="cp-chip">数据归你</span><span class="cp-chip">一个账号登录全部</span></div></div></section>
<section><div class="wrap"><div class="g3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px">{cards}</div></div></section>
<section class="sec"><div class="wrap"><div class="card" style="padding:40px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center"><h2>不给生活设限，更多应用在路上<span class="sub">每加一个生活维度，都沿用同一套登录、授权和数据边界。</span></h2><a class="cp-btn cp-btn-secondary" href="#">读读它们是怎么做出来的</a></div></div></section>''')

POSTS = [("生活感悟", "2026-10-27", 8, "工作 19 年后，我发现自己不会休息了", "从程序员到独立创业，终于拥有更多自由，却发现自己只有做事才能安心。关于 40 岁、工作习惯、无法停止思考，以及重新学习生活的一篇自述。"),
         ("AI 深度观察", "2026-10-27", 8, "OpenAI 进入 Google Cloud：当 AI 巨头开始互相销售对方的模型", "深度解析 OpenAI 与 Google Cloud 合作背后的模型分销、企业采购、Codex Agent 架构与多模型产品设计，并区分已知事实和行业推演。"),
         ("网络技术科普", "2026-10-27", 17, "从 TCP/UDP 到 mihomo 与 sing-box：一篇讲清网络代理的内核、协议与 DNS", "从 IP、端口、TCP、UDP、QUIC、TLS 等网络基础讲起，梳理三大代理内核的差异，对比常见协议的优劣与选型，解释两种 DNS 模式。")]
CATS = [("全部", 3), ("数字空间", 0), ("健康记录", 0), ("投资观察", 0), ("内容工作", 0), ("技术实践", 0), ("生活随笔", 0)]

def post_card(c, d, m, t, s):
    return f'<a class="post-card" href="#"><div><span class="cp-chip">{c}</span><div class="cp-meta" style="margin-top:10px">{d.replace("2026-", "")} · {m} 分钟</div></div><div><h3>{t}</h3><p>{s}</p><span class="cp-meta" style="display:inline-block;margin-top:12px;color:var(--color-action-hover);font-weight:600">阅读全文 →</span></div></a>'

def filters(active="全部", counts=CATS):
    return '<nav class="filters" aria-label="分类">' + "".join(f'<a href="#" aria-current="{"true" if n == active else "false"}" class="{"zero" if c == 0 and n != active else ""}">{n}<b>{c}</b></a>' for n, c in counts) + '</nav>'

def blog():
    return page("博客", f'''<section class="ph"><div class="wrap" style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap"><div><h1>博客</h1><p class="lead">关于个人数字空间、健康、投资与内容工作的观察与记录。把值得回看的想法，慢慢整理成文。</p></div><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">通过 RSS 订阅</a></div></section>
<section><div class="wrap">{filters()}<div class="cp-meta" style="margin:28px 0 0">共 3 篇，按发布时间排列</div>
<div style="margin-top:8px">{"".join(post_card(*p) for p in POSTS)}</div></div></section>''')

def blog_states():
    cats = [("全部", 14), ("数字空间", 0), ("健康记录", 0), ("投资观察", 0), ("内容工作", 0), ("技术实践", 0), ("生活随笔", 14)]
    many = "".join(post_card("生活随笔", "2026-10-20", 6, f"示例文章标题 {i}", "摘要最多三行，超出省略。分类名来自分类表，文章按发布时间倒序。") for i in (1, 2))
    return page("博客", f'''<section class="ph" style="padding-bottom:24px"><div class="wrap"><h1>博客</h1></div></section>
<section><div class="wrap"><div class="g2" style="display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start">
<div><p class="cp-head"><span>分类有结果 · 第 1 / 2 页（每页 12 篇）</span></p>{filters("生活随笔", cats)}<div class="cp-meta" style="margin:20px 0 0">分类：生活随笔 · 共 14 篇</div>{many}
<nav style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-border);padding-top:20px" aria-label="分页"><span class="cp-meta">第 1 / 2 页</span><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">下一页</a></nav></div>
<div><p class="cp-head"><span>分类没有文章</span></p>{filters("投资观察")}<div class="cp-empty" style="margin-top:24px"><b>「投资观察」还没有文章</b>先看看其他分类，或者订阅 RSS，有新文章时会收到。<div class="row" style="justify-content:center;margin-top:6px"><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">看全部文章</a><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">RSS 订阅</a></div></div>
<p class="cp-head" style="margin-top:40px"><span>标签页 / 系列页</span></p><div class="card" style="padding:20px"><div style="font-size:15px;font-weight:600">标签：AI 工具 · 共 5 篇</div><p class="cp-help" style="margin:6px 0 0">版式与分类页相同；分类栏没有高亮项，「全部」也不高亮。</p></div></div>
</div></div></section>''')

def post():
    return page("博客", f'''<div class="wrap" style="padding-top:40px"><a class="cp-back" href="#">← 返回博客</a></div>
<section class="wrap postgrid" style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:64px;padding-top:24px">
<article class="cp-prose" style="max-width:720px"><div class="row" style="gap:10px;margin-bottom:16px"><a class="cp-chip" href="#" style="text-decoration:none">生活感悟</a><span class="cp-meta">发布于 2026-10-27 · 更新于 10-30 · 约 8 分钟</span></div>
<h1>工作 19 年后，我发现自己不会休息了</h1><p style="color:var(--color-text-muted);font-size:19px;line-height:1.7">从程序员到独立创业，终于拥有更多自由，却发现自己只有做事才能安心。</p>
<figure><div style="aspect-ratio:2.35;border-radius:14px;background:var(--color-surface-2);display:grid;place-items:center;color:var(--color-text-subtle);font-size:14px">头图 2.35:1</div><figcaption>图注取图片标题。头图、目录、资料来源都是「有就显示」。</figcaption></figure>
<p><b>今年是我写代码的第 19 年。</b>真正自由以后，我反而只有在做事的时候才安心。</p>
<h2>一、自由以后的第一个月</h2><p>每天醒来第一件事是打开电脑，不是因为有人在等，而是怕停下来。</p>
<blockquote>休息不是做事的反面，而是做事的一部分。</blockquote>
<h2>二、重新学习生活</h2><p>我开始给自己定「不做事」的时间，像排会议一样排进日历。</p>
<div style="border-top:1px solid var(--color-border);margin-top:40px;padding-top:24px"><p class="lab" style="font-size:13px;font-weight:600;color:var(--color-text-subtle);margin:0 0 8px">资料来源</p><ol style="margin:0;padding-left:1.2em;font-size:15px;line-height:1.8;color:var(--color-text-muted)"><li><a href="#" style="color:inherit">来源标题一</a></li><li><a href="#" style="color:inherit">来源标题二</a></li></ol></div>
<div class="row" style="gap:8px;margin-top:24px"><a class="cp-chip" href="#" style="text-decoration:none">生活感悟</a><a class="cp-chip" href="#" style="text-decoration:none"># 工作习惯</a><span class="cp-meta">系列：<a href="#" style="color:var(--color-action-hover)">四十岁这一年</a></span></div>
<p class="cp-meta" style="margin-top:16px">本文由 AI 协作撰写，经本人审核后发布。</p>
<div class="cp-pager" style="margin-top:32px"><a href="#"><small>上一篇</small>OpenAI 进入 Google Cloud：当 AI 巨头开始互相销售对方的模型</a><a href="#" style="text-align:right;opacity:.5;pointer-events:none"><small>下一篇</small>这是最新一篇</a></div>
<div style="text-align:center;margin-top:28px"><a class="cp-btn cp-btn-ghost" href="#">浏览更多文章</a></div></article>
<aside><nav class="cp-toc" aria-label="目录" style="position:sticky;top:24px"><span class="cp-meta" style="font-weight:600">目录</span><a href="#" aria-current="true">一、自由以后的第一个月</a><a href="#">二、重新学习生活</a></nav></aside></section>''')

def post_preview():
    return page("博客", f'''<div style="background:var(--brand-soft);border-bottom:1px solid var(--color-border)"><div class="wrap" style="display:flex;align-items:center;gap:12px;min-height:48px;font-size:14px"><span class="cp-chip" style="background:var(--color-surface)">草稿预览</span>仅本人可见，不被搜索引擎收录。发布更新前，公开文章保留当前版本。<a class="cp-btn cp-btn-secondary cp-btn-sm" href="#" style="margin-left:auto">回到审核台</a></div></div>
<section class="narrow" style="padding-top:40px"><article class="cp-prose"><div class="row" style="gap:10px;margin-bottom:16px"><span class="cp-chip">生活感悟</span><span class="cp-meta">草稿更新于 2026-10-30 · 约 5 分钟</span></div><h1>没有小标题的短文</h1><p style="color:var(--color-text-muted)">只有一个或没有小标题时不显示目录；没有头图时标题下直接是正文。</p><p>正文段落。16–17px、1.8 倍行高，一行约 38 个汉字。</p><p>正文段落。</p></article></section>''')

def about():
    threads = [("生活 · Health", "晨起与夜幕的真实节律", "从 Oura 的日常记录出发，关注睡眠质量、静息心率与恢复。看清自己的精力周期，比盲目加速更有力量。", "查看健康空间"),
               ("投资 · GU", "每一笔判断的诚实复盘", "把持仓、研究和决策逻辑完整留下，在市场的周期里检验认知与执行。", "查看投资工作台"),
               ("记忆 · Me & GZH", "经过确认的个人背景与叙事", "想法、偏好与稿件先进入待确认区；确认后才成为本人可管理、可授权的个人背景。", "查看个人与表达")]
    th = "".join(f'<a class="card appcard" href="#" style="min-height:260px"><span class="cp-meta">{a}</span><div class="n" style="font-size:20px">{b}</div><p>{c}</p><div class="go"><span></span><b>{d} ↗</b></div></a>' for a, b, c, d in threads)
    layer = lambda t, s, items: f'<div class="card" style="padding:32px"><span class="cp-chip">{s}</span><h3 style="font-size:22px;font-weight:600;margin:14px 0 14px">{t}</h3>' + "".join(f'<div class="cp-kv" style="min-height:44px"><span style="color:var(--color-text)">{i}</span></div>' for i in items) + '</div>'
    return page("关于", f'''<section class="ph"><div class="wrap"><h1>把自己的数据，交给自己的 AI。</h1><p class="lead">我是 kedoupi（codepi）。这里是我的个人数字化中心，也是我为自己构建的私域智能起点。生活、投资、写作与思考，在这里慢慢连接。</p></div></section>
<section style="background:#242321;color:#F6F3ED;padding:96px 0;margin-top:48px"><div class="wrap" style="display:grid;grid-template-columns:1fr 1fr;gap:64px"><h2 style="color:#F6F3ED;font-size:40px">不拥有你，<br><span style="color:#A8A29A">才有资格理解你。</span></h2><p style="font-size:17px;line-height:1.8;color:#C6BFB5;margin:0">数字化生活不应该是一场向公共平台交出隐私的妥协。我们创造的生活轨迹，理应成为自己的记忆与力量。把真实的生活留给自己，让智能在尊重与授权中慢慢学会靠近。</p></div></section>
<section class="sec"><div class="wrap"><h2>三条生活脉络<span class="sub">围绕真实生活，持续沉淀。</span></h2><div class="g3" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:40px">{th}</div></div></section>
<section class="sec"><div class="wrap"><h2>开放与私密的边界<span class="sub">公开的坦诚分享，私人的严格留给自己。这是智能可以安全接入的前提。</span></h2><div class="g2" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:40px">
{layer("开放的思考与规范", "公开层", ["博客文章、复盘与项目介绍全量公开", "通过 CodePi MCP 向外部 AI 客户端提供只读索引", "不含个人生理指标或未公开财务数据"])}
{layer("严密的个人工作空间", "私域层", ["健康记录、真实持仓、未发布稿件仅本人可见", "统一登录，会话独立鉴权，随时可以撤回", "不把私人数据提供给第三方"])}</div></div></section>''')

def contact():
    return page("", f'''<section class="ph"><div class="narrow"><h1>联系</h1><p class="lead">关于这个空间，或这里的应用与工具，欢迎交流。</p></div></section>
<section class="narrow" style="display:grid;gap:20px"><div class="card" style="padding:28px;display:grid;gap:10px"><h2 style="font-size:22px">项目交流</h2><p style="margin:0;font-size:16px;line-height:1.7">在 GitHub 项目仓库反馈问题或留下建议。附上页面地址、遇到的情况和期望的结果，会更容易定位。</p><a class="cp-btn cp-btn-primary" href="#" style="justify-self:start;margin-top:6px">去 GitHub 反馈</a></div>
<div class="cp-alert cp-alert-warning">{IC["alert"]}<div><span class="cp-alert-title">仓库里的讨论是公开的</span>请勿放入验证码、密钥、健康记录、投资账户信息或未发布稿件；截图请先遮住私人内容。</div></div>
<p class="cp-help" style="font-size:15px">也可以先<a href="#" style="color:var(--color-action-hover)">了解这个空间</a>，或<a href="#" style="color:var(--color-action-hover)">看看正在使用的应用</a>。</p></section>''')

def legal(title, sections):
    body = "".join(f'<h2>{t}</h2><p>{p}</p>' for t, p in sections)
    return page(title,f'<section class="ph" style="padding-bottom:16px"><div class="narrow"><h1>{title}</h1><p class="cp-meta" style="margin-top:12px;font-size:14px">更新于 2026 年 10 月 15 日</p></div></section><section class="narrow legal">{body}</section>')

PRIV = [("公开主站", "这里展示个人介绍、应用说明和明确选择公开的内容。主站不加载广告脚本，也不为广告设置 Cookie；浏览公开页面不需要登录。"),
        ("私人应用与登录", "健康、投资理财和公众号工作台有各自的服务端数据与访问控制，并使用统一登录。登录会使用会话 Cookie；应用中的记录与公开主站内容分开处理。"),
        ("MCP 与公开范围", "授权的 AI 客户端可以向博客提交公开文章的草稿；草稿经本人在工作台审核后才会公开发布，客户端不能直接公开内容。个人业务数据需要在 AI 客户端单独授权后访问。"),
        ("访问与外部链接", "页面由 Cloudflare 提供服务，网络请求经过其基础设施。外部链接指向独立网站，访问后适用相应网站的数据处理规则。")]
TERMS = [("公开内容与私人应用", "公开页面用于个人介绍、内容分享和应用说明。私人应用需要登录和相应权限；公开入口不代表其中的数据可以公开访问。"),
         ("记录与参考", "健康与投资应用用于个人记录和回顾。阅读数据时请留意来源、适用范围和更新时间；内容不能替代专业意见。"),
         ("链接与内容", "网站可能链接到独立的外部服务。原始资料和引用内容属于各自权利人，代码的使用以项目仓库中的许可文件为准。")]

def nf():
    return page("", f'''<section class="ph" style="padding:160px 0 80px"><div class="narrow" style="text-align:center"><div style="font-size:120px;font-weight:600;letter-spacing:-.05em;line-height:1;color:var(--color-border-strong)">404</div><h1 style="font-size:36px;margin-top:20px">没有找到这个页面</h1><p class="lead" style="margin:16px auto 0">可能这个工具已经下线，或者地址输错了。</p><div class="row" style="justify-content:center;margin-top:28px;gap:12px"><a class="cp-btn cp-btn-primary" href="#">回到首页</a><a class="cp-btn cp-btn-secondary" href="#">看看现在的应用</a></div></div></section>''')

def menu_phone():
    return f'''<div class="site" style="min-height:100%"><div style="display:flex;align-items:center;height:56px;padding:0 16px;border-bottom:1px solid var(--color-border)"><span style="display:flex;gap:8px;align-items:center;font-weight:600"><img src="{LOGO}" alt="" style="width:22px">CodePi</span><button class="cp-iconbtn" style="margin-left:auto" aria-label="关闭菜单">{IC["x"]}</button></div>
<nav style="display:grid;padding:8px 16px;font-size:20px;font-weight:500" aria-label="手机菜单">{"".join(f'<a href="#" style="padding:18px 0;border-bottom:1px solid var(--color-border);text-decoration:none;display:flex;justify-content:space-between"{AC if n == "博客" else ""}>{n}<span class="cp-meta">{d}</span></a>' for n, d in [("首页", ""), ("博客", "3 篇"), ("关于", ""), ("隐私说明", "")])}
<a class="cp-btn cp-btn-primary" href="#" style="margin-top:24px">进入我的工作台</a></nav>
<p class="cp-help" style="padding:16px;margin:0">工作台仅本人可用，进入后用统一登录确认身份。</p></div>'''

DESK = [("Web-Blog", "博客", blog, 1150), ("Web-Blog-States", "博客 · 筛选、分页与空", blog_states, 1250),
        ("Web-Post", "文章页", post, 1900), ("Web-Post-Preview", "文章页 · 草稿预览与无目录", post_preview, 800), ("Web-About", "关于", about, 2050),
        ("Web-Privacy", "隐私说明", lambda: legal("隐私说明", PRIV), 1050)]
PH = [("Web-Blog-Phone", "博客 · 手机", blog, 1500), ("Web-Post-Phone", "文章页 · 手机", post, 2500), ("Web-About-Phone", "关于 · 手机", about, 2900), ("Web-Privacy-Phone", "隐私说明 · 手机", lambda: legal("隐私说明", PRIV), 1500), ("Web-Menu-Phone", "手机菜单", menu_phone, 844)]
for n, t, fn, h in DESK:
    add(n, t, 1440, H.get(n, h), fn(), SITE_CSS)
for n, t, fn, h in PH:
    add(n, t, 390, H.get(n, h), fn(), SITE_CSS + PHONE)
print("www ok")
