import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Typography,
  Button,
  Empty,
  Pagination,
  message as antdMessage,
  Tag,
  Statistic
} from 'antd';
import {
  HeartFilled,
  EyeOutlined,
  ShoppingCartOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { artworkService } from '../lib/artworks';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorDisplay from '../components/ErrorDisplay';

const { Title, Text } = Typography;
const { Meta } = Card;

function Favorites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unfavoriting, setUnfavoriting] = useState(new Set());
  const pageSize = 12;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    fetchFavorites();
  }, [user, currentPage, navigate]);

  const fetchFavorites = async () => {
    setLoading(true);
    try {
      const result = await artworkService.getUserFavorites(user.id, {
        page: currentPage,
        limit: pageSize
      });
      
      setFavorites(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      console.error('获取收藏列表失败:', err);
      setError(err.message);
      antdMessage.error('加载收藏列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUnfavorite = async (artworkId) => {
    setUnfavoriting(prev => new Set(prev).add(artworkId));
    try {
      await artworkService.toggleFavorite(artworkId, user.id);
      antdMessage.success('已取消收藏');
      await fetchFavorites(); // 重新加载列表
    } catch (error) {
      console.error('取消收藏失败:', error);
      antdMessage.error('操作失败，请重试');
    } finally {
      setUnfavoriting(prev => {
        const next = new Set(prev);
        next.delete(artworkId);
        return next;
      });
    }
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const formatPrice = (price) => {
    if (price === 0) return '免费';
    return `¥${price.toLocaleString()}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  if (!user) {
    return null;
  }

  if (loading) {
    return <LoadingSpinner tip="加载收藏列表..." />;
  }

  if (error) {
    return (
      <ErrorDisplay
        title="加载失败"
        description={error}
        onRefresh={fetchFavorites}
        showHome
      />
    );
  }

  return (
    <div className="responsive-container" style={{ padding: '20px' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={() => navigate(-1)}
            type="text"
            style={{ marginRight: 16 }}
          >
            返回
          </Button>
          <Title level={2} style={{ margin: 0 }}>
            我的收藏
          </Title>
        </div>
        
        {/* 统计信息 */}
        <Row gutter={[16, 16]} className="responsive-stats">
          <Col>
            <Statistic
              title="收藏作品"
              value={total}
              prefix={<HeartFilled />}
              valueStyle={{ color: '#f5222d' }}
            />
          </Col>
          <Col>
            <Statistic
              title="当前页面"
              value={`${currentPage}/${Math.ceil(total / pageSize) || 1}`}
              valueStyle={{ color: '#1890ff' }}
            />
          </Col>
        </Row>
      </div>

      {/* 收藏列表 */}
      {favorites.length === 0 ? (
        <Empty
          description="还没有收藏任何作品"
          style={{ padding: '60px 0' }}
        >
          <Button 
            type="primary" 
            onClick={() => navigate('/')}
          >
            去发现作品
          </Button>
        </Empty>
      ) : (
        <>
          <div className="responsive-grid">
            {favorites.map((artwork) => (
              <Card
                key={artwork.id}
                className="responsive-card"
                hoverable
                cover={
                  <div 
                    style={{ 
                      height: 200, 
                      overflow: 'hidden',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                    onClick={() => navigate(`/artwork/${artwork.id}`)}
                  >
                    <img
                      alt={artwork.title}
                      src={artwork.thumbnail_url || artwork.image_url}
                      className="responsive-image-cover"
                    />
                    {/* 浏览量 */}
                    <div style={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      background: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 12
                    }}>
                      <EyeOutlined /> {artwork.view_count || 0}
                    </div>
                  </div>
                }
                actions={[
                  <div key="price" style={{ color: '#1890ff', fontWeight: 'bold' }}>
                    {formatPrice(artwork.price)}
                  </div>,
                  <Button
                    key="unfavorite"
                    type="text"
                    icon={<HeartFilled />}
                    style={{ color: '#f5222d' }}
                    loading={unfavoriting.has(artwork.id)}
                    onClick={() => handleUnfavorite(artwork.id)}
                  >
                    取消收藏
                  </Button>,
                  <Button
                    key="buy"
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    size="small"
                    onClick={() => navigate(`/artwork/${artwork.id}`)}
                  >
                    查看详情
                  </Button>
                ]}
              >
                <Meta
                  title={
                    <div 
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/artwork/${artwork.id}`)}
                    >
                      {artwork.title}
                    </div>
                  }
                  description={
                    <div>
                      <div style={{ marginBottom: 8 }}>
                        by {artwork.profiles?.name || '匿名用户'}
                      </div>
                      <div style={{ 
                        fontSize: 12, 
                        color: '#999',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {artwork.description || '暂无描述'}
                      </div>
                    </div>
                  }
                />
                
                {/* 标签 */}
                {artwork.tags && artwork.tags.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {artwork.tags.slice(0, 2).map(tag => (
                      <Tag key={tag} size="small" color="blue" style={{ marginBottom: 4 }}>
                        {tag}
                      </Tag>
                    ))}
                    {artwork.tags.length > 2 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        +{artwork.tags.length - 2} 更多
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* 分页 */}
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Pagination
              current={currentPage}
              total={total}
              pageSize={pageSize}
              onChange={handlePageChange}
              showSizeChanger={false}
              showQuickJumper
              showTotal={(total, range) => 
                `显示 ${range[0]}-${range[1]} 条，共 ${total} 条收藏`
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Favorites;