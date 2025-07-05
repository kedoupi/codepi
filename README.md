# KDP.Cool - 数字艺术品交易平台

> 基于 React + Supabase 的现代化数字艺术品展示和交易平台

## 🎨 项目概述

KDP.Cool 是一个专为数字艺术家打造的作品展示和交易平台，支持插画、图标、海报等多种艺术作品的上传、展示和销售。

### ✨ 核心功能

- **🔐 用户认证** - Google OAuth 一键登录
- **📤 作品上传** - 支持多种图片格式，自动生成缩略图
- **🖼️ 作品展示** - 响应式网格布局，支持搜索和筛选
- **👤 用户资料** - 个人作品管理，收藏系统
- **💰 价格设置** - 支持免费和付费作品
- **🏷️ 标签系统** - 便于作品分类和发现

## 🛠️ 技术栈

### 前端
- **React 19** - 用户界面框架
- **Vite** - 构建工具和开发服务器
- **Ant Design** - UI 组件库
- **React Router** - 客户端路由

### 后端服务
- **Supabase** - 后端即服务 (BaaS)
  - PostgreSQL 数据库
  - 实时数据同步
  - 用户认证 (Google OAuth)
  - 文件存储服务
  - 行级安全策略 (RLS)

### 开发工具
- **ESLint** - 代码质量检查
- **Prettier** - 代码格式化（推荐）

## 🚀 快速开始

### 环境要求
- Node.js 18+ 
- npm 或 yarn

### 1. 克隆项目
```bash
git clone <repository-url>
cd kdp.cool
```

### 2. 安装依赖
```bash
cd client
npm install
```

### 3. 配置环境变量
在 `client` 目录下创建 `.env` 文件：
```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# App Configuration  
VITE_APP_URL=http://localhost:5173
```

### 4. 设置数据库
1. 在 Supabase Dashboard 的 SQL Editor 中执行 `docs/supabase_setup.sql`
2. 创建存储桶 `artworks`（公开访问）
3. 配置 Google OAuth 认证

### 5. 初始化数据
```bash
cd client
node setup-database.js
```

### 6. 启动开发服务器
```bash
npm run dev
```

访问 http://localhost:5173 开始使用！

## 📁 项目结构

```
kdp.cool/
├── client/                 # 前端应用
│   ├── public/             # 静态资源
│   ├── src/
│   │   ├── components/     # 可复用组件
│   │   ├── context/        # React Context
│   │   ├── hooks/          # 自定义 Hooks
│   │   ├── lib/            # 工具库和服务
│   │   ├── pages/          # 页面组件
│   │   ├── styles/         # 样式文件
│   │   └── main.jsx        # 应用入口
│   ├── .env               # 环境变量
│   ├── package.json       # 依赖配置
│   └── vite.config.js     # Vite 配置
├── docs/                   # 项目文档
│   ├── supabase_setup.sql  # 数据库设置脚本
│   ├── Technical_Architecture.md
│   └── User_Story_Map.md
└── README.md              # 项目说明
```

## 🗄️ 数据库设计

### 核心表结构

- **profiles** - 用户资料表
- **artworks** - 作品信息表
- **categories** - 作品分类表
- **favorites** - 收藏关系表
- **comments** - 评论表
- **orders** - 订单表（预留）

详细的数据库架构请查看 `docs/Technical_Architecture.md`

## 🔧 主要功能模块

### 认证系统 (`src/context/AuthContext.jsx`)
- Google OAuth 集成
- 用户状态管理
- 自动创建用户资料

### 文件上传 (`src/lib/storage.js`)
- 图片验证和压缩
- 缩略图自动生成
- Supabase Storage 集成

### 作品管理 (`src/lib/artworks.js`)
- CRUD 操作
- 搜索和筛选
- 收藏功能

### 响应式设计 (`src/styles/responsive.css`)
- 移动端优化
- 灵活网格布局
- 自适应组件

## 🎯 开发计划

### ✅ 已完成
- 用户认证系统
- 作品上传和展示
- 搜索和筛选功能
- 个人资料管理
- 响应式设计

### 🚧 开发中
- 支付集成
- 评论系统
- 高级搜索

### 📋 计划中
- 作品推荐算法
- 社交功能
- 移动端应用

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/新功能`)
3. 提交更改 (`git commit -am '添加新功能'`)
4. 推送到分支 (`git push origin feature/新功能`)
5. 创建 Pull Request

## 📝 开发注意事项

### 代码规范
- 使用 ESLint 进行代码检查
- 组件名使用 PascalCase
- 文件名使用 camelCase
- 优先使用函数组件和 Hooks

### 性能优化
- 图片懒加载
- 分页数据加载
- 组件级代码分割

### 安全考虑
- 所有 API 调用都经过 RLS 策略验证
- 文件上传类型和大小限制
- 用户输入验证和清理

## 📄 许可证

MIT License - 详见 LICENSE 文件

## 🆘 支持

如有问题，请创建 Issue 或联系项目维护者。

---

**KDP.Cool** - 让每个数字艺术家都能展示和销售自己的作品 🎨✨