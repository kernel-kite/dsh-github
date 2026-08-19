#!/usr/bin/env node
/**
 * validate-tools.mjs — 用 DSH 真实运行时校验插件工具定义
 *
 * 通过自定义 loader 把 @deepseek-ai/* 解析到本机 DSH Desktop 的 dsh-tools
 * 实际版本，然后：
 *  1. buildTools() 触发 defineTool 的 schema DSL 编译（违规会直接抛错）
 *  2. 断言 45 个工具、名称唯一且带 github_ 前缀
 *  3. 校验 output schema 属于受支持 JSON Schema 子集
 *  4. 校验 render / presentCall 可执行且永不抛错（展示层容忍任意输入）
 *  5. 用样例值对代表性工具做输出 schema 校验
 *
 * 用法: node --import ./tests/register-loader.mjs tests/validate-tools.mjs
 */

import { validateJsonSchemaValue, assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { buildTools, TOOL_COUNT } from '../lib/tools.js'

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures += 1; console.log(`  ❌ FAIL: ${label}`) }
}

// 工具构建只需要 api 的占位（schema 编译与 render 不触碰网络）
const runtime = { api: { request: async () => { throw new Error('not used') } }, config: {}, state: {}, ctx: {} }

console.log('===== 工具定义 schema 校验（defineTool 编译）=====')
const tools = buildTools(runtime)
assert(tools.length === TOOL_COUNT, `buildTools() 返回 ${tools.length} 个工具（期望 ${TOOL_COUNT}）`)

const names = tools.map((tool) => tool.name)
const unique = new Set(names).size === names.length
assert(unique, `工具名唯一（共 ${names.length} 个）`)
assert(names.every((n) => n.startsWith('github_')), '全部工具带 github_ 前缀')
assert(names.includes('github_get_me'), '含认证校验工具 github_get_me')
assert(names.includes('github_auth_login') && names.includes('github_auth_status'), '含 OAuth 登录/状态工具')
assert(names.includes('github_push_files') && names.includes('github_upload_project'), '含 push_files 与一键上传工具')
assert(names.includes('github_merge_pull_request') && names.includes('github_delete_repository'), '含危险工具（merge/delete）')

for (const tool of tools) {
  assertSupportedJsonSchema(tool.output.schema)
}

console.log('\n===== render / presentCall 可执行且不抛错 =====')
for (const tool of tools) {
  try {
    const rendered = tool.output.render({}, {})
    const ok = Array.isArray(rendered) && rendered.every((block) => block?.type === 'text' && typeof block.text === 'string')
    assert(ok, `${tool.name}: render 输出内容块`)
  } catch (error) {
    assert(false, `${tool.name}: render 抛错 ${error.message}`)
  }
  try {
    // presentCall 在必填参数缺失时（validate 失败）按设计返回 undefined；
    // runtime 只会用合法参数调用。这里断言：不抛错，且要么 undefined、
    // 要么是合法的 generic 卡片。
    const pc = tool.presentCall({})
    const ok = pc === void 0 || (pc && pc.card === 'generic' && typeof pc.title === 'string')
    assert(ok, `${tool.name}: presentCall 有效`)
  } catch (error) {
    assert(false, `${tool.name}: presentCall 抛错 ${error.message}`)
  }
}

console.log('\n===== 代表性工具输出 schema 校验 =====')
{
  const tool = tools.find((t) => t.name === 'github_auth_status')
  const value = { configured: true, source: 'env', valid: true, username: 'octocat', user: { login: 'octocat' }, error: null, deviceFlow: null }
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'github_auth_status')
  assert(violations.length === 0, 'github_auth_status: 输出通过 schema 校验')
}
{
  const tool = tools.find((t) => t.name === 'github_push_files')
  const value = { owner: 'o', repo: 'r', branch: 'main', commitSha: 'a'.repeat(40), commitUrl: 'https://github.com/o/r/commit/aaa', filesPushed: 2, forced: false, text: 'ok' }
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'github_push_files')
  assert(violations.length === 0, 'github_push_files: 输出通过 schema 校验')
}
{
  const tool = tools.find((t) => t.name === 'github_get_file_contents')
  const value = { type: 'file', path: 'README.md', content: 'hi', sha: 'x', size: 2, entries: null, text: 'file' }
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'github_get_file_contents')
  assert(violations.length === 0, 'github_get_file_contents: 输出通过 schema 校验')
}
{
  const tool = tools.find((t) => t.name === 'github_upload_project')
  const value = { owner: 'o', repo: 'r', repoCreated: true, repoUrl: 'https://github.com/o/r', branch: 'main', commitSha: 'a'.repeat(40), commitUrl: 'https://github.com/o/r/commit/a', filesPushed: 1, pullRequest: null, text: 'ok' }
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'github_upload_project')
  assert(violations.length === 0, 'github_upload_project: 输出通过 schema 校验')
}

console.log('\n========================================')
if (failures === 0) {
  console.log('✅ 全部工具定义通过 DSH 真实运行时的 schema/展示层校验。')
} else {
  console.log(`❌ ${failures} 项断言失败`)
  process.exitCode = 1
}
