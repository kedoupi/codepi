import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Card, message as antdMessage, Space, Typography, Spin } from 'antd';
import { GoogleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function Login() {
  const { signInWithGoogle, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLogging, setIsLogging] = useState(false);

  // 如果已经登录，重定向到首页
  useEffect(() => {
    if (user && !loading) {
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [user, loading, navigate, location]);

  const handleGoogleLogin = async () => {
    setIsLogging(true);
    try {
      await signInWithGoogle();
      // 成功后会通过AuthContext自动处理重定向
    } catch (error) {
      console.error('登录失败:', error);
      antdMessage.error('登录失败，请重试');
      setIsLogging(false);
    }
  };

  // 显示加载状态
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '50vh' 
      }}>
        <Spin size="large" tip="正在检查登录状态..." />
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '60vh',
      padding: '20px'
    }}>
      <Card 
        style={{ 
          width: 400, 
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Title level={2} style={{ color: '#1890ff', marginBottom: 8 }}>
              欢迎来到 KDP.Cool
            </Title>
            <Text type="secondary">
              插画师的专业作品交易平台
            </Text>
          </div>

          <div style={{ padding: '20px 0' }}>
            <Button
              type="primary"
              size="large"
              icon={<GoogleOutlined />}
              onClick={handleGoogleLogin}
              loading={isLogging}
              style={{
                height: '48px',
                fontSize: '16px',
                borderRadius: '8px'
              }}
              block
            >
              {isLogging ? '正在登录...' : '使用 Google 账户登录'}
            </Button>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              登录即表示您同意我们的服务条款和隐私政策
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  );
}

export default Login;
