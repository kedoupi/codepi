import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Spin,
  Alert,
  Typography,
  Button,
  Space,
  Tag,
  Modal,
  message as antdMessage,
  Dropdown,
  Empty,
  Statistic
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  MoreOutlined,
  PlusOutlined,
  HeartOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { artworkService } from '../lib/artworks';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorDisplay from '../components/ErrorDisplay';

const { Title, Text } = Typography;
const { Meta } = Card;

function MyArtworks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [artworks, setArtworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ total: 0, published: 0, views: 0 });
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [artworkToDelete, setArtworkToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchMyArtworks();
  }, [user, navigate]);

  const fetchMyArtworks = async () => {
    setLoading(true);
    try {
      const result = await artworkService.getArtworks({
        authorId: user.id,
        limit: 50,
        sortBy: 'created_at',
        sortOrder: 'desc'
      });
      
      setArtworks(result.data);
      
      // 计算统计数据
      const published = result.data.filter(a => a.status === 'published').length;
      const totalViews = result.data.reduce((sum, artwork) => 
        sum + (artwork.view_count || 0), 0
      );
      
      setStats({
        total: result.total,
        published,
        views: totalViews
      });
      
      setError(null);
    } catch (err) {
      console.error('获取我的作品失败:', err);
      setError(err.message);
      antdMessage.error('加载作品失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteArtwork = (artwork) => {
    setArtworkToDelete(artwork);
    setDeleteModalVisible(true);
  };

  const confirmDelete = async () => {
    if (!artworkToDelete) return;
    
    setDeletingId(artworkToDelete.id);
    try {
      await artworkService.deleteArtwork(artworkToDelete.id);
      antdMessage.success('作品删除成功');
      setDeleteModalVisible(false);
      setArtworkToDelete(null);
      await fetchMyArtworks(); // 重新加载列表
    } catch (error) {
      console.error('删除作品失败:', error);
      antdMessage.error('删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusTag = (status) => {
    const statusConfig = {
      'published': { color: 'green', text: '已发布' },
      'draft': { color: 'orange', text: '草稿' },
      'private': { color: 'red', text: '私密' }
    };
    const config = statusConfig[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const formatPrice = (price) => {
    if (price === 0) return '免费';
    return `¥${price.toLocaleString()}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  const getArtworkMenuItems = (artwork) => [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '编辑',
      onClick: () => navigate(`/edit-artwork/${artwork.id}`)
    },
    {
      key: 'view',
      icon: <EyeOutlined />,
      label: '查看',
      onClick: () => navigate(`/artwork/${artwork.id}`)
    },
    {
      type: 'divider'
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: () => handleDeleteArtwork(artwork)
    }
  ];

  if (!user) {
    return null;
  }

  if (loading) {
    return <LoadingSpinner tip="加载我的作品..." />;
  }

  if (error) {
    return (
      <ErrorDisplay
        title="加载失败"
        description={error}
        onRefresh={fetchMyArtworks}
        showHome
      />
    );
  }

  return (
    <div className="responsive-container" style={{ padding: '20px' }}>
      {/* 页面标题和统计 */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Title level={2} style={{ margin: 0 }}>我的作品</Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => navigate('/upload')}
          >
            上传新作品
          </Button>
        </div>
        
        {/* 统计数据 */}
        <Row gutter={[16, 16]} className="responsive-stats">
          <Col>
            <Statistic
              title="总作品数"
              value={stats.total}
              prefix={<EyeOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Col>
          <Col>
            <Statistic
              title="已发布"
              value={stats.published}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
          <Col>
            <Statistic
              title="总浏览量"
              value={stats.views}
              prefix={<HeartOutlined />}
              valueStyle={{ color: '#f5222d' }}
            />
          </Col>
        </Row>
      </div>

      {/* 作品列表 */}
      {artworks.length === 0 ? (
        <Empty
          description="还没有作品"
          style={{ padding: '60px 0' }}
        >
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => navigate('/upload')}
          >
            上传第一个作品
          </Button>
        </Empty>
      ) : (
        <div className="responsive-grid">
          {artworks.map((artwork) => (
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
                  {/* 状态标签 */}
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    left: 8
                  }}>
                    {getStatusTag(artwork.status)}
                  </div>
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
                <div key="date" style={{ fontSize: 12, color: '#666' }}>
                  {formatDate(artwork.created_at)}
                </div>,
                <Dropdown
                  key="more"
                  menu={{ items: getArtworkMenuItems(artwork) }}
                  trigger={['click']}
                >
                  <Button 
                    type="text" 
                    icon={<MoreOutlined />}
                    loading={deletingId === artwork.id}
                  />
                </Dropdown>
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
                  <div style={{ 
                    fontSize: 12, 
                    color: '#999',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {artwork.description || '暂无描述'}
                  </div>
                }
              />
              
              {/* 标签 */}
              {artwork.tags && artwork.tags.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {artwork.tags.slice(0, 3).map(tag => (
                    <Tag key={tag} size="small" style={{ marginBottom: 4 }}>
                      {tag}
                    </Tag>
                  ))}
                  {artwork.tags.length > 3 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      +{artwork.tags.length - 3} 更多
                    </Text>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        title="删除作品"
        open={deleteModalVisible}
        onOk={confirmDelete}
        onCancel={() => {
          setDeleteModalVisible(false);
          setArtworkToDelete(null);
        }}
        confirmLoading={deletingId !== null}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要删除作品 "{artworkToDelete?.title}" 吗？</p>
        <p style={{ color: '#ff4d4f', fontSize: 14 }}>
          ⚠️ 此操作不可恢复，作品文件也将被永久删除。
        </p>
      </Modal>
    </div>
  );
}

export default MyArtworks;
