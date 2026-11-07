"""Canvas layout: sections → categories (1 产品架构图 / 2 共用组件 / 3 Web / 4 Mobile) → rows."""
import json, re, os
from gen import ROOT as _B
ROOT = _B + "project/"  # 需先放入线上 canvas.json；全量重排只在首次建画布时用，平时用 design-canvas 的 canvas_patch.py
LIVE = json.load(open(ROOT + "canvas.json"))["boards"]
def size(n):
    if not os.path.exists(ROOT + n + ".dc.html"):
        b = LIVE[n + ".dc.html"]; return b["w"], b["h"]
    s = open(ROOT + n + ".dc.html").read()
    w, h = re.search(r'"\$preview":\{"width":(\d+),"height":(\d+)\}', s).groups()
    return int(w), int(h)
def title(n):
    if not os.path.exists(ROOT + n + ".dc.html"):
        return LIVE[n + ".dc.html"].get("title", n)
    return re.search(r"<title>(.*?)</title>", open(ROOT + n + ".dc.html").read()).group(1)

def proj(arch, comps, web, mobile, now=None):
    return ([("0 现状（改版底单）", [now])] if now else []) + [("1 产品架构图", [arch]), ("2 共用组件", [comps]), ("3 Web", web), ("4 Mobile", mobile)]

SECTIONS = [
    ("一、全局设计系统", [("1 设计规范", [["Spec", "Spec-PhoneType", "Spec-Dark", "Spec-Decisions"]]), ("2 全局公共组件", [["Components", "Comp-Shell", "Comp-Login", "Comp-Time"], ["Comp-Lists", "Comp-Overlays", "Comp-Forms", "Comp-States"], ["Comp-Dark", "Comp-Loading"]]), ("3 图表主题与架构图规范（各项目继承）", [["G-Charts", "G-Diagram"]])]),
    ("二、www 官网", proj(["Ctx-WWW", "Arch-WWW", "Feat-WWW"], ["C-WWW", "Comp-Content"],
        [["Main", "Web-About", "Web-Privacy"], ["Web-Blog", "Web-Blog-States", "Web-Post", "Web-Post-Preview"], ["Web-Desk-Login", "Web-Desk", "Web-Desk-Review", "Web-Desk-Review-More"], ["Web-Desk-States"]],
        [["Home-Phone", "Web-Menu-Phone", "Web-Blog-Phone", "Web-Post-Phone", "Web-About-Phone", "Web-Privacy-Phone", "Web-Desk-Login-Phone", "Web-Desk-Phone", "Web-Desk-Review-Phone"]])),
    ("三、JW 作息", proj(["Arch-JW", "Feat-JW"], ["C-JW"],
        [["J-Today", "J-Today-States", "J-Work-Day", "J-Work-Week"], ["J-Work-States", "J-Trends", "J-Trends-30", "J-Trends-States"], ["J-Sources", "J-Settings", "J-Settings-States", "J-Login"]],
        [["J-Today-Phone", "J-Work-Phone", "J-Trends-Phone", "J-Sources-Phone", "J-Settings-Phone"]])),
    ("四、project 工作台", proj(["Arch-Proj", "Feat-Proj"], ["C-Proj"],
        [["P-Today", "P-Today-States", "P-Drawer", "P-Drawer-States"], ["P-Journal", "P-Journal-States", "P-Project", "P-Project-Empty"], ["P-Project-States", "P-Dialogs", "P-Login", "P-Global-States"]],
        [["P-Today-Phone", "P-Pool-Phone", "P-Journal-Phone", "P-Project-Phone", "P-Task-Phone"]],
        now=["Now-Proj-Map", "Now-Proj-Issues"])),
    ("五、健康", proj(["Arch-Health", "Feat-Health"], ["C-Health"],
        [["H-Landing", "H-Landing-States", "H-Overview", "H-Overview-Empty"], ["H-Sync-States", "H-Sleep", "H-Sleep-States", "H-Weekly"], ["H-Weekly-States", "H-Compare", "H-Compare-More", "H-Settings"], ["H-Settings-States", "H-AI"]],
        [["H-Landing-Phone", "H-Overview-Phone", "H-Sleep-Phone", "H-Weekly-Phone", "H-Compare-Phone", "H-Settings-Phone"]])),
]
PAGES = [("ds", "设计系统"), ("www", "www 官网"), ("jw", "JW 作息"), ("project", "project 工作台"), ("health", "健康")]
c = json.load(open(ROOT + "canvas.json"))
boards, order, notes = {}, [], {}
for si, (t, cats) in enumerate(SECTIONS):
    pid = PAGES[si][0]
    y = 0
    notes[f"sec{si}"] = {"x": 0, "y": y, "text": t, "kind": "title1", "maxW": 6000, "page": pid}
    y += 360
    for ci, (ct, rows) in enumerate(cats):
        notes[f"sec{si}c{ci}"] = {"x": 0, "y": y, "text": ct, "kind": "title1", "size": "m", "maxW": 6000, "page": pid}
        y += 240
        for row in rows:
            x = 0; rh = 0
            for n in row:
                w, h = size(n)
                boards[n + ".dc.html"] = {"x": x, "y": y, "w": w, "h": h, "title": title(n), "page": pid}
                order.append(n + ".dc.html")
                x += w + 80; rh = max(rh, h)
            y += rh + 120
        y += 200
    y += 400
used = {k[:-8] for k in boards}
files = {f[:-8] for f in os.listdir(ROOT) if f.endswith(".dc.html")}
c["boards"], c["order"], c["notes"] = boards, order, notes
c["pages"] = [{"id": i, "name": n} for i, n in PAGES]
c["launch"] = {"view": "canvas", "page": "ds"}
json.dump(c, open(ROOT + "canvas.json", "w"), ensure_ascii=False, indent=2)
print(len(boards), "boards; files not on canvas:", sorted(files - used))
