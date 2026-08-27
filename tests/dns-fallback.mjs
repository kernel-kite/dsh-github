#!/usr/bin/env node
/**
 * dns-fallback.mjs — 客户端 DNS 韧性专项测试：
 *  1. 单测：系统解析（hosts）把域名指向 127.0.0.1 时，lookup 回退 dns.resolve4；
 *  2. 端到端：强制走回退路径，仍能连接真实 GitHub API（模拟 hosts 被改坏场景）。
 *
 * 用法: node --import ./tests/register-loader.mjs tests/dns-fallback.mjs
 */

import { readFileSync } from 'node:fs'
import { createClient, createGithubLookup, createHttpsTransport } from '../lib/client.js'

// 从 credentials 文件读取 token（正则，避免依赖 yaml）
const credsLine = readFileSync('C:/Users/cwqjk/.dsh/.credentials.yaml', 'utf8')
  .split('\n')
  .find((l) => /^\s*GITHUB_TOKEN:/.test(l)) ?? ''
const token = credsLine.split(/:\s*/, 2)[1]?.trim() ?? ''

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures += 1; console.log(`  ❌ FAIL: ${label}`) }
}

console.log('===== 单测：lookup 回退逻辑 =====')
{
  const lookup = createGithubLookup({
    lookup: (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
    resolve4: (host, cb) => cb(null, ['203.0.113.7'])
  })
  const result = await new Promise((resolve) => lookup('api.github.com', {}, (err, address, family) => resolve({ err, address, family })))
  assert(result.address === '203.0.113.7' && result.family === 4, '系统解析 127.0.0.1 → 回退 resolve4 结果')
}
{
  // 系统解析正常时应直接用系统结果
  const lookup = createGithubLookup({
    lookup: (host, opts, cb) => cb(null, [{ address: '140.82.112.5', family: 4 }]),
    resolve4: () => { throw new Error('不应调用 resolve4') }
  })
  const result = await new Promise((resolve) => lookup('api.github.com', {}, (err, address) => resolve({ err, address })))
  assert(result.address === '140.82.112.5', '系统解析正常 → 直接用系统结果（不触发回退）')
}

console.log('\n===== 端到端：强制回退路径连接真实 GitHub =====')
{
  const client = createClient({
    resolveToken: async () => ({ token, source: 'file' }),
    timeoutMs: 20000,
    // 强制 lookup 返回 127.0.0.1 → 必须走 dns.resolve4 直查真实 IP
    transport: createHttpsTransport({
      timeoutMs: 20000,
      lookup: createGithubLookup({ lookup: (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) })
    })
  })
  try {
    const { data } = await client.request('GET', '/rate_limit')
    assert(data?.resources?.core?.limit > 0, `DNS 回退路径成功连接 GitHub API（rate limit ${data.resources.core.limit}）`)
  } catch (error) {
    assert(false, `DNS 回退路径连接失败：${error.message}`)
  }
}

console.log('\n===== 端到端：默认传输（系统解析）也能连 =====')
{
  const client = createClient({ resolveToken: async () => ({ token, source: 'file' }), timeoutMs: 20000 })
  try {
    const { data } = await client.request('GET', '/rate_limit')
    assert(data?.resources?.core?.limit > 0, `默认传输成功连接 GitHub API（rate limit ${data.resources.core.limit}）`)
  } catch (error) {
    assert(false, `默认传输连接失败：${error.message}`)
  }
}

console.log('\n========================================')
if (failures === 0) {
  console.log('✅ DNS 韧性验证通过：hosts 被指到 127.0.0.1 时插件仍可正常访问 GitHub。')
} else {
  console.log(`❌ ${failures} 项断言失败`)
  process.exitCode = 1
}
