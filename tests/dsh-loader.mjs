/**
 * dsh-loader.mjs — 测试专用 ESM loader
 *
 * 把 `@deepseek-ai/*`（以及运行时顶层依赖）映射到从新版 DSH 的
 * `resources/app.asar` 中提取出来的 node_modules（见 tests/asar-extract.mjs），
 * 使测试用真实版本的 dsh-tools 校验插件。仅用于测试，不随插件分发。
 *
 * 解析规则：优先在提取的运行时里查找（含子路径与 package.json），
 * 找不到再交给默认 loader。
 */

import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const RUNTIME_ROOT = 'D:/deepseek harness 插件编写/.dsh-runtime/node_modules/'

function runtimePath(specifier) {
  // specifier 形如 '@deepseek-ai/dsh-tools'、'@deepseek-ai/dsh-tools/package.json'、'cosmokit'
  const parts = specifier.split('/')
  const scoped = specifier.startsWith('@')
  const pkgName = scoped ? `${parts[0]}/${parts[1]}` : parts[0]
  const sub = scoped ? parts.slice(2).join('/') : parts.slice(1).join('/')
  const pkgDir = `${RUNTIME_ROOT}${pkgName}`
  if (!existsSync(`${pkgDir}/package.json`)) return null

  if (sub === '') {
    // 包主入口
    let main = 'lib/index.js'
    try {
      const pkg = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8'))
      if (pkg.main) main = pkg.main
    } catch { /* keep default */ }
    const candidates = [
      `${pkgDir}/${main}`,
      `${pkgDir}/lib/index.js`,
      `${pkgDir}/index.js`
    ]
    return candidates.find((c) => existsSync(c)) ?? null
  }
  const candidates = [
    `${pkgDir}/${sub}`,
    `${pkgDir}/${sub}.js`,
    `${pkgDir}/lib/${sub}`,
    `${pkgDir}/lib/${sub}.js`,
    `${pkgDir}/lib/${sub}/index.js`
  ]
  return candidates.find((c) => existsSync(c)) ?? null
}

export async function resolve(specifier, context, nextResolve) {
  // 相对路径/绝对路径/URL/内建模块交给默认 loader
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:') || specifier.startsWith('node:')) {
    return nextResolve(specifier, context)
  }
  const target = runtimePath(specifier)
  if (target) {
    return { url: pathToFileURL(target).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
