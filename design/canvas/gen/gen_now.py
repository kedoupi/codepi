"""现状组画板：Now-Proj-Map（现状功能地图）/ Now-Proj-Issues（现状问题与建议改法）。
数据源：codepi docs/products/project/inventory.md（2026-11-07，main b8d1c59）。HN="名=高,…" 覆盖高度。"""
import os, sys
sys.argv = sys.argv[:1]  # 首页高度走 H_MAIN / H_HOME 环境变量  # gen.py 顶层会按这组高度重写 Main / Home-Phone，保持与 build_all 一致
os.environ.setdefault("HS", "4096"); os.environ.setdefault("HC", "2457")
from gen import add

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HN", "").split(",") if x)}

CSS = """
.nw{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.nw h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.nw .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 32px;max-width:960px}
.nw .stats{display:flex;gap:16px;margin:0 0 40px}
.nw .stat{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px 24px;min-width:160px}
.nw .stat b{display:block;font-size:32px;font-weight:600;letter-spacing:-.02em}
.nw .stat span{font-size:14px;color:var(--color-text-muted)}
.nw .stat.warn b{color:var(--color-warning)}
.nw .stat.bad b{color:var(--color-danger)}
.nw .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}
.nw .pg{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:24px}
.nw .pg h2{font-size:18px;font-weight:600;margin:0 0 4px}
.nw .pg .sub{font-size:13px;color:var(--color-text-muted);margin:0 0 16px}
.nw .f{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:4px 12px;padding:8px 0;border-top:1px solid var(--color-border);font-size:14px;line-height:1.5}
.nw .f:first-of-type{border-top:0}
.nw .f small{grid-column:1/-1;font-size:12px;color:var(--color-text-muted)}
.nw .t{font-size:12px;font-weight:500;padding:2px 8px;border-radius:6px;white-space:nowrap;align-self:start}
.nw .t.ok{background:var(--color-surface-2);color:var(--color-text-muted)}
.nw .t.miss{background:var(--color-surface);color:var(--color-warning);border:1px solid var(--color-warning)}
.nw .t.diff{background:var(--color-surface);color:var(--color-danger);border:1px solid var(--color-danger)}
.nw .t.na{background:transparent;color:var(--color-text-muted);border:1px dashed var(--color-border-strong)}
.nw .legend{display:flex;gap:24px;align-items:center;font-size:13px;color:var(--color-text-muted);margin-top:40px;flex-wrap:wrap}
.nw .legend > span{display:inline-flex;gap:8px;align-items:center}
.nw .src{font-size:12px;color:var(--color-text-muted);margin-top:16px}
/* 问题板 */
.nw .groups{display:grid;gap:32px}
.nw .grp h2{font-size:20px;font-weight:600;margin:0 0 12px}
.nw .row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 120px;gap:24px;padding:16px 24px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);margin-bottom:8px;font-size:14px;line-height:1.6}
.nw .row b{display:block;font-size:15px;font-weight:600;margin-bottom:4px}
.nw .row .now{color:var(--color-text-muted)}
.nw .row .fix{border-left:2px solid var(--color-action);padding-left:16px}
.nw .row .ids{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted);text-align:right}
.nw .head{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 120px;gap:24px;padding:0 24px 8px;font-size:13px;color:var(--color-text-muted)}
.nw .ask{background:var(--brand-soft);border:1px solid var(--color-action);border-radius:var(--radius-card);padding:24px}
.nw .ask h2{font-size:20px;font-weight:600;margin:0 0 12px}
.nw .ask ol{margin:0;padding-left:24px;font-size:15px;line-height:1.8}
.nw .ask small{color:var(--color-text-muted);font-size:13px}
"""

OK, MISS, DIFF, NA = "ok", "miss", "diff", "na"
LABEL = {OK: "已画", MISS: "漏画", DIFF: "和代码不一致", NA: "不上界面"}

PAGES = [
    ("登录与全局", "侧栏、手机底栏、启动与登录", [
        ("统一登录（带返回地址）", OK, ""),
        ("登录失败提示", MISS, "代码有「登录未完成」提示，稿里没画"),
        ("启动加载 / 打不开 / 重新加载", OK, ""),
        ("登录过期自动回登录页", OK, ""),
        ("退出登录", DIFF, "手机上代码没有入口，稿里画了"),
        ("导航", DIFF, "代码手机底栏只有「今天 / 动态」，稿画了 4 项"),
        ("侧栏项目列表与「需要你」数字", OK, ""),
        ("添加项目入口", OK, "只在桌面侧栏"),
        ("路由兜底（未知地址回今天）", OK, ""),
    ]),
    ("今天", "池子 / 今天 / 做完 三栏", [
        ("日期与完成进度", OK, ""),
        ("手机「今天 / 池子 / 做完」分段", DIFF, "稿把池子画成底栏独立一项"),
        ("池子按分类折叠", OK, ""),
        ("池子搜索", MISS, ""),
        ("筛选：只看需要你 / 7 天内到期", OK, ""),
        ("清除筛选、计数", OK, ""),
        ("「查过 N 次 · 最近时间」", OK, ""),
        ("放进今天", OK, ""),
        ("从池子删除", OK, "代码与稿都没有确认和撤销"),
        ("「你的」「建国的」两组", OK, ""),
        ("退回池子 / 完成", OK, ""),
        ("做完栏", DIFF, "稿每条有完成时间，代码只有标题"),
        ("操作中 / 操作失败", OK, ""),
        ("读取失败后重试", DIFF, "稿有重试按钮，代码只有文字"),
    ]),
    ("动态（工作日报）", "按周看完成、上线、查过", [
        ("周汇总：完成 / 上线 / 查过", OK, ""),
        ("按项目筛选", OK, ""),
        ("上一周 / 本周 / 下一周", OK, ""),
        ("7 格热力，点格子跳到当天", OK, ""),
        ("每天折叠卡", OK, ""),
        ("上线 / 完成 / 查过 / 其他改动", OK, ""),
        ("超过 500 条的截断提示", OK, ""),
    ]),
    ("项目页", "一个项目的待办、分支、交接与设置", [
        ("项目头：名称、仓库、最近推送", DIFF, "稿多了「推送正常」标识"),
        ("项目不存在", DIFF, "稿有「回到今天」按钮，代码只有一行字"),
        ("待办构成条与图例", OK, ""),
        ("项目卡：规则、隔离、提交、验收、合并", OK, ""),
        ("进行中分支", OK, ""),
        ("未完成待办卡片 → 打开抽屉", OK, ""),
        ("最近变更", OK, ""),
        ("交接", OK, ""),
        ("推送令牌信息", OK, ""),
        ("状态：进行中 / 暂停 / 归档", OK, ""),
        ("无令牌时的按钮", DIFF, "稿写「生成」，代码仍写「重新生成」"),
        ("重新生成令牌、复制令牌", OK, ""),
        ("改项目名", MISS, "接口有，界面也没有入口"),
    ]),
    ("任务抽屉", "从项目页卡片打开", [
        ("任务详情：是什么 / 不做会怎样 / 建议 / 需要你", OK, ""),
        ("交接时间线", OK, ""),
        ("关闭方式与可分享链接", OK, ""),
        ("「内容来自仓库待办，网页只读」", OK, ""),
    ]),
    ("添加项目与后台", "弹窗、推送、助手接口", [
        ("添加项目表单", DIFF, "稿有「取消」按钮，代码没有"),
        ("建好后显示一次令牌", OK, ""),
        ("仓库推送待办 / 分支 / 变更 / 交接", NA, ""),
        ("助手接口（今天、待办、项目、交接）", NA, ""),
        ("禁止抓取、强制 https、同源校验", NA, ""),
    ]),
]

OLD = ("旧稿 Proj-Today / Proj-Today-Phone", DIFF, "早期构思：「记一件事」、数据更新时间等代码都没有，要定去留")


def fmap():
    cards = ""
    for name, sub, items in PAGES:
        rows = "".join(f'<div class="f"><span>{t}</span><span class="t {s}">{LABEL[s]}</span>{f"<small>{n}</small>" if n else ""}</div>' for t, s, n in items)
        cards += f'<div class="pg"><h2>{name}</h2><p class="sub">{sub}</p>{rows}</div>'
    t, s, n = OLD
    cards += f'<div class="pg"><h2>旧稿</h2><p class="sub">和现在的 P- 系列并存</p><div class="f"><span>{t}</span><span class="t {s}">{LABEL[s]}</span><small>{n}</small></div></div>'
    return f'''<div class="nw"><h1>project 现状 · 功能地图</h1>
<p class="intro">线上 project 工作台现在真实有的功能，逐项对照画布里的原型。改版时每一项都要在新稿里找到位置，或写明决定去掉。</p>
<div class="stats"><div class="stat"><b>55</b><span>功能点</span></div><div class="stat warn"><b>3</b><span>漏画</span></div><div class="stat bad"><b>11</b><span>和代码不一致</span></div><div class="stat"><b>11</b><span>体验问题</span></div></div>
<div class="grid">{cards}</div>
<div class="legend"><span><i class="t ok">已画</i>稿和代码一致</span><span><i class="t miss">漏画</i>代码有、稿没画</span><span><i class="t diff">和代码不一致</i>稿和代码对不上</span><span><i class="t na">不上界面</i>后台能力，不用画</span></div>
<p class="src">来源：codepi docs/products/project/inventory.md（2026-11-07 盘点，P-F01–P-F55）。部分条目已合并显示。</p></div>'''


ISSUES = [
    ("够不着", [
        ("手机上找不到项目页和退出登录", "侧栏在手机上隐藏，底栏只有「今天 / 动态」", "手机底栏加「项目」；退出登录放进「项目」页底部", "P-F05 F06"),
        ("今天页的任务点不开", "要拍板的事看不到「是什么、不做会怎样」，得去项目页找", "今天、池子里的任务标题都能打开抽屉", "P-F20 F47"),
        ("归档的项目回不去", "归档后从侧栏消失，没有入口", "侧栏底部加「已归档」折叠组", "P-F44"),
        ("「查过」的结论看不到", "池子只显示查过几次，结论原文只在动态页", "抽屉里显示查过记录与结论", "P-F17 F33"),
    ]),
    ("容易点错", [
        ("删除一点就没了", "没有确认、不能撤销，手机上和「放进今天」等宽并排", "删除后给 5 秒「撤销」；手机上删除收进更多菜单", "P-F19"),
        ("归档一点就生效", "状态切换没有确认", "归档时要确认一次", "P-F44"),
        ("新项目也写「重新生成令牌」", "确认文案还提「旧令牌失效」，会误导", "没有令牌时写「生成推送令牌」", "P-F45"),
    ]),
    ("出错后不好恢复", [
        ("读取失败只能整页刷新", "今天、动态读取失败都没有重试，失败提示也不会消失", "每块就地给「重试」；操作失败提示几秒后自动收起", "P-F09 F25 F26"),
    ]),
    ("信息不够清楚", [
        ("做完没有时间，跨天不明显", "做完栏只有标题；「昨天没做完」只是小字", "做完显示完成时间；跨天的任务加明显标记", "P-F21 F24"),
        ("「动态」名字和内容对不上", "页面内容其实是工作日报", "改名「日报」（待你定）", "P-F26"),
        ("项目超过 5 个颜色会重复", "配色按顺序循环 5 种", "按项目固定取色，扩到 8 种", "P-F07"),
    ]),
]


def fissues():
    head = '<div class="head"><span>现在怎样</span><span>建议改法</span><span style="text-align:right">功能点</span></div>'
    g = ""
    for name, rows in ISSUES:
        r = "".join(f'<div class="row"><div><b>{t}</b><span class="now">{now}</span></div><div class="fix">{fix}</div><div class="ids">{ids}</div></div>' for t, now, fix, ids in rows)
        g += f'<div class="grp"><h2>{name}</h2>{head}{r}</div>'
    ask = '''<div class="ask"><h2>要你决定的 3 件事</h2><ol>
<li>旧稿 Proj-Today / Proj-Today-Phone 弃用吗？里面的「记一件事」要不要留到新版？<br><small>建议：弃用，「记一件事」先不做。</small></li>
<li>「动态」改名叫「日报」吗？<br><small>建议：改。</small></li>
<li>手机底栏放哪几项？<br><small>建议：今天 / 日报 / 项目 三项，池子留在今天页里分段切换。</small></li></ol></div>'''
    return f'''<div class="nw"><h1>project 现状 · 问题与建议改法</h1>
<p class="intro">从代码里看出来的 11 个体验问题，按「够不着 / 容易点错 / 出错后不好恢复 / 信息不够清楚」分组。建议改法是下一步改架构图和原型的输入，你确认后才动。</p>
<div class="groups">{g}{ask}</div>
<p class="src">来源：codepi docs/products/project/inventory.md「日常使用流与体验疑点」（推断自代码，未在线上实测）。</p></div>'''


add("Now-Proj-Map", "project · 现状功能地图", 1440, H.get("Now-Proj-Map", 1800), fmap(), CSS)
add("Now-Proj-Issues", "project · 现状问题与建议改法", 1440, H.get("Now-Proj-Issues", 1800), fissues(), CSS)
print("now ok")
