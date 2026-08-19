/**
 * 组织/用户类工具：认证用户完整信息、组织团队、团队成员。
 *
 * @module dsh-github/tools/orgs
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, renderUser, presentCall, pick } from "../format.js";
import { e, i, s, enc } from "./common.js";

export function buildOrgTools(runtime) {
	const { api } = runtime;

	return [
		defineTool({
			name: "github_get_authenticated_user",
			description: "返回当前认证用户的完整资料（含 plan、permissions、私有仓库数等原始字段）。需要用户详细信息时用本工具；仅校验认证用 github_get_me。",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						user: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall("GitHub: 当前用户（完整）"),
			async execute() {
				const { data } = await api.request("GET", "/user");
				const text = `${renderUser(data)}\n\n原始字段（节选）：\n${JSON.stringify(pick(data, ["id", "created_at", "updated_at", "plan", "permissions", "total_private_repos", "owned_private_repos"]), null, 2)}`;
				return { user: data, text };
			}
		}),

		defineTool({
			name: "github_list_organization_teams",
			description: "列出组织（org）下的全部团队。",
			parameters: {
				org: s("组织名（登录名）", true),
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
			presentCall: (args) => presentCall(`GitHub: 组织团队 ${args.org}`),
			async execute(args) {
				const { data } = await api.request("GET", `/orgs/${enc(args.org)}/teams`, { query: { per_page: args.per_page ?? 30 } });
				const text = `组织 ${args.org} 共 ${data.length} 个团队：\n` + data.map((team) => `- ${team.name}（slug: ${team.slug}）${team.description ? ` — ${team.description}` : ""}`).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_get_team_members",
			description: "列出团队（team_slug）的成员。",
			parameters: {
				org: s("组织名", true),
				team_slug: s("团队 slug（来自 list_organization_teams）", true),
				role: e("成员角色过滤", ["member", "maintainer", "all"]),
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
			presentCall: (args) => presentCall(`GitHub: 团队成员 ${args.team_slug}`),
			async execute(args) {
				const { data } = await api.request("GET", `/orgs/${enc(args.org)}/teams/${enc(args.team_slug)}/members`, {
					query: { role: args.role, per_page: args.per_page ?? 30 }
				});
				const text = `团队 ${args.team_slug} 共 ${data.length} 名成员：\n` + data.map((member) => `- ${member.login}${member.name ? `（${member.name}）` : ""}`).join("\n");
				return { count: data.length, items: data, text };
			}
		})
	];
}
