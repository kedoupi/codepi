import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin, Result, Button } from 'antd';
import { supabase } from '../lib/supabase';

function AuthCallback() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // 处理OAuth回调
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('认证回调错误:', error);
          setError(error.message);
          return;
        }

        if (data.session) {
          console.log('认证成功，用户:', data.session.user);
          // 短暂延迟后重定向到首页
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 1000);
        } else {
          console.log('没有找到会话，重定向到登录页');
          navigate('/login', { replace: true });
        }
      } catch (error) {
        console.error('处理认证回调异常:', error);
        setError('认证过程中发生异常');
      } finally {
        setLoading(false);
      }
    };

    handleAuthCallback();
  }, [navigate]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh',
        flexDirection: 'column'
      }}>
        <Spin size="large" />
        <p style={{ marginTop: 16, color: '#666' }}>
          正在处理登录信息...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <Result
        status="error"
        title="登录失败"
        subTitle={error}
        extra={[
          <Button type="primary" key="retry" onClick={() => navigate('/login')}>
            重新登录
          </Button>
        ]}
      />
    );
  }

  return (
    <Result
      status="success"
      title="登录成功"
      subTitle="正在跳转到首页..."
    />
  );
}

export default AuthCallback;