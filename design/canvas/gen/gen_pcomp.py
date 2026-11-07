"""项目组件（继承全局）+ 全局图表主题。图表来自 Chart.js 渲染图（project/charts/*.png）。"""
import os, shutil
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, day, LEGEND, LOGO_BLOB
from gen2 import IC, DOC_CSS
from gen3 import CHEV_L, CHEV_R, I16, COPY, SPARK

from gen import ROOT as _ROOT, CANVAS as _CANVAS
os.makedirs(_ROOT + "project/charts", exist_ok=True)
for f in os.listdir(_CANVAS + "/charts/out"):
    shutil.copy(_CANVAS + "/charts/out/" + f, _ROOT + "project/charts/" + f)
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HC2", "").split(",") if x)}
CSS = DOC_CSS + """
.doc .cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:24px}
.doc .comp{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);overflow:hidden;display:grid;grid-template-rows:auto 1fr}
.doc .comp .meta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:16px 24px;border-bottom:1px solid var(--color-border);background:var(--color-surface-2)}
.doc .comp .meta b{font-size:16px;font-weight:600}
.doc .comp .meta .inh{font-size:12px;font-family:var(--font-mono);color:var(--color-text-muted);text-align:right}
.doc .comp .meta .use{grid-column:1 / -1;font-size:13px;color:var(--color-text-muted)}
.doc .comp .demo{padding:24px;display:grid;gap:12px;align-content:start}
.doc .comp .demo img{width:100%;height:auto;display:block}
.doc .comp.wide{grid-column:1 / -1}
.doc .tree-inh{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-text-muted);flex-wrap:wrap}
.doc .tree-inh span{padding:4px 12px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text)}
.doc .tree-inh span.on{background:var(--color-text);color:var(--color-background);border-color:var(--color-text)}
.doc .ev{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--color-surface-2);color:var(--color-text);font-weight:500}
.doc .ev.inf{background:var(--tint-warn);color:var(--on-tint-warn)}.doc .ev.none{background:transparent;border:1px dashed var(--color-border-strong)}
"""
def img(n, alt):
    return f'<img src="charts/{n}.png" alt="{alt}">'
def comp(name, inh, use, demo, wide=False):
    return f'<section class="comp{" wide" if wide else ""}"><div class="meta"><b>{name}</b><span class="inh">{"基于" if "Chart.js" in inh else "继承"} {inh}</span><span class="use">用在：{use}</span></div><div class="demo">{demo}</div></section>'
def head(title, proj, intro):
    chain = '<div class="tree-inh"><span>全局设计规范</span>→<span>全局公共组件 cp-*</span>→<span class="on">' + proj + '组件</span>→<span>' + proj + '页面</span></div>'
    return f'<h1>{title}</h1><p class="intro">{intro}</p>{chain}'

WWW_CSS = """<style>
.doc .grp{display:grid;gap:4px;margin-top:48px}.doc .grp h2{margin:0;font-size:24px;font-weight:600}.doc .grp p{margin:0;font-size:14px;color:var(--color-text-muted)}
.doc .grp + .cg{margin-top:24px}
.w-bar{border:1px solid var(--color-border);border-radius:14px;padding:0 24px;background:var(--color-background);gap:24px}
.w-bar .links{gap:24px}.w-bar .links a.on{color:var(--color-text);font-weight:600}
.w-phone{max-width:390px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-background);overflow:hidden}
.w-phone .bar{display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 16px;border-bottom:1px solid var(--color-border)}
.w-phone .brand{display:flex;gap:8px;align-items:center;font-weight:600;font-size:15px;color:var(--color-text);text-decoration:none}
.w-phone nav{display:grid;padding:8px 16px 16px;font-size:18px;font-weight:500}
.w-phone nav a:not(.cp-btn){display:flex;align-items:center;min-height:48px;border-bottom:1px solid var(--color-border);color:var(--color-text);text-decoration:none}
.w-phone nav a[aria-current="page"]{font-weight:600}
.w-foot{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;border-top:1px solid var(--color-border);padding-top:16px;font-size:13px;color:var(--color-text-muted)}
.w-foot span:first-child{margin-right:auto}.w-foot a{color:var(--color-text-muted);text-decoration:none;display:inline-flex;align-items:center;min-height:36px}
.w-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--color-border)}
.w-steps div{padding:24px 16px 0 0}.w-steps div+div{padding-left:16px;border-left:1px solid var(--color-border)}
.w-steps .step{display:block;font-size:13px;font-weight:600;color:var(--color-action-hover);margin-bottom:8px}
.w-steps b{display:block;font-size:16px;font-weight:600;margin-bottom:8px}.w-steps p{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-muted)}
.w-space{display:flex;flex-direction:column;gap:12px;padding:24px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;text-decoration:none;color:var(--color-text)}
.w-space:hover{border-color:var(--color-border-strong)}
.w-space .n{display:flex;align-items:baseline;gap:8px;font-size:22px;font-weight:600}.w-space .n small{font-size:13px;font-weight:400;color:var(--color-text-muted)}
.w-space p{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-muted)}
.w-space .viz{border-top:1px solid var(--color-border);padding-top:12px}
.w-space .foot{display:flex;justify-content:space-between;font-size:13px;color:var(--color-text-muted)}
.w-pc{display:grid;gap:8px;padding:24px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;text-decoration:none;color:var(--color-text);justify-items:start}
.w-pc:hover{border-color:var(--color-border-strong)}.w-pc b{font-size:18px;line-height:1.4;font-weight:600}.w-pc p{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-muted)}
.w-post{display:grid;grid-template-columns:120px minmax(0,1fr);gap:16px;padding:16px 0;border-top:1px solid var(--color-border);text-decoration:none;color:var(--color-text)}
.w-post h3{margin:0 0 8px;font-size:20px;line-height:1.4;font-weight:600}
.w-post p{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.w-filters{display:flex;gap:8px;flex-wrap:wrap}
.w-filters a{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);font-size:14px;text-decoration:none;color:var(--color-text-muted)}
.w-filters a b{font-weight:500;font-size:12px;color:var(--color-text-muted)}
.w-filters a[aria-current="true"]{background:var(--color-text);border-color:var(--color-text);color:var(--color-background)}
.w-filters a[aria-current="true"] b{color:var(--text-inverse-muted)}
.w-filters a.zero{color:var(--color-text-muted);border-style:dashed}
.w-badge{display:inline-flex;align-items:center;gap:8px;height:24px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap}
.w-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.w-badge.ok{background:var(--tint-ok);color:var(--on-tint-ok)}.w-badge.warn{background:var(--tint-warn);color:var(--on-tint-warn)}.w-badge.off{background:var(--tint-danger);color:var(--color-danger)}
.w-src{display:grid;gap:12px;align-content:start}.w-src .top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.w-src .eb{margin:0;font-size:12px;color:var(--color-text-muted)}.w-src h3{margin:4px 0 0;font-size:18px;font-weight:600}
.w-src .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--color-border);padding-top:12px;font-size:12px;color:var(--color-text-muted)}
.w-src .ft a{color:var(--color-action-hover);font-weight:600;font-size:14px;display:inline-flex;align-items:center;min-height:36px;text-decoration:none}
.w-src .cp-kv{min-height:36px}
.w-fs{border:0;margin:0;padding:0;display:grid;gap:4px;min-width:0}.w-fs legend{padding:0;margin-bottom:4px;font-size:14px;font-weight:600}
.w-opt{display:flex;align-items:center;gap:12px;min-height:36px;font-size:14px;color:var(--color-text)}
.w-opt input{width:18px;height:18px;margin:0;accent-color:var(--color-action)}
.w-sum{display:grid;gap:8px;padding:16px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface)}
.w-sum h4{margin:0;font-size:16px;font-weight:600}.w-sum p{margin:0;font-size:14px;line-height:1.7}
.w-sum .src{font-size:12px;color:var(--color-text-muted)}
.w-q{display:grid;gap:4px;width:100%;text-align:left;padding:12px 16px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);color:var(--color-text);font:inherit;cursor:pointer;min-height:44px}
.w-q .t{font-size:15px;font-weight:500}.w-q .m{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--color-text-muted)}
.w-q[aria-pressed="true"]{border-color:var(--color-action);background:var(--brand-soft);box-shadow:inset 0 0 0 1px var(--color-action)}
.w-q[aria-pressed="true"] .t{font-weight:600}.w-q[aria-pressed="true"] .m{color:var(--color-text)}
.w-rev{display:grid;grid-template-columns:72px minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:baseline;padding:12px 0;border-top:1px solid var(--color-border);font-size:14px}
.w-rev:first-child{border-top:0}.w-rev .k{font-size:12px;color:var(--color-text-muted)}
.w-rev del{color:var(--color-text-muted);text-decoration:line-through}.w-rev ins{text-decoration:none;font-weight:600;background:var(--tint-ok);color:var(--on-tint-ok);padding:0 4px;border-radius:6px}
.w-rev .ar{color:var(--color-text-muted)}
.w-cat{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;border-top:1px solid var(--color-border);font-size:14px}
.w-cat:first-child{border-top:0}.w-cat code{font-family:var(--font-mono);font-size:13px;color:var(--color-text-muted)}.w-cat .num{color:var(--color-text-muted);font-size:13px}
.w-acts{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.w-scrim{background:var(--color-surface-2);border-radius:14px;padding:24px;display:grid;place-items:center}
.w-scrim .cp-dialog{width:100%;max-width:440px}
</style>"""

def www():
    LG = LOGO_BLOB
    MENU = '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>'
    AC = ' aria-current="page"'
    def bar(on):
        names = ["首页", "博客", "关于", "隐私说明"]
        links = "".join('<a href="#"' + (' class="on"' + AC if n == on else "") + ">" + n + "</a>" for n in names)
        desk = on == "我的工作台"
        btn = ('cp-btn-primary" style="font-weight:600"' + AC) if desk else 'cp-btn-secondary"'
        return ('<header class="cp-topnav w-bar"><a class="brand" href="#"><img src="' + LG + '" alt="" style="width:24px;height:24px">CodePi</a><nav class="links" aria-label="主导航（示例）">' + links
                + '</nav><div class="right"><a class="cp-btn ' + btn + ' href="#">我的工作台</a></div></header>')
    def pc(cat, t, s, m):
        return '<a class="w-pc" href="#"><span class="cp-chip">' + cat + '</span><b>' + t + '</b><p>' + s + '</p><span class="cp-meta">' + m + '</span></a>'
    def post(cat, d, m, t, s):
        return '<a class="w-post" href="#"><div><span class="cp-chip">' + cat + '</span><div class="cp-meta" style="margin-top:8px">' + d + ' · ' + str(m) + ' 分钟</div></div><div><h3>' + t + '</h3><p>' + s + '</p></div></a>'
    def src(eb, name, state, cls, rows, note, time, link, extra=""):
        return ('<article class="cp-card w-src"><div class="top"><div><p class="eb">' + eb + '</p><h3>' + name + '</h3></div><span class="w-badge ' + cls + '">' + state + '</span></div>'
                + rows + '<p class="cp-help" style="margin:0">' + note + '</p><div class="ft"><span>' + time + '</span><a href="#">' + link + ' ↗</a></div></article>')
    kv = lambda k, v: '<div class="cp-kv"><span>' + k + '</span><b>' + v + '</b></div>'
    rng = "".join('<label class="w-opt" for="wc-r' + str(i) + '"><input type="radio" id="wc-r' + str(i) + '" name="wc-range"' + (" checked" if i == 2 else "") + '>' + t + '</label>' for i, t in ((1, "今天"), (2, "近 7 天"), (3, "近 30 天")))
    apps = "".join('<label class="w-opt" for="wc-a' + str(i) + '"><input type="checkbox" id="wc-a' + str(i) + '"' + (" checked" if i != 3 else "") + '>' + t + '</label>' for i, t in ((1, "健康"), (2, "投资理财"), (3, "珂抖屁公众号")))
    chk = "".join('<label class="w-opt" for="wc-c' + str(i) + '"><input type="checkbox" id="wc-c' + str(i) + '"' + (" checked" if i <= 2 else "") + '>' + t + '</label>' for i, t in ((1, "事实与来源已核对"), (2, "没有私人信息外露"), (3, "分类与标签合适"), (4, "头图与图注完整")))
    rev = lambda k, o, n: '<div class="w-rev"><span class="k">' + k + '</span><del>' + o + '</del><span class="ar" aria-hidden="true">→</span><ins>' + n + '</ins></div>'
    cat = lambda n, s, c: '<div class="w-cat"><span>' + n + '（<code>' + s + '</code>）<span class="num">· ' + str(c) + ' 篇</span></span><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button" aria-label="删除分类 ' + n + '">删除</button></div>'
    h = head("www · 共用组件", "www ", "官网与「我的工作台」共用的组件，全部继承全局 cp-*，只补官网需要的形态。分两组：公开站（首页、博客、关于、隐私说明）和我的工作台（/desk/，仅本人）。示例数据均为虚构。")
    A = []
    A.append(comp("站点顶栏（首页当前 / 我的工作台当前）", "cp-topnav", "全站",
        bar("首页") + bar("我的工作台") + '<p class="cp-help" style="margin:0">导航只有 首页、博客、关于、隐私说明；当前页加粗并带 aria-current。右侧「我的工作台」是按钮，在 /desk/ 时变为主按钮。</p>', True))
    A.append(comp("手机顶栏 + 菜单按钮", "cp-topnav + cp-iconbtn", "全站（宽度 640px 以下）",
        '<div class="w-phone"><div class="bar"><a class="brand" href="#"><img src="' + LG + '" alt="" style="width:24px;height:24px">CodePi</a><button class="cp-iconbtn" type="button" aria-label="打开菜单" aria-expanded="false">' + MENU + '</button></div></div>'
        + '<div class="w-phone"><div class="bar"><a class="brand" href="#"><img src="' + LG + '" alt="" style="width:24px;height:24px">CodePi</a><button class="cp-iconbtn" type="button" aria-label="关闭菜单" aria-expanded="true">' + MENU + '</button></div><nav aria-label="手机菜单（示例）"><a href="#"' + AC + '>首页</a><a href="#">博客</a><a href="#">关于</a><a href="#">隐私说明</a><a class="cp-btn cp-btn-primary" href="#" style="margin-top:16px">我的工作台</a></nav></div>'))
    A.append(comp("站点页脚", "cp-meta + 链接", "全站",
        '<footer class="w-foot"><span>生活、工作与思考，在这里连接。 © 2026 示例</span><a href="#">首页</a><a href="#">博客</a><a href="#">关于</a><a href="#">隐私说明</a><a href="#">我的工作台</a></footer>'))
    A.append(comp("步骤块（汇聚 · 授权 · 释放）", "cp-meta + 分栏线", "首页",
        '<div class="w-steps"><div><span class="step">1 · 汇聚</span><b>凝聚你的生活上下文。</b><p>晨起的节律、白天的专注、夜晚的记录，汇成只属于你的理解。</p></div><div><span class="step">2 · 授权</span><b>你决定，它能听见什么。</b><p>每个来源单独授权，默认什么都不读。</p></div><div><span class="step">3 · 释放</span><b>然后，把注意力还给生活。</b><p>需要时出现，平时安静守候。</p></div></div>', True))
    A.append(comp("空间卡（现在的空间）", "cp-card + cp-kv + cp-chip", "首页",
        '<a class="w-space" href="#"><div class="n">健康<small>Health</small></div><p>记录睡眠、恢复与活动，理解自己的长期变化。</p><div class="viz"><div class="cp-kv"><b>7:12</b><span>昨晚睡眠 · 比平均多 12 分</span></div></div><div class="foot"><span>health.example.app</span><span class="cp-chip">本人使用</span></div></a>'
        + '<a class="w-space" href="#"><div class="n">博客<small>Blog</small></div><p>把一天里想清楚的事写下来，成为明天的起点。</p><div class="viz"><b style="font-size:15px;font-weight:500">示例：把数据留在自己手里</b><div class="cp-meta" style="margin-top:4px">3 月 12 日 · 随笔 · 4 分钟</div></div><div class="foot"><span>example.app/blog</span><span class="cp-chip">公开</span></div></a>'))
    A.append(comp("文章卡（最近写下的）", "cp-card + cp-chip", "首页",
        pc("生活感悟", "示例：工作多年后，我发现自己不会休息了", "从程序员到独立创业，拥有更多自由，却只有做事才安心。", "10-27 · 8 分钟")
        + pc("网络技术科普", "示例：从 TCP 到代理内核，一篇讲清", "梳理内核、协议与 DNS 的差异。", "10-27 · 17 分钟")))
    A.append(comp("文章条目（博客列表）", "cp-chip + cp-meta", "博客 · 分类页 · 标签页",
        post("生活感悟", "10-27", 8, "示例：工作多年后，我发现自己不会休息了", "摘要最多三行，超出省略。分类名来自分类表，文章按发布时间倒序排列。")
        + post("AI 深度观察", "10-27", 8, "示例：当 AI 巨头开始互相销售对方的模型", "区分已知事实和行业推演，保留来源。")))
    A.append(comp("分类筛选", "cp-chip（可点形态）", "博客 · 分类页",
        '<nav class="w-filters" aria-label="分类（示例）"><a href="#" aria-current="true">全部<b>3</b></a><a href="#">技术实践<b>1</b></a><a href="#" class="zero">投资观察<b>0</b></a></nav><p class="cp-help" style="margin:0">当前项反色；篇数为 0 的用虚线边框但仍可点，进入后给出空状态与下一步。</p>'))
    A.append(comp("正文排版", "cp-prose + cp-toc", "文章 · 关于 · 隐私说明",
        '<article class="cp-prose" style="max-width:none"><h2 style="margin-top:0">一、小标题</h2><p>正文 16px、1.8 倍行高，一行约 38 个汉字。</p><blockquote>引用用品牌橙细线。</blockquote></article>'))
    A.append(comp("草稿预览条", "cp-banner", "文章草稿预览",
        '<div class="cp-banner" style="background:var(--brand-soft);color:var(--color-text)"><span class="cp-chip">草稿预览</span><span>仅本人可见，不被收录。</span><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">回到审核台</a></div>'))
    A.append(comp("上一篇 / 下一篇", "cp-pager", "文章文末",
        '<div class="cp-pager"><a href="#"><small>上一篇</small>示例：当 AI 巨头开始互相销售模型</a><a href="#" style="text-align:right"><small>下一篇</small>这是最新一篇</a></div>'))
    B = []
    B.append(comp("应用概览卡（三态）", "cp-card + cp-kv + cp-chip", "我的工作台 · 应用概览",
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">'
        + src("生活 / HEALTH", "健康", "已读取", "ok", kv("昨晚睡眠", "7:12") + kv("恢复评分", "81"), "基于已保存的数据整理。", "数据日期 11-06", "进入健康")
        + src("投资 / GU", "投资理财", "请核对时效", "warn", kv("决策待复盘", "3 笔") + '<div class="cp-kv"><span>总资产</span><span style="display:flex;gap:8px;align-items:center"><b aria-label="金额已隐藏">******</b><button class="cp-btn cp-btn-secondary cp-btn-sm" type="button" aria-label="查看总资产">查看</button></span></div>', "数据已超过 3 天，请先到原应用核对。", "数据日期 11-02", "进入投资")
        + src("表达 / WECHAT", "珂抖屁公众号", "暂不可用", "off", '<p class="cp-help" style="margin:0;color:var(--color-text)">暂时没有读到指标。</p>', "读取失败，不显示旧数字；稍后可再刷新。", "未取得数据日期", "进入公众号")
        + '</div>', True))
    B.append(comp("需要处理条目", "cp-task + cp-chip", "我的工作台 · 接下来",
        '<div class="cp-task"><span class="cp-dot live" aria-hidden="true"></span><span style="flex:1">2 篇稿件等待审核</span><span class="cp-chip need">博客</span><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">去处理</a></div>'
        + '<div class="cp-task"><span class="cp-dot" aria-hidden="true"></span><span style="flex:1">投资数据超过 3 天未更新</span><span class="cp-chip">GU</span><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">去核对</a></div>'))
    B.append(comp("按需摘要表单", "cp-btn + 单选 / 多选", "我的工作台 · 回顾",
        '<form style="display:grid;gap:16px" onsubmit="return false"><fieldset class="w-fs"><legend>范围</legend>' + rng + '</fieldset><fieldset class="w-fs"><legend>应用</legend>' + apps + '</fieldset>'
        + '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><button class="cp-btn cp-btn-primary" type="submit">生成摘要 →</button><span class="cp-help">基于已保存的数据整理，不触发同步。</span></div></form>'))
    B.append(comp("摘要结果段", "cp-card + cp-meta", "我的工作台 · 回顾",
        '<article class="w-sum" aria-label="摘要结果"><div class="cp-head" style="margin:0"><span>近 7 天 · 健康、投资理财</span><span>生成于 11-07 09:20</span></div><h4>健康</h4><p>平均睡眠 7 小时 5 分，较上周多 12 分。</p><h4>投资理财</h4><p>3 笔决策待复盘，数据日期 11-02，请先核对时效。</p><span class="src">摘要只保留在当前页面，来源见各应用。</span></article>'))
    B.append(comp("审核队列条目（待审核 / 更新待审核 / 选中）", "cp-card + cp-chip", "我的工作台 · 博客审核",
        '<button class="w-q" type="button" aria-pressed="false"><span class="t">示例：工作多年后，我发现自己不会休息了</span><span class="m"><span class="cp-chip need">待审核</span>11-06 提交</span></button>'
        + '<button class="w-q" type="button" aria-pressed="false"><span class="t">示例：从 TCP 到代理内核</span><span class="m"><span class="cp-chip">更新待审核</span>已发布版本不受影响</span></button>'
        + '<button class="w-q" type="button" aria-pressed="true"><span class="t">示例：当 AI 巨头开始互相销售模型</span><span class="m"><span class="cp-chip need">待审核</span>正在查看</span></button>'))
    B.append(comp("审核清单", "cp-btn + 复选", "我的工作台 · 博客审核",
        '<fieldset class="w-fs"><legend>发布前确认</legend>' + chk + '</fieldset><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><button class="cp-btn cp-btn-primary" type="button" aria-disabled="true" aria-describedby="wc-why">发布</button><span class="cp-help" id="wc-why">还有 2 项未确认，全部勾选后才能发布。</span></div>'))
    B.append(comp("审核操作条", "cp-btn", "我的工作台 · 博客审核",
        '<div class="w-acts"><button class="cp-btn cp-btn-primary" type="button">发布</button><button class="cp-btn cp-btn-secondary" type="button">退回修改</button><button class="cp-btn cp-btn-destructive" type="button">拒绝</button><button class="cp-btn cp-btn-ghost" type="button">归档</button></div><p class="cp-help" style="margin:0">发布为主操作；拒绝是破坏性操作，需再确认；归档可恢复。</p>'))
    B.append(comp("修订对比行（旧 → 新）", "cp-kv + ins / del", "我的工作台 · 博客审核（更新待审核）",
        '<div>' + rev("标题", "示例：从 TCP 到代理", "示例：从 TCP 到代理内核") + rev("分类", "技术实践", "网络技术科普") + rev("标签", "代理", "代理、DNS") + '</div>'))
    B.append(comp("分类条目", "cp-kv + cp-btn", "我的工作台 · 博客分类",
        '<div>' + cat("生活感悟", "life", 14) + cat("技术实践", "tech", 1) + cat("投资观察", "invest", 0) + '</div>'))
    B.append(comp("确认对话框", "cp-dialog", "我的工作台 · 删除分类 / 拒绝稿件",
        '<div class="w-scrim"><div class="cp-dialog" role="dialog" aria-modal="true" aria-labelledby="wc-dt" aria-describedby="wc-db"><h3 class="cp-dialog-title" id="wc-dt">删除分类「投资观察」？</h3><p class="cp-dialog-body" id="wc-db">该分类下没有文章。删除后无法恢复。</p><div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary" type="button">取消</button><button class="cp-btn cp-btn-destructive" type="button">删除</button></div></div></div>', True))
    g1 = '<div class="grp"><h2>A. 公开站</h2><p>首页、博客、关于、隐私说明共用。</p></div><div class="cg">' + "".join(A) + '</div>'
    g2 = '<div class="grp"><h2>B. 我的工作台</h2><p>/desk/，仅本人可见；状态与时效如实显示，不显示旧数字当作新数据。</p></div><div class="cg">' + "".join(B) + '</div>'
    return WWW_CSS + '<div class="doc">' + h + g1 + g2 + '</div>'

def jw():
    ev = '<div style="display:flex;gap:8px"><span class="ev">看到</span><span class="ev inf">推断</span><span class="ev none">无数据</span></div>'
    return f'''<div class="doc">{head("JW · 项目组件", "JW ", "作息自己的组件。图表全部用开源 Chart.js 画（浮动条、堆叠柱、范围、矩阵热力），颜色取全局作息状态色；交互状态继承全局组件。")}
<div class="cg">
{comp("作息时间线", "Chart.js · 浮动横条（indexAxis: y）", "今天 · 登录页示意", img("jw-timeline", "0–24 点作息时间线") + '<p class="cp-help" style="margin:0">每段一个 [开始, 结束] 浮动条；斜纹未知用图案填充；点按一段弹出明细。</p>', True)}
{comp("当前状态卡", "cp-stat", "今天", f'<div class="cp-stat" style="border-left:4px solid var(--state-desk);display:grid;grid-template-columns:auto 1fr;gap:4px 16px;align-items:center"><b style="font-size:24px;grid-row:span 2">在电脑前</b><span>16:07 · 公司网络，有键鼠</span><span class="cp-meta">截至 16:03 · 工作机每 15 分钟上传</span></div>{ev}')}
{comp("证据标签 · 状态图例", "cp-chip · cp-legend", "全站", ev + LEGEND)}
{comp("每天各状态时长", "Chart.js · 堆叠柱（stacked）", "趋势", img("jw-stacked", "每天各状态堆叠柱"))}
{comp("每天几点", "Chart.js · 散点 + 线段（范围与平均）", "趋势", img("jw-range", "每天几点范围"))}
{comp("哪些钟头最出活", "Chart.js · chartjs-chart-matrix", "工作", img("jw-heat", "钟头热力"))}
{comp("时间花在哪", "Chart.js · 横向条", "工作", img("jw-cats", "八类去向"))}
{comp("被打断", "Chart.js · 柱状（高于平均 1.5 倍标橙）", "工作", img("jw-inter", "被打断"))}
{comp("来源新鲜度 · 判断规则行", "cp-fresh · cp-kv", "来源与口径", '<div class="cp-kv"><span style="color:var(--color-text)">家中设备扫描</span><span class="cp-fresh">新鲜 · 8 分钟前</span></div><div class="cp-kv"><span style="color:var(--color-text)">工作机采样</span><span class="cp-fresh stale">过期 · 25 分钟前</span></div><div class="cp-kv"><span style="color:var(--color-text)">开会</span><span class="ev inf">推断</span></div>')}
</div></div>'''

def proj():
    return f'''<div class="doc">{head("project · 项目组件", "project ", "工作台自己的组件。列表与抽屉继承全局 cp-task、cp-drawer；两个小图用 Chart.js。")}
<div class="cg">
{comp("池子行", "cp-task", "今天 · 池子", '<div class="cp-task" style="background:var(--color-background);padding:0 8px;border-radius:10px"><span style="flex:1">授权示例上线</span><span class="cp-chip need">需要你</span><span class="cp-meta">截止 11-13</span><button class="cp-btn cp-btn-secondary cp-btn-sm">放进今天</button><button class="cp-btn cp-btn-ghost cp-btn-sm">删除</button></div><div class="cp-task"><span style="flex:1">示例网关限流调整</span><span class="cp-meta">查过 2 次 · 最近 11-05</span></div>')}
{comp("分类折叠组", "details + cp-head", "池子", '<details open><summary style="font-weight:600;font-size:13px;cursor:pointer">发布 <span class="cp-meta">2</span></summary><div class="cp-task"><span style="flex:1">授权示例上线</span></div><div class="cp-task"><span style="flex:1">发布示例版本说明</span></div></details>')}
{comp("今天泳道", "cp-task + 空位", "今天", '<div class="cp-head" style="margin:0"><span style="color:var(--color-text);font-weight:600">你的</span><span>做完点「完成」</span></div><div class="cp-task"><span style="flex:1">选择示例方案</span><button class="cp-btn cp-btn-ghost cp-btn-sm">退回池子</button><button class="cp-btn cp-btn-secondary cp-btn-sm">完成</button></div><div class="cp-head" style="margin:8px 0 0"><span style="color:var(--color-text);font-weight:600">建国的</span><span>合并后自动移到做完</span></div><div class="cp-empty" style="padding:16px">从池子拿一件过来</div>')}
{comp("交接卡", "cp-alert 形态", "任务抽屉 · 项目页", '<div style="border:1px solid var(--color-border);border-radius:10px;padding:12px;font-size:13px;line-height:1.6"><div style="display:flex;justify-content:space-between"><span><span class="cp-chip need">受阻</span> <b>Claude</b></span><span class="cp-meta">11/4 09:10</span></div>等待示例授权。<br><span style="color:var(--color-text-muted)">下一步：授权后继续。</span><br><span style="color:var(--color-danger)">卡点：缺少示例令牌。</span></div>')}
{comp("本周每天条数", "Chart.js · 柱状", "动态", img("p-week", "本周每天条数"))}
{comp("待办构成", "Chart.js · 单条堆叠", "项目页", img("p-composition", "待办构成"))}
{comp("令牌只显示一次", "cp-copy + cp-banner", "项目页 · 添加项目", f'<div style="display:grid;gap:8px;padding:12px;border:1px solid var(--color-action);border-radius:10px;background:var(--brand-soft)"><b style="font-size:14px">推送令牌只显示这一次</b><div class="cp-copy"><input class="cp-input" readonly value="[示例令牌，占位]" aria-label="推送令牌" style="min-height:40px"><button class="cp-btn cp-btn-secondary cp-btn-sm">{COPY}复制</button></div></div>', True)}
</div></div>'''

def health():
    return f'''<div class="doc">{head("健康 · 项目组件", "健康 ", "健康自己的组件。线上已用 Chart.js，这里统一主题；评分、发现卡继承全局 cp-stat。")}
<div class="cg">
{comp("评分卡", "cp-stat + Chart.js 迷你折线", "概览", '<div class="cp-stat"><div class="cp-head"><span>睡眠 · Oura 评分</span><span class="cp-chip" style="background:var(--tint-warn);color:var(--on-tint-warn)">偏低</span></div><div class="cp-stat-num">72</div><div class="cp-delta">−6 较前 7 天均值</div>' + img("h-mini", "迷你折线") + '</div>')}
{comp("同步状态条", "cp-fresh", "概览 · 设置", '<div style="display:grid;gap:8px"><span class="cp-fresh">本次自动同步已完成</span><span class="cp-fresh stale">后台正在更新数据 · 12 / 30 批次</span><span class="cp-fresh dead">授权失效，自动同步暂停</span></div>')}
{comp("主睡眠 HRV（个人参考带）", "Chart.js · 折线 + 区间填充", "概览 · 睡眠", img("h-hrv", "HRV 参考带"))}
{comp("近 14 天睡眠", "Chart.js · 柱 + 均值虚线", "概览", img("h-sleep14", "14 天睡眠"))}
{comp("睡眠分期", "Chart.js · 浮动横条", "睡眠与恢复", img("h-stages", "睡眠分期"))}
{comp("30 天准备度", "Chart.js · chartjs-chart-matrix", "概览", img("h-ready", "30 天准备度"))}
{comp("对比 · 逐日对齐", "Chart.js · 双折线（缺失断线）", "对比 · 指标详情", img("h-compare-line", "逐日对齐"))}
{comp("对比 · 两期分布", "Chart.js · 散点", "对比 · 指标详情", img("h-compare-dots", "两期分布"))}
{comp("发现卡", "cp-stat", "近 7 天解读", '<div class="cp-stat" style="display:grid;gap:6px"><span class="cp-meta">睡眠</span><b style="font-size:18px">平均每晚少睡了 48 分钟</b><div style="display:flex;gap:12px;align-items:baseline"><span class="cp-stat-num" style="font-size:28px">6:14</span><span class="cp-meta">此前 7:02</span></div><span class="cp-meta">有效记录 6/7 晚 · 对照 7/7 晚</span></div>', True)}
</div></div>'''

def gcharts():
    rows = [("字体", "Inter + 思源黑体，12px", "Chart.defaults.font"), ("文字色", "--color-text-muted", "Chart.defaults.color"), ("网格线", "--color-border，只留横线，不画刻度", "scale.grid / border"),
            ("系列色", "作息状态色、App 八类、睡眠分期、图表中性色；当前值用 --color-action", "各项目组件"), ("图例", "底部左对齐，8px 圆角方块", "plugins.legend"), ("动画", "关闭；尊重减少动态效果", "animation:false"),
            ("缺数据", "不补 0：断线、空框或斜纹", "spanGaps:false"), ("提示框", "点按 / 悬停看明细，深色底", "plugins.tooltip")]
    tr = "".join(f'<tr><td><b>{a}</b></td><td>{b}</td><td><code>{c}</code></td></tr>' for a, b, c in rows)
    return f'''<div class="doc"><h1>全局 · 图表主题（Chart.js）</h1><p class="intro">图表本身属于各项目（JW、健康、工作台各有自己的图），全局只定一套主题：所有项目用同一个开源库 Chart.js，同一套默认值。健康线上已经在用 Chart.js；JW 现在是手写 SVG，迁移时改用同一套。</p>
<div class="panel"><table class="spec"><tr><th>项</th><th>规则</th><th>对应配置</th></tr>{tr}</table></div>
<div class="g3" style="margin-top:24px"><div class="panel"><p class="lab">柱状（JW 被打断）</p>{img("jw-inter", "柱状示例")}</div><div class="panel"><p class="lab">折线 + 区间（健康 HRV）</p>{img("h-hrv", "折线示例")}</div><div class="panel"><p class="lab">矩阵热力（JW 钟头）</p>{img("jw-heat", "热力示例")}</div></div></div>'''

for n, t, fn, h in [("C-WWW", "www · 项目组件", www, 1400), ("C-JW", "JW · 项目组件", jw, 2000), ("C-Proj", "project · 项目组件", proj, 1500), ("C-Health", "健康 · 项目组件", health, 1900), ("G-Charts", "全局 · 图表主题", gcharts, 900)]:
    add(n, t, 1440, H.get(n, h), fn(), CSS)
print("pcomp ok")
