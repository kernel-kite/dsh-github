/**
 * 提交类工具：列表 / 详情。
 *
 * @module dsh-github/tools/commits
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, renderCommit, presentCall, truncate } from "../format.js";
import { i, s, resolveOwner, enc } from "./common.js";

export function buildCommitTools(runtime) {
	const { api } = runtime;

	return [
		defineTool({
			name: "github_list_commits",
			description: "列出分支/提交历史（可按分支或路径过滤）。查看最近改动时使用。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				sha: s("分支名或提交 SHA（缺省为默认分支）"),
				path: s("只列该路径相关的提交"),
				author: s("只列该作者（登录名）的提交"),
				per_page: i("每页数量（默认 30）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						count: { type: "integer", required: true },
						items: { type: "array", items: { type: "object", additionalProperties: true }, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 提交历史 ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/commits`, {
					query: { sha: args.sha, path: args.path, author: args.author, per_page: args.per_page ?? 30 }
				});
				const text = `共 ${data.length} 条：\n` + data.map((commit) => {
					const message = (commit.commit?.message ?? "").split("\n")[0];
					return `- ${commit.sha?.slice(0, 7)} ${message}（${commit.commit?.author?.name ?? commit.author?.login ?? "?"}）`;
				}).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_get_commit",
			description: "查询单个提交的完整信息（提交信息、作者、改动的文件列表与增删行数、父提交）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				ref: s("提交 SHA、分支名或标签名", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						commit: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 提交 ${args.ref.slice(0, 10)}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/commits/${enc(args.ref)}`);
				const files = Array.isArray(data.files) ? data.files : [];
				const text = [
					renderCommit(data),
					`改动：+${data.stats?.additions ?? "?"} / -${data.stats?.deletions ?? "?"}，共 ${files.length} 个文件：`,
					...files.map((file) => `- ${file.status} ${file.filename}（+${file.additions ?? 0}/-${file.deletions ?? 0}）`)
				].join("\n");
				return { commit: data, text };
			}
		})
	];
}
