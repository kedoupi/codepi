// 快速Supabase连接测试
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zukdgavwxpymqtgorofw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1a2RnYXZ3eHB5bXF0Z29yb2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2OTU1NzcsImV4cCI6MjA2NzI3MTU3N30.Tbad_NVUTas9GCLhkw_2DoB9NiZnsBNPt0oWfiS2RWk';

async function quickTest() {
  console.log('🧪 Supabase 快速连接测试\n');

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase 客户端创建成功');

    // 测试认证
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError) {
      console.log('❌ 认证测试失败:', authError.message);
    } else {
      console.log('✅ 认证系统正常');
    }

    // 测试数据库连接 - 先测试是否有categories表
    console.log('\n🗄️  测试数据库连接...');
    const { data: dbData, error: dbError } = await supabase
      .from('categories')
      .select('*')
      .limit(5);

    if (dbError) {
      console.log('❌ 数据库连接失败:', dbError.message);
      if (dbError.code === '42P01') {
        console.log('💡 提示: categories 表不存在，需要执行数据库设置脚本');
        console.log('📋 请在Supabase Dashboard的SQL Editor中执行 /docs/supabase_setup.sql');
      }
    } else {
      console.log('✅ 数据库连接成功');
      console.log(`📊 categories表有 ${dbData.length} 条记录`);
      if (dbData.length > 0) {
        console.log('📋 样例分类:', dbData.map(c => c.name).join(', '));
      }
    }

    // 测试存储桶
    console.log('\n📁 测试存储桶...');
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();

    if (storageError) {
      console.log('❌ 存储桶检查失败:', storageError.message);
    } else {
      console.log('✅ 存储系统正常');
      const artworksBucket = buckets.find(bucket => bucket.name === 'artworks');
      if (artworksBucket) {
        console.log('✅ artworks 存储桶存在');
      } else {
        console.log('⚠️  artworks 存储桶不存在');
        console.log('📋 当前存储桶:', buckets.map(b => b.name).join(', ') || '无');
      }
    }

    console.log('\n🎉 测试完成!');

  } catch (error) {
    console.log('\n❌ 测试失败:', error.message);
  }
}

quickTest();