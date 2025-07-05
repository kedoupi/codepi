// 快速数据库设置脚本
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zukdgavwxpymqtgorofw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1a2RnYXZ3eHB5bXF0Z29yb2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2OTU1NzcsImV4cCI6MjA2NzI3MTU3N30.Tbad_NVUTas9GCLhkw_2DoB9NiZnsBNPt0oWfiS2RWk';

async function setupDatabase() {
  console.log('🚀 开始设置数据库...\n');

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. 创建示例分类数据
    console.log('📂 创建示例分类...');
    const categories = [
      { name: '插画', slug: 'illustration', description: '数字插画作品', sort_order: 1 },
      { name: '图标', slug: 'icons', description: '图标设计', sort_order: 2 },
      { name: '海报', slug: 'posters', description: '宣传海报设计', sort_order: 3 },
      { name: '背景', slug: 'backgrounds', description: '背景图案设计', sort_order: 4 },
      { name: '角色', slug: 'characters', description: '角色设计', sort_order: 5 },
      { name: '其他', slug: 'others', description: '其他类型作品', sort_order: 6 }
    ];

    for (const category of categories) {
      const { data, error } = await supabase
        .from('categories')
        .upsert(category, { onConflict: 'slug' });
      
      if (error) {
        console.log(`❌ 创建分类 "${category.name}" 失败:`, error.message);
      } else {
        console.log(`✅ 创建分类 "${category.name}" 成功`);
      }
    }

    console.log('\n🎉 数据库设置完成！');
    console.log('💡 现在您可以开始使用系统了');

  } catch (error) {
    console.log('\n❌ 设置失败:', error.message);
    console.log('💡 请确保：');
    console.log('   1. Supabase项目已创建');
    console.log('   2. 数据库表已通过SQL Editor创建');
    console.log('   3. 存储桶已创建');
  }
}

setupDatabase();