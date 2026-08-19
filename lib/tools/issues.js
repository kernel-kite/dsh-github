/**
 * Issue 类工具：列表/查询/创建/更新（状态、标签、指派）/评论。
 *
 * @module dsh-github/tools/issues
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, renderIssueLike, presentCall, truncate } from "../format.js";
import { arr, e, i, s, resolveOwner, enc } from "./common.js";

export function buildIssueTools(runtime) {
	const { api } = runtime;

	return [
		defineTool({
			name: "github_list_issues",
			description: "列出仓库的 issues（可过滤状态/标签/指派者，注意该接口也会返回 PR）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				state: e("状态过滤", ["open", "closed", "all"]),
				labels: s("逗号分隔的标签名，如 bug,urgent"),
				assignee: s("指派者登录名；传 none 查未指派"),
				creator: s("创建者登录名"),
				sort: e("排序字段", ["created", "updated", "comments"]),
				direction: e("排序方向", ["asc", "desc"]),
				per_page: i("每页数量（默认 30，最大 100）")
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
			presentCall: (args) => presentCall(`GitHub: 列出 issues（${args.state ?? "open"}）`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/issues`, {
					query: {
						state: args.state,
						labels: args.labels,
						assignee: args.assignee,
						creator: args.creator,
						sort: args.sort,
						direction: args.direction,
						per_page: args.per_page ?? 30
					}
				});
				const text = `共 ${data.length} 条：\n` + data.map((issue) => {
					const prefix = issue.pull_request ? "PR" : "Issue";
					return `- #${issue.number} [${issue.state}] ${issue.title}（@${issue.user?.login ?? "?"}）`;
				}).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_get_issue",
			description: "查询单个 issue 的详情（含正文、标签、指派、评论数、时间线关键信息）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				issue_number: i("issue 编号", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						issue: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: issue #${args.issue_number}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/issues/${args.issue_number}`);
				const text = `${renderIssueLike(data)}\n\n${truncate(data.body ?? "（无正文）", 4000)}`;
				return { issue: data, text };
			}
		}),

		defineTool({
			name: "github_create_issue",
			description: "在仓库创建 issue（标题必填；可带正文、标签、指派者、里程碑）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				title: s("issue 标题", true),
				body: s("issue 正文（Markdown）"),
				labels: arr(s("标签名"), "标签列表"),
				assignees: arr(s("用户登录名"), "指派者列表"),
				milestone: i("里程碑编号")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						issue: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 创建 issue「${args.title}」`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					title: args.title,
					...(args.body ? { body: args.body } : {}),
					...(args.labels?.length ? { labels: args.labels } : {}),
					...(args.assignees?.length ? { assignees: args.assignees } : {}),
					...(args.milestone ? { milestone: args.milestone } : {})
				};
				const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/issues`, { body });
				return { issue: data, text: `已创建 issue #${data.number}：${data.title}\n${data.html_url ?? ""}` };
			}
		}),

		defineTool({
			name: "github_update_issue",
			description: "更新 issue：改标题/正文、加标签、重新指派、改状态（open/closed）。把状态改为 closed 属于危险操作（需审批）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				issue_number: i("issue 编号", true),
				title: s("新标题"),
				body: s("新正文"),
				state: e("目标状态（closed 需审批）", ["open", "closed"]),
				state_reason: e("关闭原因（state=closed 时可用）", ["completed", "not_planned", "reopened"]),
				labels: arr(s("标签名"), "替换为的标签列表"),
				assignees: arr(s("用户登录名"), "替换为的指派者列表")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						issue: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 更新 issue #${args.issue_number}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const body = {
					...(args.title ? { title: args.title } : {}),
					...(args.body ? { body: args.body } : {}),
					...(args.state ? { state: args.state } : {}),
					...(args.state_reason ? { state_reason: args.state_reason } : {}),
					...(args.labels ? { labels: args.labels } : {}),
					...(args.assignees ? { assignees: args.assignees } : {})
				};
				if (Object.keys(body).length === 0) throw new Error("至少提供一个要更新的字段（title/body/state/labels/assignees）");
				const { data } = await api.request("PATCH", `/repos/${enc(owner)}/${enc(args.repo)}/issues/${args.issue_number}`, { body });
				return { issue: data, text: `已更新 issue #${data.number}（状态：${data.state}）\n${data.html_url ?? ""}` };
			}
		}),

		defineTool({
			name: "github_add_issue_comment",
			description: "给 issue（或 PR）添加评论。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				issue_number: i("issue 或 PR 编号", true),
				body: s("评论正文（Markdown）", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						comment: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 评论 #${args.issue_number}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/issues/${args.issue_number}/comments`, {
					body: { body: args.body }
				});
				return { comment: data, text: `已评论 issue #${args.issue_number}\n${data.html_url ?? ""}` };
			}
		})
	];
}
