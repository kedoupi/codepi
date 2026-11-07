# 产品文档（看板定稿后的落地文档）

> 状态：现行规则（所有者 2026-11-07 决定）。适用于 codepi 全部产品。

## 看板先行、文档落地、最后实现

每个产品都有两样东西，各管一件事：

- **看板**：固定的设计画布 `https://claude.ai/artifact/6ktcuY2pcMxnmZMKSTEJtj` 里该产品的页面。所有者和 agent 在这里设计、讨论、修改方案，需要所有者看一眼、拍板的内容都先放这里。
- **文档**：本目录 `docs/products/<产品>/`。看板讨论定下的结论写成文档，要能执行（有验收标准），也要能回溯（每条写明出自哪张画板、哪天由谁决定）。

顺序固定为：

0. **现状入看板**：先盘点线上真实功能（`inventory.md`），放进看板该产品页最前面的「现状」组。
1. **定架构**：功能的增删改先改看板上的产品架构图和功能图，所有者确认后再往下走。
2. **定 UI 与交互**：画桌面与手机页面、空 / 加载 / 出错 / 未登录等状态和操作流。
3. **落文档**：看板定稿后，整理成本目录的设计文档（功能清单、页面规格、交互说明、验收标准），每条对应画板名。
4. **按文档实现**：执行者只照文档实现，验收员按文档逐条验收。

两条底线：

- **不倒着改**：实现中发现需要改设计，先停下回看板改，再改文档，最后才改代码。
- **不丢功能**：`inventory.md` 里每个功能点在设计文档里都要有去处——新位置，或写明所有者决定合并或去掉。

## 目录

| 产品 | 目录 | 现状底单 |
| --- | --- | --- |
| www 官网 | `www/` | [inventory.md](www/inventory.md) |
| project 工作台 | `project/` | [inventory.md](project/inventory.md) |
| JW 作息（apps/rhythm） | `jw/` | [inventory.md](jw/inventory.md) |
| 健康 | `health/` | [inventory.md](health/inventory.md) |
| gu 投资 | `gu/` | [inventory.md](gu/inventory.md) |
| me 记忆 | `me/` | [inventory.md](me/inventory.md) |
| gzh 公众号 | `gzh/` | [inventory.md](gzh/inventory.md) |

`inventory.md` 是 2026-11-07 按 main `b8d1c59` 只读盘点的代码快照（合计约 462 个功能点），行号会随代码漂移；改版定稿时以当时代码复核。
