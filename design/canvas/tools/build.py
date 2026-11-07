#!/usr/bin/env python3
"""一键重建 codepi 设计画布的全部画板（.dc.html）与本地预览。

用法：python3 design/canvas/tools/build.py [--out <目录>] [--archdiag <archdiag.py 路径>]
- 输出默认 design/canvas/build/（不入库）：build/project/*.dc.html 是画板，build/preview/*.html 用于截图测高。
- 高度来自 data/heights.json（板名 → 高度）；改了内容先用 tools/render.sh 量真实高度，再写回 heights.json。
- 架构图由 MyBrain 的 arch-diagram Skill 生成（archdiag.py），默认找 ~/MyBrain/.agents/skills/workflow/arch-diagram/scripts/archdiag.py，
  也可用 --archdiag 或环境变量 ARCHDIAG 指定；找不到就跳过架构图并提示。
- 生成器之间会互相 import 并重写同名画板，顺序即「后写的为准」，不要随意调换。
- 发布到画布用 MyBrain 的 design-canvas Skill（canvas_patch.py lint / insert / resize / verify），本脚本不联网、不发布。"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

CANVAS = Path(__file__).resolve().parent.parent
GEN = CANVAS / "gen"
ORDER = ["gen2.py", "gen3.py", "gen_www.py", "gen_proj.py", "gen_jw.py", "gen_health.py", "gen_maps.py", "gen_tree.py",
         "gen_arch.py", "gen_pcomp.py", "gen_desk.py", "gen_projv2.py", "gen_now.py", "gen_now2.py"]
ARCH_DATA = ["www-arch.json", "proj-v2.json"]  # 在对应 gen_*.py 之后生成，覆盖同名手写旧板
H_VARS = ["H3", "HW", "HP", "HJ", "HM", "HT", "HC2", "HD", "HA", "HH", "HN", "HV"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(CANVAS / "build"))
    ap.add_argument("--archdiag", default=os.environ.get("ARCHDIAG", str(Path.home() / "MyBrain/.agents/skills/workflow/arch-diagram/scripts/archdiag.py")))
    a = ap.parse_args(argv)
    out = Path(a.out).resolve()
    heights = json.loads((CANVAS / "data/heights.json").read_text())
    hs = ",".join(f"{k}={v}" for k, v in heights.items())
    env = dict(os.environ, CANVAS_BUILD=str(out), HS=str(heights.get("Spec", 4096)), HC=str(heights.get("Components", 2457)),
               H_MAIN=str(heights.get("Main", 3471)), H_HOME=str(heights.get("Home-Phone", 4900)))
    env.update({v: hs for v in H_VARS})
    for g in ORDER:
        subprocess.run([sys.executable, g], cwd=GEN, env=env, check=True, stdout=subprocess.DEVNULL)
    if Path(a.archdiag).exists():
        for d in ARCH_DATA:
            subprocess.run([sys.executable, "-I", a.archdiag, str(CANVAS / "data" / d), "--out", str(out), "--theme", "codepi", "--preview"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print(f"提示：找不到 archdiag.py（{a.archdiag}），跳过架构图 {ARCH_DATA}", file=sys.stderr)
    subprocess.run([sys.executable, "gen.py"], cwd=GEN, env=env, check=True, stdout=subprocess.DEVNULL)  # 首页最后写，避免被 import 时的默认高度覆盖
    n = len(list((out / "project").glob("*.dc.html")))
    print(json.dumps({"ok": True, "out": str(out), "boards": n}, ensure_ascii=False))


if __name__ == "__main__":
    main()
