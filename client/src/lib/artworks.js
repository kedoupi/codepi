import { supabase } from './supabase';

/**
 * 作品数据服务
 * 处理所有与作品相关的数据库操作
 */
export class ArtworkService {
  
  /**
   * 创建新作品
   */
  async createArtwork(artworkData) {
    try {
      const { data, error } = await supabase
        .from('artworks')
        .insert([{
          ...artworkData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      console.log('作品创建成功:', data);
      return data;

    } catch (error) {
      console.error('创建作品失败:', error);
      throw error;
    }
  }

  /**
   * 获取作品列表 (支持分页和筛选)
   */
  async getArtworks(options = {}) {
    try {
      const {
        page = 1,
        limit = 12,
        category = null,
        search = null,
        authorId = null,
        sortBy = 'created_at',
        sortOrder = 'desc',
        status = 'published'
      } = options;

      let query = supabase
        .from('artworks')
        .select(`
          *,
          profiles:author_id(
            id,
            name,
            avatar_url
          ),
          favorites(id)
        `, { count: 'exact' })
        .eq('status', status);

      // 添加筛选条件
      if (category) {
        query = query.eq('category_id', category);
      }

      if (authorId) {
        query = query.eq('author_id', authorId);
      }

      if (search) {
        query = query.textSearch('fts', search);
      }

      // 排序
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      // 分页
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      };

    } catch (error) {
      console.error('获取作品列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取单个作品详情
   */
  async getArtworkById(id) {
    try {
      const { data, error } = await supabase
        .from('artworks')
        .select(`
          *,
          profiles:author_id(
            id,
            name,
            avatar_url,
            bio
          ),
          favorites(id),
          comments(
            id,
            content,
            rating,
            created_at,
            profiles:user_id(name, avatar_url)
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // 增加浏览次数
      await this.incrementViewCount(id);

      return data;

    } catch (error) {
      console.error('获取作品详情失败:', error);
      throw error;
    }
  }

  /**
   * 更新作品
   */
  async updateArtwork(id, updates) {
    try {
      const { data, error } = await supabase
        .from('artworks')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      console.log('作品更新成功:', data);
      return data;

    } catch (error) {
      console.error('更新作品失败:', error);
      throw error;
    }
  }

  /**
   * 删除作品
   */
  async deleteArtwork(id) {
    try {
      const { error } = await supabase
        .from('artworks')
        .delete()
        .eq('id', id);

      if (error) throw error;

      console.log('作品删除成功:', id);
      return true;

    } catch (error) {
      console.error('删除作品失败:', error);
      throw error;
    }
  }

  /**
   * 增加浏览次数
   */
  async incrementViewCount(artworkId) {
    try {
      await supabase.rpc('increment_view_count', { artwork_id: artworkId });
    } catch (error) {
      console.error('增加浏览次数失败:', error);
      // 不抛出错误，避免影响主要功能
    }
  }

  /**
   * 搜索作品
   */
  async searchArtworks(query, options = {}) {
    try {
      const {
        page = 1,
        limit = 12,
        category = null,
        priceRange = null,
        sortBy = 'relevance'
      } = options;

      let supabaseQuery = supabase
        .from('artworks')
        .select(`
          *,
          profiles:author_id(name, avatar_url)
        `, { count: 'exact' })
        .eq('status', 'published');

      // 全文搜索
      if (query && query.trim()) {
        supabaseQuery = supabaseQuery.textSearch('fts', query.trim());
      }

      // 分类筛选
      if (category) {
        supabaseQuery = supabaseQuery.eq('category_id', category);
      }

      // 价格区间筛选
      if (priceRange && priceRange.length === 2) {
        supabaseQuery = supabaseQuery
          .gte('price', priceRange[0])
          .lte('price', priceRange[1]);
      }

      // 排序
      switch (sortBy) {
        case 'price_low':
          supabaseQuery = supabaseQuery.order('price', { ascending: true });
          break;
        case 'price_high':
          supabaseQuery = supabaseQuery.order('price', { ascending: false });
          break;
        case 'newest':
          supabaseQuery = supabaseQuery.order('created_at', { ascending: false });
          break;
        case 'popular':
          supabaseQuery = supabaseQuery.order('view_count', { ascending: false });
          break;
        default:
          supabaseQuery = supabaseQuery.order('created_at', { ascending: false });
      }

      // 分页
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      supabaseQuery = supabaseQuery.range(from, to);

      const { data, error, count } = await supabaseQuery;

      if (error) throw error;

      return {
        data: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      };

    } catch (error) {
      console.error('搜索作品失败:', error);
      throw error;
    }
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      return data || [];

    } catch (error) {
      console.error('获取分类失败:', error);
      throw error;
    }
  }

  /**
   * 收藏/取消收藏作品
   */
  async toggleFavorite(artworkId, userId) {
    try {
      // 检查是否已收藏
      const { data: existingFavorite, error: checkError } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', userId)
        .eq('artwork_id', artworkId)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingFavorite) {
        // 取消收藏
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('artwork_id', artworkId);

        if (error) throw error;
        return { favorited: false };
      } else {
        // 添加收藏
        const { error } = await supabase
          .from('favorites')
          .insert([{
            user_id: userId,
            artwork_id: artworkId
          }]);

        if (error) throw error;
        return { favorited: true };
      }

    } catch (error) {
      console.error('收藏操作失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的收藏作品
   */
  async getUserFavorites(userId, options = {}) {
    try {
      const { page = 1, limit = 12 } = options;

      let query = supabase
        .from('favorites')
        .select(`
          created_at,
          artworks(
            *,
            profiles:author_id(name, avatar_url)
          )
        `, { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // 分页
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data: (data || []).map(item => item.artworks),
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      };

    } catch (error) {
      console.error('获取收藏列表失败:', error);
      throw error;
    }
  }
}

// 导出单例实例
export const artworkService = new ArtworkService();