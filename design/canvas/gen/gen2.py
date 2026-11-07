from gen import add, day, LEGEND, BARS, ROOT, BOARDS
import sys

IC = {
 "check": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
 "alert": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
 "error": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
 "info": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
 "search": '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
 "chev": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
 "loader": '<svg class="cp-icon cp-icon-16 cp-spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>',
 "plus": '<svg class="cp-icon cp-icon-16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
 "x": '<svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
}

DOC_CSS = """
.doc{background:var(--color-background);color:var(--color-text);font-family:var(--font-sans);padding:64px 72px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.doc h1{font-size:40px;letter-spacing:-.025em;font-weight:600;margin:0}
.doc .intro{font-size:16px;line-height:1.6;color:var(--color-text-muted);margin:12px 0 0;max-width:760px}
.doc section{margin-top:56px}
.doc h2{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px}
.doc h2 + p{font-size:14px;color:var(--color-text-muted);margin:0 0 20px;max-width:760px;line-height:1.6}
.doc .lab{font-size:12px;color:var(--color-text-subtle);margin:0 0 8px;font-weight:500}
.doc .panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);padding:24px}
.doc .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.doc .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.doc .g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.doc .row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.doc .sw{display:grid;grid-template-columns:44px 1fr;gap:10px 12px;align-items:center;font-size:13px}
.doc .sw i{width:44px;height:44px;border-radius:10px;border:1px solid rgb(0 0 0 / 6%)}
.doc .sw b{font-weight:600;display:block}.doc .sw span{color:var(--color-text-muted);font-size:12px;font-family:var(--font-mono)}
.doc .sw small{display:block;color:var(--color-text-muted);font-size:12px;line-height:1.5}
.doc table.spec{width:100%;border-collapse:collapse;font-size:14px}
.doc table.spec th{font-size:12px;font-weight:500;color:var(--color-text-subtle);text-align:left;padding:0 12px 8px 0;border-bottom:1px solid var(--color-border)}
.doc table.spec td{padding:12px 12px 12px 0;border-bottom:1px solid var(--color-border);vertical-align:top;line-height:1.55}
.doc code{font-family:var(--font-mono);font-size:12px;color:var(--color-text-muted)}
"""

def sw(name, var, hexv, use):
    return f'<div class="sw"><i style="background:var({var})"></i><div><b>{name}</b><span>{var} · {hexv}</span><small>{use}</small></div></div>'

def spec_body():
    sem = [("页面底", "--color-background", "#FAF8F4", "页面背景，占画面 75–85%"), ("表面", "--color-surface", "#FFFFFF", "卡片、面板、输入框、弹窗"),
           ("次表面", "--color-surface-2", "#F3EFE8", "v2 新增：分段控件底、窗口栏、标签底"), ("正文", "--color-text", "#2D2A28", "标题与正文"),
           ("次要文字", "--color-text-muted", "#706A64", "说明、元数据（暖白上 5.0:1）"), ("弱文字", "--color-text-subtle", "#8C857E", "v2 新增：表头、计数、轴标签，只用于 12–14px 辅助信息"),
           ("装饰线", "--color-border", "#E7E3DC", "分隔线与卡片边框，不承载含义"), ("控件边界", "--color-border-strong", "#8C857E", "输入框、次按钮边框（3.6:1）"),
           ("行动橙", "--color-action", "#C94F20", "主按钮、焦点环、当前状态点"), ("行动橙 · 悬停", "--color-action-hover", "#A83E18", "悬停；暖白底上的橙色文字"),
           ("暖橙浅底", "--brand-soft", "#FFE6D9", "导航当前项、选中行、需要你"), ("品牌橙", "--brand-orange", "#FF713D", "Logo 与细线、圆点，不作白字底"),
           ("成功", "--color-success", "#23744C", "完成、正常"), ("警告", "--color-warning", "#965400", "需关注、数据过期"), ("错误", "--color-danger", "#B42318", "出错、破坏性操作")]
    states = [("卧室 / 睡眠", "--state-sleep", "#2F4F8F"), ("在家", "--state-home", "#7FA3DA"), ("通勤", "--state-commute", "#D9822B"), ("在电脑前", "--state-desk", "#1F7A63"),
              ("开会", "--state-meeting", "#B85C38"), ("离座", "--state-away", "#9FD0BF"), ("在外", "--state-out", "#7D5BB0"), ("未知", "--state-unknown", "#C9C6BD"), ("还没到", "--state-future", "#EFEBE4")]
    sem_html = "".join(sw(*x) for x in sem)
    st_html = "".join(f'<div class="sw"><i style="background:var({v})"></i><div><b>{n}</b><span>{v} · {h}</span></div></div>' for n, v, h in states)
    site_t = [("展示标题", "--site-display", "72 / 1.08 · 600 · 字距 −3%", '<span style="font-size:48px;font-weight:600;letter-spacing:-.03em;line-height:1.1">AI，先从你开始。</span>', "每页一个，只在官网首屏"),
              ("区块标题", "--site-h2", "44 / 1.2 · 600 · −2.5%", '<span style="font-size:32px;font-weight:600;letter-spacing:-.025em">六个应用，一份上下文。</span>', "后半句可降为弱文字色做双色句"),
              ("导语", "--site-lead", "22 / 1.55 · 400", '<span style="font-size:20px;color:var(--color-text-muted)">它不替你生活。</span>', "首屏与区块说明，行宽 ≤ 640px"),
              ("正文", "--site-body", "16 / 1.6 · 400", '<span style="font-size:16px">正文不小于 16px，行宽约 72 字。</span>', "")]
    app_t = [("页面标题", "--app-title", "22 / 1.3 · 600", '<span style="font-size:22px;font-weight:600">3 月 18 日</span>', "应用页顶部日期或名称"),
             ("大数字", "--app-num", "32 / 1.1 · 600 · 等宽数字", '<span style="font-size:32px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums">7:12</span>', "数据卡主值，只放一个"),
             ("小标题", "--app-h3", "16 / 1.4 · 600", '<span style="font-size:16px;font-weight:600">今天要做</span>', "面板标题"),
             ("正文", "--app-body", "14 / 1.5 · 400", '<span style="font-size:14px">回复房东关于续租的邮件</span>', "列表、表格、表单说明"),
             ("辅助", "--app-meta", "12 / 1.4 · 500", '<span style="font-size:12px;color:var(--color-text-subtle)">3-20 截止 · 数据 15:28 更新</span>', "时间戳、计数、轴标签")]
    def trows(rows): return "".join(f'<tr><td style="width:140px"><b>{a}</b><br><code>{b}</code></td><td style="width:240px;color:var(--color-text-muted)">{c}</td><td style="white-space:nowrap">{d}</td><td style="width:280px;color:var(--color-text-muted);font-size:13px">{e}</td></tr>' for a, b, c, d, e in rows)
    spaces = [(1, 4), (2, 8), (3, 12), (4, 16), (6, 24), (8, 32), (12, 48), (16, 64)]
    sp = "".join(f'<div style="display:flex;align-items:center;gap:12px;font-size:13px"><code style="width:72px">space-{k}</code><i style="display:block;height:12px;width:{v}px;background:var(--color-action);border-radius:2px"></i><span style="color:var(--color-text-muted)">{v}px</span></div>' for k, v in spaces)
    return f'''<div class="doc">
<h1>CodePi 设计规范 v2</h1>
<p class="intro">在 v1.5（石墨灰 + 活力橙、暖白底）上补齐两件事：官网与应用各用一套密度，以及各应用共用的数据组件。颜色不新增品牌色，只补两个中性色和一组作息状态色。所有页面只写语义变量，不写色值。</p>

<section><h2>画布规矩</h2><p>张老板 2026-11-07 定，已写进仓库规则。</p>
<div class="g3">
<div class="panel"><b style="font-size:15px">一个项目一张画布</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">codepi 的全部设计都放在这一张画布里，不再新建。以后有新应用，就在这里加一节。</p></div>
<div class="panel"><b style="font-size:15px">先全局，再项目</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">先放全局的设计规范、公共组件和图表主题；每个项目的组件都继承全局，不另起一套。</p></div>
<div class="panel"><b style="font-size:15px">每个项目四类</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">1 产品架构图（层级图与功能图）· 2 共用组件 · 3 Web · 4 Mobile。架构图用版式盒子画，不用图表库。</p></div>
</div></section>

<section><h2>四条原则</h2><p>从 Stripe、Framer、Linear、Vercel 实测得出，也是这一版首页遵守的规则。</p>
<div class="g4">
<div class="panel"><b style="font-size:15px">标题大而轻</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">展示字号 600 字重、字距收紧；不用 800–900 的粗黑。</p></div>
<div class="panel"><b style="font-size:15px">一页一个强调</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">橙色只给主按钮和「现在 / 已授权」这类状态；其余是暖白与灰。</p></div>
<div class="panel"><b style="font-size:15px">展示真界面</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">官网主视觉用产品自己的界面，数据为虚构示意，并标明。</p></div>
<div class="panel"><b style="font-size:15px">克制的动效</b><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:8px 0 0">悬停 150ms；整页只有一个展开动画；尊重减少动态效果。</p></div>
</div></section>

<section><h2>颜色 · 语义</h2><p>暖白 / 白约 75–85%，灰与文字 10–20%，橙 5–10%。白字只放在行动橙上，不放在品牌橙上。</p>
<div class="panel"><div class="g3" style="row-gap:22px">{sem_html}</div>
<div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin-top:24px"><i style="flex:80;background:var(--color-background);border:1px solid var(--color-border)"></i><i style="flex:13;background:var(--color-text)"></i><i style="flex:7;background:var(--color-action)"></i></div>
<div class="cp-axis"><span>暖白 / 白 80%</span><span>文字与灰 13%</span><span>橙 7%</span></div></div></section>

<section><h2>颜色 · 作息状态</h2><p>与 jw 线上一致，官网示意图与各应用共用。相邻状态同时靠明度区分，不只靠色相；图上永远配图例或文字。</p>
<div class="panel"><div class="g3" style="row-gap:18px">{st_html}</div>
<div style="margin-top:24px">{day()}</div><div class="cp-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div></section>

<section><h2>文字 · 两套字阶</h2><p>同一家族（Inter + 思源黑体），官网用大字讲一件事，应用用小字放更多信息。数字一律等宽（tabular-nums）。</p>
<div style="display:grid;gap:20px">
<div class="panel"><p class="lab">官网 · 展示密度</p><table class="spec"><tr><th>名称</th><th>规格</th><th>样例</th><th>用法</th></tr>{trows(site_t)}</table></div>
<div class="panel"><p class="lab">应用 · 工作密度</p><table class="spec"><tr><th>名称</th><th>规格</th><th>样例</th><th>用法</th></tr>{trows(app_t)}</table></div>
</div></section>

<section><h2>间距、圆角、阴影、动效</h2><p>4px 网格只用 8 档；圆角三档沿用 v1.5，加一档 6px 给作息条与标签。</p>
<div class="g4">
<div class="panel" style="display:grid;gap:10px"><p class="lab">间距</p>{sp}</div>
<div class="panel"><p class="lab">圆角</p><div style="display:grid;gap:14px;font-size:13px">
<div style="display:flex;gap:12px;align-items:center"><i style="width:56px;height:36px;border:1px solid var(--color-border-strong);border-radius:6px"></i>6 · 作息条、标签</div>
<div style="display:flex;gap:12px;align-items:center"><i style="width:56px;height:36px;border:1px solid var(--color-border-strong);border-radius:10px"></i>10 · 按钮、输入框</div>
<div style="display:flex;gap:12px;align-items:center"><i style="width:56px;height:36px;border:1px solid var(--color-border-strong);border-radius:14px"></i>14 · 卡片、面板</div>
<div style="display:flex;gap:12px;align-items:center"><i style="width:56px;height:36px;border:1px solid var(--color-border-strong);border-radius:18px"></i>18 · 弹窗</div></div></div>
<div class="panel"><p class="lab">阴影</p><div style="display:grid;gap:18px;font-size:13px">
<div style="height:56px;border-radius:14px;background:var(--color-surface);border:1px solid var(--color-border);box-shadow:var(--shadow-card);display:grid;place-items:center">卡片 · 几乎无</div>
<div style="height:56px;border-radius:14px;background:var(--color-surface);border:1px solid var(--color-border);box-shadow:var(--shadow-float);display:grid;place-items:center">浮层 · 官网产品窗</div></div></div>
<div class="panel"><p class="lab">动效</p><table class="spec"><tr><td>150ms</td><td>悬停、按下、颜色</td></tr><tr><td>220ms</td><td>展开、抽屉、弹窗</td></tr><tr><td>1.1s</td><td>官网作息条展开，整页唯一</td></tr><tr><td colspan="2" style="color:var(--color-text-muted)">缓动 cubic-bezier(.4,0,.2,1)；减少动态效果时全部关闭</td></tr></table></div>
</div></section>

<section><h2>官网与应用：共享什么、各自不同</h2><p>共享品牌色、字体家族、变量、基础组件与图标；不强制同一种页面结构。</p>
<div class="panel"><table class="spec"><tr><th></th><th>官网</th><th>应用（工作台、作息、健康）</th></tr>
<tr><td><b>目标</b></td><td>让人记住、看懂、愿意进来</td><td>清楚、高效、每天用不累</td></tr>
<tr><td><b>密度</b></td><td>一屏讲一件事，区块间 144px</td><td>一屏放全当天信息，面板间 16–24px</td></tr>
<tr><td><b>字号</b></td><td>展示 72 / 区块 44 / 导语 22</td><td>标题 22 / 正文 14 / 辅助 12</td></tr>
<tr><td><b>布局</b></td><td>1200 容器、左对齐、细线网格</td><td>侧栏 200 + 内容区；面板网格；表格可横向滚动</td></tr>
<tr><td><b>动效</b></td><td>首屏一个展开动画</td><td>只有状态变化的反馈，不做入场动画</td></tr>
<tr><td><b>数据</b></td><td>虚构示意，并写明「数据均为虚构」</td><td>真实数据；缺数据写「暂无」，不当 0</td></tr></table></div></section>

<section><h2>写作</h2><p>沿用 v1.5：中文为主、短句、陈述语气，不用感叹号和 emoji。</p>
<div class="g3">
<div class="panel"><p class="lab">按钮动词开头</p><div class="row"><span class="cp-btn cp-btn-primary cp-btn-sm">放进今天</span><span class="cp-btn cp-btn-secondary cp-btn-sm">标记完成</span></div></div>
<div class="panel"><p class="lab">错误写原因和改法</p><div class="cp-error">{IC["error"].replace('cp-icon"', 'cp-icon cp-icon-16"')}日期不存在，请选 3 月 1 日到 31 日之间</div></div>
<div class="panel"><p class="lab">推断要标出来</p><div class="cp-kv" style="border:0"><span>14:00–15:00 开会</span><span class="cp-chip">推断</span></div></div>
</div></section>
</div>'''

def comp_body():
    return f'''<div class="doc">
<h1>统一组件</h1>
<p class="intro">v1.5 的 8 个组件（按钮、输入框、下拉、卡片、标签页、导航、弹窗、提示）样式不变；v2 补上各应用都要用的数据组件和三种状态。类名统一 <code>cp-</code>，样式只来自变量。</p>

<section><h2>按钮</h2><p>每个视图最多一个主按钮；最小高度 44px，桌面密集工具栏可用 36px。</p>
<div class="panel"><div class="g4">
<div><p class="lab">主按钮</p><div class="row"><button class="cp-btn cp-btn-primary">进入工作台</button><button class="cp-btn cp-btn-primary cp-btn-sm">放进今天</button></div></div>
<div><p class="lab">次按钮</p><div class="row"><button class="cp-btn cp-btn-secondary">看看有哪些应用</button><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button></div></div>
<div><p class="lab">幽灵 · 破坏性</p><div class="row"><button class="cp-btn cp-btn-ghost">{IC["plus"]}添加项目</button><button class="cp-btn cp-btn-destructive cp-btn-sm">删除</button></div></div>
<div><p class="lab">焦点 · 禁用 · 加载</p><div class="row"><button class="cp-btn cp-btn-secondary cp-btn-sm" style="outline:2px solid var(--color-focus);outline-offset:2px">焦点</button><button class="cp-btn cp-btn-primary cp-btn-sm" aria-disabled="true">禁用</button><button class="cp-btn cp-btn-primary cp-btn-sm" aria-busy="true">{IC["loader"]}保存中</button></div></div>
</div></div></section>

<section><h2>表单与筛选</h2><p>标签常驻；错误写原因和改法，并关联到输入框。筛选用分段切换，不用一排胶囊按钮。</p>
<div class="panel"><div class="g4">
<div class="cp-field"><label class="cp-label" for="f1">项目名称</label><input class="cp-input" id="f1" placeholder="例如：读书笔记"><span class="cp-help">只在你的工作台里显示</span></div>
<div class="cp-field"><label class="cp-label" for="f2">截止日期</label><input class="cp-input" id="f2" value="2026-02-30" aria-invalid="true" aria-describedby="f2e"><span class="cp-error" id="f2e">{IC["error"].replace('cp-icon"', 'cp-icon cp-icon-16"')}这一天不存在，请重新选择</span></div>
<div class="cp-field"><label class="cp-label" for="f3">所属项目</label><div class="cp-select-wrap"><select class="cp-select" id="f3"><option>读书笔记</option></select>{IC["chev"]}</div></div>
<div class="cp-field"><label class="cp-label" for="f4">搜索池子</label><div style="position:relative"><input class="cp-input" id="f4" placeholder="搜索事项或分类" style="padding-left:36px"><span style="position:absolute;left:12px;top:14px;color:var(--color-text-subtle)">{IC["search"]}</span></div></div>
</div>
<div class="row" style="margin-top:24px;gap:24px">
<div><p class="lab">分段切换</p><div class="cp-seg" role="group" aria-label="筛选"><button aria-pressed="true">全部 24</button><button aria-pressed="false">需要你 5</button><button aria-pressed="false">7 天内到期 2</button></div></div>
<div><p class="lab">标签页</p><div class="cp-tablist" role="tablist" style="width:320px"><button class="cp-tab" role="tab" aria-selected="true">本周</button><button class="cp-tab" role="tab" aria-selected="false">近 30 天</button><button class="cp-tab" role="tab" aria-selected="false">自定义</button></div></div>
<div><p class="lab">标签与状态点</p><div class="row"><span class="cp-chip need">需要你</span><span class="cp-chip">推断</span><span class="cp-chip"><span class="cp-dot live"></span>现在</span><span class="cp-chip"><span class="cp-dot" style="--c:var(--color-success)"></span>已授权</span></div></div>
</div></div></section>

<section><h2>导航</h2><p>官网顶栏 64px，主按钮放右侧；应用侧栏当前项用暖橙浅底 + 3px 品牌橙指示条，不整片用橙色。</p>
<div class="g2" style="align-items:start">
<div class="panel" style="padding:0 24px"><header class="cp-topnav" style="border:0"><a class="brand" href="#"><img src="/_blob/3e2c94fc8dc2369e81d7096f10727c09" alt="">CodePi</a><nav class="links" aria-label="示例"><a href="#">应用</a><a href="#">博客</a><a href="#">关于</a></nav><div class="right"><a href="#">登录</a><a class="cp-btn cp-btn-secondary cp-btn-sm" href="#">我的工作台</a></div></header></div>
<div class="panel" style="padding:8px;display:flex;gap:16px"><nav class="cp-nav" aria-label="示例侧栏" style="width:220px"><a href="#" aria-current="page"><span>今天</span><span>3</span></a><a href="#"><span>动态</span></a><a href="#"><span>项目</span><span>24</span></a><div class="cp-nav-h">项目</div><a href="#"><span>读书笔记</span><span>6</span></a></nav><p style="font-size:13px;color:var(--color-text-muted);line-height:1.6;margin:12px 8px">手机上侧栏收进底部导航（今天 / 池子 / 动态 / 项目），触控目标 ≥ 44px。</p></div>
</div></section>

<section><h2>数据展示</h2><p>v2 新增。工作台、作息、健康共用同一套；数字等宽，缺数据写「暂无」。</p>
<div class="g3">
<div class="cp-stat"><div class="cp-head"><span>昨晚睡眠</span><span>健康</span></div><div class="cp-stat-num">7:12<small>恢复 81</small></div><div class="cp-delta up">比 7 天平均多 12 分</div><div style="margin-top:14px">{BARS}</div></div>
<div class="cp-stat"><div class="cp-head"><span>今天在电脑前</span><span>作息</span></div><div class="cp-stat-num">4:45</div><div class="cp-delta">开会 1:00 · 比上周二少 20 分</div><div style="margin-top:18px">{day("cp-day cp-day-sm", now=False)}</div></div>
<div class="cp-stat"><div class="cp-head"><span>本周睡眠</span><span>健康</span></div><div class="cp-stat-num" style="color:var(--color-text-subtle)">暂无</div><div class="cp-delta">手环本周还没同步，最后一次 3 月 15 日</div></div>
</div>
<div class="g2" style="margin-top:20px">
<div class="panel"><div class="cp-head"><span>一天的作息条</span><span>数据 15:28 更新</span></div>{day()}<div class="cp-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div style="margin-top:12px">{LEGEND}</div></div>
<div class="panel"><div class="cp-head"><span>任务行</span><span>0 / 3</span></div>
<div class="cp-task"><span class="cp-check"></span>回复房东关于续租的邮件<span class="cp-chip need" style="margin-left:auto">需要你</span><span class="cp-meta">3-20</span></div>
<div class="cp-task"><span class="cp-check ai"></span>整理本周读书笔记<span class="cp-meta">AI 在做</span></div>
<div class="cp-task"><span class="cp-check done"></span><span style="color:var(--color-text-muted);text-decoration:line-through">汇总三月睡眠变化</span><span class="cp-meta">已完成</span></div>
<div class="cp-task"><span class="cp-check"></span>清理书架上的旧杂志<span class="cp-meta" style="color:var(--color-text);display:inline-flex;gap:12px"><span>放进今天</span><span style="color:var(--color-text-subtle)">删除</span></span></div></div>
</div>
<div class="g2" style="margin-top:20px">
<div class="panel"><div class="cp-head"><span>键值行</span><span>投资理财</span></div><div class="cp-kv"><span>决策待复盘</span><b>3 笔</b></div><div class="cp-kv"><span>研究笔记</span><b>9 篇</b></div><div class="cp-kv"><span>数据更新</span><span>今天 09:00</span></div></div>
<div class="panel" style="overflow-x:auto"><table class="cp-table"><thead><tr><th>日期</th><th>在电脑前</th><th>开会</th><th>比上周同日</th></tr></thead><tbody>
<tr><td>3 月 17 日 周一</td><td>6:10</td><td>0:30</td><td style="color:var(--color-success)">+25 分</td></tr>
<tr><td>3 月 18 日 周二</td><td>4:45</td><td>1:00</td><td style="color:var(--color-warning)">−20 分</td></tr>
<tr><td>3 月 19 日 周三</td><td colspan="3" style="color:var(--color-text-subtle)">还没到</td></tr></tbody></table></div>
</div></section>

<section><h2>反馈与状态</h2><p>状态永远同时配图标或文字；空状态告诉人下一步做什么。</p>
<div class="g4">
<div class="cp-alert">{IC["info"]}<div><span class="cp-alert-title">数据 15:28 更新</span>下次同步约 15:58。</div></div>
<div class="cp-alert cp-alert-success">{IC["check"]}<div><span class="cp-alert-title">已放进今天</span>做完点「完成」。</div></div>
<div class="cp-alert cp-alert-warning">{IC["alert"]}<div><span class="cp-alert-title">手环 3 天没同步</span>睡眠显示为暂无。</div></div>
<div class="cp-alert cp-alert-error">{IC["error"]}<div><span class="cp-alert-title">保存失败</span>网络断开，恢复后自动重试。</div></div>
</div>
<div class="g4" style="margin-top:20px;align-items:start">
<div class="cp-empty"><b>今天还没有安排</b>从池子里挑一件放进来。<button class="cp-btn cp-btn-secondary cp-btn-sm" style="margin-top:6px">打开池子</button></div>
<div class="panel" style="display:grid;gap:10px"><p class="lab">加载</p><div class="cp-skel" style="height:22px;width:40%"></div><div class="cp-skel" style="height:28px"></div><div class="cp-skel" style="height:14px;width:70%"></div><div class="cp-skel" style="height:14px;width:55%"></div></div>
<div class="panel"><p class="lab">提示条</p><div class="cp-toast">已删除 1 件事<a href="#">撤销</a></div></div>
<div class="cp-dialog" style="width:auto"><h3 class="cp-dialog-title">删除这个项目？</h3><p class="cp-dialog-body">项目里的 6 件事会一起移出池子，30 天内可以恢复。</p><div class="cp-dialog-actions"><button class="cp-btn cp-btn-secondary cp-btn-sm">取消</button><button class="cp-btn cp-btn-destructive cp-btn-sm">删除项目</button></div></div>
</div></section>
</div>'''

import os
H_SPEC, H_COMP = int(os.environ.get('HS', 3000)), int(os.environ.get('HC', 2400))
add("Spec", "设计规范", 1440, H_SPEC, spec_body(), DOC_CSS)
add("Components", "统一组件", 1440, H_COMP, comp_body(), DOC_CSS)
print("ok")
