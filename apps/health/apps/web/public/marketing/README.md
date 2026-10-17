# 落地页换图槽位

黄薇 / tzai-image PNG 已就位。再换图时覆盖同名文件即可，不用改布局。

| 文件 | 线上路径 | 位置 |
|---|---|---|
| `01-hero.png` | `/marketing/01-hero.png` | Hero，产品标题旁 |
| `02-feature-readiness.png` | `/marketing/02-feature-readiness.png` | 准备度功能卡 |
| `03-share-concept.png` | `/marketing/03-share-concept.png` | 多人 / 各看各的 |
| `vis-sleep.svg` | `/marketing/vis-sleep.svg` | 睡眠卡（自制奶油插画，可换） |
| `vis-activity.svg` | `/marketing/vis-activity.svg` | 活动卡（自制奶油插画，可换） |

建议 3:2，奶油纸色。不要 Oura 官方 logo / wordmark。槽位 `object-fit: cover`。

没有 `01-hero.png` 时回退 `../board-preview.svg`。
