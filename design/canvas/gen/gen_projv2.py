"""project 改版第 1 步：Arch-Proj-v2「改版功能树（提案）」。每个叶子标 保留 / 调整 / 新增 / 去掉 与 P-F 编号，覆盖 inventory 全部 55 项。
决定：张老板 2026-11-07 11:12「按建议」——弃用旧稿 Proj-Today、「动态」改名「日报」、手机底栏 今天 / 日报 / 项目。HV="名=高" 覆盖高度。"""
import os, sys, re
sys.argv = sys.argv[:1]  # 首页高度走 H_MAIN / H_HOME 环境变量
os.environ.setdefault("HS", "4096"); os.environ.setdefault("HC", "2457")
from gen import add

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HV", "").split(",") if x)}

CSS = """
.v2{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.v2 h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.v2 .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 32px;max-width:960px}
.v2 h2.sec{font-size:20px;font-weight:600;margin:40px 0 16px}
.v2 .nav{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.v2 .navc{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:24px}
.v2 .navc h3{font-size:16px;font-weight:600;margin:0 0 12px}
.v2 .chips{display:flex;gap:8px;flex-wrap:wrap}
.v2 .chip{font-size:14px;padding:6px 12px;border-radius:8px;background:var(--color-surface-2)}
.v2 .chip.new{background:var(--brand-soft);box-shadow:inset 0 0 0 1px var(--color-action)}
.v2 .navc p{font-size:13px;color:var(--color-text-muted);margin:12px 0 0;line-height:1.6}
.v2 .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}
.v2 .pg{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:24px}
.v2 .pg h3{font-size:18px;font-weight:600;margin:0}
.v2 .pg .rt{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted);margin:4px 0 16px}
.v2 .grp{font-size:13px;font-weight:600;color:var(--color-text-muted);margin:16px 0 4px}
.v2 .f{display:grid;grid-template-columns:52px minmax(0,1fr);gap:4px 12px;padding:8px 0;border-top:1px solid var(--color-border);font-size:14px;line-height:1.5}
.v2 .f .id{grid-column:2;font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted)}
.v2 .t{font-size:12px;font-weight:500;padding:2px 0;border-radius:6px;text-align:center;align-self:start}
.v2 .t.keep{background:var(--color-surface-2);color:var(--color-text-muted)}
.v2 .t.adj{color:var(--color-warning);box-shadow:inset 0 0 0 1px var(--color-warning)}
.v2 .t.new{background:var(--brand-soft);color:var(--color-text);box-shadow:inset 0 0 0 1px var(--color-action)}
.v2 .t.drop{color:var(--color-danger);box-shadow:inset 0 0 0 1px var(--color-danger)}
.v2 .t.na{color:var(--color-text-muted);box-shadow:inset 0 0 0 1px var(--color-border-strong)}
.v2 .dec{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.v2 .dec div{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:20px;font-size:14px;line-height:1.6}
.v2 .dec b{display:block;font-size:15px;margin-bottom:4px}
.v2 .dec small{color:var(--color-text-muted);font-size:12px}
.v2 .cov{margin-top:32px;font-size:14px;color:var(--color-text-muted);line-height:1.7}
.v2 .cov b{color:var(--color-success)}
.v2 .legend{display:flex;gap:24px;align-items:center;font-size:13px;color:var(--color-text-muted);margin-top:24px;flex-wrap:wrap}
.v2 .legend > span{display:inline-flex;gap:8px;align-items:center}
.v2 .legend .t{width:52px;display:inline-block}
"""

K, A, N, D, X = "keep", "adj", "new", "drop", "na"
L = {K: "保留", A: "调整", N: "新增", D: "去掉", X: "后台"}

PAGES = [
    ("今天", "/", [
        ("顶部", [(K, "日期与完成进度", "F09"), (N, "读取失败就地「重试」", "F09"), (K, "手机「今天 / 池子 / 做完」分段", "F10")]),
        ("池子", [(K, "按分类折叠", "F11"), (K, "搜索（新稿补画）", "F12"), (K, "只看需要你 / 7 天内到期", "F13 F14"), (K, "清除筛选与计数", "F15 F16"),
                 (K, "「查过 N 次 · 最近时间」", "F17"), (K, "放进今天", "F18"), (A, "删除：5 秒内可撤销；手机收进「更多」", "F19")]),
        ("今天栏", [(K, "「你的」「建国的」两组", "F20"), (A, "卡片：跨天任务加明显标记", "F21"), (N, "点任务标题打开抽屉", "F47"), (K, "退回池子 / 完成", "F22 F23")]),
        ("做完栏与反馈", [(A, "做完显示完成时间", "F24"), (A, "操作失败提示几秒后自动收起", "F25")]),
    ]),
    ("日报（原「动态」）", "/log", [
        ("", [(A, "页面改名「日报」，导航同步", "F26"), (K, "周汇总：完成 / 上线 / 查过", "F26"), (K, "按项目筛选", "F27"), (K, "上一周 / 本周 / 下一周", "F28"),
              (K, "7 格热力，点格子跳到当天", "F29"), (K, "每天折叠卡", "F30"), (K, "上线 / 完成 / 查过 / 其他改动", "F31–F34"),
              (K, "超过 500 条的截断提示", "F35"), (N, "读取失败就地「重试」", "F26")]),
    ]),
    ("项目（手机新入口）", "手机底栏「项目」；桌面即侧栏", [
        ("", [(A, "项目列表：按项目固定取色，扩到 8 种", "F07"), (N, "「已归档」折叠组，可回看", "F44"), (K, "添加项目入口", "F08"),
              (A, "添加项目表单：加「取消」", "F51"), (K, "建好后显示一次令牌", "F52"), (A, "退出登录：手机放在本页底部", "F05")]),
    ]),
    ("项目页", "/p/:id", [
        ("概况", [(K, "项目头：名称、仓库、最近推送", "F36"), (A, "项目不存在：加「回到今天」", "F36"), (N, "改项目名", "PATCH name"), (K, "待办构成条与图例", "F37"), (K, "项目卡", "F38")]),
        ("内容", [(K, "进行中分支", "F39"), (K, "未完成待办卡片 → 抽屉", "F40"), (K, "最近变更", "F41"), (A, "交接：点条目打开对应任务", "F42")]),
        ("设置", [(K, "推送令牌信息", "F43"), (A, "归档要确认一次", "F44"), (A, "没有令牌时写「生成推送令牌」", "F45"), (K, "复制令牌", "F46")]),
    ]),
    ("任务抽屉", "任意页 ?task=", [
        ("", [(K, "详情：是什么 / 不做会怎样 / 建议 / 需要你", "F47"), (K, "交接时间线", "F48"), (N, "查过记录与结论", "F17 F33"),
              (K, "关闭方式与可分享链接", "F49"), (K, "「内容来自仓库待办，网页只读」", "F50")]),
    ]),
    ("登录与全局", "/login 与启动", [
        ("", [(K, "统一登录（带返回地址）", "F01"), (K, "登录失败提示（新稿补画）", "F01"), (K, "返回地址白名单", "F02"), (K, "启动加载 / 打不开", "F03"),
              (K, "登录过期回登录页", "F04"), (A, "导航：桌面侧栏 + 手机三项底栏", "F06"), (K, "未知地址回今天", "F53"),
              (X, "禁止抓取 / https / 同源校验", "F54"), (X, "仓库推送与助手接口", "F55"), (D, "旧稿 Proj-Today(-Phone)、「推送正常」标识", "旧稿")]),
    ]),
]


def body():
    nav = '''<div class="nav">
<div class="navc"><h3>桌面 · 侧栏</h3><div class="chips"><span class="chip">今天</span><span class="chip">日报</span><span class="chip">项目列表</span><span class="chip new">已归档（折叠）</span><span class="chip">＋ 添加项目</span><span class="chip">退出登录</span></div><p>和现在一样常驻左侧；「动态」改名「日报」，项目列表底部加已归档折叠组。</p></div>
<div class="navc"><h3>手机 · 底栏</h3><div class="chips"><span class="chip">今天</span><span class="chip">日报</span><span class="chip new">项目</span></div><p>新增「项目」一项，装下项目列表、添加项目和退出登录；池子仍在今天页里分段切换。</p></div></div>'''
    cards = ""
    for name, route, groups in PAGES:
        g = ""
        for gn, items in groups:
            if gn:
                g += f'<div class="grp">{gn}</div>'
            g += "".join(f'<div class="f"><span class="t {s}">{L[s]}</span><span>{t}</span><span class="id">{i}</span></div>' for s, t, i in items)
        cards += f'<div class="pg"><h3>{name}</h3><div class="rt">{route}</div>{g}</div>'
    dec = '''<div class="dec">
<div><b>旧稿 Proj-Today 弃用</b>「记一件事」先不做。<br><small>张老板 2026-11-07 11:12 按建议</small></div>
<div><b>「动态」改名「日报」</b>页面内容本来就是工作日报。<br><small>张老板 2026-11-07 11:12 按建议</small></div>
<div><b>手机底栏：今天 / 日报 / 项目</b>池子留在今天页分段里。<br><small>张老板 2026-11-07 11:12 按建议</small></div></div>'''
    return f'''<div class="v2"><h1>project · 改版功能树（提案）</h1>
<p class="intro">在现状 55 个功能上改：大部分保留，标出要调整、新增和去掉的。你确认这张图后，再按它画新的桌面和手机页面。</p>
<h2 class="sec">导航</h2>{nav}<h2 class="sec">页面与功能</h2><div class="grid">{cards}</div>
<h2 class="sec">已定的决定</h2>{dec}
<p class="cov"><b>覆盖 55 / 55</b>：现状功能地图里的 P-F01–P-F55 每一项都在上面有去处，没有删掉任何现有功能；「去掉」只针对旧稿和代码里没有的标识。</p>
<div class="legend"><span><i class="t keep">保留</i>照现在的功能</span><span><i class="t adj">调整</i>功能在，改做法</span><span><i class="t new">新增</i>现在没有</span><span><i class="t drop">去掉</i>不再画</span><span><i class="t na">后台</i>不上界面</span></div></div>'''


add("Arch-Proj-v2", "project · 改版功能树（提案）", 1440, H.get("Arch-Proj-v2", 2000), body(), CSS)

# 覆盖自检：P-F01–F55 都出现
ids = set()
for _, _, groups in PAGES:
    for _, items in groups:
        for _, _, i in items:
            for a, b in re.findall(r"F(\d+)(?:–F?(\d+))?", i):
                ids.update(range(int(a), int(b or a) + 1))
missing = sorted(set(range(1, 56)) - ids)
print("v2 ok; missing", missing)
