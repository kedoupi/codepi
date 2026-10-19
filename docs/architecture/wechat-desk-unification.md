# 公号工作台合一（gzh-preview → fagao）

> 状态：2026-10-10 公众号工作台合一的历史记录。下文域名与目录已被后续迁移替代；
> 当前唯一实现为 `apps/gzh/`，入口为 `gzh.codepi.app`，见[应用说明](../../apps/gzh/README.md)。
> 保留原始决策证据，不恢复 `fagao` 或 `gzh-preview` 平行应用。

## 决策

| 项 | 选择 |
| --- | --- |
| 主域 | `fagao.kdp.cool` |
| gzh-preview | 下线；主机名 301 → fagao |
| 登录 | 工作台与预览路径均须登录 |
| 「拒」 | 进入 **需改**（与「要改」相同，可再交审） |
| 代码 | monorepo 仅保留 `fagao/`；删除 `gzh-preview/` |

## 工程

- `fagao/worker/status.ts`：`reviewNextStatus("拒") === "需改"`
- Cloudflare Redirect Rule：`gzh-preview.kdp.cool/*` → `https://fagao.kdp.cool$1`（或等价 dynamic redirect）
- 部署：只部署 Pages 项目 `fagao`

## 角色与流

编辑排今日早/中/晚 → 交待审 → 负责人通读后 过/要改/拒 → 可推箱 → 人工进微信草稿箱 → 已进箱。可撤回待审。

不接微信草稿箱 API。不进入 AdSense 计算器审稿面。


## 删除完成

- Monorepo 不再包含 `gzh-preview/` 目录
- Cloudflare Pages 项目 `gzh-preview` 已删除
- 自定义域 `gzh-preview.kdp.cool` 已挂到 `fagao` 项目（与发稿台同站，须登录）
