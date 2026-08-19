# dsh-github 工具清单汇总

共 **45 个工具**，前缀 `github_`，全部走 GitHub REST API v3（`api.github.com`）。
分类与 opencode GitHub MCP 工具集对标。图标约定：🔒 = 危险操作（触发审批门），✅ = 常规放行。

## 认证类（4）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_get_me` | 校验 token 并返回当前用户（等价 opencode get_me） | ✅ |
| `github_auth_login` | OAuth Device Flow 登录：返回网址+用户码，后台轮询，token 自动持久化 | ✅ |
| `github_auth_status` | 认证状态：是否配置、来源、实时校验、当前用户、Device Flow 进度 | ✅ |
| `github_auth_logout` | 清除凭据 / 停止进行中的 Device Flow | ✅ |

## 仓库类（14）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_create_repository` | 创建仓库（个人或组织） | ✅ |
| `github_get_repository` | 查询仓库完整信息 | ✅ |
| `github_list_repositories` | 列出用户/组织仓库 | ✅ |
| `github_fork_repository` | Fork 仓库 | ✅ |
| `github_delete_repository` | 删除仓库（不可恢复） | 🔒 |
| `github_list_branches` | 列出全部分支 | ✅ |
| `github_create_branch` | 从默认/指定分支创建新分支 | ✅ |
| `github_delete_branch` | 删除分支 | 🔒 |
| `github_get_file_contents` | 读取文件内容 / 列目录 | ✅ |
| `github_create_or_update_file` | 创建/更新单个文件（自动解析 sha） | ✅ |
| `github_push_files` | 一次提交推送多文件（blob→tree→commit→ref；分支不存在自动创建） | ✅（`force: true` 时 🔒） |
| `github_delete_file` | 删除单个文件 | 🔒 |
| `github_list_tags` | 列出标签 | ✅ |
| `github_get_tag` | 查看标签详情（注解/轻量） | ✅ |

## Issue 类（5）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_list_issues` | 列出 issues（状态/标签/指派过滤） | ✅ |
| `github_get_issue` | 查询 issue 详情 | ✅ |
| `github_create_issue` | 创建 issue（标题/正文/标签/指派/里程碑） | ✅ |
| `github_update_issue` | 更新 issue（标题/正文/标签/指派/状态） | 🔒（`state: closed` 时） |
| `github_add_issue_comment` | 给 issue/PR 加评论 | ✅ |

## PR 类（8）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_list_pull_requests` | 列出 PR（状态/head/base 过滤） | ✅ |
| `github_get_pull_request` | 查询 PR 详情 | ✅ |
| `github_get_pull_request_diff` | 获取 PR 原始 diff | ✅ |
| `github_create_pull_request` | 创建 PR（head/base/标题/正文/draft） | ✅ |
| `github_update_pull_request` | 更新 PR（标题/正文/base/状态/draft） | 🔒（`state: closed` 时） |
| `github_merge_pull_request` | 合并 PR（merge/squash/rebase） | 🔒 |
| `github_get_pull_request_reviews` | 列出 PR 上的 review | ✅ |
| `github_submit_pull_request_review` | 提交 review（APPROVE/REQUEST_CHANGES/COMMENT） | ✅ |

## 提交类（2）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_list_commits` | 列出提交历史（分支/路径/作者过滤） | ✅ |
| `github_get_commit` | 查询单个提交（含文件改动明细） | ✅ |

## 搜索类（5）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_search_repositories` | 搜索仓库 | ✅ |
| `github_search_code` | 搜索代码（需认证） | ✅ |
| `github_search_issues` | 搜索 issues + PR | ✅ |
| `github_search_pull_requests` | 搜索 PR（自动附加 `is:pr`） | ✅ |
| `github_search_users` | 搜索用户 | ✅ |

## 版本类（3）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_list_releases` | 列出 Releases | ✅ |
| `github_get_latest_release` | 获取最新正式 Release | ✅ |
| `github_get_release_by_tag` | 按 tag 获取 Release | ✅ |

## 组织/用户类（3）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_get_authenticated_user` | 当前用户完整资料（plan/permissions 等原始字段） | ✅ |
| `github_list_organization_teams` | 列出组织团队 | ✅ |
| `github_get_team_members` | 列出团队成员 | ✅ |

## 工作流类（1）

| 工具 | 说明 | 权限 |
|---|---|---|
| `github_upload_project` | 一键上传项目：仓库不存在自动创建 → 推送多文件（一次提交）→ 自动开 PR | ✅ |

## 审批门规则（tools/pre-execute → ctx.approval）

触发审批（需用户批准才放行，拒绝/取消/无审批通道一律 fail closed）：

| 触发条件 | 审批理由示例 |
|---|---|
| `github_delete_repository` | 删除仓库 owner/repo |
| `github_delete_file` | 删除文件 path（owner/repo） |
| `github_delete_branch` | 删除分支 branch（owner/repo） |
| `github_merge_pull_request` | 合并 PR #n（owner/repo） |
| `github_push_files` + `force: true` | 强制推送 N 个文件到 branch |
| `github_update_issue` + `state: closed` | 关闭 issue #n |
| `github_update_pull_request` + `state: closed` | 关闭 PR #n（由同一规则族覆盖） |

其余所有读操作与常规写操作直接放行，不逐次弹审批。
