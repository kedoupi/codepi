import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Avatar,
  Typography,
  Button,
  Tabs,
  Form,
  Input,
  Upload,
  message as antdMessage,
  Spin,
  Empty,
  Modal,
  Space,
  Divider,
  Statistic
} from 'antd';
import {
  UserOutlined,
  EditOutlined,
  CameraOutlined,
  PictureOutlined,
  HeartOutlined,
  EyeOutlined,
  SettingOutlined,
  LogoutOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { artworkService } from '../lib/artworks';
import { storageService } from '../lib/storage';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { TextArea } = Input;

function Profile() {
  const navigate = useNavigate();
  const { user, profile, updateProfile, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [userArtworks, setUserArtworks] = useState([]);
  const [userFavorites, setUserFavorites] = useState([]);
  const [stats, setStats] = useState({ artworks: 0, favorites: 0, views: 0 });
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    loadUserData();
  }, [user, navigate]);

  const loadUserData = async () => {
    setLoading(true);
    try {
      // 加载用户作品
      const artworksResult = await artworkService.getArtworks({
        authorId: user.id,
        limit: 20
      });
      setUserArtworks(artworksResult.data);

      // 加载用户收藏
      const favoritesResult = await artworkService.getUserFavorites(user.id, {
        limit: 20
      });
      setUserFavorites(favoritesResult.data);

      // 计算统计数据
      const totalViews = artworksResult.data.reduce((sum, artwork) => 
        sum + (artwork.view_count || 0), 0
      );

      setStats({
        artworks: artworksResult.total,
        favorites: favoritesResult.total,
        views: totalViews
      });

    } catch (error) {
      console.error('加载用户数据失败:', error);
      antdMessage.error('加载用户数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProfile = () => {
    form.setFieldsValue({
      name: profile?.name || user?.user_metadata?.full_name || '',
      bio: profile?.bio || ''
    });
    setEditModalVisible(true);
  };

  const handleSaveProfile = async (values) => {
    try {
      await updateProfile(values);
      setEditModalVisible(false);
      antdMessage.success('个人资料更新成功');
    } catch (error) {
      console.error('更新个人资料失败:', error);
      antdMessage.error('更新失败，请重试');
    }
  };

  const handleAvatarUpload = async (file) => {
    setAvatarUploading(true);
    try {
      const uploadResult = await storageService.uploadArtwork(file, user.id);
      await updateProfile({ 
        avatar_url: uploadResult.thumbnail.url 
      });
      antdMessage.success('头像更新成功');
    } catch (error) {
      console.error('头像上传失败:', error);
      antdMessage.error('头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
    return false;
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('退出登录失败:', error);
      antdMessage.error('退出登录失败');
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  if (!user) {
    return null;
  }

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      {/* 用户信息卡片 */}
      <Card style={{ marginBottom: 24 }}>
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} sm={6} style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Avatar
                size={120}
                src={profile?.avatar_url || user?.user_metadata?.avatar_url}
                icon={<UserOutlined />}
              />
              <Upload
                beforeUpload={handleAvatarUpload}
                showUploadList={false}
                accept="image/*"
              >
                <Button
                  type="primary"
                  shape="circle"
                  icon={<CameraOutlined />}
                  size="small"
                  loading={avatarUploading}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0
                  }}
                />
              </Upload>
            </div>
          </Col>
          
          <Col xs={24} sm={12}>
            <Title level={2} style={{ marginBottom: 8 }}>
              {profile?.name || user?.user_metadata?.full_name || '用户'}
            </Title>
            <Text type="secondary" style={{ fontSize: 16 }}>
              {user?.email}
            </Text>
            {profile?.bio && (
              <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
                {profile.bio}
              </Paragraph>
            )}
          </Col>
          
          <Col xs={24} sm={6}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={handleEditProfile}
                block
              >
                编辑资料
              </Button>
              <Button
                icon={<SettingOutlined />}
                block
              >
                设置
              </Button>
              <Button
                danger
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                block
              >
                退出登录
              </Button>
            </Space>
          </Col>
        </Row>

        <Divider />

        {/* 统计数据 */}
        <Row gutter={[16, 16]} style={{ textAlign: 'center' }}>
          <Col xs={8}>
            <Statistic
              title="发布作品"
              value={stats.artworks}
              prefix={<PictureOutlined />}
            />
          </Col>
          <Col xs={8}>
            <Statistic
              title="收藏作品"
              value={stats.favorites}
              prefix={<HeartOutlined />}
            />
          </Col>
          <Col xs={8}>
            <Statistic
              title="总浏览量"
              value={stats.views}
              prefix={<EyeOutlined />}
            />
          </Col>
        </Row>
      </Card>

      {/* 作品和收藏标签页 */}
      <Card>
        <Tabs defaultActiveKey="artworks">
          <TabPane tab={`我的作品 (${stats.artworks})`} key="artworks">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 50 }}>
                <Spin size="large" />
              </div>
            ) : userArtworks.length === 0 ? (
              <Empty
                description="还没有发布作品"
                style={{ padding: 50 }}
              >
                <Button 
                  type="primary" 
                  onClick={() => navigate('/upload')}
                >
                  上传第一个作品
                </Button>
              </Empty>
            ) : (
              <Row gutter={[16, 16]}>
                {userArtworks.map(artwork => (
                  <Col key={artwork.id} xs={24} sm={12} md={8} lg={6}>
                    <Card
                      hoverable
                      cover={
                        <div 
                          style={{ 
                            height: 200, 
                            overflow: 'hidden',
                            cursor: 'pointer'
                          }}
                          onClick={() => navigate(`/artwork/${artwork.id}`)}
                        >
                          <img
                            alt={artwork.title}
                            src={artwork.thumbnail_url || artwork.image_url}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        </div>
                      }
                      actions={[
                        <div key="views">
                          <EyeOutlined /> {artwork.view_count || 0}
                        </div>,
                        <div key="favorites">
                          <HeartOutlined /> {artwork.favorites?.length || 0}
                        </div>
                      ]}
                    >
                      <Card.Meta
                        title={artwork.title}
                        description={
                          <div>
                            <div style={{ color: '#1890ff', fontWeight: 'bold' }}>
                              {artwork.price === 0 ? '免费' : `¥${artwork.price}`}
                            </div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                              {formatDate(artwork.created_at)}
                            </div>
                          </div>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </TabPane>

          <TabPane tab={`我的收藏 (${stats.favorites})`} key="favorites">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 50 }}>
                <Spin size="large" />
              </div>
            ) : userFavorites.length === 0 ? (
              <Empty
                description="还没有收藏作品"
                style={{ padding: 50 }}
              >
                <Button 
                  type="primary" 
                  onClick={() => navigate('/favorites')}
                >
                  查看收藏列表
                </Button>
              </Empty>
            ) : (
              <Row gutter={[16, 16]}>
                {userFavorites.map(artwork => (
                  <Col key={artwork.id} xs={24} sm={12} md={8} lg={6}>
                    <Card
                      hoverable
                      cover={
                        <div 
                          style={{ 
                            height: 200, 
                            overflow: 'hidden',
                            cursor: 'pointer'
                          }}
                          onClick={() => navigate(`/artwork/${artwork.id}`)}
                        >
                          <img
                            alt={artwork.title}
                            src={artwork.thumbnail_url || artwork.image_url}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        </div>
                      }
                    >
                      <Card.Meta
                        title={artwork.title}
                        description={
                          <div>
                            <div>by {artwork.profiles?.name || '匿名用户'}</div>
                            <div style={{ color: '#1890ff', fontWeight: 'bold', marginTop: 4 }}>
                              {artwork.price === 0 ? '免费' : `¥${artwork.price}`}
                            </div>
                          </div>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </TabPane>
        </Tabs>
      </Card>

      {/* 编辑资料弹窗 */}
      <Modal
        title="编辑个人资料"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveProfile}
        >
          <Form.Item
            name="name"
            label="昵称"
            rules={[{ required: true, message: '请输入昵称' }]}
          >
            <Input placeholder="输入您的昵称" maxLength={50} />
          </Form.Item>

          <Form.Item
            name="bio"
            label="个人简介"
          >
            <TextArea
              placeholder="介绍一下自己..."
              rows={4}
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setEditModalVisible(false)}>
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Profile;