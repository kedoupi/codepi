"""Snap generated markup/CSS to CodePi 设计规范 v2: token colours, type scale, spacing scale, radii, button heights, weights."""
import re

HEX = {
    "#2E6DB4": "var(--cat-dev)", "#7FA3DA": "var(--cat-chat)", "#E08A2E": "var(--cat-comm)", "#9A5A1C": "var(--cat-meet)", "#8A63B8": "var(--cat-doc)",
    "#3BA39B": "var(--cat-browse)", "#C7B27A": "var(--cat-private)", "#B5B1A6": "var(--cat-other)", "#4E73B8": "var(--stage-light)",
    "#FFF1E2": "var(--tint-warn)", "#7A4A12": "var(--on-tint-warn)", "#E6F2EC": "var(--tint-ok)", "#1D5E3E": "var(--on-tint-ok)", "#E8EEF8": "var(--tint-info)",
    "#F3D3C2": "var(--tint-accent-line)", "#E2DCD2": "var(--chart-muted)", "#D6CEC2": "var(--chart-muted)", "#DDD7CE": "var(--chart-muted)", "#D6D0C6": "var(--chart-muted)",
    "#E9E4DC": "var(--chart-muted)", "#C9C3B9": "var(--chart-faint)", "#B9B1A6": "var(--chart-ref)", "#242321": "var(--surface-inverse)", "#F6F3ED": "var(--text-inverse)",
    "#A8A29A": "var(--text-inverse-muted)", "#C6BFB5": "var(--text-inverse-muted)", "#3A3734": "var(--line-inverse)", "#FF936C": "var(--accent-inverse)",
    "#F4F1EC": "var(--color-background)", "#EFEBE4": "var(--state-future)", "#8C857E": "var(--color-text-subtle)", "#2F4F8F": "var(--state-sleep)",
    "#D9822B": "var(--state-commute)", "#9FD0BF": "var(--state-away)", "#7D5BB0": "var(--state-out)", "#C9C6BD": "var(--state-unknown)", "#1F7A63": "var(--state-desk)",
    "#B85C38": "var(--state-meeting)", "#2D2A28": "var(--color-text)", "#706A64": "var(--color-text-muted)", "#E7E3DC": "var(--color-border)", "#FAF8F4": "var(--color-background)",
    "#F3EFE8": "var(--color-surface-2)", "#FFE6D9": "var(--brand-soft)", "#C94F20": "var(--color-action)", "#A83E18": "var(--color-action-hover)", "#23744C": "var(--color-success)",
    "#965400": "var(--color-warning)", "#B42318": "var(--color-danger)", "#FF713D": "var(--brand-orange)",
}
FONT = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 44, 56, 72]
FONT_FIX = {26: 22, 34: 32, 48: 44, 52: 56, 36: 40, 120: 72, 17: 16, 19: 20, 27: 28, 9: 12, 10: 12, 11: 12}
SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]
def snap(v, scale):
    return min(scale, key=lambda s: (abs(s - v), -s))
def font(m):
    v = float(m.group(1)); iv = int(round(v))
    return f"font-size:{FONT_FIX.get(iv, snap(iv, FONT))}px"
def space_val(val):
    if any(k in val for k in ("calc(", "max(", "min(", "clamp(", "var(")):
        return val
    def one(m):
        n = float(m.group(2)); s = snap(abs(n), SPACE)
        return f"{m.group(1)}{s}px"
    return re.sub(r"(-?)(\d+(?:\.\d+)?)px", lambda m: ("-" if m.group(1) else "") + f"{snap(abs(float(m.group(2))), SPACE)}px", val)
def radius(m):
    def one(mm):
        n = float(mm.group(1))
        if n <= 3 or n >= 400: return mm.group(0)
        t = 6 if n <= 7 else (10 if n <= 12 else (14 if n <= 16 else 18))
        return f"{t}px"
    return m.group(1) + re.sub(r"(\d+(?:\.\d+)?)px", one, m.group(2))

# 规范第 4 节三套字阶（官网展示 / 内容阅读 / 应用密度，含手机值）的并集；strict 模式只许这些值（2026-11-07 www 对齐）
SPEC_FONT = [12, 14, 16, 18, 22, 24, 28, 32, 36, 44, 48, 72]
def font_strict(m):
    return f"font-size:{snap(int(round(float(m.group(1)))), SPEC_FONT)}px"

def normalize(s, strict=False):
    for h, v in HEX.items():
        s = re.sub(re.escape(h) + r"(?![0-9A-Fa-f])", v, s, flags=re.I)
    s = re.sub(r"font-size:\s*(\d+(?:\.\d+)?)px", font_strict if strict else font, s)
    s = re.sub(r"((?:padding|margin)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*)([^;\"'}]+)", lambda m: m.group(1) + space_val(m.group(2)), s)
    s = re.sub(r"((?:row-|column-)?gap\s*:\s*)([^;\"'}]+)", lambda m: m.group(1) + space_val(m.group(2)), s)
    s = re.sub(r"(border-radius\s*:\s*)([^;\"'}]+)", radius, s)
    s = re.sub(r"min-height:\s*(2[0-9]|3[0-5])px", "min-height:36px", s)
    s = re.sub(r"font-weight:\s*(650|700|800|900)", "font-weight:600", s)
    s = s.replace("width:26px;height:26px", "width:36px;height:36px")
    return s
