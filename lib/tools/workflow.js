/**
 * 工作流类工具：github_upload_project —— 一键上传项目
 * （create_repository → push_files → create_pull_request 串起来，
 *  模拟 opencode 推送多文件的体验）。
 *
 * @module dsh-github/tools/workflow
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { pushFiles } from "../push.js";
import { renderText, presentCall } from "../format.js";
import { arr, b, s, resolveOwner, enc, fileEntry } from "./common.js";

export function buildWorkflowTools(runtime) {
	const { api } = runtime;

	return [
		defineTool({
			name: "github_upload_project",
			description: "一键上传项目到 GitHub：仓库不存在则自动创建 → 推送多个文件（Git Data API，一次提交）→ 默认再开一个 PR。适合「把本地项目推到 GitHub」的完整流程；常规写操作，无需逐次审批。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名（不存在会自动创建）", true),
				description: s("仓库描述（仅新建时生效）"),
				private: b("新建仓库是否私有（默认 true）"),
				files: arr(fileEntry("要上传的文件：path 为仓库内路径，content 为文件内容"), "项目文件列表", true),
				message: s("提交信息（默认「Upload project files」）"),
				branch: s("推送到的分支（默认仓库默认分支；上传后自动创建该分支并从默认分支切出）"),
				create_pull_request: b("是否在推送后创建 PR（默认 true）"),
				pr_title: s("PR 标题（默认用提交信息）"),
				pr_body: s("PR 正文（Markdown，可选）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						owner: { type: "string", required: true },
						repo: { type: "string", required: true },
						repoCreated: { type: "boolean", required: true },
						repoUrl: { type: "string", required: true },
						branch: { type: "string", required: true },
						commitSha: { type: "string", required: true },
						commitUrl: { type: "string", required: true },
						filesPushed: { type: "integer", required: true },
						pullRequest: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }], required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 上传项目 → ${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				if (!Array.isArray(args.files) || args.files.length === 0) throw new Error("files 至少需要一个文件条目");

				// 1) 确保仓库存在
				let repoCreated = false;
				let repo;
				try {
					repo = (await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}`)).data;
				} catch (error) {
					if (error?.status !== 404) throw error;
					const me = await (async () => {
						const { data } = await api.request("GET", "/user");
						return data.login;
					})();
					const createPath = owner === me ? "/user/repos" : `/orgs/${enc(owner)}/repos`;
					repo = (await api.request("POST", createPath, {
						body: {
							name: args.repo,
							...(args.description ? { description: args.description } : {}),
							private: args.private ?? true,
							auto_init: false
						}
					})).data;
					repoCreated = true;
				}
				const defaultBranch = repo.default_branch ?? "main";
				const targetBranch = args.branch ?? defaultBranch;

				// 2) 推送文件（复用共享 pushFiles：建 blob → tree → commit → ref）
				const pushResult = await pushFiles(runtime, {
					owner,
					repo: args.repo,
					branch: targetBranch,
					message: args.message ?? "Upload project files",
					files: args.files
				});

				// 3) 可选：创建 PR
				let pullRequest = null;
				if (args.create_pull_request !== false && targetBranch !== defaultBranch) {
					pullRequest = (await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/pulls`, {
						body: {
							title: args.pr_title ?? args.message ?? `Upload project files to ${targetBranch}`,
							head: targetBranch,
							base: defaultBranch,
							...(args.pr_body ? { body: args.pr_body } : {})
						}
					})).data;
				}

				const lines = [
					`项目已上传到 GitHub${repoCreated ? "（新建仓库）" : ""}：${owner}/${args.repo}`,
					`仓库地址：${repo.html_url ?? `https://github.com/${owner}/${args.repo}`}`,
					`分支：${targetBranch}，推送 ${pushResult.filesPushed} 个文件`,
					`提交：${pushResult.commitSha.slice(0, 7)} ${pushResult.commitUrl}`
				];
				if (pullRequest) {
					lines.push(`PR #${pullRequest.number}：${pullRequest.title}`);
					lines.push(`PR 地址：${pullRequest.html_url}`);
				} else if (args.create_pull_request !== false) {
					lines.push("（未创建 PR：目标分支即默认分支，改动已直接在默认分支上）");
				}

				return {
					owner,
					repo: args.repo,
					repoCreated,
					repoUrl: repo.html_url ?? `https://github.com/${owner}/${args.repo}`,
					branch: targetBranch,
					commitSha: pushResult.commitSha,
					commitUrl: pushResult.commitUrl,
					filesPushed: pushResult.filesPushed,
					pullRequest,
					text: lines.join("\n")
				};
			}
		})
	];
}

