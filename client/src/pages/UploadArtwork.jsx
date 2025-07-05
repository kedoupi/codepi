import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Card,
  InputNumber,
  Upload,
  Select,
  Space,
  Tag,
  message as antdMessage,
  Progress,
  Row,
  Col,
  Image,
  Typography
} from 'antd';
import {
  InboxOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { storageService } from '../lib/storage';
import { artworkService } from '../lib/artworks';

const { Dragger } = Upload;
const { Option } = Select;
const { Title, Text } = Typography;

function UploadArtwork() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileUploading, setFileUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [inputTag, setInputTag] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // 加载分类列表
    loadCategories();
  }, [user, navigate]);

  const loadCategories = async () => {
    try {
      const categoriesList = await artworkService.getCategories();
      setCategories(categoriesList);
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };

  // 自定义文件上传处理
  const handleFileUpload = async (file) => {
    setFileUploading(true);
    setUploadProgress(0);

    try {
      // 显示预览
      const previewUrl = URL.createObjectURL(file);
      setPreviewImage(previewUrl);

      // 模拟上传进度
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // 上传文件
      const uploadResult = await storageService.uploadArtwork(file, user.id);
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadedFile(uploadResult);
      
      antdMessage.success('文件上传成功！');

    } catch (error) {
      console.error('文件上传失败:', error);
      antdMessage.error(error.message || '文件上传失败');
      setPreviewImage(null);
    } finally {
      setFileUploading(false);
    }
    
    return false; // 阻止默认上传行为
  };

  // 删除上传的文件
  const handleRemoveFile = async () => {
    if (uploadedFile) {
      try {
        await storageService.deleteFile(uploadedFile.original.path);
        await storageService.deleteFile(uploadedFile.thumbnail.path);
      } catch (error) {
        console.error('删除文件失败:', error);
      }
    }
    
    setUploadedFile(null);
    setPreviewImage(null);
    setUploadProgress(0);
  };

  // 添加标签
  const handleAddTag = () => {
    if (inputTag && !tags.includes(inputTag) && tags.length < 10) {
      setTags([...tags, inputTag]);
      setInputTag('');
    }
  };

  // 删除标签
  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // 提交表单
  const onFinish = async (values) => {
    if (!uploadedFile) {
      antdMessage.error('请先上传作品文件');
      return;
    }

    setLoading(true);
    try {
      const artworkData = {
        title: values.title,
        description: values.description || '',
        price: values.price || 0,
        category_id: values.category || null,
        tags: tags,
        image_url: uploadedFile.original.url,
        thumbnail_url: uploadedFile.thumbnail.url,
        original_filename: uploadedFile.metadata.originalName,
        file_size: uploadedFile.metadata.size,
        dimensions: {
          // TODO: 从图片获取实际尺寸
          width: 1920,
          height: 1080
        },
        author_id: user.id,
        status: 'published'
      };

      const result = await artworkService.createArtwork(artworkData);
      
      antdMessage.success('作品发布成功！');
      
      // 重置表单
      form.resetFields();
      setTags([]);
      setUploadedFile(null);
      setPreviewImage(null);
      setUploadProgress(0);

      // 跳转到作品详情页
      navigate(`/artwork/${result.id}`);

    } catch (error) {
      console.error('发布作品失败:', error);
      antdMessage.error(error.message || '发布作品失败');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px' }}>
      <Card>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 30 }}>
          上传新作品
        </Title>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          autoComplete="off"
        >
          <Row gutter={[24, 0]}>
            {/* 文件上传区域 */}
            <Col xs={24} md={12}>
              <Form.Item label="作品文件" required>
                {!uploadedFile ? (
                  <Dragger
                    beforeUpload={handleFileUpload}
                    showUploadList={false}
                    accept="image/*"
                    disabled={fileUploading}
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">
                      点击或拖拽文件到此区域上传
                    </p>
                    <p className="ant-upload-hint">
                      支持 JPG、PNG、WebP、GIF 格式，最大 50MB
                    </p>
                  </Dragger>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <Image
                      src={previewImage}
                      alt="预览"
                      style={{
                        maxWidth: '100%',
                        maxHeight: 300,
                        borderRadius: 8
                      }}
                    />
                    <div style={{ marginTop: 10 }}>
                      <Button 
                        icon={<DeleteOutlined />} 
                        onClick={handleRemoveFile}
                        danger
                      >
                        重新上传
                      </Button>
                    </div>
                  </div>
                )}

                {fileUploading && (
                  <div style={{ marginTop: 10 }}>
                    <Progress percent={uploadProgress} status="active" />
                    <Text type="secondary">正在上传文件...</Text>
                  </div>
                )}
              </Form.Item>
            </Col>

            {/* 作品信息 */}
            <Col xs={24} md={12}>
              <Form.Item
                name="title"
                label="作品标题"
                rules={[{ required: true, message: '请输入作品标题' }]}
              >
                <Input placeholder="输入吸引人的作品标题" maxLength={100} />
              </Form.Item>

              <Form.Item name="description" label="作品描述">
                <Input.TextArea
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

              {/* 标签输入 */}
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
            <Space>
              <Button onClick={() => navigate('/')}>
                取消
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                disabled={!uploadedFile}
                size="large"
              >
                发布作品
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

export default UploadArtwork;
