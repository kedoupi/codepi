-- 本地/测试用合成设置。生产环境必须用真实设备标识替换 subject_device_ids，
-- 该值只能由获授权的部署步骤写入，源码与仓库不保存真实设备名或标识。
INSERT OR REPLACE INTO settings (id, subject_device_ids, app_categories, updated_at)
VALUES (
  'default',
  '["dev-a"]',
  '{"示例编辑器":"开发","示例沟通":"沟通","示例文档":"文档","示例浏览器":"浏览"}',
  '2026-11-03T00:00:00.000Z'
);
