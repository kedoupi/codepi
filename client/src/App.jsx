import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout, Menu, Button, Avatar, Dropdown, Spin } from 'antd';
import { UserOutlined, LogoutOutlined, SettingOutlined, UploadOutlined, AppstoreOutlined } from '@ant-design/icons';
import './App.css';

const { Header, Content, Footer } = Layout;

function App() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('登出失败:', error);
    }
  };

  // 用户菜单
  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
      onClick: () => navigate('/profile')
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
      onClick: () => navigate('/settings')
    },
    {
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout
    }
  ];

  // 如果正在加载认证状态，显示加载页面
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh'
      }}>
        <Spin size="large" tip="正在加载..." />
      </div>
    );
  }

  return (
    <Layout className="layout" style={{ minHeight: '100vh' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Link to="/" style={{ 
            color: 'white', 
            fontSize: '24px', 
            fontWeight: 'bold',
            textDecoration: 'none'
          }}>
            KDP.Cool
          </Link>
        </div>

        <Menu 
          theme="dark" 
          mode="horizontal" 
          selectedKeys={[location.pathname]}
          style={{ 
            flex: 1, 
            justifyContent: 'center',
            border: 'none'
          }}
        >
          <Menu.Item key="/" icon={<AppstoreOutlined />}>
            <Link to="/">作品市场</Link>
          </Menu.Item>
          {user && (
            <>
              <Menu.Item key="/upload" icon={<UploadOutlined />}>
                <Link to="/upload">上传作品</Link>
              </Menu.Item>
              <Menu.Item key="/my-artworks">
                <Link to="/my-artworks">我的作品</Link>
              </Menu.Item>
              <Menu.Item key="/favorites">
                <Link to="/favorites">我的收藏</Link>
              </Menu.Item>
            </>
          )}
        </Menu>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          {user ? (
            <Dropdown 
              menu={{ items: userMenuItems }}
              placement="bottomRight"
              trigger={['click']}
            >
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: '6px',
                transition: 'background-color 0.3s'
              }}>
                <Avatar 
                  src={profile?.avatar_url} 
                  icon={<UserOutlined />}
                  size="small"
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: 'white' }}>
                  {profile?.name || user.email}
                </span>
              </div>
            </Dropdown>
          ) : (
            <div>
              <Button 
                type="default" 
                style={{ marginRight: '8px' }}
                onClick={() => navigate('/login')}
              >
                登录
              </Button>
            </div>
          )}
        </div>
      </Header>

      <Content style={{ 
        padding: '24px 24px', 
        flex: 1,
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{
          background: '#fff',
          padding: '24px',
          borderRadius: '8px',
          minHeight: '100%'
        }}>
          <Outlet />
        </div>
      </Content>

      <Footer style={{ 
        textAlign: 'center',
        backgroundColor: '#001529',
        color: 'white'
      }}>
        KDP.Cool ©2025 - 插画师的专业作品交易平台
      </Footer>
    </Layout>
  );
}

export default App;
