-- KDP.Cool Supabase 数据库设置脚本
-- 在 Supabase SQL Editor 中执行此脚本

-- ==============================================
-- 1. 创建扩展用户资料表
-- ==============================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  role TEXT DEFAULT 'artist' CHECK (role IN ('artist', 'buyer', 'admin')),
  website_url TEXT,
  social_links JSONB DEFAULT '{}',
  total_sales INTEGER DEFAULT 0,
  total_earnings DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 2. 创建作品分类表
-- ==============================================

CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  parent_id UUID REFERENCES categories(id),
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 3. 创建作品表
-- ==============================================

CREATE TABLE IF NOT EXISTS artworks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  watermark_url TEXT,
  original_filename TEXT,
  file_size INTEGER,
  dimensions JSONB, -- {width: 1920, height: 1080}
  price DECIMAL(10,2) DEFAULT 0,
  license_type TEXT DEFAULT 'standard' CHECK (license_type IN ('standard', 'extended', 'exclusive')),
  tags TEXT[],
  category_id UUID REFERENCES categories(id),
  status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  download_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 4. 创建订单表
-- ==============================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  buyer_id UUID REFERENCES auth.users(id) NOT NULL,
  artwork_id UUID REFERENCES artworks(id) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  license_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  
  -- Stripe相关字段
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  
  -- 数字交付相关
  download_url TEXT,
  download_expires_at TIMESTAMP,
  download_count INTEGER DEFAULT 0,
  max_downloads INTEGER DEFAULT 3,
  
  -- 元数据
  metadata JSONB DEFAULT '{}',
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 5. 创建收藏表
-- ==============================================

CREATE TABLE IF NOT EXISTS favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  artwork_id UUID REFERENCES artworks(id) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, artwork_id)
);

-- ==============================================
-- 6. 创建关注表
-- ==============================================

CREATE TABLE IF NOT EXISTS follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID REFERENCES auth.users(id) NOT NULL,
  following_id UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- ==============================================
-- 7. 创建评论表
-- ==============================================

CREATE TABLE IF NOT EXISTS comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  artwork_id UUID REFERENCES artworks(id) NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  content TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  status TEXT DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'deleted')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 8. 创建下载记录表
-- ==============================================

CREATE TABLE IF NOT EXISTS download_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  artwork_id UUID REFERENCES artworks(id) NOT NULL,
  download_url TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  downloaded_at TIMESTAMP DEFAULT NOW()
);

-- ==============================================
-- 9. 创建索引以提升性能
-- ==============================================

-- 作品相关索引
CREATE INDEX IF NOT EXISTS idx_artworks_author_status ON artworks(author_id, status);
CREATE INDEX IF NOT EXISTS idx_artworks_category_status ON artworks(category_id, status);
CREATE INDEX IF NOT EXISTS idx_artworks_featured ON artworks(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_artworks_tags ON artworks USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_artworks_created_at ON artworks(created_at DESC);

-- 订单相关索引
CREATE INDEX IF NOT EXISTS idx_orders_buyer_status ON orders(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent ON orders(stripe_payment_intent_id);

-- 收藏和关注索引
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_artwork_id ON favorites(artwork_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- 全文搜索索引
CREATE INDEX IF NOT EXISTS idx_artworks_search ON artworks USING GIN(
  to_tsvector('english', title || ' ' || COALESCE(description, ''))
);

-- ==============================================
-- 10. 启用行级安全策略 (RLS)
-- ==============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE artworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_logs ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- 11. 创建 RLS 安全策略
-- ==============================================

-- 用户资料安全策略
CREATE POLICY "用户可以查看所有公开资料" ON profiles
  FOR SELECT USING (TRUE);

CREATE POLICY "用户只能编辑自己的资料" ON profiles
  FOR ALL USING (auth.uid() = id);

-- 作品安全策略
CREATE POLICY "所有人可以查看已发布的作品" ON artworks
  FOR SELECT USING (status = 'published');

CREATE POLICY "用户可以管理自己的作品" ON artworks
  FOR ALL USING (auth.uid() = author_id);

-- 订单安全策略
CREATE POLICY "用户只能查看自己的订单" ON orders
  FOR SELECT USING (auth.uid() = buyer_id);

CREATE POLICY "作者可以查看自己作品的订单" ON orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM artworks 
      WHERE artworks.id = orders.artwork_id 
      AND artworks.author_id = auth.uid()
    )
  );

-- 收藏安全策略
CREATE POLICY "用户可以管理自己的收藏" ON favorites
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "所有人可以查看收藏统计" ON favorites
  FOR SELECT USING (TRUE);

-- 关注安全策略
CREATE POLICY "用户可以管理自己的关注" ON follows
  FOR ALL USING (auth.uid() = follower_id);

CREATE POLICY "所有人可以查看关注统计" ON follows
  FOR SELECT USING (TRUE);

-- 评论安全策略
CREATE POLICY "所有人可以查看已发布的评论" ON comments
  FOR SELECT USING (status = 'published');

CREATE POLICY "用户可以管理自己的评论" ON comments
  FOR ALL USING (auth.uid() = user_id);

-- 下载记录安全策略
CREATE POLICY "用户只能查看自己的下载记录" ON download_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "系统可以插入下载记录" ON download_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ==============================================
-- 12. 创建实用函数
-- ==============================================

-- 增加作品下载次数
CREATE OR REPLACE FUNCTION increment_download_count(artwork_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE artworks 
  SET download_count = download_count + 1,
      updated_at = NOW()
  WHERE id = artwork_id;
END;
$$ LANGUAGE plpgsql;

-- 增加作品查看次数
CREATE OR REPLACE FUNCTION increment_view_count(artwork_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE artworks 
  SET view_count = view_count + 1,
      updated_at = NOW()
  WHERE id = artwork_id;
END;
$$ LANGUAGE plpgsql;

-- 更新用户资料的最后修改时间
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- 13. 创建触发器
-- ==============================================

-- 自动更新 updated_at 字段
CREATE OR REPLACE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_artworks_updated_at
  BEFORE UPDATE ON artworks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 14. 插入初始分类数据
-- ==============================================

INSERT INTO categories (name, slug, description, sort_order) VALUES
  ('插画设计', 'illustration', '各类风格的插画作品', 1),
  ('图标设计', 'icons', '图标和符号设计', 2),
  ('UI设计', 'ui-design', '用户界面设计元素', 3),
  ('背景素材', 'backgrounds', '背景图案和纹理', 4),
  ('字体设计', 'typography', '字体和文字设计', 5),
  ('卡通动画', 'cartoon', '卡通角色和动画素材', 6),
  ('商业插画', 'commercial', '商业用途的插画作品', 7),
  ('艺术创作', 'art', '纯艺术创作作品', 8)
ON CONFLICT (slug) DO NOTHING;

-- ==============================================
-- 数据库设置完成！
-- ==============================================

-- 执行完毕后，请在 Supabase Dashboard 中：
-- 1. 设置 Google OAuth 提供商
-- 2. 配置 Storage Buckets
-- 3. 获取项目 URL 和 API Keys