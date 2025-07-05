import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Card,
  InputNumber,
  Select,
  Space,
  Tag,
  message as antdMessage,
  Row,
  Col,
  Image,
  Typography,
  Spin,
  Alert
} from 'antd';
import {
  SaveOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { artworkService } from '../lib/artworks';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorDisplay from '../components/ErrorDisplay';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

function EditArtwork() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form] = Form.useForm();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [artwork, setArtwork] = useState(null);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [inputTag, setInputTag] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    loadData();
  }, [id, user, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 并行加载作品详情和分类列表
      const [artworkData, categoriesData] = await Promise.all([
        artworkService.getArtworkById(id),
        artworkService.getCategories()
      ]);

      // 检查权限
      if (artworkData.author_id !== user.id) {
        antdMessage.error('您没有权限编辑此作品');
        navigate('/my-artworks');
        return;
      }

      setArtwork(artworkData);
      setCategories(categoriesData);
      setTags(artworkData.tags || []);

      // 设置表单初始值
      form.setFieldsValue({
        title: artworkData.title,
        description: artworkData.description,
        price: artworkData.price,
        category: artworkData.category_id,
        status: artworkData.status
      });

      setError(null);
    } catch (err) {
      console.error('加载作品数据失败:', err);
      setError(err.message);
      antdMessage.error('加载作品数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    if (inputTag && !tags.includes(inputTag) && tags.length < 10) {
      setTags([...tags, inputTag]);
      setInputTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const onFinish = async (values) => {
    setSaving(true);
    try {
      const updateData = {
        title: values.title,
        description: values.description || '',
        price: values.price || 0,
        category_id: values.category || null,
        status: values.status,
        tags: tags,
        updated_at: new Date().toISOString()
      };

      await artworkService.updateArtwork(id, updateData);
      
      antdMessage.success('作品更新成功！');
      navigate('/my-artworks');

    } catch (error) {
      console.error('更新作品失败:', error);
      antdMessage.error(error.message || '更新作品失败');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return null;
  }

  if (loading) {
    return <LoadingSpinner tip="加载作品数据..." />;
  }

  if (error) {
    return (
      <ErrorDisplay
        title="加载失败"
        description={error}
        onRefresh={loadData}
        showHome
      />
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
            <Button onClick={() => navigate('/my-artworks')}>
              返回我的作品
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="responsive-container" style={{ padding: '20px' }}>
      <div style={{ marginBottom: 20 }}>
        <Button 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate('/my-artworks')}
          type="text"
        >
          返回我的作品
        </Button>
      </div>

      <Card>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 30 }}>
          编辑作品
        </Title>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          autoComplete="off"
        >
          <Row gutter={[24, 0]}>
            {/* 作品预览 */}
            <Col xs={24} md={10}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  作品预览
                </Text>
                <Image
                  src={artwork.image_url}
                  alt={artwork.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 300,
                    borderRadius: 8
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  原始文件名: {artwork.original_filename}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  文件大小: {(artwork.file_size / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
            </Col>

            {/* 编辑表单 */}
            <Col xs={24} md={14}>
              <Form.Item
                name="title"
                label="作品标题"
                rules={[{ required: true, message: '请输入作品标题' }]}
              >
                <Input placeholder="输入吸引人的作品标题" maxLength={100} />
              </Form.Item>

              <Form.Item name="description" label="作品描述">
                <TextArea
                  placeholder="描述你的作品创意、风格或用途..."
                  rows={4}
                  maxLength={500}
                  showCount
                />
              </Form.Item>

              <Form.Item name="category" label="作品分类">
                <Select placeholder="选择分类" allowClear>
                  {categories.map(category => (
                    <Option key={category.id} value={category.id}>
                      {category.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="price"
                label="价格 (元)"
                rules={[{ required: true, message: '请设置价格' }]}
              >
                <InputNumber
                  placeholder="0"
                  min={0}
                  max={9999}
                  style={{ width: '100%' }}
                  formatter={value => `¥ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/¥\s?|(,*)/g, '')}
                />
              </Form.Item>

              <Form.Item
                name="status"
                label="发布状态"
                rules={[{ required: true, message: '请选择发布状态' }]}
              >
                <Select>
                  <Option value="published">已发布</Option>
                  <Option value="draft">草稿</Option>
                  <Option value="private">私密</Option>
                </Select>
              </Form.Item>

              {/* 标签编辑 */}
              <Form.Item label="标签">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.Group compact>
                    <Input
                      style={{ width: 'calc(100% - 80px)' }}
                      value={inputTag}
                      onChange={(e) => setInputTag(e.target.value)}
                      onPressEnter={handleAddTag}
                      placeholder="输入标签后按回车添加"
                      maxLength={20}
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleAddTag}
                      disabled={!inputTag || tags.length >= 10}
                    >
                      添加
                    </Button>
                  </Input.Group>
                  
                  <div>
                    {tags.map(tag => (
                      <Tag
                        key={tag}
                        closable
                        onClose={() => handleRemoveTag(tag)}
                        style={{ marginBottom: 4 }}
                      >
                        {tag}
                      </Tag>
                    ))}
                  </div>
                  
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    最多添加 10 个标签，有助于其他用户发现你的作品
                  </Text>
                </Space>
              </Form.Item>
            </Col>
          </Row>

          {/* 提交按钮 */}
          <Form.Item style={{ textAlign: 'center', marginTop: 30 }}>
            <Space size="large">
              <Button onClick={() => navigate('/my-artworks')}>
                取消
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={saving}
                icon={<SaveOutlined />}
                size="large"
              >
                保存更改
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

export default EditArtwork;