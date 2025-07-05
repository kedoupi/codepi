import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Card, 
  Col, 
  Row, 
  Spin, 
  Alert, 
  Pagination, 
  Select, 
  Input, 
  Button, 
  Space,
  Typography,
  Empty,
  message as antdMessage
} from 'antd';
import { SearchOutlined, EyeOutlined, HeartOutlined } from '@ant-design/icons';
import { artworkService } from '../lib/artworks';

const { Meta } = Card;
const { Search } = Input;
const { Title } = Typography;
const { Option } = Select;

function Marketplace() {
  const [artworks, setArtworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const pageSize = 12;

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    fetchArtworks();
  }, [currentPage, selectedCategory, sortBy]);

  const loadCategories = async () => {
    try {
      const categoriesList = await artworkService.getCategories();
      setCategories(categoriesList);
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };

  const fetchArtworks = async () => {
    setLoading(true);
    try {
      const options = {
        page: currentPage,
        limit: pageSize,
        category: selectedCategory,
        search: searchQuery,
        sortBy: sortBy
      };

      const result = await artworkService.getArtworks(options);
      setArtworks(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      console.error('获取作品列表失败:', err);
      setError(err.message);
      antdMessage.error('加载作品失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handleSearch = (value) => {
    setSearchQuery(value);
    setCurrentPage(1);
    fetchArtworks();
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    setCurrentPage(1);
  };

  const handleSortChange = (value) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  const formatPrice = (price) => {
    if (price === 0) return '免费';
    return `¥${price.toLocaleString()}`;
  };

  const formatViewCount = (count) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  if (loading) {
    return <Spin size="large" />;
  }

  if (error) {
    return <Alert message="Error" description={error} type="error" showIcon />;
  }

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <Title level={2} style={{ textAlign: 'center', marginBottom: 30 }}>
        作品市场
      </Title>

      {/* 搜索和筛选区域 */}
      <div style={{ marginBottom: 30, background: '#f5f5f5', padding: 20, borderRadius: 8 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={8}>
            <Search
              placeholder="搜索作品标题、描述或标签..."
              allowClear
              enterButton={<SearchOutlined />}
              size="large"
              onSearch={handleSearch}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              placeholder="选择分类"
              allowClear
              style={{ width: '100%' }}
              size="large"
              value={selectedCategory}
              onChange={handleCategoryChange}
            >
              {categories.map(category => (
                <Option key={category.id} value={category.id}>
                  {category.name}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} md={4}>
            <Select
              value={sortBy}
              onChange={handleSortChange}
              style={{ width: '100%' }}
              size="large"
            >
              <Option value="newest">最新发布</Option>
              <Option value="popular">最受欢迎</Option>
              <Option value="price_low">价格从低到高</Option>
              <Option value="price_high">价格从高到低</Option>
            </Select>
          </Col>
        </Row>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 50 }}>
          <Spin size="large" />
        </div>
      ) : error ? (
        <Alert message="加载失败" description={error} type="error" showIcon />
      ) : artworks.length === 0 ? (
        <Empty
          description="暂无作品"
          style={{ padding: 50 }}
        />
      ) : (
        <>
          <Row gutter={[24, 24]}>
            {artworks.map((artwork) => (
              <Col key={artwork.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  cover={
                    <Link to={`/artwork/${artwork.id}`}>
                      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
                        <img
                          alt={artwork.title}
                          src={artwork.thumbnail_url || artwork.image_url}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            background: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 12
                          }}
                        >
                          <EyeOutlined /> {formatViewCount(artwork.view_count || 0)}
                        </div>
                      </div>
                    </Link>
                  }
                  actions={[
                    <div key="price" style={{ color: '#1890ff', fontWeight: 'bold' }}>
                      {formatPrice(artwork.price)}
                    </div>,
                    <div key="favorite" style={{ color: '#ff4d4f' }}>
                      <HeartOutlined /> {artwork.favorites?.length || 0}
                    </div>
                  ]}
                >
                  <Meta
                    title={
                      <Link 
                        to={`/artwork/${artwork.id}`} 
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {artwork.title}
                      </Link>
                    }
                    description={
                      <div>
                        <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
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
                </Card>
              </Col>
            ))}
          </Row>

          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Pagination
              current={currentPage}
              total={total}
              pageSize={pageSize}
              onChange={handlePageChange}
              showSizeChanger={false}
              showQuickJumper
              showTotal={(total, range) => 
                `显示 ${range[0]}-${range[1]} 条，共 ${total} 条`
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Marketplace;
