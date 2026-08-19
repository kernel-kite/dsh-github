/**
 * 版本（Release）类工具：列表 / 最新 / 按 tag。
 *
 * @module dsh-github/tools/releases
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderText, presentCall, truncate } from "../format.js";
import { i, s, resolveOwner, enc } from "./common.js";

export function buildReleaseTools(runtime) {
	const { api } = runtime;

	const releaseText = (release) => [
		`Release ${release.tag_name ?? "?"}${release.name ? `：${release.name}` : ""}`,
		`作者：${release.author?.login ?? "?"} 发布：${release.published_at ?? "?"}`,
		`地址：${release.html_url ?? ""}`,
		...(release.prerelease ? ["（预发布）"] : []),
		...(release.draft ? ["（草稿）"] : []),
		...(release.body ? [`\n${truncate(release.body, 2000)}`] : [])
	].join("\n");

	return [
		defineTool({
			name: "github_list_releases",
			description: "列出仓库的 Releases（含下载资源 asset 列表）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
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
			presentCall: (args) => presentCall(`GitHub: releases ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/releases`, { query: { per_page: args.per_page ?? 30 } });
				const text = `共 ${data.length} 个 release：\n` + data.map((release) => `- ${release.tag_name ?? "?"}${release.name ? `：${release.name}` : ""}${release.prerelease ? "（预发布）" : ""}`).join("\n");
				return { count: data.length, items: data, text };
			}
		}),

		defineTool({
			name: "github_get_latest_release",
			description: "获取仓库最新的正式 Release（跳过预发布与草稿）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						release: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 最新 release ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/releases/latest`);
				return { release: data, text: releaseText(data) };
			}
		}),

		defineTool({
			name: "github_get_release_by_tag",
			description: "按 tag 名获取指定 Release。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				tag: s("标签名，如 v1.0.0", true)
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						release: { type: "object", additionalProperties: true, required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: release ${args.tag}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/releases/tags/${enc(args.tag)}`);
				return { release: data, text: releaseText(data) };
			}
		})
	];
}
