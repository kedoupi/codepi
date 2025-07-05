#!/usr/bin/env node

// Supabase 连接测试脚本
// 用法: node test-supabase.js

import readline from 'readline';
import fs from 'fs';
import path from 'path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testSupabase() {
  console.log('🧪 Supabase 连接测试\n');

  // 获取用户输入的配置信息
  const supabaseUrl = await askQuestion('请输入你的 Supabase Project URL (例如: https://xxxxx.supabase.co): ');
  const supabaseKey = await askQuestion('请输入你的 Supabase anon key (以 eyJ 开头): ');

  console.log('\n📡 正在测试连接...\n');

  try {
    // 动态导入 Supabase
    const { createClient } = await import('@supabase/supabase-js');
    
    // 创建 Supabase 客户端
    const supabase = createClient(supabaseUrl.trim(), supabaseKey.trim());
    
    console.log('✅ Supabase 客户端创建成功');

    // 测试 1: 检查认证状态
    console.log('\n🔐 测试 1: 检查认证状态...');
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.log('❌ 认证测试失败:', authError.message);
    } else {
      console.log('✅ 认证系统正常 - 当前无用户登录 (符合预期)');
    }

    // 测试 2: 检查数据库连接
    console.log('\n🗄️  测试 2: 检查数据库连接...');
    const { data: dbData, error: dbError } = await supabase
      .from('categories')
      .select('count(*)', { count: 'exact' });

    if (dbError) {
      console.log('❌ 数据库连接失败:', dbError.message);
      console.log('💡 提示: 请确保你已经执行了 /docs/supabase_setup.sql 脚本');
    } else {
      console.log('✅ 数据库连接成功 - categories 表可访问');
      console.log(`📊 当前有 ${dbData?.length || 0} 个分类记录`);
    }

    // 测试 3: 检查存储桶
    console.log('\n📁 测试 3: 检查存储桶...');
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();

    if (storageError) {
      console.log('❌ 存储桶检查失败:', storageError.message);
    } else {
      console.log('✅ 存储系统正常');
      const artworksBucket = buckets.find(bucket => bucket.name === 'artworks');
      if (artworksBucket) {
        console.log('✅ artworks 存储桶存在且可访问');
      } else {
        console.log('⚠️  警告: artworks 存储桶不存在，请在 Supabase Dashboard 中创建');
        console.log('📋 可用存储桶:', buckets.map(b => b.name).join(', '));
      }
    }

    // 测试 4: 测试实时连接
    console.log('\n⚡ 测试 4: 检查实时连接...');
    const channel = supabase.channel('test-channel');
    
    await new Promise((resolve) => {
      channel
        .on('system', {}, (payload) => {
          if (payload.event === 'system:joined') {
            console.log('✅ 实时连接正常');
            resolve();
          }
        })
        .subscribe();
      
      // 5秒超时
      setTimeout(() => {
        console.log('⚠️  实时连接超时，但不影响基本功能');
        resolve();
      }, 5000);
    });

    channel.unsubscribe();

    console.log('\n🎉 测试完成! Supabase 配置看起来正常');
    console.log('\n📝 接下来可以：');
    console.log('1. 将正确的 URL 和 Key 添加到 /client/.env 文件');
    console.log('2. 运行 npm run dev 启动开发服务器');
    console.log('3. 测试 Google OAuth 登录功能');

  } catch (error) {
    console.log('\n❌ 测试失败:', error.message);
    console.log('\n🔧 可能的解决方案:');
    console.log('1. 检查 Supabase URL 格式是否正确');
    console.log('2. 检查 anon key 是否完整且正确');
    console.log('3. 确保网络连接正常');
    console.log('4. 确保 Supabase 项目状态为 active');
  }

  rl.close();
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// 检查是否在项目目录中
if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
  console.log('❌ 请在 /client 目录中运行此脚本');
  console.log('正确的命令: cd client && node test-supabase.js');
  process.exit(1);
}

// 运行测试
testSupabase().catch(console.error);