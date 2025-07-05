# KDP.Cool 部署指南

本文档详细介绍了如何部署 KDP.Cool 数字艺术品交易平台。

## 🚀 快速部署

### 1. 准备工作

#### 1.1 Supabase 设置
1. 在 [Supabase](https://supabase.com) 创建新项目
2. 获取项目 URL 和 API Key
3. 在 Supabase Dashboard 执行以下操作：

```sql
-- 在 SQL Editor 中执行 docs/supabase_setup.sql 脚本
```

4. 创建存储桶：
   - 进入 Storage 页面
   - 创建名为 `artworks` 的存储桶
   - 设置为 **公开访问**

5. 配置 Google OAuth：
   - 进入 Authentication > Providers
   - 启用 Google 提供商
   - 配置 OAuth 客户端 ID 和密钥

#### 1.2 环境变量配置

创建 `.env` 文件：
```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# App Configuration
VITE_APP_URL=https://your-domain.com
```

### 2. 本地部署

```bash
# 1. 安装依赖
cd client
npm install

# 2. 环境检查
node health-check.js

# 3. 初始化数据
node setup-database.js

# 4. 构建项目
npm run build

# 5. 预览构建结果
npm run preview
```

### 3. 云平台部署

#### 3.1 Vercel 部署

1. **准备项目**
```bash
npm install -g vercel
```

2. **部署配置**
```bash
vercel --prod
```

3. **环境变量设置**
在 Vercel Dashboard 中配置：
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

4. **域名配置**
在 Supabase Authentication 设置中添加生产域名到重定向 URL

#### 3.2 Netlify 部署

1. **构建设置**
- Build command: `npm run build`
- Publish directory: `dist`

2. **环境变量**
在 Netlify Dashboard 中配置相同的环境变量

3. **重定向配置**
创建 `public/_redirects` 文件：
```
/*    /index.html   200
```

## 🔧 配置详解

### Supabase 完整配置

#### 数据库表结构
系统需要以下表：
- `profiles` - 用户资料
- `artworks` - 作品信息
- `categories` - 作品分类
- `favorites` - 收藏关系
- `comments` - 评论系统
- `orders` - 订单记录

#### 行级安全策略 (RLS)
确保所有表都启用了 RLS 并配置了适当的策略。

#### 存储配置
- 创建 `artworks` 存储桶
- 设置公开访问权限
- 配置文件大小限制（建议 50MB）

### 认证配置

#### Google OAuth 设置
1. 在 [Google Cloud Console](https://console.cloud.google.com) 创建项目
2. 启用 Google+ API
3. 创建 OAuth 2.0 客户端 ID
4. 配置授权重定向 URI：
   - 开发环境: `http://localhost:5173/auth/callback`
   - 生产环境: `https://your-domain.com/auth/callback`

#### Supabase Auth 配置
在 Supabase Dashboard > Authentication > Settings:
- Site URL: 设置为你的域名
- Redirect URLs: 添加所有环境的回调 URL

## 🚨 安全考虑

### 1. 环境变量安全
- 不要在代码中硬编码密钥
- 使用平台提供的环境变量功能
- 定期轮换 API 密钥

### 2. Supabase 安全
- 启用所有表的 RLS
- 配置适当的安全策略
- 限制 API 访问频率

### 3. 文件上传安全
- 验证文件类型和大小
- 扫描恶意内容
- 设置存储限制

## 📊 监控和日志

### 1. Supabase Analytics
- 监控 API 使用情况
- 查看数据库性能
- 跟踪认证统计

### 2. 前端监控
建议集成：
- Sentry (错误追踪)
- Google Analytics (用户分析)
- Vercel Analytics (性能监控)

### 3. 健康检查
定期运行健康检查脚本：
```bash
node health-check.js
```

## 🔄 更新和维护

### 1. 数据库迁移
创建版本化的 SQL 迁移脚本：
```sql
-- migration_v1.1.0.sql
ALTER TABLE artworks ADD COLUMN new_field TEXT;
```

### 2. 依赖更新
定期更新依赖：
```bash
npm update
npm audit fix
```

### 3. 备份策略
- 配置 Supabase 自动备份
- 定期导出重要数据
- 测试恢复流程

## 🐛 故障排除

### 常见问题

#### 1. 认证失败
```
Error: Invalid login credentials
```
**解决方案：**
- 检查 Google OAuth 配置
- 验证重定向 URL 设置
- 确认 Supabase 认证设置

#### 2. 文件上传失败
```
Error: Storage bucket not found
```
**解决方案：**
- 确认存储桶已创建
- 检查存储桶权限设置
- 验证存储 API 密钥

#### 3. 数据库连接错误
```
Error: relation "table_name" does not exist
```
**解决方案：**
- 执行数据库设置脚本
- 检查表名和权限
- 验证 RLS 策略

### 日志查看
- Vercel: 在 Functions 页面查看日志
- Netlify: 在 Functions 页面查看执行日志
- Supabase: 在 Logs 页面查看数据库日志

## 📱 移动端考虑

虽然当前版本是响应式 Web 应用，但架构支持未来扩展：

### PWA 配置
添加 PWA 支持：
```bash
npm install @vite-pwa/vite
```

### 原生应用
可以使用以下技术栈扩展：
- React Native
- Capacitor
- Expo

## 🎯 性能优化

### 1. 构建优化
- 启用代码分割
- 压缩图片资源
- 使用 CDN 加速

### 2. 数据库优化
- 创建适当的索引
- 使用连接池
- 缓存频繁查询

### 3. 前端优化
- 实现虚拟滚动
- 图片懒加载
- 预加载关键资源

---

## 📞 技术支持

如有问题，请：
1. 查看错误日志
2. 运行健康检查脚本
3. 参考故障排除部分
4. 创建 GitHub Issue

**KDP.Cool** - 专业的数字艺术品交易平台 🎨✨