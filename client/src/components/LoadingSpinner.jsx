import React from 'react';
import { Spin } from 'antd';

const LoadingSpinner = ({ 
  size = 'large', 
  tip = '加载中...', 
  style = {} 
}) => {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '200px',
      ...style
    }}>
      <Spin size={size} tip={tip} />
    </div>
  );
};

export default LoadingSpinner;