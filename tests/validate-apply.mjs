#!/usr/bin/env node
/**
 * validate-apply.mjs — 用 mock Context 验证插件的 apply() 生命周期
 *
 * 校验 apply(ctx) 能正确完成：
 *  1. 注册 45 个 github_* 工具
 *  2. 注册 tools/pre-execute 审批门（dangerous → ask）
 *  3. 注册 systemPrompt 引导段
 *  4. dispose 时安全停止 Device Flow 轮询
 *
 * 用法: node --import ./tests/register-loader.mjs tests/validate-apply.mjs
 */

import { apply } from '../index.js'

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures += 1; console.log(`  ❌ FAIL: ${label}`) }
}

function makeCtx() {
  const registeredTools = []
  const sections = []
  const listeners = {}
  const ctx = {
    get: (key) => (key === 'credentials' ? {
      resolve: async (ref) => ({ value: 'ghp_fake_token', source: 'file' }),
      set: async () => {},
      unset: async () => {}
    } : void 0),
    on: (event, fn) => { (listeners[event] ??= []).push(fn) },
    tools: { register: (tool) => registeredTools.push(tool) },
    systemPrompt: { section: (section) => sections.push(section) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  }
  return { ctx, registeredTools, sections, listeners }
}

console.log('===== apply() 生命周期 =====')
{
  const { ctx, registeredTools, sections, listeners } = makeCtx()
  apply(ctx, {})

  assert(registeredTools.length === 45, `ctx.tools.register 注册 ${registeredTools.length} 个工具`)
  assert(registeredTools.every((tool) => typeof tool.name === 'string' && tool.name.startsWith('github_')), '工具名全部 github_ 前缀')
  assert(typeof listeners['tools/pre-execute']?.[0] === 'function', '已注册 tools/pre-execute 审批门')
  assert(sections.some((s) => s.name === 'tool:github'), '已注册 systemPrompt 引导段')

  // ── 审批门行为 ──
  const gate = listeners['tools/pre-execute'][0]
  let nextCalled = 0
  const next = () => { nextCalled += 1; return 'passed' }

  const danger = gate({ name: 'github_merge_pull_request', arguments: { owner: 'o', repo: 'r', pull_number: 7 } }, next)
  assert(danger.kind === 'ask' && danger.reason.includes('合并 PR'), 'merge PR → ask（含理由）')

  const danger2 = gate({ name: 'github_push_files', arguments: { owner: 'o', repo: 'r', branch: 'main', files: [{ path: 'a', content: 'b' }], force: true } }, next)
  assert(danger2.kind === 'ask' && danger2.reason.includes('强制推送'), 'force push → ask')

  const danger3 = gate({ name: 'github_update_issue', arguments: { owner: 'o', repo: 'r', issue_number: 1, state: 'closed' } }, next)
  assert(danger3.kind === 'ask' && danger3.reason.includes('关闭 issue'), '关闭 issue → ask')

  const danger4 = gate({ name: 'github_delete_repository', arguments: { owner: 'o', repo: 'r' } }, next)
  assert(danger4.kind === 'ask', '删除仓库 → ask')

  const safe = gate({ name: 'github_create_issue', arguments: { owner: 'o', repo: 'r', title: 't' } }, next)
  assert(safe === 'passed' && nextCalled === 1, 'create_issue → 直接放行')

  const safePush = gate({ name: 'github_push_files', arguments: { owner: 'o', repo: 'r', branch: 'main', files: [{ path: 'a', content: 'b' }], force: false } }, next)
  assert(safePush === 'passed' && nextCalled === 2, 'push_files(非 force) → 直接放行')

  const other = gate({ name: 'read', arguments: {} }, next)
  assert(other === 'passed' && nextCalled === 3, '非 github_* 工具不受影响')
}

console.log('\n===== approvalGate: false 关闭审批门 =====')
{
  const { ctx, listeners } = makeCtx()
  apply(ctx, { approvalGate: false })
  const gates = listeners['tools/pre-execute'] ?? []
  assert(gates.length === 0, 'approvalGate:false 时不注册审批门')
}

console.log('\n===== dispose 清理 =====')
{
  const { ctx } = makeCtx()
  let disposeCb = null
  const origOn = ctx.on.bind(ctx)
  ctx.on = (event, fn) => { if (event === 'dispose') disposeCb = fn; origOn(event, fn) }
  apply(ctx, {})
  assert(typeof disposeCb === 'function', '已注册 dispose 回调')
  try { disposeCb(); assert(true, 'dispose 无异常（无 pendingFlow）') } catch (error) { assert(false, `dispose 抛错 ${error.message}`) }
}

console.log('\n========================================')
if (failures === 0) {
  console.log('✅ apply() 生命周期与审批门行为验证通过。')
} else {
  console.log(`❌ ${failures} 项断言失败`)
  process.exitCode = 1
}
