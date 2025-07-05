// 系统健康检查脚本
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://zukdgavwxpymqtgorofw.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1a2RnYXZ3eHB5bXF0Z29yb2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2OTU1NzcsImV4cCI6MjA2NzI3MTU3N30.Tbad_NVUTas9GCLhkw_2DoB9NiZnsBNPt0oWfiS2RWk';

async function healthCheck() {
  console.log('🏥 KDP.Cool 系统健康检查\\n');
  
  let allChecksPass = true;
  const results = [];

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. 检查 Supabase 连接
    console.log('🔗 检查 Supabase 连接...');
    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (!authError) {
        console.log('✅ Supabase 连接正常');
        results.push({ check: 'Supabase 连接', status: 'pass' });
      } else {
        throw authError;
      }
    } catch (error) {
      console.log('❌ Supabase 连接失败:', error.message);
      results.push({ check: 'Supabase 连接', status: 'fail', error: error.message });
      allChecksPass = false;
    }

    // 2. 检查数据库表
    console.log('\\n🗄️ 检查数据库表...');
    const requiredTables = ['profiles', 'artworks', 'categories', 'favorites'];
    
    for (const table of requiredTables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (!error) {
          console.log(`✅ 表 ${table} 正常`);
          results.push({ check: `表 ${table}`, status: 'pass' });
        } else {
          throw error;
        }
      } catch (error) {
        console.log(`❌ 表 ${table} 检查失败:`, error.message);
        results.push({ check: `表 ${table}`, status: 'fail', error: error.message });
        allChecksPass = false;
      }
    }

    // 3. 检查存储桶
    console.log('\\n📁 检查存储桶...');
    try {
      const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
      
      if (!storageError) {
        const artworksBucket = buckets.find(bucket => bucket.name === 'artworks');
        if (artworksBucket) {
          console.log('✅ artworks 存储桶正常');
          results.push({ check: 'artworks 存储桶', status: 'pass' });
        } else {
          console.log('❌ artworks 存储桶不存在');
          results.push({ check: 'artworks 存储桶', status: 'fail', error: '存储桶不存在' });
          allChecksPass = false;
        }
      } else {
        throw storageError;
      }
    } catch (error) {
      console.log('❌ 存储系统检查失败:', error.message);
      results.push({ check: '存储系统', status: 'fail', error: error.message });
      allChecksPass = false;
    }

    // 4. 检查分类数据
    console.log('\\n📂 检查基础数据...');
    try {
      const { data: categories, error: catError } = await supabase
        .from('categories')
        .select('*');
      
      if (!catError && categories.length > 0) {
        console.log(`✅ 分类数据正常 (${categories.length} 个分类)`);
        results.push({ check: '分类数据', status: 'pass', data: `${categories.length} 个分类` });
      } else {
        console.log('⚠️  分类数据为空，建议运行初始化脚本');
        results.push({ check: '分类数据', status: 'warning', error: '数据为空' });
      }
    } catch (error) {
      console.log('❌ 分类数据检查失败:', error.message);
      results.push({ check: '分类数据', status: 'fail', error: error.message });
      allChecksPass = false;
    }

    // 5. 检查环境变量
    console.log('\\n🔧 检查环境配置...');
    const envVars = [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY'
    ];
    
    for (const envVar of envVars) {
      if (process.env[envVar] || (envVar === 'VITE_SUPABASE_URL' && supabaseUrl) || (envVar === 'VITE_SUPABASE_ANON_KEY' && supabaseKey)) {
        console.log(`✅ ${envVar} 已配置`);
        results.push({ check: envVar, status: 'pass' });
      } else {
        console.log(`❌ ${envVar} 未配置`);
        results.push({ check: envVar, status: 'fail', error: '环境变量未配置' });
        allChecksPass = false;
      }
    }

    // 输出总结
    console.log('\\n📊 健康检查总结:');
    console.log('==================');
    
    const passCount = results.filter(r => r.status === 'pass').length;
    const failCount = results.filter(r => r.status === 'fail').length;
    const warnCount = results.filter(r => r.status === 'warning').length;
    
    console.log(`✅ 通过: ${passCount}`);
    console.log(`❌ 失败: ${failCount}`);
    console.log(`⚠️  警告: ${warnCount}`);
    
    if (allChecksPass) {
      console.log('\\n🎉 系统状态良好，可以正常使用！');
    } else {
      console.log('\\n⚠️  发现问题，请根据上述信息进行修复');
      console.log('\\n💡 修复建议:');
      console.log('   1. 确保 Supabase 项目已正确配置');
      console.log('   2. 执行数据库设置脚本: node setup-database.js');
      console.log('   3. 检查环境变量配置');
      console.log('   4. 确保存储桶已创建并设置为公开访问');
    }

  } catch (error) {
    console.log('\\n❌ 健康检查失败:', error.message);
    allChecksPass = false;
  }

  process.exit(allChecksPass ? 0 : 1);
}

healthCheck();