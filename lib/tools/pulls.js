/**
 * PR 类工具：列表/查询/查看 diff/创建/更新/合并/评审（approve 等）。
 *
 * @module dsh-github/tools/pulls
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, renderPullRequest, presentCall, truncate } from "../format.js";
import { arr, b, e, i, s, resolveOwner, enc } from "./common.js";

export function buildPullTools(runtime) {
	const { api } = runtime;

	return [
		defineTool({
			name: "github_list_pull_requests",
			description: "列出仓库的 Pull Requests（可按状态/head/base 过滤）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				state: e("状态过滤", ["open", "closed", "all"]),
				head: s("head 过滤，格式 user:branch 或 branch"),
				base: s("base 分支名"),
				sort: e("排序字段", ["created", "updated", "popularity", "long-running"]),
				direction: e("排序方向", ["asc", "desc"]),
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
			presentCall: (args) => presentCall(`GitHub: 列出 PR（${args.state ?? "open"}）`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/pulls`, {
					query: {
						state: args.state,
						head: args.head,
						base: args.base,
						sort: args.sort,
						direction: args.direction,
						per_page: args.per_page ?? 30
					}
				});
				const text = `共 ${data.length} 条：\n` + data.map((pr) =>
					`- #${pr.number} [${pr.state}${pr.draft ? "/draft" : ""}] ${pr.title}（${pr.head?.ref} → ${pr.base?.ref}，@${pr.user?.login ?? "?"}）`
				).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_get_pull_request",
			description: "查询单个 PR 的详情（状态、可合并性、head/base、改动统计、审查要求等）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						pull: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: PR #${args.pull_number}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}`);
				const text = [
					renderPullRequest(data),
					...(data.additions !== void 0 ? [`改动：+${data.additions} / -${data.deletions}，共 ${data.changed_files} 个文件`] : []),
					...(data.mergeable !== void 0 ? [`可合并：${data.mergeable}`] : []),
					...(data.body ? [`\n${truncate(data.body, 4000)}`] : [])
				].join("\n");
				return { pull: data, text };
			}
		}),

		defineTool({
			name: "github_get_pull_request_diff",
			description: "获取 PR 的原始 diff（统一 diff 文本），用于评审代码改动。diff 可能很长，模型应聚焦关键文件。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						owner: { type: "string", required: true },
						repo: { type: "string", required: true },
						pull_number: { type: "integer", required: true },
						diff: { type: "string", required: true },
						url: { type: "string", required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: PR #${args.pull_number} diff`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { text: diff } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}`, {
					accept: "application/vnd.github.v3.diff",
					raw: true
				});
				const url = `https://github.com/${owner}/${args.repo}/pull/${args.pull_number}`;
				return {
					owner,
					repo: args.repo,
					pull_number: args.pull_number,
					diff,
					url,
					text: `PR #${args.pull_number} diff（${diff.length} 字符）：\n\n${truncate(diff, 12000)}`
				};
			}
		}),

		defineTool({
			name: "github_create_pull_request",
			description: "创建 Pull Request：head 为源分支（提交所在），base 为目标分支。推送代码后开 PR 时使用。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				title: s("PR 标题", true),
				head: s("源分支名（本仓库分支名，或 user:branch）", true),
				base: s("目标分支名（默认分支）", true),
				body: s("PR 正文（Markdown）"),
				draft: b("创建为 draft PR"),
				maintainer_can_modify: b("允许维护者修改")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						pull: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 创建 PR「${args.title}」`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					title: args.title,
					head: args.head,
					base: args.base,
					...(args.body ? { body: args.body } : {}),
					...(args.draft !== void 0 ? { draft: args.draft } : {}),
					...(args.maintainer_can_modify !== void 0 ? { maintainer_can_modify: args.maintainer_can_modify } : {})
				};
				const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/pulls`, { body });
				return { pull: data, text: `已创建 PR #${data.number}：${data.title}\n${data.html_url ?? ""}` };
			}
		}),

		defineTool({
			name: "github_update_pull_request",
			description: "更新 PR：改标题/正文/目标分支/状态/draft。把状态改为 closed（不合并直接关闭）属于危险操作（需审批）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true),
				title: s("新标题"),
				body: s("新正文"),
				state: e("目标状态（closed 需审批）", ["open", "closed"]),
				base: s("新的目标分支名"),
				draft: b("是否 draft")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						pull: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 更新 PR #${args.pull_number}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					...(args.title ? { title: args.title } : {}),
					...(args.body ? { body: args.body } : {}),
					...(args.state ? { state: args.state } : {}),
					...(args.base ? { base: args.base } : {}),
					...(args.draft !== void 0 ? { draft: args.draft } : {})
				};
				if (Object.keys(body).length === 0) throw new Error("至少提供一个要更新的字段（title/body/state/base/draft）");
				const { data } = await api.request("PATCH", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}`, { body });
				return { pull: data, text: `已更新 PR #${data.number}（状态：${data.state}）\n${data.html_url ?? ""}` };
			}
		}),

		defineTool({
			name: "github_merge_pull_request",
			description: "合并 Pull Request（默认 merge，可 squash/rebase）。危险操作：需要审批。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true),
				commit_title: s("合并提交标题（可选）"),
				commit_message: s("合并提交说明（可选）"),
				merge_method: e("合并方式", ["merge", "squash", "rebase"]),
				sha: s("要合并的 head SHA（可选，用于防竞态）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						merged: { type: "boolean", required: true },
						sha: { type: "string", required: true },
						message: { type: "string", required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 合并 PR #${args.pull_number}`, "danger"),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					...(args.commit_title ? { commit_title: args.commit_title } : {}),
					...(args.commit_message ? { commit_message: args.commit_message } : {}),
					...(args.merge_method ? { merge_method: args.merge_method } : {}),
					...(args.sha ? { sha: args.sha } : {})
				};
				const { data } = await api.request("PUT", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}/merge`, { body });
				const sha = data.sha ?? "";
				return {
					merged: data.merged === true,
					sha,
					message: data.message ?? "",
					text: `PR #${args.pull_number} 已合并（${args.merge_method ?? "merge"}）${sha ? `→ ${sha.slice(0, 7)}` : ""}\nhttps://github.com/${owner}/${args.repo}/pull/${args.pull_number}`
				};
			}
		}),

		defineTool({
			name: "github_get_pull_request_reviews",
			description: "列出 PR 上已有的 review（审批/请求修改/评论）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true)
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
			presentCall: (args) => presentCall(`GitHub: PR #${args.pull_number} reviews`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}/reviews`);
				const text = `共 ${data.length} 条 review：\n` + data.map((review) =>
					`- [${review.state ?? "?"}] ${review.user?.login ?? "?"}${review.submitted_at ? `（${review.submitted_at}）` : ""}${review.body ? `：${truncate(review.body, 200)}` : ""}`
				).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_submit_pull_request_review",
			description: "提交 PR review：APPROVE（批准）/ REQUEST_CHANGES（请求修改）/ COMMENT（仅评论）。评审代码后给出结论时使用。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				pull_number: i("PR 编号", true),
				event: e("评审结论", ["APPROVE", "REQUEST_CHANGES", "COMMENT"], true),
				body: s("评审意见（Markdown）"),
				commit_id: s("针对的提交 SHA（可选，默认最新）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						review: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 提交 review（${args.event}）`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					event: args.event,
					...(args.body ? { body: args.body } : {}),
					...(args.commit_id ? { commit_id: args.commit_id } : {})
				};
				const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/pulls/${args.pull_number}/reviews`, { body });
				return { review: data, text: `已提交 review（${args.event}）到 PR #${args.pull_number}${data.html_url ? `\n${data.html_url}` : ""}` };
			}
		})
	];
}
