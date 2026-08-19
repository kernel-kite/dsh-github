/**
 * 搜索类工具：仓库 / 代码 / issue / PR / 用户。
 * 全部走 GitHub Search API（/search/*）。
 *
 * @module dsh-github/tools/search
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, presentCall, truncate } from "../format.js";
import { e, i, s } from "./common.js";

export function buildSearchTools(runtime) {
	const { api } = runtime;

	/** 通用搜索执行：path、query 构造、结果整形。 */
	const runSearch = async (path, q, perPage, sort, order) => {
		const query = {
			q,
			...(perPage ? { per_page: perPage } : {}),
			...(sort ? { sort } : {}),
			...(order ? { order } : {})
		};
		const { data } = await api.request("GET", path, { query });
		return {
			totalCount: data.total_count ?? 0,
			items: data.items ?? [],
			text: `共 ${data.total_count ?? 0} 条结果：\n` + (data.items ?? []).map((item, index) => `- ${index + 1}. ${item.full_name ?? item.path ?? item.login ?? item.title ?? "?"}（${item.html_url ?? ""}）`).join("\n")
		};
	};

	return [
		defineTool({
			name: "github_search_repositories",
			description: "搜索 GitHub 仓库（按名称/描述/语言/星标等，GitHub 搜索语法，如 `topic:ml language:python stars:>100`）。",
			parameters: {
				q: s("搜索查询（支持 GitHub qualifier 语法）", true),
				per_page: i("每页数量（默认 10，最大 100）"),
				sort: e("排序", ["stars", "forks", "help-wanted-issues", "updated"]),
				order: e("方向", ["asc", "desc"])
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalCount: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 搜索仓库「${args.q}」`),
			execute: (args) => runSearch("/search/repositories", args.q, args.per_page ?? 10, args.sort, args.order)
		}),

		defineTool({
			name: "github_search_code",
			description: "在代码中搜索（需要认证，且只覆盖已索引的公开/你有权限的代码）。查询建议带 repo: 限定范围。",
			parameters: {
				q: s("代码搜索查询（建议带 repo:user/repo 或 language: 限定）", true),
				per_page: i("每页数量（默认 10，最大 100）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalCount: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 搜索代码「${args.q}」`),
			execute: (args) => runSearch("/search/code", args.q, args.per_page ?? 10)
		}),

		defineTool({
			name: "github_search_issues",
			description: "搜索 issues 与 PR（GitHub 语法，如 `repo:owner/repo is:issue label:bug`）。",
			parameters: {
				q: s("搜索查询（支持 qualifier 语法）", true),
				per_page: i("每页数量（默认 10，最大 100）"),
				sort: e("排序", ["comments", "reactions", "reactions-+1", "created", "updated"]),
				order: e("方向", ["asc", "desc"])
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalCount: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 搜索 issue「${args.q}」`),
			execute: (args) => runSearch("/search/issues", args.q, args.per_page ?? 10, args.sort, args.order)
		}),

		defineTool({
			name: "github_search_pull_requests",
			description: "搜索 Pull Requests（自动附加 is:pr，等价于 search_issues 的 PR 视图）。",
			parameters: {
				q: s("搜索查询（支持 qualifier 语法）", true),
				per_page: i("每页数量（默认 10，最大 100）"),
				sort: e("排序", ["comments", "reactions", "created", "updated"]),
				order: e("方向", ["asc", "desc"])
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalCount: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 搜索 PR「${args.q}」`),
			execute: (args) => runSearch("/search/issues", `${args.q} is:pr`, args.per_page ?? 10, args.sort, args.order)
		}),

		defineTool({
			name: "github_search_users",
			description: "搜索 GitHub 用户（按用户名/全名/组织等）。",
			parameters: {
				q: s("搜索查询（如 `language:python location:beijing`）", true),
				per_page: i("每页数量（默认 10，最大 100）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalCount: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 搜索用户「${args.q}」`),
			execute: (args) => runSearch("/search/users", args.q, args.per_page ?? 10)
		})
	];
}
