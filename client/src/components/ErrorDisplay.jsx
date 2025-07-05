import React from 'react';
import { Alert, Button, Space } from 'antd';
import { ReloadOutlined, HomeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const ErrorDisplay = ({ 
  title = '出错了', 
  description = '发生了未知错误，请稍后重试', 
  showRefresh = true,
  showHome = false,
  onRefresh = null
}) => {
  const navigate = useNavigate();

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      window.location.reload();
    }
  };

  const actions = [];
  
  if (showRefresh) {
    actions.push(
      <Button key="refresh" icon={<ReloadOutlined />} onClick={handleRefresh}>
        重新加载
      </Button>
    );
  }
  
  if (showHome) {
    actions.push(
      <Button key="home" type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
        返回首页
      </Button>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: 600, margin: '0 auto' }}>
      <Alert
        message={title}
        description={description}
        type="error"
        showIcon
        action={
          actions.length > 0 && (
            <Space>
              {actions}
            </Space>
          )
        }
        style={{ textAlign: 'left' }}
      />
    </div>
  );
};

export default ErrorDisplay;