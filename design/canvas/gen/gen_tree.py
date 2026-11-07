"""产品架构图：层级树（产品 → 页面 → 功能），每个页面标注电脑稿 / 手机稿。"""
import os
os.environ.setdefault("HS", "3695"); os.environ.setdefault("HC", "2457")
from gen import add

H = {k: int(v) for k, v in (x.split("=") for x in os.environ.get("HT", "").split(",") if x)}
CSS = """
.tr{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.tr h1{font-size:40px;font-weight:600;letter-spacing:-.025em;margin:0}
.tr .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 48px;max-width:900px}
.tr .tree{display:grid;grid-template-columns:240px minmax(0,1fr);align-items:center}
.tr .root{background:var(--color-text);color:var(--color-background);border-radius:var(--radius-card);padding:24px;display:grid;gap:8px;position:relative}
.tr .root b{font-size:24px;font-weight:600}
.tr .root span{font-size:13px;line-height:1.6;color:var(--text-inverse-muted)}
.tr .root::after{content:"";position:absolute;right:-32px;top:50%;width:32px;border-top:2px solid var(--color-border-strong)}
.tr .lvl1{margin-left:32px;border-left:2px solid var(--color-border-strong);display:grid;gap:16px;padding:8px 0}
.tr .page{position:relative;margin-left:32px;display:grid;grid-template-columns:240px minmax(0,1fr);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);overflow:hidden}
.tr .page::before{content:"";position:absolute;left:-34px;top:32px;width:32px;border-top:2px solid var(--color-border-strong)}
.tr .page .ph{padding:16px;background:var(--color-surface-2);border-right:1px solid var(--color-border);display:grid;gap:8px;align-content:start}
.tr .page .ph b{font-size:16px;font-weight:600}
.tr .page .ph code{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted)}
.tr .refs{display:flex;gap:4px;flex-wrap:wrap}
.tr .ref{font-size:12px;font-family:var(--font-mono);padding:2px 8px;border-radius:6px;background:var(--color-surface);border:1px solid var(--color-border);white-space:nowrap}
.tr .ref.m{background:var(--brand-soft);border-color:var(--tint-accent-line)}
.tr .feats{padding:16px;display:flex;flex-wrap:wrap;gap:8px;align-content:start}
.tr .f{font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid var(--color-border);background:var(--color-background)}
.tr .f.st{color:var(--color-text-muted);border-style:dashed}
.tr .legend{display:flex;gap:16px;align-items:center;font-size:13px;color:var(--color-text-muted);margin-top:32px;flex-wrap:wrap}
"""
def tree(name, sub, desc, pages):
    rows = ""
    for title, route, desk, phone, feats, states in pages:
        refs = "".join(f'<span class="ref">{d}</span>' for d in desk.split()) + "".join(f'<span class="ref m">{p}</span>' for p in phone.split())
        fs = "".join(f'<span class="f">{f}</span>' for f in feats) + "".join(f'<span class="f st">{s}</span>' for s in states)
        rows += f'<div class="page"><div class="ph"><b>{title}</b>{f"<code>{route}</code>" if route else ""}<div class="refs">{refs}</div></div><div class="feats">{fs}</div></div>'
    return f'''<div class="tr"><h1>{name} · 产品架构</h1><p class="intro">{desc}</p>
<div class="tree"><div class="root"><b>{name}</b><span>{sub}</span></div><div class="lvl1">{rows}</div></div>
<div class="legend"><span class="f" style="padding:4px 10px">功能</span><span class="f st" style="padding:4px 10px">状态</span><span class="ref">电脑稿</span><span class="ref m">手机稿</span><span>层级：产品 → 页面 → 功能；功能与线上一致。</span></div></div>'''

WWW = tree("www 官网", "公开站 + 本人工作台", "公开站有哪些页面、每页有哪些功能；顶栏只有首页、博客、关于、隐私说明，右侧是「我的工作台」（仅本人，统一登录）。", [
    ("全站外框", "", "Web-Blog", "Web-Menu-Phone", ["顶栏：首页 · 博客 · 关于 · 隐私说明", "我的工作台入口", "页脚链接", "手机菜单"], []),
    ("首页", "/", "Main", "Home-Phone", ["价值主张（AI，先从你开始）", "示意界面", "汇聚 · 授权 · 释放三步", "安全与主权（授权表）", "现在的空间（六个空间卡片）", "最近写下的（3 篇）", "结尾行动"], []),
    ("博客", "/blog/", "Web-Blog Web-Blog-States", "Web-Blog-Phone", ["分类筛选与篇数", "文章列表", "RSS 订阅", "分页（每页 12 篇）", "标签页", "系列页"], ["空分类", "第 2 页"]),
    ("文章", "/blog/:slug · /blog/preview/:id", "Web-Post Web-Post-Preview", "Web-Post-Phone", ["目录", "头图与图注", "正文排版", "资料来源", "分类 · 标签 · 系列", "AI 协作声明", "上一篇 / 下一篇", "浏览更多"], ["草稿预览", "无目录短文"]),
    ("关于", "/about/", "Web-About", "Web-About-Phone", ["理念", "三条生活脉络", "公开层与私域层"], []),
    ("隐私说明", "/privacy/", "Web-Privacy", "Web-Privacy-Phone", ["分节说明", "更新日期"], []),
    ("我的工作台 · 登录", "/desk/", "Web-Desk-Login", "Web-Desk-Login-Phone", ["本人登录（统一登录）", "重新检查连接"], ["确认登录中", "连接不可用", "会话无法验证", "登录到期"]),
    ("我的工作台 · 概览", "/desk/", "Web-Desk Web-Desk-States", "Web-Desk-Phone", ["三个应用概览：健康 · 投资理财 GU · 珂抖屁公众号", "状态 · 指标 · 数据日期", "进入应用", "投资金额默认隐藏", "刷新概览", "退出登录", "需要处理", "按需摘要：范围 · 纳入应用 · 生成"], ["部分来源不可用", "摘要已生成", "范围已改", "无待处理", "退出中 / 已退出"]),
    ("我的工作台 · 博客审核", "/desk/", "Web-Desk-Review Web-Desk-Review-More", "Web-Desk-Review-Phone", ["待审核队列", "详情与预览草稿", "与上一版对比", "审核清单（4 项）", "发布 · 退回 · 拒绝 · 归档", "小改与小改后发布", "分类管理", "已发布：查看 · 发布更新 · 下架", "测试与归档：恢复"], ["无待审核"])])
JW = tree("JW 作息", "私人作息分析 · 仅本人", "作息有哪些页面、每页有哪些功能。设备在线不等于人在；看到的、推断的、没数据的分开标注。", [
    ("今天", "", "J-Today J-Today-States", "J-Today-Phone", ["日期切换（只跳有数据的日子）", "月历选择", "当前状态", "通勤上限", "在电脑前", "开会", "在家分房间", "0–24 点时间线", "关键时刻", "工作时段", "用得最多的 App"], ["未指定手机", "最近 20 分钟没数据", "看以前的日期", "加载", "出错", "没有这一天"]),
    ("工作", "", "J-Work-Day J-Work-Week J-Work-States", "J-Work-Phone", ["今天 / 本周", "本周 7 格", "八类去向与上周对比", "离座", "专注", "被打断", "哪些钟头最出活", "口径说明"], ["出错", "加载", "缺数据"]),
    ("趋势", "", "J-Trends J-Trends-30 J-Trends-States", "J-Trends-Phone", ["近 7 / 30 天", "各状态时长堆叠柱", "工作日平均", "本周和上周", "每天几点", "不一样的日子", "可信度"], ["不足 30 天", "出错", "无汇总", "无异常日"]),
    ("来源与口径", "", "J-Sources", "J-Sources-Phone", ["家中设备扫描新鲜度", "工作机采样新鲜度", "每个状态怎么判断"], ["过期", "时间异常", "没有新鲜数据"]),
    ("设置", "", "J-Settings J-Settings-States", "J-Settings-Phone", ["待重算提示与重算", "App 八类归类", "全部 App 表", "网络改名", "保存设置"], ["读取中", "读取失败", "重算中 / 中断 / 完成", "校验失败", "保存失败"]),
    ("登录", "", "J-Login", "", ["统一登录"], [])])
PROJ = tree("project 工作台", "所有项目要做的事 · 仅本人", "工作台有哪些页面、每页有哪些功能。待办由各仓库推送，网页只挑选、完成、删除。", [
    ("今天", "", "P-Today P-Today-States P-Drawer", "P-Today-Phone P-Pool-Phone", ["完成进度", "池子按分类折叠", "搜索", "只看需要你", "7 天内到期", "清除筛选", "放进今天", "删除", "你的：退回池子 / 完成", "建国的：合并后自动移到做完", "做完"], ["全空", "筛选无结果", "操作失败", "请求进行中"]),
    ("任务详情", "抽屉", "P-Drawer P-Drawer-States", "P-Task-Phone", ["状态与需要你", "截止", "是什么 / 不做会怎样 / 建议", "出处与关联", "交接记录", "只读说明"], ["已完成", "只有基础字段", "正在读取", "已不存在"]),
    ("动态", "", "P-Journal P-Journal-States", "P-Journal-Phone", ["工作日报按周", "项目筛选", "上一周 / 本周 / 下一周", "完成 · 上线 · 查过汇总", "每天格子", "每天展开明细"], ["空周", "加载", "失败", "超过 500 条截断", "只有一个项目"]),
    ("项目页", "/p/:id", "P-Project P-Project-Empty P-Project-States", "P-Project-Phone", ["待办构成", "项目卡", "进行中分支", "这个项目的待办", "最近变更", "交接", "项目状态：进行中 / 暂停 / 归档", "重新生成推送令牌"], ["全空", "二次确认", "令牌只显示一次", "生成失败", "不存在"]),
    ("添加项目", "弹窗", "P-Dialogs", "", ["ID", "名称", "GitHub 仓库", "建项目并生成令牌"], ["提交中", "ID 已存在", "令牌只显示一次"]),
    ("登录 · 全局", "", "P-Login P-Global-States", "", ["统一登录"], ["启动加载", "打不开", "登录过期回登录页"])])
HEALTH = tree("健康", "个人健康空间 · Oura", "健康有哪些页面、每页有哪些功能。空缺不是 0；评分与差值用于记录变化，不作健康判断。", [
    ("落地页", "", "H-Landing H-Landing-States", "H-Landing-Phone", ["介绍", "登录健康空间", "语言切换"], ["启动加载", "登录失败", "未连接 Oura"]),
    ("概览", "", "H-Overview H-Overview-Empty H-Sync-States", "H-Overview-Phone", ["每日简报", "同步状态", "记录中的变化", "睡眠 · 准备度 · 活动评分", "主睡眠 HRV 与参考带", "近 14 天睡眠", "活动的起伏", "30 天准备度", "评分趋势", "AI 分析", "数据依据"], ["新账号没有记录", "同步进行中 / 受限 / 部分完成 / 失败"]),
    ("睡眠与恢复", "", "H-Sleep H-Sleep-States", "H-Sleep-Phone", ["按晚切换", "与近期中位数比", "睡眠指标", "睡眠分期", "夜间心率", "夜间 HRV", "睡眠组成", "历史对照", "最近 7 晚"], ["只有小睡", "加载", "失败", "近 30 天无记录", "还没采集", "非个人账号"]),
    ("近 7 天解读", "", "H-Weekly H-Weekly-States", "H-Weekly-Phone", ["结论", "睡眠发现卡", "夜间恢复发现卡", "压力与恢复发现卡", "生活记录", "继续观察"], ["数据不足", "授权失效", "只有摘要", "没有生活标签"]),
    ("对比", "", "H-Compare H-Compare-More", "H-Compare-Phone", ["区间比较", "个人历史参照", "当前与对照区间", "7 / 30 / 自定义", "睡眠与恢复 · 活动 · 压力", "逐日对齐", "两期分布"], ["样本不足", "缺失断线"]),
    ("设置", "", "H-Settings H-Settings-States", "H-Settings-Phone", ["界面语言", "数据采集与历史记录", "更新数据", "账号与 Oura 连接", "应用连接与撤销"], ["同步进行中", "非个人账号", "未连接", "语言保存中"]),
    ("AI 解读", "抽屉", "H-AI", "", ["结论", "主要发现", "可以关注", "数据说明"], ["生成中", "失败", "回退为规则摘要"])])

for n, t, body, h in [("Arch-WWW", "www · 产品架构", WWW, 1100), ("Arch-JW", "JW · 产品架构", JW, 1100), ("Arch-Proj", "project · 产品架构", PROJ, 1100), ("Arch-Health", "健康 · 产品架构", HEALTH, 1200)]:
    add(n, t, 1440, H.get(n, h), body, CSS)
print("tree ok")
