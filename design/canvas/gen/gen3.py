import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add, day, LEGEND, BARS, LOGO_BLOB
from gen2 import IC, DOC_CSS

LOGO = LOGO_BLOB
def used(t): return f'<div style="font-size:13px;color:var(--color-text-subtle);margin:0 0 18px">用在：{t}</div>'
def head(title, intro): return f'<h1>{title}</h1><p class="intro">{intro}</p>'
I16 = lambda k: IC[k].replace('class="cp-icon"', 'class="cp-icon cp-icon-16"').replace('class="cp-icon cp-icon-16 cp-icon-16"', 'class="cp-icon cp-icon-16"')
CHEV_L = '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
CHEV_R = '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
MENU = '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
SPARK = '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>'
COPY = '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
CAL = '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'

# ───────── 1 外壳与导航 ─────────
def shell():
    return f'''<div class="doc">{head("组件 · 外壳与导航", "官网与各应用共用的外框。官网顶栏讲品牌和入口；应用顶栏讲「在哪个产品、数据多新、我是谁」。")}
<section><h2>官网顶栏 · 手机菜单</h2>{used("www 全站")}
<div class="g2" style="align-items:start">
<div class="panel" style="padding:0 24px"><header class="cp-topnav" style="border:0"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi</a><nav class="links" aria-label="示例"><a href="#">应用</a><a href="#" style="color:var(--color-text);font-weight:600">博客</a><a href="#">关于</a></nav><div class="right"><a href="#">登录</a><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">我的工作台</a></div></header></div>
<div style="display:flex;gap:20px">
<div class="panel" style="padding:0;width:390px;overflow:hidden"><div style="display:flex;align-items:center;height:56px;padding:0 16px;border-bottom:1px solid var(--color-border)"><span style="display:flex;gap:8px;align-items:center;font-weight:600"><img src="{LOGO}" alt="" style="width:22px">CodePi</span><button class="cp-iconbtn" style="margin-left:auto" aria-label="关闭菜单">{IC["x"]}</button></div>
<nav style="display:grid;padding:8px 16px 16px;font-size:17px" aria-label="手机菜单"><a href="#" style="padding:14px 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:var(--color-text)">应用</a><a href="#" style="padding:14px 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:var(--color-text)">博客</a><a href="#" style="padding:14px 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:var(--color-text)">关于</a><a class="cp-btn cp-btn-primary" href="#" style="margin-top:16px">进入我的工作台</a><a class="cp-btn cp-btn-ghost" href="#">登录</a></nav></div>
</div></div></section>

<section><h2>应用顶栏 · 账号菜单</h2>{used("工作台、作息、健康的每一页")}
<div class="panel" style="padding:0;overflow:visible"><div class="cp-appbar" style="border-radius:14px 14px 0 0"><a class="brand" href="#"><img src="{LOGO}" alt="">CodePi<small>健康</small></a>
<span class="cp-fresh" style="margin-left:16px">数据 15:28 更新</span>
<div class="right"><button class="cp-btn cp-btn-secondary cp-btn-sm">{SPARK}问问 AI</button><button class="cp-btn cp-btn-ghost cp-btn-sm" aria-label="账号菜单" aria-expanded="true" style="padding:0 6px"><span class="cp-avatar">小</span></button></div></div>
<div style="display:flex;justify-content:flex-end;padding:8px 24px 24px;min-height:250px;background:var(--color-background);border-radius:0 0 14px 14px">
<div class="cp-menu"><div class="who"><b>小周</b>me@example.com</div><hr><a href="#">设置</a><a href="#">数据来源与同步</a><a href="#">切换到深色</a><hr><button>退出登录</button></div></div></div></section>

<section><h2>应用侧栏 · 手机底部导航 · 返回</h2>{used("工作台（侧栏）、作息与健康（手机底部）、来源与设置子页（返回）")}
<div class="g3" style="align-items:start">
<div class="panel" style="padding:8px"><nav class="cp-nav" aria-label="示例侧栏"><a href="#" aria-current="page"><span>今天</span><span>3</span></a><a href="#"><span>动态</span></a><div class="cp-nav-h">项目</div><a href="#"><span>读书笔记</span><span>6</span></a><a href="#"><span>家务</span><span>4</span></a><a href="#" style="color:var(--color-text-subtle)"><span>＋ 添加项目</span></a><div class="cp-nav-h"></div><a href="#" style="color:var(--color-text-subtle)"><span>退出登录</span></a></nav></div>
<div class="panel" style="padding:0;overflow:hidden"><div style="height:120px;background:var(--color-background);display:grid;place-items:center;font-size:13px;color:var(--color-text-subtle)">页面内容</div><nav class="cp-tabbar" aria-label="底部导航"><a href="#" aria-current="page">今天</a><a href="#">工作</a><a href="#">趋势</a><a href="#">来源</a></nav></div>
<div class="panel"><a class="cp-back" href="#">{CHEV_L}返回来源</a><h3 style="margin:10px 0 4px;font-size:22px;font-weight:600">设置</h3><p class="cp-help" style="margin:0">App 归类、网络改名、重新计算。</p></div>
</div></section>

<section><h2>页脚</h2>{used("www 全站；应用里只保留一行版本与隐私链接")}
<div class="panel" style="padding:0 24px"><footer style="display:flex;gap:24px;padding:24px 0;font-size:13px;color:var(--color-text-subtle)"><span style="margin-right:auto">© 2026 CodePi · kedoupi</span><a href="#" style="color:inherit">隐私</a><a href="#" style="color:inherit">条款</a><a href="#" style="color:inherit">联系</a></footer></div></section>
</div>'''

# ───────── 2 登录 ─────────
def login():
    card = lambda inner: f'<div class="panel" style="padding:32px;display:grid;gap:18px;align-content:start"><div style="display:flex;gap:10px;align-items:center;font-weight:600"><img src="{LOGO}" alt="" style="width:26px">CodePi</div>{inner}</div>'
    return f'''<div class="doc">{head("组件 · 统一登录", "所有应用共用一套邮箱验证码登录。每一步只有一个主按钮，错误写原因和改法。")}
<section><h2>登录流程</h2>{used("auth 统一登录；工作台、作息、健康未登录时进入")}
<div class="g4" style="align-items:stretch">
{card('<div><h3 style="margin:0;font-size:22px;font-weight:600">登录 CodePi</h3><p class="cp-help" style="margin:6px 0 0">用邮箱收一个 6 位验证码。</p></div><div class="cp-field"><label class="cp-label" for="l1">邮箱</label><input class="cp-input" id="l1" value="me@example.com"></div><button class="cp-btn cp-btn-primary">发送验证码</button>')}
{card('<div><h3 style="margin:0;font-size:22px;font-weight:600">输入验证码</h3><p class="cp-help" style="margin:6px 0 0">已发到 me@example.com，10 分钟内有效。</p></div><div class="cp-otp"><span>4</span><span>8</span><span>1</span><span class="on"></span><span></span><span></span></div><button class="cp-btn cp-btn-primary" aria-busy="true">' + IC["loader"] + '验证中</button><a class="cp-back" href="#">换一个邮箱</a>')}
{card('<div><h3 style="margin:0;font-size:22px;font-weight:600">输入验证码</h3><p class="cp-help" style="margin:6px 0 0">已发到 me@example.com</p></div><div class="cp-otp err"><span>4</span><span>8</span><span>1</span><span>0</span><span>9</span><span>2</span></div><span class="cp-error">' + I16("error") + '验证码不对，请再看一下邮件</span><button class="cp-btn cp-btn-primary">重新验证</button>')}
{card('<div><h3 style="margin:0;font-size:22px;font-weight:600">验证码已过期</h3><p class="cp-help" style="margin:6px 0 0">超过 10 分钟没有输入。</p></div><div class="cp-alert cp-alert-warning">' + IC["alert"] + '<div>重新发送后，旧验证码立刻失效。</div></div><button class="cp-btn cp-btn-primary">重新发送</button><span class="cp-help">58 秒后可以再发</span>')}
</div></section>
<section><h2>应用登录门</h2>{used("直接打开 jw.codepi.app、health.codepi.app 等应用时")}
<div class="g2"><div class="panel" style="padding:48px;display:grid;gap:14px;justify-items:start"><span class="cp-chip">作息</span><h3 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-.01em">登录后查看你的作息</h3><p class="cp-help" style="margin:0;max-width:420px;font-size:15px">作息页只给本人看。用 CodePi 账号登录一次，所有应用都会记住你。</p><button class="cp-btn cp-btn-primary">用 CodePi 登录</button></div>
<div class="panel" style="padding:48px;display:grid;gap:14px;justify-items:start"><span class="cp-chip need">登录没完成</span><h3 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-.01em">这次登录没有完成</h3><p class="cp-help" style="margin:0;max-width:420px;font-size:15px">登录链接已经用过，或者在别的浏览器打开了。回到登录页重新来一次就行。</p><div class="row"><button class="cp-btn cp-btn-primary">重新登录</button><button class="cp-btn cp-btn-ghost">回到官网</button></div></div></div></section>
</div>'''

# ───────── 3 日期与时间 ─────────
def cal():
    days = []
    has = {3,4,5,6,7,10,11,12,13,14,17,18}
    for _ in range(5): days.append('<span class="no"></span>')  # March 2026 starts Sunday? placeholder offset
    for d in range(1, 32):
        cls = "has" if d in has else "no"
        if d == 17: cls = "has sel"
        if d == 18: cls = "has today"
        days.append(f'<span class="{cls}">{d}</span>')
    return f'''<div class="cp-cal"><div class="hd"><button class="cp-iconbtn" aria-label="上个月">{CHEV_L}</button>2026 年 3 月<button class="cp-iconbtn" aria-label="下个月">{CHEV_R}</button></div>
<div class="gr"><span class="w">一</span><span class="w">二</span><span class="w">三</span><span class="w">四</span><span class="w">五</span><span class="w">六</span><span class="w">日</span>{''.join(days[:40])}</div>
<div class="ft"><span>有圆点的日子有数据</span><a href="#" style="color:var(--color-action-hover)">回到今天</a></div></div>'''

def time_board():
    return f'''<div class="doc">{head("组件 · 日期与时间", "各应用都在「看某一天 / 某一周」。切换方式统一：箭头逐天，点日期弹出月历，只能选有数据的日子。")}
<section><h2>日期切换器 · 月历</h2>{used("作息今天页、健康睡眠页、工作台动态（按周）")}
<div class="g3" style="align-items:start">
<div class="panel" style="display:grid;gap:18px"><p class="lab">逐天切换</p><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前一天">{CHEV_L}</button><button class="cp-btn cp-btn-ghost cp-btn-sm" style="font-size:20px;font-weight:600;padding:0 8px">3 月 17 日 周一 {I16("chev")}</button><button class="cp-iconbtn" aria-label="后一天">{CHEV_R}</button></div>
<p class="lab">今天（后一天不可点）</p><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前一天">{CHEV_L}</button><span class="d">3 月 18 日 周二</span><button class="cp-iconbtn" aria-label="后一天" aria-disabled="true">{CHEV_R}</button><span class="cp-chip" style="margin-left:8px">今天</span></div>
<p class="lab">按周</p><div class="cp-datebar"><button class="cp-iconbtn" aria-label="上一周">{CHEV_L}</button><span class="d" style="font-size:18px">3 月 16 日 – 22 日</span><button class="cp-iconbtn" aria-label="下一周" aria-disabled="true">{CHEV_R}</button></div></div>
<div>{cal()}</div>
<div class="panel" style="display:grid;gap:18px"><p class="lab">范围切换</p><div class="cp-seg" role="group" aria-label="范围"><button aria-pressed="true">近 7 天</button><button aria-pressed="false">近 30 天</button><button aria-pressed="false">自定义</button></div>
<p class="lab">数据新鲜度</p><div style="display:grid;gap:10px"><span class="cp-fresh">数据 15:28 更新</span><span class="cp-fresh stale">家中设备 2 小时没上报</span><span class="cp-fresh dead">手环 3 天没同步</span></div>
<p class="lab">时间写法</p><table class="spec"><tr><td>今天</td><td>15:28</td></tr><tr><td>今年内</td><td>3 月 12 日</td></tr><tr><td>跨年</td><td>2025 年 12 月 30 日</td></tr><tr><td>时长</td><td>4:45、1 小时 5 分</td></tr></table></div>
</div></section>
</div>'''

# ───────── 4 图表 ─────────
def charts():
    week = [(52, 8), (61, 6), (48, 12), (66, 4), (58, 10), (20, 0), (0, 0)]
    def colf(a, b):
        if a == 0: return '<div></div>'
        return '<div><i style="height:%d%%;background:var(--state-meeting)"></i><i style="height:%d%%;background:var(--state-desk)"></i></div>' % (b, a)
    cols = "".join(colf(a, b) for a, b in week)
    heat = []
    import random
    random.seed(4)
    for r, dname in enumerate(["一", "二", "三", "四", "五", "六", "日"]):
        heat.append(f'<span>{dname}</span>')
        for h in range(24):
            v = 0
            if r < 5 and 9 <= h <= 18 and h != 12: v = random.choice([.35, .6, .85, 1])
            elif r >= 5 and 10 <= h <= 16: v = random.choice([0, 0, .2, .35])
            heat.append(f'<i style="opacity:{v if v else .06}"></i>')
    stages = [("清醒", "var(--state-unknown)", [(0, 3), (46, 2), (88, 4)]), ("REM", "#7FA3DA", [(18, 8), (52, 9), (80, 8)]), ("浅睡", "#4E73B8", [(3, 15), (26, 20), (61, 19)]), ("深睡", "#2F4F8F", [(8, 10), (36, 10), (70, 10)])]
    night = "".join(f'<div style="display:grid;grid-template-columns:44px 1fr;align-items:center;gap:8px;font-size:11px;color:var(--color-text-subtle)"><span>{n}</span><div style="position:relative;height:18px;background:var(--color-surface-2);border-radius:4px">' + "".join(f'<i style="position:absolute;left:{s}%;width:{w}%;top:0;bottom:0;background:{c};border-radius:3px"></i>' for s, w in segs) + '</div></div>' for n, c, segs in stages)
    hist = [3, 6, 11, 17, 22, 18, 12, 7, 3, 1]
    distr = "".join(f'<i style="flex:1;height:{h * 4}%;background:{"var(--color-action)" if i == 5 else "#E2DCD2"};border-radius:2px 2px 0 0"></i>' for i, h in enumerate(hist))
    return f'''<div class="doc">{head("组件 · 图表", "所有图都用同一套状态色、细线坐标和等宽数字；每张图都有图例或文字说明，并写出数据缺口。")}
<section><h2>一天：作息条 + 关键时刻</h2>{used("作息今天页、官网示意、工作台今天（可选）")}
<div class="panel">{day()}<div class="cp-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div style="margin-top:12px">{LEGEND}</div>
<div class="cp-moments"><div class="m" style="left:29.9%;--c:var(--state-home)"><b>07:10</b>起床</div><div class="m lo" style="left:33.6%;--c:var(--state-commute)"><b>08:05</b>出门</div><div class="m" style="left:37.2%;--c:var(--state-desk)"><b>08:55</b>开始工作</div><div class="m" style="left:50.7%;--c:var(--state-away)"><b>12:10</b>午饭</div><div class="m" style="left:58.3%;--c:var(--state-meeting)"><b>14:00</b>开会</div><div class="m" style="left:64.6%;--c:var(--color-action)"><b>15:30</b>现在</div></div></div></section>

<section><h2>一周：7 格 · 堆叠柱 · 热力图</h2>{used("作息工作页（本周 7 格、上周对比）、作息趋势页、健康近 7 天")}
<div class="panel"><div class="cp-week"><div><span>周一</span><b>6:10</b>+25 分</div><div class="on"><span>周二</span><b>4:45</b>−20 分</div><div><span>周三</span><b>5:30</b>+5 分</div><div><span>周四</span><b>6:40</b>+40 分</div><div><span>周五</span><b>5:50</b>持平</div><div class="none"><span>周六</span><b>暂无</b>没有数据</div><div class="none"><span>周日</span><b>—</b>还没到</div></div></div>
<div class="g2" style="margin-top:20px">
<div class="panel"><div class="cp-head"><span>每天在电脑前与开会</span><span>近 7 天</span></div><div class="cp-col">{cols}<span class="cp-avg" style="bottom:56%"><span>平均 5:20</span></span></div><div class="cp-xlab"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="cp-legend" style="margin-top:10px"><span style="--c:var(--state-desk)">在电脑前</span><span style="--c:var(--state-meeting)">开会</span></div></div>
<div class="panel"><div class="cp-head"><span>一周里什么时候在电脑前</span><span>颜色越深越久</span></div><div class="cp-heat">{''.join(heat)}</div><div class="cp-xlab" style="margin-left:30px"><span style="text-align:left">0</span><span>6</span><span>12</span><span>18</span><span style="text-align:right">24</span></div></div>
</div></section>

<section><h2>健康：睡眠分期 · 贡献项 · 分布 · 迷你图</h2>{used("健康睡眠页、对比页、指标详情、概览卡片")}
<div class="g2">
<div class="panel"><div class="cp-head"><span>昨晚睡眠分期</span><span>23:40 – 06:52</span></div><div style="display:grid;gap:6px">{night}</div><div class="cp-xlab" style="margin-left:52px"><span style="text-align:left">23:40</span><span>02:00</span><span>04:30</span><span style="text-align:right">06:52</span></div></div>
<div class="panel"><div class="cp-head"><span>睡眠得分 81 · 各项贡献</span><span>满分 100</span></div>
<div class="cp-hbar"><span>总时长</span><div class="t"><i style="width:84%;--c:var(--state-desk)"></i></div><b>84</b></div>
<div class="cp-hbar"><span>效率</span><div class="t"><i style="width:91%;--c:var(--state-desk)"></i></div><b>91</b></div>
<div class="cp-hbar"><span>深睡</span><div class="t"><i style="width:62%;--c:var(--color-warning)"></i></div><b>62</b></div>
<div class="cp-hbar"><span>入睡时间</span><div class="t"><i style="width:55%;--c:var(--color-warning)"></i></div><b>55</b></div>
<div class="cp-hbar"><span>REM</span><div class="t"><i style="width:78%;--c:var(--state-desk)"></i></div><b>78</b></div></div>
</div>
<div class="g3" style="margin-top:20px">
<div class="panel"><div class="cp-head"><span>静息心率分布</span><span>近 90 天</span></div><div style="display:flex;align-items:flex-end;gap:3px;height:90px;border-bottom:1px solid var(--color-border)">{distr}</div><div class="cp-xlab"><span style="text-align:left">48</span><span>56</span><span style="text-align:right">68 次/分</span></div><p class="cp-help" style="margin:8px 0 0">昨晚 55，落在你最常见的范围里。</p></div>
<div class="cp-stat"><div class="cp-head"><span>恢复</span><span>近 7 天</span></div><div class="cp-stat-num">81</div><svg viewBox="0 0 200 48" style="width:100%;height:48px;margin-top:10px" aria-hidden="true"><polyline points="0,30 33,26 66,34 100,22 133,28 166,18 200,14" fill="none" stroke="var(--color-text)" stroke-width="1.75"/><circle cx="200" cy="14" r="3.5" fill="var(--color-action)"/></svg></div>
<div class="cp-stat"><div class="cp-head"><span>时间去向</span><span>今天</span></div><div style="display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px;margin:6px 0 12px"><i style="flex:42;background:#2E6DB4"></i><i style="flex:18;background:#E08A2E"></i><i style="flex:21;background:var(--state-meeting)"></i><i style="flex:12;background:#8A63B8"></i><i style="flex:7;background:var(--state-away)"></i></div>
<div class="cp-kv"><span>编程</span><b>2:00</b></div><div class="cp-kv"><span>沟通</span><b>0:52</b></div><div class="cp-kv"><span>开会</span><b>1:00</b></div></div>
</div></section>

<section><h2>可信度与缺口</h2>{used("作息趋势页（每天的可信度）、健康缺数据的日子")}
<div class="panel"><div class="row" style="gap:28px;font-size:14px"><span><span class="cp-tier hi"><i></i><i></i><i></i></span> 高：两个来源都在</span><span><span class="cp-tier mid"><i></i><i></i><i></i></span> 中：只有一个来源</span><span><span class="cp-tier lo"><i></i><i></i><i></i></span> 低：大段缺数据</span><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:40px;height:12px;border-radius:3px;background:repeating-linear-gradient(135deg,var(--state-unknown) 0 4px,var(--color-surface) 4px 8px)"></i>没有数据的时段用斜纹，不画成 0</span></div></div></section>
</div>'''

# ───────── 5 列表 ─────────
def lists():
    pool_rows = [("读书笔记", "#2E6DB4", [("整理《思考，快与慢》第 3 章", "", False), ("给读书会选下个月的书", "3-25", True)]),
                 ("家务", "#D9822B", [("回复房东关于续租的邮件", "3-20", True), ("预约空调清洗", "", False)])]
    pr = ""
    for g, c, items in pool_rows:
        pr += f'<div class="cp-head" style="margin:16px 0 4px"><span style="display:flex;gap:8px;align-items:center;color:var(--color-text);font-weight:600"><i style="width:8px;height:8px;border-radius:2px;background:{c}"></i>{g}</span><span>{len(items)}</span></div>'
        for t, d, need in items:
            needc = '<span class="cp-chip need" style="margin-left:auto">需要你</span>' if need else ""
            ml = "" if need else "margin-left:auto"
            dd = ("截止 " + d) if d else ""
            act = '<button class="cp-btn cp-btn-secondary cp-btn-sm" style="min-height:30px">放进今天</button>' if (g == "读书笔记" and not need) else ""
            hl = ' style="background:var(--color-background);margin:0 -8px;padding:0 8px;border-radius:8px"' if act else ""
            pr += f'<div class="cp-task"{hl}><span class="cp-check"></span>{t}{needc}<span class="cp-meta" style="{ml}">{dd}</span>{act}</div>'
    apps = [("编辑器", "#2E6DB4", 120, "2:00"), ("浏览器", "#3BA39B", 64, "1:04"), ("聊天", "#E08A2E", 52, "0:52"), ("会议", "#9A5A1C", 60, "1:00"), ("笔记", "#8A63B8", 30, "0:30")]
    ar = "".join(f'<div class="cp-hbar" style="grid-template-columns:28px 80px 1fr 52px"><span style="width:12px;height:12px;border-radius:3px;background:{c}"></span><span>{n}</span><div class="t"><i style="width:{m / 1.2}%;--c:{c}"></i></div><b>{t}</b></div>' for n, c, m, t in apps)
    return f'''<div class="doc">{head("组件 · 列表", "一行一件事，左边是名字，右边对齐放时间和操作。行高 40px 起，操作在悬停或选中时变清楚。")}
<section><h2>池子 · 今天 · 做完</h2>{used("工作台今天页（池子按项目分组、今天两条泳道、做完折叠）")}
<div class="g3" style="align-items:start">
<div class="panel"><div class="cp-head"><span style="font-size:15px;color:var(--color-text);font-weight:600">池子</span><span>24 件</span></div><div class="cp-seg" role="group" aria-label="筛选"><button aria-pressed="true">全部</button><button aria-pressed="false">需要你 5</button><button aria-pressed="false">7 天内 2</button></div>{pr}</div>
<div class="panel"><div class="cp-head"><span style="font-size:15px;color:var(--color-text);font-weight:600">今天</span><span>1 / 4</span></div><div class="cp-progress" style="margin-bottom:16px"><i style="width:25%"></i></div>
<p class="lab">你的 · 做完点完成</p><div class="cp-task"><span class="cp-check"></span>回复房东关于续租的邮件<span class="cp-meta">3-20</span></div><div class="cp-task"><span class="cp-check done"></span><span style="text-decoration:line-through;color:var(--color-text-muted)">预约空调清洗</span><span class="cp-meta">10:20</span></div>
<p class="lab" style="margin-top:16px">AI 的 · 合并后自动移到做完</p><div class="cp-task"><span class="cp-check ai"></span>整理本周读书笔记<span class="cp-meta">在做</span></div><div class="cp-task"><span class="cp-check ai"></span>汇总三月睡眠变化<span class="cp-meta">排队</span></div></div>
<div class="panel"><details open><summary style="cursor:pointer;font-size:15px;font-weight:600;list-style:none;display:flex;justify-content:space-between">做完 <span class="cp-meta">本周 12 件</span></summary>
<div style="margin-top:10px"><div class="cp-task"><span class="cp-check done"></span>预约空调清洗<span class="cp-meta">今天</span></div><div class="cp-task"><span class="cp-check done"></span>交水电费<span class="cp-meta">昨天</span></div><div class="cp-task"><span class="cp-check done"></span>备份手机照片<span class="cp-meta">3-15</span></div></div></details></div>
</div></section>

<section><h2>工作日报 · App 用量 · 来源</h2>{used("工作台动态（按天展开）、作息工作页、作息来源页、健康设置的同步面板")}
<div class="g3" style="align-items:start">
<div class="panel"><div class="cp-head"><span>本周工作日报</span><span>3 月 16 – 22 日</span></div>
<details open style="border-top:1px solid var(--color-border);padding:10px 0"><summary style="cursor:pointer;font-size:14px;font-weight:600;display:flex;justify-content:space-between">3 月 18 日 周二<span class="cp-meta">完成 3 · 新增 2</span></summary><div class="cp-log" style="margin-top:12px"><div><time>10:20</time><i></i><span>完成「预约空调清洗」</span></div><div><time>14:05</time><i style="background:var(--color-action)"></i><span>AI 合并「读书笔记导出」<span class="cp-meta"> · 读书笔记</span></span></div><div><time>15:10</time><i></i><span>新增「给读书会选书」</span></div></div></details>
<details style="border-top:1px solid var(--color-border);padding:10px 0"><summary style="cursor:pointer;font-size:14px;font-weight:600;display:flex;justify-content:space-between">3 月 17 日 周一<span class="cp-meta">完成 5</span></summary></details></div>
<div class="panel"><div class="cp-head"><span>今天用得最多的 App</span><span>在电脑前 4:45</span></div><div style="display:grid;gap:4px">{ar}</div></div>
<div class="panel"><div class="cp-head"><span>数据来源</span><span>4 个</span></div>
<div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">家中设备扫描</div><span class="cp-meta">每 5 分钟</span></div><span class="cp-fresh">2 分钟前</span></div>
<div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">工作机</div><span class="cp-meta">键鼠、网络、电源</span></div><span class="cp-fresh">刚刚</span></div>
<div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">手环</div><span class="cp-meta">睡眠、心率</span></div><span class="cp-fresh dead">3 天前</span></div>
<div class="cp-kv" style="min-height:52px"><div><div style="color:var(--color-text);font-weight:500">日历</div><span class="cp-meta">未连接</span></div><button class="cp-btn cp-btn-secondary cp-btn-sm" style="min-height:30px">连接</button></div></div>
</div></section>

<section><h2>内容列表：博客文章 · 应用卡片 · 不一样的日子</h2>{used("www 博客列表、www 应用页、作息趋势页「不一样的日子」")}
<div class="g3" style="align-items:start">
<div class="panel"><a href="#" style="display:block;text-decoration:none;color:var(--color-text);padding-bottom:14px;border-bottom:1px solid var(--color-border)"><span class="cp-meta">3 月 12 日 · 随笔 · 4 分钟</span><div style="font-size:17px;font-weight:600;margin:6px 0 4px">把数据留在自己手里，是一种什么体验</div><p class="cp-help" style="margin:0">一个月后回头看，最大的变化不是看到了什么，而是终于敢问了。</p></a>
<a href="#" style="display:block;text-decoration:none;color:var(--color-text);padding-top:14px"><span class="cp-meta">3 月 3 日 · 工程 · 6 分钟</span><div style="font-size:17px;font-weight:600;margin:6px 0 4px">为什么待办要分成「你的」和「AI 的」</div></a></div>
<a class="cp-card" href="#"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3 class="cp-card-title">作息 <span style="font-weight:400;font-size:13px;color:var(--color-text-subtle)">Rhythm</span></h3><span class="cp-chip">本人使用</span></div><p class="cp-card-body">看清自己一天的作息与工作节奏，每个结论都写明怎么判断的。</p><div style="margin-top:16px">{day("cp-day cp-day-sm", now=False)}</div><div class="cp-meta" style="margin-top:14px">jw.codepi.app ↗</div></a>
<div class="panel"><div class="cp-head"><span>不一样的日子</span><span>近 30 天</span></div><div class="cp-kv" style="min-height:48px"><div><div style="color:var(--color-text);font-weight:500">3 月 7 日 周六</div><span class="cp-meta">在电脑前 7:10，比周六平均多 5 小时</span></div><span class="cp-chip need">偏多</span></div><div class="cp-kv" style="min-height:48px"><div><div style="color:var(--color-text);font-weight:500">3 月 11 日 周三</div><span class="cp-meta">00:40 才睡</span></div><span class="cp-chip">晚睡</span></div></div>
</div></section>
</div>'''

# ───────── 6 抽屉与弹窗 ─────────
def overlays():
    return f'''<div class="doc">{head("组件 · 抽屉与弹窗", "看详情用右侧抽屉，不打断列表；需要确认或填表才用弹窗。一次只开一个，Esc 关闭，焦点回到触发它的按钮。")}
<section><h2>任务抽屉 · AI 解读抽屉</h2>{used("工作台任务详情；健康「问问 AI」")}
<div class="g2" style="align-items:start">
<div style="display:flex;border-radius:14px;overflow:hidden;border:1px solid var(--color-border);height:560px"><div class="cp-scrim" style="flex:1"></div><aside class="cp-drawer" aria-label="任务详情"><header><div style="flex:1"><span class="cp-chip need">需要你</span><h3 style="margin-top:8px">回复房东关于续租的邮件</h3><span class="cp-meta">家务 · 截止 3 月 20 日</span></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>
<div class="bd"><div><p class="lab">说明</p><p style="margin:0;line-height:1.6">房东问续租一年还是半年，要在周五前回复。半年租金每月多 200。</p></div>
<div><p class="lab">进展</p><div class="cp-log"><div><time>3-16</time><i></i><span>放进池子</span></div><div><time>3-18</time><i style="background:var(--color-action)"></i><span>放进今天</span></div></div></div></div>
<footer><button class="cp-btn cp-btn-ghost cp-btn-sm">删除</button><button class="cp-btn cp-btn-secondary cp-btn-sm">移出今天</button><button class="cp-btn cp-btn-primary cp-btn-sm">完成</button></footer></aside></div>
<div style="display:flex;border-radius:14px;overflow:hidden;border:1px solid var(--color-border);height:560px"><div class="cp-scrim" style="flex:1"></div><aside class="cp-drawer" aria-label="AI 解读"><header><div style="flex:1"><span class="cp-meta">{SPARK} 问问 AI · 只读你授权的健康数据</span><h3 style="margin-top:6px">这周睡得怎么样？</h3></div><button class="cp-iconbtn" aria-label="关闭">{IC["x"]}</button></header>
<div class="bd"><div class="cp-answer"><p>这周平均睡了 7 小时 4 分，比上周多 18 分钟<span class="cp-cite">1</span>。周三入睡最晚（00:40），第二天的恢复只有 62<span class="cp-cite">2</span>。</p><p>深睡比例偏低的晚上，都是 23:30 以后才躺下的<span class="cp-cite">3</span><span class="cp-cursor"></span></p></div>
<div style="display:grid;gap:6px;font-size:12px;color:var(--color-text-subtle)"><span>1 · 睡眠时长，3 月 12–18 日</span><span>2 · 恢复，3 月 12 日</span><span>3 · 睡眠分期，近 7 晚</span></div></div>
<footer style="justify-content:stretch"><input class="cp-input" placeholder="接着问…" aria-label="接着问" style="min-height:40px"><button class="cp-btn cp-btn-primary cp-btn-sm">发送</button></footer></aside></div>
</div></section>

<section><h2>确认弹窗 · 添加项目 · 令牌只显示一次</h2>{used("工作台删除确认、添加项目、项目推送令牌；作息设置的重新计算确认")}
<div class="g3" style="align-items:start">
<div class="cp-dialog" style="width:auto"><h3 class="cp-dialog-title">删除这件事？</h3><p class="cp-dialog-body">「预约空调清洗」会从池子里移走，等于不做了。30 天内可以在做完里找回。</p><div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button><button class="cp-btn cp-btn-destructive cp-btn-sm">删除</button></div></div>
<div class="cp-dialog" style="width:auto"><h3 class="cp-dialog-title">添加项目</h3><div style="display:grid;gap:14px;margin:16px 0 22px"><div class="cp-field"><label class="cp-label" for="p1">项目名称</label><input class="cp-input" id="p1" value="读书笔记"></div><div class="cp-field"><label class="cp-label" for="p2">标识</label><input class="cp-input" id="p2" value="reading-notes"><span class="cp-help">只能用小写字母、数字和横线，之后不能改</span></div></div><div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button><button class="cp-btn cp-btn-primary cp-btn-sm">添加</button></div></div>
<div class="cp-dialog" style="width:auto"><h3 class="cp-dialog-title">推送令牌</h3><p class="cp-dialog-body" style="margin-bottom:14px">只显示这一次。关掉后看不到了，需要时再生成一个新的。</p><div class="cp-copy"><input class="cp-input" readonly value="cp_live_••••••••••••7Q2x" aria-label="推送令牌" style="min-height:40px"><button class="cp-btn cp-btn-secondary cp-btn-sm">{COPY}已复制</button></div><div class="cp-dialog-actions" style="margin-top:20px"><button class="cp-btn cp-btn-primary cp-btn-sm">我已保存</button></div></div>
</div></section>
</div>'''

# ───────── 7 表单 ─────────
def forms():
    rows = [("微信", "沟通"), ("Figma", "设计"), ("终端", "编程")]
    tr = "".join(f'<tr><td><input class="cp-input" value="{a}" aria-label="App 名称" style="min-height:36px;font-size:14px"></td><td><div class="cp-select-wrap"><select class="cp-select" aria-label="类别" style="min-height:36px;font-size:14px"><option>{b}</option></select>{IC["chev"]}</div></td><td style="width:44px"><button class="cp-iconbtn" aria-label="删除 {a}">{IC["x"]}</button></td></tr>' for a, b in rows)
    return f'''<div class="doc">{head("组件 · 表单", "标签常驻、错误就近、保存有反馈。设置类表单按「一组一卡」排，改完的项有「已保存」提示，不靠弹窗。")}
<section><h2>输入的各种状态</h2>{used("登录、添加项目、作息设置、健康设置")}
<div class="panel"><div class="g4">
<div class="cp-field"><label class="cp-label" for="a1">默认</label><input class="cp-input" id="a1" placeholder="例如：公司网络"></div>
<div class="cp-field"><label class="cp-label" for="a2">焦点</label><input class="cp-input" id="a2" value="公司网络" style="outline:2px solid var(--color-focus);outline-offset:2px"></div>
<div class="cp-field"><label class="cp-label" for="a3">出错</label><input class="cp-input" id="a3" value="" aria-invalid="true"><span class="cp-error">{I16("error")}名称不能为空</span></div>
<div class="cp-field"><label class="cp-label" for="a4">禁用</label><input class="cp-input" id="a4" value="家里网络" disabled><span class="cp-help">由家中设备自动识别，不能改</span></div>
</div>
<div class="g3" style="margin-top:24px">
<div class="cp-field"><label class="cp-label" for="a5">多行</label><textarea class="cp-input" id="a5" style="min-height:96px;padding:10px 12px">每周三下午有组会，通常 14:00 开始。</textarea></div>
<div style="display:grid;gap:16px;align-content:start"><p class="lab" style="margin:0">开关 · 复选</p><span class="cp-switch on"><i></i>周末也统计工作时长</span><span class="cp-switch"><i></i>把离座超过 10 分钟算作打断</span><span class="cp-checkbox on"><i></i>健康数据允许 AI 读取</span><span class="cp-checkbox"><i></i>投资数据允许 AI 读取</span></div>
<div style="display:grid;gap:12px;align-content:start"><p class="lab" style="margin:0">保存反馈</p><div class="cp-field"><label class="cp-label" for="a6">网络显示名</label><div style="display:flex;gap:8px"><input class="cp-input" id="a6" value="公司"><button class="cp-btn cp-btn-secondary">保存</button></div><span class="cp-help" style="color:var(--color-success);display:flex;gap:4px;align-items:center">{I16("check")}已保存，明天 04:30 起按新名字统计</span></div></div>
</div></div></section>

<section><h2>可编辑的规则表</h2>{used("作息设置：App 八类归类、网络改名")}
<div class="g2" style="align-items:start"><div class="panel"><div class="cp-head"><span style="font-size:15px;color:var(--color-text);font-weight:600">App 归类</span><span>改完后只影响之后的统计</span></div><table class="cp-table"><thead><tr><th>App</th><th>类别</th><th></th></tr></thead><tbody>{tr}</tbody></table><div class="row" style="margin-top:14px"><button class="cp-btn cp-btn-ghost cp-btn-sm">{IC["plus"]}加一行</button><button class="cp-btn cp-btn-primary cp-btn-sm" style="margin-left:auto">保存归类</button></div></div>
<div class="panel" style="display:grid;gap:14px"><div class="cp-head" style="margin:0"><span style="font-size:15px;color:var(--color-text);font-weight:600">重新计算</span></div><p class="cp-help" style="margin:0">改了归类或网络名后，可以把过去的日子按新规则重算一遍。最多一次 31 天。</p><div class="g2" style="gap:12px"><div class="cp-field"><label class="cp-label" for="r1">从</label><input class="cp-input" id="r1" value="2026-03-01"></div><div class="cp-field"><label class="cp-label" for="r2">到</label><input class="cp-input" id="r2" value="2026-03-17"></div></div><div class="row"><button class="cp-btn cp-btn-secondary" aria-busy="true">{IC["loader"]}正在重算 9 / 17 天</button></div><div class="cp-progress"><i style="width:53%"></i></div></div></div></section>
</div>'''

# ───────── 8 文章 ─────────
def content():
    return f'''<div class="doc">{head("组件 · 文章与内容", "博客正文为阅读服务：680px 行宽、17px 正文、1.8 行高。目录跟着滚动，来源和上下篇放在文末。")}
<section><h2>文章页</h2>{used("www 博客文章、关于、隐私、条款")}
<div class="panel" style="padding:48px 56px;display:grid;grid-template-columns:minmax(0,680px) 220px;gap:64px;justify-content:center">
<article class="cp-prose"><div class="row" style="gap:8px;margin-bottom:14px"><a href="#" class="cp-chip" style="text-decoration:none">随笔</a><span class="cp-meta">3 月 12 日 · 4 分钟读完</span></div>
<h1>把数据留在自己手里，是一种什么体验</h1><p style="color:var(--color-text-muted);font-size:19px">一个月后回头看，最大的变化不是看到了什么，而是终于敢问了。</p>
<figure><div style="aspect-ratio:2.35;border-radius:14px;background:linear-gradient(0deg,var(--color-surface-2),var(--color-surface-2));display:grid;place-items:center;color:var(--color-text-subtle);font-size:14px">头图 · 2.35:1</div><figcaption>每篇文章一张头图，图注写在图下。</figcaption></figure>
<h2>先从一个小问题开始</h2><p>第一周我只问了一个问题：我真的每天都在电脑前坐够八小时吗？答案是没有，平均 5 小时 20 分，其中开会占了一成。</p>
<blockquote>数据不会替你做决定，它只是让你不再靠感觉争论。</blockquote>
<p>导出某一天的数据只要一行命令：</p><pre><code>codepi export --day 2026-03-18 --format csv</code></pre>
<ul><li>只读你授权的来源</li><li>每个结论写明出处</li><li>随时可以收回</li></ul></article>
<aside style="position:relative"><nav class="cp-toc" aria-label="目录" style="position:sticky;top:24px"><span class="lab" style="margin:0 0 4px">目录</span><a href="#" aria-current="true">先从一个小问题开始</a><a href="#">一个月后的变化</a><a href="#">还没想明白的事</a></nav></aside>
</div></section>
<section><h2>文末：来源 · 分类 · 上下篇</h2>{used("www 博客文章页底部、博客列表筛选")}
<div class="g2" style="align-items:start">
<div class="panel"><p class="lab">来源</p><ol style="margin:0;padding-left:1.2em;font-size:14px;line-height:1.8;color:var(--color-text-muted)"><li>《睡眠革命》第 4 章，2018</li><li>作息数据，2026 年 2–3 月，示意</li></ol>
<p class="lab" style="margin-top:20px">分类</p><div class="row" style="gap:8px"><a href="#" class="cp-chip need" style="text-decoration:none">全部 12</a><a href="#" class="cp-chip" style="text-decoration:none">工程 5</a><a href="#" class="cp-chip" style="text-decoration:none">随笔 4</a><a href="#" class="cp-chip" style="text-decoration:none">读书 3</a></div></div>
<div class="cp-pager"><a href="#"><small>上一篇</small>为什么待办要分成「你的」和「AI 的」</a><a href="#" style="text-align:right"><small>下一篇</small>一个人的数据，怎样才算属于自己</a></div>
</div></section>
</div>'''

# ───────── 9 状态 ─────────
def states():
    sk = lambda h, w="100%": f'<div class="cp-skel" style="height:{h}px;width:{w}"></div>'
    return f'''<div class="doc">{head("组件 · 加载、空、出错", "每个页面都要画这三种状态。加载用骨架保持版面不跳；空状态说明下一步；出错写原因和改法，能重试就给按钮。")}
<section><h2>加载</h2>{used("所有应用首次打开（全页）、切换日期（局部骨架）")}
<div class="g4" style="align-items:stretch">
<div class="panel cp-pageload" style="min-height:220px"><img src="{LOGO}" alt="">正在打开工作台</div>
<div class="panel" style="display:grid;gap:10px;align-content:start"><p class="lab">数据卡</p>{sk(14, "40%")}{sk(36, "60%")}{sk(44)}</div>
<div class="panel" style="display:grid;gap:10px;align-content:start"><p class="lab">列表</p>{sk(16)}{sk(16, "85%")}{sk(16, "92%")}{sk(16, "70%")}{sk(16, "80%")}</div>
<div class="panel" style="display:grid;gap:10px;align-content:start"><p class="lab">图表</p>{sk(28)}<div style="display:flex;gap:6px;align-items:flex-end;height:90px">{''.join(sk(h, "100%").replace('style="', 'style="flex:1;') for h in (40, 70, 55, 80, 62))}</div></div>
</div></section>
<section><h2>空状态</h2>{used("工作台今天 / 池子筛选无结果 / 动态空周；博客分类无文章；作息没有这一天")}
<div class="g4">
<div class="cp-empty"><b>今天还没有安排</b>从池子里挑一件放进来。<button class="cp-btn cp-btn-secondary cp-btn-sm" style="margin-top:6px">打开池子</button></div>
<div class="cp-empty"><b>没有符合筛选的事</b>「需要你」里现在是空的。<button class="cp-btn cp-btn-ghost cp-btn-sm" style="margin-top:6px">看全部</button></div>
<div class="cp-empty"><b>这一周没有日报</b>3 月 9 – 15 日没有完成或新增的事。</div>
<div class="cp-empty"><b>这一天没有数据</b>3 月 2 日家中设备和工作机都没上报。<button class="cp-btn cp-btn-ghost cp-btn-sm" style="margin-top:6px">去前一天</button></div>
</div></section>
<section><h2>出错与提醒</h2>{used("接口失败、数据过期、未连接来源、离线、404")}
<div style="display:grid;gap:12px">
<div class="cp-banner">{IC["alert"]}<span>手环 3 天没同步，睡眠和恢复显示为暂无。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">现在同步</button></div>
<div class="cp-banner err">{IC["error"]}<span>今天的数据没加载出来：服务暂时不可用。</span><button class="cp-btn cp-btn-secondary cp-btn-sm">重试</button></div>
</div>
<div class="g3" style="margin-top:20px">
<div class="panel" style="padding:32px;display:grid;gap:12px;justify-items:start"><span class="cp-chip">健康</span><h3 style="margin:0;font-size:22px;font-weight:600">还没连接手环</h3><p class="cp-help" style="margin:0">连接后，睡眠、恢复和活动会每天自动同步。</p><button class="cp-btn cp-btn-primary">连接手环</button></div>
<div class="panel" style="padding:32px;display:grid;gap:12px;justify-items:start"><span class="cp-chip">离线</span><h3 style="margin:0;font-size:22px;font-weight:600">网络断开了</h3><p class="cp-help" style="margin:0">你改的内容先存在这台设备上，联网后自动同步。</p></div>
<div class="panel" style="padding:32px;display:grid;gap:12px;justify-items:start"><span style="font-size:48px;font-weight:600;letter-spacing:-.03em;line-height:1">404</span><h3 style="margin:0;font-size:22px;font-weight:600">这个页面不存在</h3><p class="cp-help" style="margin:0">链接可能写错了，或者页面已经搬走。</p><div class="row"><a class="cp-btn cp-btn-primary cp-btn-sm" href="#">回到首页</a><a class="cp-btn cp-btn-ghost cp-btn-sm" href="#">看看应用</a></div></div>
</div></section>
</div>'''

# ───────── 10 深色 ─────────
def dark():
    return f'''<div class="doc" data-theme="dark" style="background:var(--color-background);color:var(--color-text)">{head("组件 · 深色主题", "深色是可选主题，不是品牌主展示。所有组件同一套类名，只换变量；主按钮在深色下用浅橙底、深色字。深色底上的 Logo 用官方反白母版（symbol-inverse），此处以虚线框占位。")}
<section><h2>常用组件在深色下</h2>{used("工作台、作息、健康的深色模式")}
<div class="panel" style="padding:0;overflow:hidden"><div class="cp-appbar"><a class="brand" href="#"><span style="width:22px;height:22px;border-radius:6px;border:1px dashed var(--color-border-strong);display:grid;place-items:center;font-size:9px;color:var(--color-text-subtle)">反白</span>CodePi<small>作息</small></a><span class="cp-fresh" style="margin-left:16px">数据 15:28 更新</span><div class="right"><button class="cp-btn cp-btn-secondary cp-btn-sm">{SPARK}问问 AI</button><span class="cp-avatar">小</span></div></div>
<div style="padding:24px;display:grid;gap:20px"><div class="cp-datebar"><button class="cp-iconbtn" aria-label="前一天">{CHEV_L}</button><span class="d">3 月 18 日 周二</span><button class="cp-iconbtn" aria-label="后一天" aria-disabled="true">{CHEV_R}</button></div>
{day()}<div class="cp-axis" style="margin-top:-14px"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>{LEGEND}
<div class="g3"><div class="cp-stat"><div class="cp-head"><span>在电脑前</span><span>今天</span></div><div class="cp-stat-num">4:45</div><div class="cp-delta">比上周二少 20 分</div></div>
<div class="cp-stat"><div class="cp-head"><span>今天要做</span><span>1 / 3</span></div><div class="cp-task"><span class="cp-check"></span>回复房东的邮件<span class="cp-meta">3-20</span></div><div class="cp-task"><span class="cp-check ai"></span>整理读书笔记<span class="cp-meta">AI 在做</span></div></div>
<div class="cp-stat" style="display:grid;gap:12px;align-content:start"><div class="row"><button class="cp-btn cp-btn-primary cp-btn-sm">保存</button><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button><button class="cp-btn cp-btn-ghost cp-btn-sm">更多</button></div><div class="cp-seg" role="group" aria-label="范围"><button aria-pressed="true">近 7 天</button><button aria-pressed="false">近 30 天</button></div><div class="cp-alert cp-alert-warning">{IC["alert"]}<div>手环 3 天没同步</div></div></div></div></div></div></section>
</div>'''

BOARDS3 = [("Comp-Shell", "组件 · 外壳与导航", shell, 1720), ("Comp-Login", "组件 · 统一登录", login, 1060), ("Comp-Time", "组件 · 日期与时间", time_board, 760),
           ("Comp-Charts", "组件 · 图表", charts, 2050), ("Comp-Lists", "组件 · 列表", lists, 1700), ("Comp-Overlays", "组件 · 抽屉与弹窗", overlays, 1300),
           ("Comp-Forms", "组件 · 表单", forms, 1180), ("Comp-Content", "组件 · 文章与内容", content, 1700), ("Comp-States", "组件 · 加载、空、出错", states, 1250), ("Comp-Dark", "组件 · 深色主题", dark, 820)]
H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("H3", "").split(",") if x)}
for name, title, fn, h in BOARDS3:
    add(name, title, 1440, H.get(name, h), fn(), DOC_CSS)
print("ok3")
