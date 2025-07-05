import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Card, 
  Spin, 
  Alert, 
  Row, 
  Col, 
  Typography, 
  Button, 
  Space, 
  Tag, 
  Avatar,
  Divider,
  Image,
  message as antdMessage,
  Modal
} from 'antd';
import {
  HeartOutlined,
  HeartFilled,
  EyeOutlined,
  ShareAltOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
  UserOutlined
} from '@ant-design/icons';
import { artworkService } from '../lib/artworks';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph, Text } = Typography;

function ArtworkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [artwork, setArtwork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [favoriting, setFavoriting] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    if (id) {
      fetchArtwork();
    }
  }, [id]);

  const fetchArtwork = async () => {
    setLoading(true);
    try {
      const data = await artworkService.getArtworkById(id);
      setArtwork(data);
      
      // 检查是否已收藏
      if (user) {
        const favorited = data.favorites?.some(fav => fav.user_id === user.id);
        setIsFavorited(favorited);
      }
      
      setError(null);
    } catch (err) {
      console.error('获取作品详情失败:', err);
      setError(err.message);
      antdMessage.error('加载作品详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async () => {
    if (!user) {
      antdMessage.warning('请先登录');
      return;
    }

    setFavoriting(true);
    try {
      const result = await artworkService.toggleFavorite(artwork.id, user.id);
      setIsFavorited(result.favorited);
      antdMessage.success(result.favorited ? '已添加到收藏' : '已取消收藏');
    } catch (error) {
      console.error('收藏操作失败:', error);
      antdMessage.error('操作失败，请重试');
    } finally {
      setFavoriting(false);
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: artwork.title,
        text: artwork.description,
        url: window.location.href
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(window.location.href);
      antdMessage.success('链接已复制到剪贴板');
    }
  };

  const formatPrice = (price) => {
    if (price === 0) return '免费';
    return `¥${price.toLocaleString()}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px', maxWidth: 800, margin: '0 auto' }}>
        <Alert 
          message="加载失败" 
          description={error} 
          type="error" 
          showIcon 
          action={
            <Button onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    );
  }

  if (!artwork) {
    return (
      <div style={{ padding: '20px', maxWidth: 800, margin: '0 auto' }}>
        <Alert 
          message="作品未找到" 
          description="该作品可能已被删除或不存在" 
          type="warning" 
          showIcon 
          action={
            <Button onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      {/* 返回按钮 */}
      <div style={{ marginBottom: 20 }}>
        <Button 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate(-1)}
          type="text"
        >
          返回
        </Button>
      </div>

      <Row gutter={[40, 40]}>
        {/* 作品图片 */}
        <Col xs={24} lg={14}>
          <div style={{ position: 'relative' }}>
            <Image
              src={artwork.image_url}
              alt={artwork.title}
              style={{ 
                width: '100%', 
                borderRadius: 8,
                cursor: 'pointer'
              }}
              preview={{
                visible: showImageModal,
                onVisibleChange: setShowImageModal,
                mask: (
                  <div style={{ color: 'white', textAlign: 'center' }}>
                    <EyeOutlined style={{ fontSize: 20 }} />
                    <div>点击查看大图</div>
                  </div>
                )
              }}
            />
            
            {/* 统计信息覆盖层 */}
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 14
              }}
            >
              <EyeOutlined /> {artwork.view_count || 0} 次浏览
            </div>
          </div>
        </Col>

        {/* 作品信息 */}
        <Col xs={24} lg={10}>
          <Card>
            {/* 标题和操作按钮 */}
            <div style={{ marginBottom: 20 }}>
              <Title level={2} style={{ marginBottom: 10 }}>
                {artwork.title}
              </Title>
              
              <Space>
                <Button
                  type={isFavorited ? "primary" : "default"}
                  icon={isFavorited ? <HeartFilled /> : <HeartOutlined />}
                  loading={favoriting}
                  onClick={handleFavorite}
                  danger={isFavorited}
                >
                  {isFavorited ? '已收藏' : '收藏'}
                </Button>
                <Button icon={<ShareAltOutlined />} onClick={handleShare}>
                  分享
                </Button>
                <Button icon={<DownloadOutlined />} type="primary">
                  购买下载
                </Button>
              </Space>
            </div>

            <Divider />

            {/* 价格 */}
            <div style={{ marginBottom: 20 }}>
              <Text type="secondary">价格</Text>
              <Title level={3} style={{ color: '#1890ff', margin: '8px 0' }}>
                {formatPrice(artwork.price)}
              </Title>
            </div>

            <Divider />

            {/* 作者信息 */}
            <div style={{ marginBottom: 20 }}>
              <Text type="secondary">创作者</Text>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
                <Avatar 
                  src={artwork.profiles?.avatar_url} 
                  icon={<UserOutlined />}
                  size={40}
                />
                <div style={{ marginLeft: 12 }}>
                  <div style={{ fontWeight: 500 }}>
                    {artwork.profiles?.name || '匿名用户'}
                  </div>
                  {artwork.profiles?.bio && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {artwork.profiles.bio}
                    </Text>
                  )}
                </div>
              </div>
            </div>

            <Divider />

            {/* 作品描述 */}
            {artwork.description && (
              <div style={{ marginBottom: 20 }}>
                <Text type="secondary">作品描述</Text>
                <Paragraph style={{ marginTop: 8 }}>
                  {artwork.description}
                </Paragraph>
              </div>
            )}

            {/* 标签 */}
            {artwork.tags && artwork.tags.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <Text type="secondary">标签</Text>
                <div style={{ marginTop: 8 }}>
                  {artwork.tags.map(tag => (
                    <Tag key={tag} color="blue">
                      {tag}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            <Divider />

            {/* 技术信息 */}
            <div>
              <Text type="secondary">技术信息</Text>
              <div style={{ marginTop: 8 }}>
                <Row gutter={[0, 8]}>
                  <Col span={12}>
                    <Text type="secondary">文件大小：</Text>
                  </Col>
                  <Col span={12}>
                    <Text>{(artwork.file_size / (1024 * 1024)).toFixed(2)} MB</Text>
                  </Col>
                  
                  {artwork.dimensions && (
                    <>
                      <Col span={12}>
                        <Text type="secondary">分辨率：</Text>
                      </Col>
                      <Col span={12}>
                        <Text>{artwork.dimensions.width} × {artwork.dimensions.height}</Text>
                      </Col>
                    </>
                  )}
                  
                  <Col span={12}>
                    <Text type="secondary">发布时间：</Text>
                  </Col>
                  <Col span={12}>
                    <Text>{formatDate(artwork.created_at)}</Text>
                  </Col>
                </Row>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default ArtworkDetail;
