import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HM", "").split(",") if x)}
CSS = """
.mp{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.mp h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.mp .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 40px;max-width:900px}
.mp .lanes{display:grid;grid-template-columns:1fr 48px 1.1fr 48px 1.4fr;align-items:stretch}
.mp .lane{display:grid;gap:12px;align-content:start}
.mp .lane > h2{font-size:14px;font-weight:600;color:var(--color-text-muted);margin:0 0 4px;display:flex;gap:8px;align-items:center}
.mp .lane > h2 i{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;font-style:normal;font-size:12px;background:var(--color-text);color:var(--color-background)}
.mp .node{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:16px}
.mp .node b{display:block;font-size:16px;font-weight:600;margin-bottom:4px}
.mp .node p{margin:0;font-size:13px;line-height:1.6;color:var(--color-text-muted)}
.mp .node code{font-family:var(--font-mono);font-size:12px;background:var(--color-surface-2);padding:2px 4px;border-radius:6px;color:var(--color-text)}
.mp .node.acc{border-color:var(--color-action);box-shadow:inset 4px 0 0 var(--color-action)}
.mp .arrow{display:grid;place-items:center;color:var(--color-text-muted);font-size:24px}
.mp .pg{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;align-items:baseline}
.mp .refs{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.mp .ref{font-size:12px;font-family:var(--font-mono);padding:2px 8px;border-radius:6px;background:var(--color-surface-2);color:var(--color-text);white-space:nowrap}
.mp .ref.ph{background:var(--brand-soft)}
.mp .legend{display:flex;gap:16px;font-size:13px;color:var(--color-text-muted);margin-top:32px;align-items:center}
.mp .ftree{display:grid;gap:16px}
.mp .fpage{display:grid;grid-template-columns:240px minmax(0,1fr);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);overflow:hidden}
.mp .fpage > div:first-child{padding:16px;border-right:1px solid var(--color-border);background:var(--color-surface-2);display:grid;gap:8px;align-content:start}
.mp .fpage > div:first-child b{font-size:16px;font-weight:600}
.mp .fpage > div:first-child code{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted)}
.mp .frow{display:grid;grid-template-columns:200px minmax(0,1fr) 300px;gap:16px;padding:12px 16px;border-top:1px solid var(--color-border);font-size:14px;align-items:baseline}
.mp .frow:first-child{border-top:0}
.mp .frow b{font-weight:600}
.mp .frow span{color:var(--color-text-muted);line-height:1.6}
"""

def refs(desk, phone=""):
    out = "".join(f'<span class="ref">{d}</span>' for d in desk.split()) + "".join(f'<span class="ref ph">{p}</span>' for p in phone.split())
    return f'<span class="refs">{out}</span>'

def arch(title, intro, sources, services, pages):
    src = "".join(f'<div class="node"><b>{a}</b><p>{b}</p></div>' for a, b in sources)
    svc = "".join(f'<div class="node{" acc" if i == 0 else ""}"><b>{a}</b><p>{b}</p></div>' for i, (a, b) in enumerate(services))
    pg = "".join(f'<div class="node pg"><b>{a}</b>{refs(d, p)}<p style="grid-column:1 / -1">{b}</p></div>' for a, b, d, p in pages)
    return f'''<div class="mp"><h1>{title} · 产品架构</h1><p class="intro">{intro}</p>
<div class="lanes"><div class="lane"><h2><i>1</i>数据从哪来</h2>{src}</div><div class="arrow" aria-hidden="true">→</div>
<div class="lane"><h2><i>2</i>服务与接口</h2>{svc}</div><div class="arrow" aria-hidden="true">→</div>
<div class="lane"><h2><i>3</i>页面（右侧是对应设计稿）</h2>{pg}</div></div>
<div class="legend"><span class="ref">电脑稿名</span><span class="ref ph">手机稿名</span><span>在画布本分区按名字找到对应稿；所有设计稿用示意数据。</span></div></div>'''

def feats(title, intro, pages):
    blocks = ""
    for name, route, rows in pages:
        rr = "".join(f'<div class="frow"><b>{f}</b><span>{d}</span>{refs(desk, ph)}</div>' for f, d, desk, ph in rows)
        blocks += f'<div class="fpage"><div><b>{name}</b><code>{route}</code></div><div>{rr}</div></div>'
    return f'<div class="mp"><h1>{title} · 功能图</h1><p class="intro">{intro}</p><div class="ftree">{blocks}</div><div class="legend"><span class="ref">电脑稿名</span><span class="ref ph">手机稿名</span><span>每一项功能或状态都能在右侧的稿里找到。</span></div></div>'

# ───────── www ─────────
W_ARCH = arch("www 官网", "公开站 + 本人工作台。顶栏只有首页、博客、关于、隐私说明；「我的工作台」在右侧，仅本人，统一登录。",
    [("产品清单", "仓库 <code>packages/shared/products.ts</code>：六个空间的名称、说明、入口、访问方式，用于首页「现在的空间」"), ("博客稿件", "AI 客户端经 MCP 提交草稿，本人在工作台审核后发布；分类、标签、系列、资料来源随稿件保存"), ("各应用只读概览接口", "健康、投资理财 GU、珂抖屁公众号各提供状态、指标与数据日期，工作台只读取"), ("博客审核接口（统一登录）", "待审核队列、详情、对比、审核动作、分类管理"), ("站点文案", "只剩关于、隐私说明两份固定文案")],
    [("Astro 静态站 + Cloudflare Worker", "<code>apps/web</code>：生成公开页面，404 页不被收录"), ("博客读取", "列表按发布时间倒序，每页 12 篇；分类、标签、系列页同一版式；RSS 订阅"), ("草稿预览", "<code>/blog/preview/:id</code> 仅本人登录可见，不被收录"), ("/desk/ 工作台", "仅本人：概览、按需摘要、博客审核；未登录先显示登录页"), ("统一登录入口", "「我的工作台」跳到 CodePi 统一登录")],
    [("首页", "价值主张、示意界面、汇聚·授权·释放、授权表、现在的空间、最近写下的、结尾行动", "Main", "Home-Phone"), ("博客", "分类筛选、RSS、分页、空分类、标签与系列", "Web-Blog Web-Blog-States", "Web-Blog-Phone"),
     ("文章", "目录、头图、资料来源、标签系列、上下篇、草稿预览", "Web-Post Web-Post-Preview", "Web-Post-Phone"), ("关于", "理念、三条生活脉络、公开与私域边界", "Web-About", "Web-About-Phone"), ("隐私说明", "分节说明与更新日期", "Web-Privacy", "Web-Privacy-Phone"),
     ("我的工作台 · 登录", "本人登录、重新检查连接及四种登录状态", "Web-Desk-Login", "Web-Desk-Login-Phone"), ("我的工作台 · 概览", "三个应用概览、需要处理、按需摘要", "Web-Desk Web-Desk-States", "Web-Desk-Phone"), ("我的工作台 · 博客审核", "队列、详情、对比、清单、审核动作、分类管理", "Web-Desk-Review Web-Desk-Review-More", "Web-Desk-Review-Phone"),
     ("全站外框", "顶栏、页脚、手机菜单", "Web-Blog", "Web-Menu-Phone")])
W_FEAT = feats("www 官网", "按页面列出功能与状态；产品逻辑与线上一致，只重做界面。", [
    ("全站", "顶栏 · 页脚 · 手机菜单", [("顶栏导航", "首页 / 博客 / 关于 / 隐私说明，当前页加粗；右侧「我的工作台」", "Web-Blog", "Web-Menu-Phone"), ("页脚", "关于、博客、隐私说明", "Web-Blog", "Web-Blog-Phone")]),
    ("首页", "/", [("价值主张", "AI，先从你开始；说明、进入工作台", "Main", "Home-Phone"), ("示意界面", "今天的作息条、要做的事、睡眠、待确认、关键时刻；标明数据虚构", "Main", "Home-Phone"), ("汇聚 · 授权 · 释放", "三步说明", "Main", "Home-Phone"), ("安全与主权", "逐项授权表", "Main", "Home-Phone"), ("现在的空间", "六个空间卡片，每块真实界面缩影", "Main", "Home-Phone"), ("最近写下的", "3 篇最新文章", "Main", "Home-Phone"), ("结尾行动", "进入工作台 / 读博客", "Main", "Home-Phone")]),
    ("博客", "/blog/ · /blog/tag/ · /blog/series/", [("分类筛选", "全部与各分类带篇数；为 0 的分类变淡", "Web-Blog", "Web-Blog-Phone"), ("文章列表 · RSS", "分类、日期、阅读时长、标题、三行摘要；RSS 订阅", "Web-Blog", "Web-Blog-Phone"), ("分页 · 标签与系列页", "每页 12 篇；第 2 页状态", "Web-Blog-States", ""), ("空分类", "给出下一步", "Web-Blog-States", "")]),
    ("文章", "/blog/:slug · /blog/preview/:id", [("正文阅读", "目录（两个以上小标题才出现）、头图、正文排版", "Web-Post", "Web-Post-Phone"), ("文末", "资料来源、分类标签系列、AI 协作声明、上下篇、浏览更多", "Web-Post", "Web-Post-Phone"), ("草稿预览", "仅本人可见的提示条；无目录的短文", "Web-Post-Preview", "")]),
    ("关于", "/about/", [("关于", "理念、三条生活脉络、公开与私域", "Web-About", "Web-About-Phone")]),
    ("隐私说明", "/privacy/", [("隐私说明", "分节文案与更新日期", "Web-Privacy", "Web-Privacy-Phone")]),
    ("我的工作台 · 登录", "/desk/（仅本人，统一登录）", [("本人登录", "统一登录；重新检查连接", "Web-Desk-Login", "Web-Desk-Login-Phone"), ("登录状态", "确认登录中、连接不可用、会话无法验证、登录到期", "Web-Desk-States", "")]),
    ("我的工作台 · 概览", "/desk/", [("三个应用概览", "健康 / 投资理财 GU / 珂抖屁公众号：状态、指标、数据日期、进入；投资金额默认隐藏", "Web-Desk", "Web-Desk-Phone"), ("刷新概览 · 退出登录", "退出中 / 已退出状态", "Web-Desk Web-Desk-States", "Web-Desk-Phone"), ("需要处理", "待处理事项；无待处理状态", "Web-Desk Web-Desk-States", "Web-Desk-Phone"), ("按需摘要", "范围、纳入应用、生成；摘要已生成、范围已改、部分来源不可用", "Web-Desk Web-Desk-States", "Web-Desk-Phone")]),
    ("我的工作台 · 博客审核", "/desk/", [("待审核队列 · 详情", "队列、详情、预览草稿、与上一版对比；无待审核状态", "Web-Desk-Review", "Web-Desk-Review-Phone"), ("审核清单与动作", "清单 4 项；发布、退回、拒绝、归档；小改与小改后发布", "Web-Desk-Review Web-Desk-Review-More", "Web-Desk-Review-Phone"), ("分类管理", "分类增改", "Web-Desk-Review-More", ""), ("已发布 · 测试与归档", "查看、发布更新、下架；恢复", "Web-Desk-Review-More", "")])])

# ───────── JW ─────────
J_ARCH = arch("JW 作息", "把家中设备与工作机的只读信号整理成可以回看的时间线，并公开每个结论的判断方法。设备在线不等于人在。",
    [("家中设备扫描", "家里的扫描器定期上报设备心跳，判断本人手机是否在家、在哪个房间"), ("工作机采样", "工作机每分钟记录网络、电源、锁屏与键鼠空闲，每 15 分钟上传；不读键盘内容和屏幕"), ("本看板设置", "本人手机、App 八类归类、网络改名")],
    [("只读状态服务", "通过服务绑定读取两路原始信号，不对外开放"), ("Rhythm Worker + 数据库", "<code>apps/rhythm</code>：逐分钟判定状态（卧室、在家、通勤、在电脑前、开会、离座、在外、未知），每日汇总"), ("每日重算", "凌晨重算最近 3 天；改设置后手动重算，一次最多 31 天"), ("接口", "<code>/api/day</code> · <code>/api/work</code> · <code>/api/trends</code> · <code>/api/sources</code> · <code>/api/settings</code>"), ("统一登录", "仅本人访问，登录最多保留 7 天")],
    [("今天", "当前状态、通勤、在电脑前、开会、在家、0–24 点、工作时段、App", "J-Today J-Today-States", "J-Today-Phone"), ("工作", "今天 / 本周、八类去向、专注、被打断、钟头热力", "J-Work-Day J-Work-Week J-Work-States", "J-Work-Phone"),
     ("趋势", "近 7 / 30 天、本周和上周、每天几点、不一样的日子、可信度", "J-Trends J-Trends-30 J-Trends-States", "J-Trends-Phone"), ("来源与口径", "两路信号新鲜度、每个状态怎么判断", "J-Sources", "J-Sources-Phone"),
     ("设置", "App 归类、网络改名、重算", "J-Settings J-Settings-States", "J-Settings-Phone"), ("登录", "统一登录", "J-Login", "")])
J_FEAT = feats("JW 作息", "所有时间按北京时间；看到的、推断的、没数据的分开标注；缺数据写「暂无」，不当 0。", [
    ("今天", "", [("日期切换", "前一天 / 后一天跳到有数据的日子；月历只能选有数据的日子", "J-Today J-Today-States", "J-Today-Phone"), ("当前状态", "今天有数据 / 最近 20 分钟没数据 / 看以前的日期三种说明", "J-Today-States", "J-Today-Phone"),
                   ("时长卡片", "上班通勤上限、下班通勤上限、在电脑前、开会、在家（分房间）", "J-Today", "J-Today-Phone"), ("0–24 点时间线", "状态色 + 斜纹未知 + 还没到；点按看一段明细；关键时刻", "J-Today", "J-Today-Phone"),
                   ("工作时段 · App", "按连续时间块；用得最多的 App", "J-Today", "J-Today-Phone"), ("未指定手机 · 加载 · 出错 · 无数据", "顶部提示去设置；三种异常", "J-Today-States", "")]),
    ("工作", "", [("范围切换", "今天 / 本周；本周 7 格逐日", "J-Work-Day J-Work-Week", "J-Work-Phone"), ("时间花在哪", "在公司、八类 App 去向与上周对比、离座", "J-Work-Day", "J-Work-Phone"), ("专注 · 被打断 · 钟头热力", "连续 ≥25 分钟；高于平均 1.5 倍标橙；近 4 周工作日", "J-Work-Day J-Work-Week", "J-Work-Phone"), ("出错 · 加载 · 缺数据", "", "J-Work-States", "")]),
    ("趋势", "", [("范围切换 · 跳转", "近 7 / 30 天；各版块锚点", "J-Trends", "J-Trends-Phone"), ("各状态时长", "每天 24 小时堆叠柱 + 工作日均", "J-Trends J-Trends-30", "J-Trends-Phone"), ("本周和上周 · 每天几点", "工作日按日平均；离家、开始办公、离开电脑、到家", "J-Trends", "J-Trends-Phone"),
                        ("不一样的日子 · 可信度", "与同类日比；两路信号是否齐全", "J-Trends", "J-Trends-Phone"), ("不足 30 天 · 出错 · 无汇总", "", "J-Trends-30 J-Trends-States", "")]),
    ("来源与口径", "", [("两路信号", "新鲜 / 过期 / 时间异常 / 没有新鲜数据", "J-Sources", "J-Sources-Phone"), ("判断方法", "每个状态：看到或推断 + 规则", "J-Sources", "J-Sources-Phone")]),
    ("设置", "", [("待重算提示", "多少天按旧设置算；重算中 / 中断 / 完成", "J-Settings J-Settings-States", "J-Settings-Phone"), ("App 归类 · 网络改名", "八类卡片、全部 App 表、增删；保存后标记待重算", "J-Settings", "J-Settings-Phone"), ("保存 · 校验 · 失败", "", "J-Settings-States", "")])])

# ───────── project ─────────
P_ARCH = arch("project 工作台", "所有项目要做的事一处看。待办、要你拍板的事、进行中的分支和交接由各个仓库推上来；网页只挑选、完成、删除，不编辑待办内容。",
    [("各个仓库", "用项目推送令牌 <code>POST /api/ingest/:id</code> 推送待办、分支、交接与变更"), ("AI 客户端（MCP）", "读今天的安排、挑选今天、记录查过的结论"), ("本人在网页上的操作", "放进今天、退回池子、完成、删除、添加项目")],
    [("Project Worker + 数据库", "<code>apps/project</code>：项目、待办、今天、交接、工作日报"), ("接口", "今天、动态（按周）、项目详情、添加项目与令牌"), ("统一登录", "登录最多 7 天；接口返回 401 时直接回登录页")],
    [("今天", "池子（按分类、搜索、筛选）、今天（你的 / 建国的）、做完、任务抽屉", "P-Today P-Today-States P-Drawer P-Drawer-States", "P-Today-Phone P-Pool-Phone P-Task-Phone"), ("动态", "工作日报：按周、按项目、每天展开", "P-Journal P-Journal-States", "P-Journal-Phone"),
     ("项目页", "待办构成、项目卡、分支、待办、变更、交接、推送与设置", "P-Project P-Project-Empty P-Project-States", "P-Project-Phone"), ("添加项目", "ID、名称、仓库；令牌只显示一次", "P-Dialogs", ""), ("登录 · 全局状态", "", "P-Login P-Global-States", "")])
P_FEAT = feats("project 工作台", "网页不编辑待办内容；要改在仓库里改，下次推送后更新。", [
    ("今天", "", [("池子", "按分类折叠；搜索；只看需要你、7 天内到期、清除筛选；放进今天、删除", "P-Today P-Today-States", "P-Pool-Phone"), ("今天", "你的（退回池子、完成、昨天没做完）；建国的（合并后自动移到做完）；完成进度", "P-Today", "P-Today-Phone"),
                   ("做完", "今天完成的事", "P-Today", "P-Today-Phone"), ("任务抽屉", "状态、需要你、截止、是什么、不做会怎样、建议、出处、交接；只读说明", "P-Drawer P-Drawer-States", "P-Task-Phone"), ("空 · 筛选无结果 · 操作失败 · 忙碌", "", "P-Today-States", "")]),
    ("动态", "", [("周切换 · 项目筛选", "上一周 / 本周 / 下一周；按项目重算", "P-Journal P-Journal-States", "P-Journal-Phone"), ("汇总与每天", "完成 / 上线 / 查过；每天格子与条数", "P-Journal", "P-Journal-Phone"), ("每天展开", "上线、完成（另 N 件）、查过与结论、其他改动", "P-Journal P-Journal-States", "P-Journal-Phone"), ("空周 · 加载 · 失败 · 截断 · 单项目", "", "P-Journal-States", "")]),
    ("项目页", "/p/:id", [("概况", "仓库、最近推送、待办构成", "P-Project", "P-Project-Phone"), ("项目卡 · 分支 · 交接 · 变更", "来自仓库规则的协作适配段", "P-Project", "P-Project-Phone"), ("推送与设置", "状态进行中 / 暂停 / 归档；重新生成令牌（二次确认、只显示一次、失败）", "P-Project P-Project-States", "P-Project-Phone"), ("全空 · 加载 · 不存在", "", "P-Project-Empty P-Project-States", "")]),
    ("添加项目 · 登录", "弹窗", [("添加项目", "打开、填写、提交中、ID 已存在、建好后显示令牌", "P-Dialogs", ""), ("登录与全局状态", "统一登录；启动加载、打不开、登录过期", "P-Login P-Global-States", "")])])

# ───────── health ─────────
H_ARCH = arch("健康", "照顾好自己，从理解每天开始。记录来自 Oura；评分与差值用于记录变化，不作健康判断。",
    [("Oura", "授权后读取官方评分、详细睡眠、心率、活动、压力等；部分类别可能因上游受限暂停"), ("本人的偏好", "界面语言、连接与授权")],
    [("同步任务", "每天 09:00 刷新近 90 天官方评分；详情刷新近 7 天并补齐 90 天缺失；分批执行，关页面也继续"), ("Health API + 数据库", "<code>apps/health</code>：日汇总、睡眠、对比、7 天解读"), ("AI 解读", "模型辅助排序生成结论；失败时回退为规则摘要；仅个人工作区"), ("对外只读", "可授权 AI 应用经 MCP 只读访问，随时撤销"), ("统一登录", "个人工作区与非个人账号权限不同")],
    [("落地页", "未登录介绍；未连接 Oura", "H-Landing H-Landing-States", "H-Landing-Phone"), ("概览", "变化提示、评分、HRV、睡眠、活动、准备度、数据依据", "H-Overview H-Overview-Empty H-Sync-States", "H-Overview-Phone"),
     ("睡眠与恢复", "一晚分期、心率与 HRV、组成、历史对照、最近 7 晚", "H-Sleep H-Sleep-States", "H-Sleep-Phone"), ("近 7 天解读", "标题结论、三张发现卡、生活记录", "H-Weekly H-Weekly-States", "H-Weekly-Phone"),
     ("对比", "区间比较 / 个人历史参照；睡眠恢复、活动、压力", "H-Compare H-Compare-More", "H-Compare-Phone"), ("设置", "偏好、数据同步、账号、应用连接", "H-Settings H-Settings-States", "H-Settings-Phone"), ("AI 解读抽屉", "生成中、结果、失败、回退", "H-AI", "")])
H_FEAT = feats("健康", "空缺不是 0；样本不足时保留原值、暂停比较；供个人观察，不用于诊断。", [
    ("落地页", "", [("介绍与登录", "登录健康空间、关于、语言切换", "H-Landing", "H-Landing-Phone"), ("加载 · 登录失败 · 全局提示 · 未连接 Oura", "", "H-Landing-States", "")]),
    ("概览", "", [("每日简报 · 同步状态", "五种同步状态的紧凑形态", "H-Overview H-Sync-States", "H-Overview-Phone"), ("记录中的变化 · 三项评分", "睡眠、准备度、活动与前 7 天均值比", "H-Overview", "H-Overview-Phone"), ("HRV · 睡眠 · 活动 · 30 天准备度", "个人参考带、7/14/30 天切换、缺失空框", "H-Overview", "H-Overview-Phone"), ("评分趋势 · AI 分析 · 数据依据", "展开区与更新数据", "H-Overview", ""), ("新账号没有记录", "评分显示「—」", "H-Overview-Empty", "")]),
    ("睡眠与恢复", "", [("日期切换 · 结论", "与近期中位数比；实际睡眠、卧床、入睡、清醒、效率", "H-Sleep", "H-Sleep-Phone"), ("一晚的睡眠", "分期、夜间心率、夜间 HRV、组成、历史对照", "H-Sleep", "H-Sleep-Phone"), ("最近 7 晚", "入睡到起床的时间条；7 / 30 天", "H-Sleep", "H-Sleep-Phone"), ("小睡 · 加载 · 失败 · 无记录 · 未采集 · 非个人", "", "H-Sleep-States", "")]),
    ("近 7 天解读", "", [("结论与三张发现卡", "睡眠、夜间恢复、压力与恢复；有效记录天数", "H-Weekly", "H-Weekly-Phone"), ("生活记录 · 继续观察", "生活标签只提供时间线索", "H-Weekly", "H-Weekly-Phone"), ("加载 · 失败 · 数据不足 · 非个人 · 无标签", "", "H-Weekly-States", "")]),
    ("对比", "", [("模式与区间", "区间比较 / 个人历史参照；当前与对照区间；7 / 30 / 自定义", "H-Compare", "H-Compare-Phone"), ("指标表与展开", "逐日对齐与两期分布；缺失不补零", "H-Compare H-Compare-More", "H-Compare-Phone")]),
    ("设置 · AI", "抽屉", [("偏好 · 数据同步 · 账号 · 应用连接", "语言；批次与类别；Oura 连接与修复；MCP 授权与撤销", "H-Settings H-Settings-States", "H-Settings-Phone"), ("AI 解读抽屉", "生成中、结果、失败、回退", "H-AI", "")])])

BOARDS_M = [("Arch-WWW", "www · 产品架构", W_ARCH, 1100), ("Feat-WWW", "www · 功能图", W_FEAT, 1500), ("Arch-JW", "JW · 产品架构", J_ARCH, 1100), ("Feat-JW", "JW · 功能图", J_FEAT, 1700),
            ("Arch-Proj", "project · 产品架构", P_ARCH, 1100), ("Feat-Proj", "project · 功能图", P_FEAT, 1500), ("Arch-Health", "健康 · 产品架构", H_ARCH, 1200), ("Feat-Health", "健康 · 功能图", H_FEAT, 1900)]
for n, t, body, h in BOARDS_M:
    add(n, t, 1440, H.get(n, h), body, CSS)
print("maps ok")
