#!/usr/bin/env node
/**
 * push-upload.mjs — 用内存版「迷你 GitHub API」验证核心写流程：
 *  github_push_files（多文件一次提交）与 github_upload_project
 *  （建仓 → 推送 → 开 PR 一键流程，对应验收标准 2）。
 *
 * 用法: node --import ./tests/register-loader.mjs tests/push-upload.mjs
 */

import { buildTools } from '../lib/tools.js'
import { resolveToken } from '../lib/auth.js'

let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures += 1; console.log(`  ❌ FAIL: ${label}`) }
}

/**
 * 迷你 GitHub API（覆盖本插件用到的端点）。
 * 状态：repos / refs / blobs / trees / commits / pulls。
 */
function fakeGithub() {
  const repos = new Map()      // "owner/repo" -> { default_branch, html_url, ... }
  const refs = new Map()       // "owner/repo#refs/heads/x" -> sha
  const blobs = new Map()      // sha -> content
  const trees = new Map()      // sha -> entries
  const commits = new Map()    // sha -> { tree, parents, message }
  const pulls = []             // { number, title, head, base, html_url }
  const url = new URL('https://api.github.com')

  async function request(method, path, opts = {}) {
    url.pathname = path
    url.search = ''
    if (opts.query) for (const [k, v] of Object.entries(opts.query)) if (v !== void 0 && v !== null && v !== '') url.searchParams.set(k, String(v))
    const segments = path.split('/').filter(Boolean)
    const body = opts.body ?? {}
    const fail = (status, message) => { const e = new Error(message); e.status = status; throw e }

    // GET /user
    if (method === 'GET' && path === '/user') return { data: { login: 'octocat', name: 'Octo Cat', html_url: 'https://github.com/octocat', public_repos: 1, followers: 1, following: 1 } }

    // GET/POST repos
    if (path === '/user/repos' && method === 'POST') {
      const key = `octocat/${body.name}`
      const repo = { name: body.name, full_name: key, owner: { login: 'octocat' }, html_url: `https://github.com/${key}`, default_branch: 'main', private: body.private ?? true, description: body.description }
      repos.set(key, repo)
      return { data: repo }
    }
    // GET /repos/{o}/{r}
    if (method === 'GET' && segments.length === 3 && segments[0] === 'repos') {
      const key = `${segments[1]}/${segments[2]}`
      const repo = repos.get(key)
      if (!repo) fail(404, 'Not Found')
      return { data: repo }
    }
    // refs（GET/PATCH 需要 heads/...；POST 用 body.ref）
    const refHeadMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/)
    if (refHeadMatch) {
      const key = `${refHeadMatch[1]}/${refHeadMatch[2]}#refs/heads/${decodeURIComponent(refHeadMatch[3])}`
      if (method === 'GET') {
        // 与真实 GitHub 一致：仓库尚无任何 ref（空仓库）时返回 409，而非 404
        const repoKey = `${refHeadMatch[1]}/${refHeadMatch[2]}`
        const hasAnyRef = [...refs.keys()].some((k) => k.startsWith(`${repoKey}#`))
        if (!hasAnyRef) fail(409, 'Git Repository is empty.')
        const sha = refs.get(key)
        if (!sha) fail(404, 'Not Found')
        return { data: { object: { sha, type: 'commit' } } }
      }
      if (method === 'PATCH') { refs.set(key, body.sha); return { data: { ref: key.split('#')[1], object: { sha: body.sha } } } }
      if (method === 'POST') { refs.set(key, body.sha); return { data: { ref: body.ref, object: { sha: body.sha } } } }
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      const match = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/)
      const key = `${match[1]}/${match[2]}#${body.ref}`
      refs.set(key, body.sha)
      return { data: { ref: body.ref, object: { sha: body.sha } } }
    }
    // blobs（空仓库时与真实 GitHub 一致返回 409）
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      const repoKey = `${segments[1]}/${segments[2]}`
      const hasAnyRef = [...refs.keys()].some((k) => k.startsWith(`${repoKey}#`))
      if (!hasAnyRef) fail(409, 'Git Repository is empty.')
      const sha = `blob-${blobs.size + 1}`
      blobs.set(sha, body.content)
      return { data: { sha } }
    }
    // PUT contents/{path} — 空仓库播种（创建首个提交与默认分支 ref）
    const contentsPut = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)
    if (method === 'PUT' && contentsPut) {
      const repoKey = `${contentsPut[1]}/${contentsPut[2]}`
      const filePath = decodeURIComponent(contentsPut[3])
      const branch = body.branch ?? 'main'
      const blobSha = `blob-${blobs.size + 1}`
      blobs.set(blobSha, body.content)
      const treeSha = `tree-${trees.size + 1}`
      trees.set(treeSha, [{ path: filePath, mode: '100644', type: 'blob', sha: blobSha }])
      const commitSha = `commit-${commits.size + 1}`
      commits.set(commitSha, { message: body.message, tree: treeSha, parents: [] })
      refs.set(`${repoKey}#refs/heads/${branch}`, commitSha)
      return { data: { commit: { sha: commitSha, tree: { sha: treeSha } }, content: { sha: blobSha, path: filePath } } }
    }
    // GET /git/commits/{sha}
    const commitGet = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/(.+)$/)
    if (method === 'GET' && commitGet) {
      const sha = decodeURIComponent(commitGet[3])
      const commit = commits.get(sha)
      if (!commit) fail(404, 'Not Found')
      return { data: { sha, tree: { sha: commit.tree } } }
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      const sha = `tree-${trees.size + 1}`
      trees.set(sha, body.tree)
      return { data: { sha } }
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      const sha = `commit-${commits.size + 1}`
      commits.set(sha, { message: body.message, tree: body.tree, parents: body.parents ?? [] })
      return { data: { sha } }
    }
    // pulls
    if (method === 'POST' && path.endsWith('/pulls')) {
      const number = pulls.length + 1
      const pr = { number, title: body.title, head: body.head, base: body.base, html_url: `https://github.com/octocat/repo/pull/${number}`, state: 'open' }
      pulls.push(pr)
      return { data: pr }
    }
    fail(404, `unhandled: ${method} ${path}`)
  }

  /** 预置一个仓库（默认分支 main、无提交）。 */
  function seed(name) {
    const key = `octocat/${name}`
    repos.set(key, { name, full_name: key, owner: { login: 'octocat' }, html_url: `https://github.com/${key}`, default_branch: 'main', private: true })
    return key
  }

  return { request, seed }
}

async function main() {
  console.log('===== github_push_files：多文件一次提交 =====')
  {
    const api = fakeGithub()
    api.seed('demo')
    const tools = buildTools({ api, config: {}, state: {}, ctx: {} })
    const pushTool = tools.find((t) => t.name === 'github_push_files')
    const exec = { signal: void 0 }
    const result = await pushTool.execute({
      owner: 'octocat',
      repo: 'demo',
      branch: 'feature/x',
      message: 'add project',
      files: [
        { path: 'README.md', content: '# demo' },
        { path: 'src/index.js', content: 'console.log(1)' }
      ],
      force: false
    }, exec)
    assert(result.filesPushed === 2, `推送 ${result.filesPushed} 个文件`)
    assert(result.commitSha.startsWith('commit-'), `产生提交 ${result.commitSha}`)
    assert(result.branch === 'feature/x', `分支 ${result.branch}`)
    assert(result.commitUrl.startsWith('https://github.com/octocat/demo/commit/'), `提交 URL 正确（${result.commitUrl}）`)
  }

  console.log('\n===== github_upload_project：建仓 → 推送 → 开 PR 一键流程 =====')
  {
    const api = fakeGithub()
    const tools = buildTools({ api, config: {}, state: {}, ctx: {} })
    const upload = tools.find((t) => t.name === 'github_upload_project')
    const exec = { signal: void 0 }
    const result = await upload.execute({
      owner: 'octocat',
      repo: 'my-app',
      description: 'my app',
      private: true,
      branch: 'main',
      files: [
        { path: 'README.md', content: '# my-app' },
        { path: 'package.json', content: '{}' }
      ],
      create_pull_request: true,
      pr_title: 'Upload my-app'
    }, exec)
    assert(result.repoCreated === true, `仓库自动创建（${result.repoCreated}）`)
    assert(result.filesPushed === 2, `推送 ${result.filesPushed} 个文件`)
    assert(result.pullRequest === null, 'main 分支直接推送，不建 PR（符合设计）')
  }

  console.log('\n===== github_upload_project：非默认分支 → 自动开 PR =====')
  {
    const api = fakeGithub()
    const tools = buildTools({ api, config: {}, state: {}, ctx: {} })
    const upload = tools.find((t) => t.name === 'github_upload_project')
    const exec = { signal: void 0 }
    const result = await upload.execute({
      owner: 'octocat',
      repo: 'my-app2',
      branch: 'feature/init',
      files: [{ path: 'README.md', content: '# hi' }],
      create_pull_request: true
    }, exec)
    assert(result.pullRequest !== null && result.pullRequest.number === 1, `自动创建 PR #${result.pullRequest?.number}`)
    assert(result.pullRequest.head === 'feature/init' && result.pullRequest.base === 'main', 'PR head/base 正确')
  }

  console.log('\n========================================')
  if (failures === 0) {
    console.log('✅ 推送与一键上传流程验证通过（含建仓、多文件提交、自动开 PR）。')
  } else {
    console.log(`❌ ${failures} 项断言失败`)
    process.exitCode = 1
  }
}

await main()
