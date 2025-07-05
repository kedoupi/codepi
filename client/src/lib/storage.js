import { supabase } from './supabase';

/**
 * 文件上传服务
 * 支持图片上传、压缩和缩略图生成
 */
export class StorageService {
  constructor() {
    this.bucketName = 'artworks';
  }

  /**
   * 验证文件类型和大小
   */
  validateFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxSize = 50 * 1024 * 1024; // 50MB

    if (!allowedTypes.includes(file.type)) {
      throw new Error('不支持的文件类型。请上传 JPG、PNG、WebP 或 GIF 格式的图片。');
    }

    if (file.size > maxSize) {
      throw new Error('文件大小不能超过 50MB');
    }

    return true;
  }

  /**
   * 生成唯一文件名
   */
  generateFileName(originalName, userId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop();
    return `${userId}/${timestamp}-${random}.${extension}`;
  }

  /**
   * 上传原始文件
   */
  async uploadOriginal(file, userId) {
    try {
      this.validateFile(file);

      const fileName = this.generateFileName(file.name, userId);
      const filePath = `originals/${fileName}`;

      console.log('正在上传文件:', filePath);

      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('文件上传失败:', error);
        throw error;
      }

      // 获取公共URL
      const { data: urlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      return {
        path: filePath,
        url: urlData.publicUrl,
        fileName: fileName,
        originalName: file.name,
        size: file.size,
        type: file.type
      };

    } catch (error) {
      console.error('上传文件异常:', error);
      throw error;
    }
  }

  /**
   * 生成缩略图 (客户端压缩)
   */
  async generateThumbnail(file, maxWidth = 400, maxHeight = 300) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // 计算新尺寸
        let { width, height } = img;
        
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // 绘制缩略图
        ctx.drawImage(img, 0, 0, width, height);

        // 转换为Blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('生成缩略图失败'));
            }
          },
          'image/jpeg',
          0.8 // 80% 质量
        );
      };

      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * 上传缩略图
   */
  async uploadThumbnail(originalFile, userId) {
    try {
      const thumbnailBlob = await this.generateThumbnail(originalFile);
      const fileName = this.generateFileName(originalFile.name, userId);
      const filePath = `thumbnails/${fileName}`;

      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(filePath, thumbnailBlob, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      return {
        path: filePath,
        url: urlData.publicUrl
      };

    } catch (error) {
      console.error('上传缩略图失败:', error);
      throw error;
    }
  }

  /**
   * 完整的文件上传流程
   */
  async uploadArtwork(file, userId) {
    try {
      console.log('开始上传作品文件...');

      // 1. 上传原始文件
      const originalUpload = await this.uploadOriginal(file, userId);
      console.log('原始文件上传成功:', originalUpload.url);

      // 2. 生成并上传缩略图
      const thumbnailUpload = await this.uploadThumbnail(file, userId);
      console.log('缩略图上传成功:', thumbnailUpload.url);

      return {
        original: originalUpload,
        thumbnail: thumbnailUpload,
        metadata: {
          originalName: file.name,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('上传作品失败:', error);
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath) {
    try {
      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([filePath]);

      if (error) throw error;
      
      console.log('文件删除成功:', filePath);
      return true;

    } catch (error) {
      console.error('删除文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取文件的公共URL
   */
  getPublicUrl(filePath) {
    const { data } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);
    
    return data.publicUrl;
  }
}

// 导出单例实例
export const storageService = new StorageService();