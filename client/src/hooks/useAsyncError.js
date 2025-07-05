import { useState, useCallback } from 'react';
import { message as antdMessage } from 'antd';

/**
 * 异步错误处理钩子
 * 用于统一处理异步操作的加载状态和错误处理
 */
export const useAsyncError = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (asyncFunction, options = {}) => {
    const {
      loadingMessage = null,
      successMessage = null,
      errorMessage = '操作失败',
      showErrorMessage = true,
      throwError = false
    } = options;

    setLoading(true);
    setError(null);

    if (loadingMessage) {
      antdMessage.loading(loadingMessage);
    }

    try {
      const result = await asyncFunction();
      
      if (successMessage) {
        antdMessage.success(successMessage);
      }
      
      return result;
    } catch (err) {
      console.error('异步操作失败:', err);
      setError(err);
      
      if (showErrorMessage) {
        antdMessage.error(err.message || errorMessage);
      }
      
      if (throwError) {
        throw err;
      }
      
      return null;
    } finally {
      setLoading(false);
      antdMessage.destroy(); // 清除loading消息
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);

  return {
    loading,
    error,
    execute,
    reset
  };
};