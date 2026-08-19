#!/usr/bin/env node
/**
 * approval-gate.mjs — 审批门分类的单元测试（classifyDanger）。
 *
 * 用法: node --import ./tests/register-loader.mjs tests/approval-gate.mjs
 */

import { classifyDanger, DANGEROUS_TOOLS } from '../lib/approval.js'

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures += 1; console.log(`  ❌ FAIL: ${label}`) }
}

console.log('===== 危险操作 → 需要审批 =====')
assert(classifyDanger('github_delete_repository', { owner: 'o', repo: 'r' })?.includes('删除仓库'), '删除仓库')
assert(classifyDanger('github_delete_file', { owner: 'o', repo: 'r', path: 'a.txt' })?.includes('删除文件'), '删除文件')
assert(classifyDanger('github_delete_branch', { owner: 'o', repo: 'r', branch: 'x' })?.includes('删除分支'), '删除分支')
assert(classifyDanger('github_merge_pull_request', { owner: 'o', repo: 'r', pull_number: 1 })?.includes('合并 PR'), '合并 PR')
assert(classifyDanger('github_push_files', { owner: 'o', repo: 'r', branch: 'main', files: [{}], force: true })?.includes('强制推送'), 'force push')
assert(classifyDanger('github_update_issue', { owner: 'o', repo: 'r', issue_number: 1, state: 'closed' })?.includes('关闭 issue'), '关闭 issue')
assert(classifyDanger('github_update_pull_request', { owner: 'o', repo: 'r', pull_number: 2, state: 'closed' })?.includes('关闭 PR'), '关闭 PR（不合并）')

console.log('\n===== 常规操作 → 放行 =====')
assert(classifyDanger('github_push_files', { owner: 'o', repo: 'r', branch: 'main', files: [{}], force: false }) === null, 'push_files(非 force)')
assert(classifyDanger('github_update_issue', { owner: 'o', repo: 'r', issue_number: 1, state: 'open' }) === null, '重新打开 issue')
assert(classifyDanger('github_create_repository', { name: 'x' }) === null, '创建仓库')
assert(classifyDanger('github_create_issue', { title: 't' }) === null, '创建 issue')
assert(classifyDanger('github_create_or_update_file', {}) === null, '写文件')
assert(classifyDanger('github_upload_project', { repo: 'x', files: [{}] }) === null, '一键上传项目')
assert(classifyDanger('github_get_me', {}) === null, 'get_me')
assert(classifyDanger('read', {}) === null, '非 github 工具')

console.log('\n===== 边界：缺参时不误伤 =====')
assert(classifyDanger('github_push_files', { force: true })?.includes('强制推送'), 'force=true 但缺 files 仍拦截')
assert(classifyDanger('github_push_files', {}) === null, '无 force 参数 → 放行')
assert(classifyDanger('github_update_issue', { state: 'closed' })?.includes('关闭 issue'), 'state=closed 但缺编号仍拦截')

console.log(`\n危险工具清单（${DANGEROUS_TOOLS.length}）：${DANGEROUS_TOOLS.join(', ')}`)

console.log('\n========================================')
if (failures === 0) {
  console.log('✅ 审批门分类验证通过。')
} else {
  console.log(`❌ ${failures} 项断言失败`)
  process.exitCode = 1
}
