/**
 * 仓库类工具：创建/查询/列出/fork/删除仓库、分支管理、
 * 文件读写（单个与批量推送）、标签。
 *
 * @module dsh-github/tools/repos
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { GITHUB_WEB_BASE } from "../client.js";
import { pushFiles } from "../push.js";
import { renderText, renderRepository, presentCall, pick, truncate } from "../format.js";
import { arr, b, e, i, s, resolveOwner, enc, commitWebUrl, fileEntry } from "./common.js";

/** 列表输出（count + items）。 */
const LIST_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		count: { type: "integer", required: true },
		items: { type: "array", items: { type: "object", additionalProperties: true }, required: true }
	}
};

export function buildRepoTools(runtime) {
	const { api } = runtime;

	const repoOutput = (value) => ({
		schema: { type: "object", additionalProperties: false, properties: {
			repository: { type: "object", additionalProperties: true, required: true },
			text: { type: "string", required: true }
		} },
		render: (args, v) => renderText(v.text)
	});

	return [
		defineTool({
			name: "github_create_repository",
			description: "创建 GitHub 仓库（个人或组织）。适合「上传项目」流程第一步：模型新建仓库后推送文件。返回仓库地址与默认分支。",
			parameters: {
				name: s("仓库名（唯一，同一账号下不可重复）", true),
				description: s("仓库描述"),
				private: b("是否私有（默认 true）"),
				auto_init: b("是否用 README 初始化（默认 false；为 true 时默认分支会有一个初始提交）"),
				gitignore_template: s("gitignore 模板名，如 Node、Python（仅 auto_init 时生效）"),
				license_template: s("LICENSE 模板名，如 MIT（仅 auto_init 时生效）"),
				has_issues: b("启用 Issues（默认 true）"),
				has_wiki: b("启用 Wiki（默认 true）"),
				org: s("在指定组织下创建（POST /orgs/{org}/repos）；缺省创建在当前用户下")
			},
			output: repoOutput({}),
			presentCall: (args) => presentCall(`GitHub: 创建仓库 ${args.name}`),
			async execute(args) {
				const body = {
					name: args.name,
					description: args.description,
					private: args.private ?? true,
					auto_init: args.auto_init ?? false,
					...(args.gitignore_template ? { gitignore_template: args.gitignore_template } : {}),
					...(args.license_template ? { license_template: args.license_template } : {}),
					...(args.has_issues !== void 0 ? { has_issues: args.has_issues } : {}),
					...(args.has_wiki !== void 0 ? { has_wiki: args.has_wiki } : {})
				};
				const path = args.org ? `/orgs/${enc(args.org)}/repos` : "/user/repos";
				const { data } = await api.request("POST", path, { body });
				return { repository: data, text: `${renderRepository(data)}\n创建成功。` };
			}
		}),

		defineTool({
			name: "github_get_repository",
			description: "查询单个仓库的完整信息（默认分支、星标、fork、语言、可见性等）。判断仓库是否存在、读取 default_branch 时使用。",
			parameters: {
				owner: s("仓库所有者（登录名或组织名）；缺省用当前认证用户"),
				repo: s("仓库名", true)
			},
			output: repoOutput({}),
			presentCall: (args) => presentCall(`GitHub: 查询仓库 ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}`);
				return { repository: data, text: renderRepository(data) };
			}
		}),

		defineTool({
			name: "github_list_repositories",
			description: "列出仓库（当前用户或指定用户的仓库；指定 type 过滤可见性）。",
			parameters: {
				owner: s("用户登录名；缺省列出当前认证用户的仓库"),
				type: e("仓库类型过滤", ["all", "owner", "public", "private", "member"], false),
				sort: e("排序字段", ["created", "updated", "pushed", "full_name"], false),
				direction: e("排序方向", ["asc", "desc"], false),
				per_page: i("每页数量（默认 30，最大 100）")
			},
			output: {
				schema: LIST_SCHEMA,
				render: (args, value) => {
					const items = value.items ?? [];
					const lines = [`共 ${value.count ?? items.length} 个仓库：`];
					for (const repo of items) {
						lines.push(`- ${repo.full_name}（${repo.visibility ?? (repo.private ? "private" : "public")}${repo.fork ? ", fork" : ""}）${repo.description ? ` — ${repo.description}` : ""}`);
					}
					return renderText(lines.join("\n"));
				}
			},
			presentCall: (args) => presentCall(`GitHub: 列出 ${args.owner ?? "我的"} 仓库`),
			async execute(args) {
				const query = {
					type: args.type,
					sort: args.sort,
					direction: args.direction,
					per_page: args.per_page ?? 30
				};
				const path = args.owner ? `/users/${enc(args.owner)}/repos` : "/user/repos";
				const { data } = await api.request("GET", path, { query });
				return { count: data.length, items: data };
			}
		}),

		defineTool({
			name: "github_fork_repository",
			description: "Fork 一个仓库到当前用户（或指定组织）。",
			parameters: {
				owner: s("源仓库所有者", true),
				repo: s("源仓库名", true),
				organization: s("fork 到的组织（可选，缺省 fork 到当前用户）"),
				default_branch_only: b("只 fork 默认分支（可选）")
			},
			output: repoOutput({}),
			presentCall: (args) => presentCall(`GitHub: fork ${args.owner}/${args.repo}`),
			async execute(args) {
				const body = {
					...(args.organization ? { organization: args.organization } : {}),
					...(args.default_branch_only !== void 0 ? { default_branch_only: args.default_branch_only } : {})
				};
				const { data } = await api.request("POST", `/repos/${enc(args.owner)}/${enc(args.repo)}/forks`, { body });
				return { repository: data, text: `${renderRepository(data)}\nfork 完成。` };
			}
		}),

		defineTool({
			name: "github_delete_repository",
			description: "删除一个仓库（不可恢复！）。危险操作：需要审批。删除前请先与用户确认。",
			parameters: {
				owner: s("仓库所有者", true),
				repo: s("仓库名", true)
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					deleted: { type: "boolean", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 删除仓库 ${args.owner}/${args.repo}`, "danger"),
			async execute(args) {
				await api.request("DELETE", `/repos/${enc(args.owner)}/${enc(args.repo)}`);
				return { deleted: true, text: `已删除仓库 ${args.owner}/${args.repo}。` };
			}
		}),

		defineTool({
			name: "github_list_branches",
			description: "列出仓库全部分支（名称 + 头部提交 SHA + 是否受保护）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				per_page: i("每页数量（默认 30）")
			},
			output: {
				schema: LIST_SCHEMA,
				render: (args, value) => {
					const items = value.items ?? [];
					const lines = [`共 ${value.count ?? items.length} 个分支：`];
					for (const branch of items) {
						lines.push(`- ${branch.name} → ${branch.commit?.sha?.slice(0, 7) ?? "?"}${branch.protected ? "（protected）" : ""}`);
					}
					return renderText(lines.join("\n"));
				}
			},
			presentCall: (args) => presentCall(`GitHub: 分支列表 ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/branches`, { query: { per_page: args.per_page ?? 30 } });
				return { count: data.length, items: data };
			}
		}),

		defineTool({
			name: "github_create_branch",
			description: "在仓库中从某个基线（默认分支或指定 base 分支）创建新分支。推 PR 前建功能分支时使用。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				branch: s("新分支名，如 feature/foo", true),
				base: s("基线分支名（缺省为仓库默认分支）"),
				sha: s("直接指定基线提交 SHA（与 base 二选一）")
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					ref: { type: "string", required: true },
					sha: { type: "string", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 创建分支 ${args.branch}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				let sha = args.sha;
				if (!sha) {
					let base = args.base;
					if (!base) {
						const repo = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}`);
						base = repo.data.default_branch ?? "main";
					}
					const ref = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/git/ref/heads/${enc(base)}`);
					sha = ref.data.object.sha;
				}
				const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(args.repo)}/git/refs`, {
					body: { ref: `refs/heads/${args.branch}`, sha }
				});
				return {
					ref: data.ref,
					sha: data.object.sha,
					text: `已创建分支 ${args.branch}（基于 ${sha.slice(0, 7)}）→ ${data.object.sha.slice(0, 7)}`
				};
			}
		}),

		defineTool({
			name: "github_delete_branch",
			description: "删除一个分支（通常用于合并后清理功能分支）。危险操作：需要审批。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				branch: s("要删除的分支名", true)
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					deleted: { type: "boolean", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 删除分支 ${args.branch}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				await api.request("DELETE", `/repos/${enc(owner)}/${enc(args.repo)}/git/refs/heads/${enc(args.branch)}`);
				return { deleted: true, text: `已删除分支 ${args.branch}（${owner}/${args.repo}）。` };
			}
		}),

		defineTool({
			name: "github_get_file_contents",
			description: "读取仓库中的文件内容（自动 base64 解码）或列出目录条目。指定 ref 可读任意分支/提交/标签下的文件。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				path: s("文件或目录路径，如 src/index.js 或 src", true),
				ref: s("分支名 / 提交 SHA / 标签（缺省为默认分支）")
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						type: { type: "string", required: true, enum: ["file", "dir"] },
						path: { type: "string", required: true },
						content: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
						sha: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
						size: { oneOf: [{ type: "integer" }, { type: "null" }], required: true },
						entries: { oneOf: [{ type: "array", items: { type: "object", additionalProperties: true } }, { type: "null" }], required: true },
						text: { type: "string", required: true }
					}
				},
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 读取 ${args.path}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const query = args.ref ? { ref: args.ref } : void 0;
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/contents/${args.path.split("/").map(enc).join("/")}`, { query });
				if (Array.isArray(data)) {
					const entries = data.map((entry) => pick(entry, ["name", "path", "type", "size", "sha"]));
					const text = `目录 ${args.path}/ 共 ${entries.length} 项：\n` + entries.map((entry) => `- ${entry.type === "dir" ? `${entry.name}/` : entry.name}（${entry.size ?? 0} bytes）`).join("\n");
					return { type: "dir", path: args.path, content: null, sha: null, size: null, entries, text };
				}
				const content = typeof data.content === "string" ? Buffer.from(data.content, "base64").toString("utf8") : null;
				const text = `文件 ${args.path}（${data.size ?? 0} bytes, sha ${(data.sha ?? "").slice(0, 7)}）：\n\n${truncate(content ?? "", 8000)}`;
				return { type: "file", path: args.path, content, sha: data.sha ?? null, size: data.size ?? null, entries: null, text };
			}
		}),

		defineTool({
			name: "github_create_or_update_file",
			description: "创建或更新仓库中的单个文件（Contents API，提交信息必需）。更新已有文件时插件会自动读取当前 sha，无需手工传。适合少量文件改动。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				path: s("文件路径，如 README.md", true),
				message: s("提交信息", true),
				content: s("文件内容（UTF-8 文本）", true),
				sha: s("已有文件的 blob SHA（更新时自动解析，一般无需传）"),
				branch: s("目标分支（缺省为默认分支）")
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					commitSha: { type: "string", required: true },
					commitUrl: { type: "string", required: true },
					contentPath: { type: "string", required: true },
					updated: { type: "boolean", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 写入 ${args.path}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const repoPath = `/repos/${enc(owner)}/${enc(args.repo)}/contents/${args.path.split("/").map(enc).join("/")}`;
				let sha = args.sha;
				if (!sha) {
					try {
						const existing = await api.request("GET", repoPath);
						sha = existing.data.sha;
					} catch (error) {
						if (error?.status !== 404) throw error;
					}
				}
				const body = {
					message: args.message,
					content: Buffer.from(args.content, "utf8").toString("base64"),
					...(sha ? { sha } : {}),
					...(args.branch ? { branch: args.branch } : {})
				};
				const { data } = await api.request("PUT", repoPath, { body });
				const commitSha = data.commit?.sha ?? "";
				const updated = Boolean(sha);
				return {
					commitSha,
					commitUrl: commitWebUrl(owner, args.repo, commitSha),
					contentPath: args.path,
					updated,
					text: `${updated ? "已更新" : "已创建"}文件 ${args.path}（${owner}/${args.repo}）\n提交：${commitSha.slice(0, 7)} ${commitWebUrl(owner, args.repo, commitSha)}`
				};
			}
		}),

		defineTool({
			name: "github_push_files",
			description: "一次提交推送多个文件（Git Data API：blob → tree → commit → ref）。适合批量上传项目文件；分支不存在时自动从默认分支创建（空仓库则直接创建首个提交）。force=true 会强制覆盖远端历史，属于危险操作。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				branch: s("目标分支（缺省为默认分支；不存在时自动创建）"),
				message: s("提交信息", true),
				files: arr(fileEntry(), "要推送的文件列表", true),
				force: b("强制推送（覆盖远端历史，危险操作，需要审批）"),
				author_name: s("提交作者名（可选，默认用 GitHub 账号）"),
				author_email: s("提交作者邮箱（可选）")
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					owner: { type: "string", required: true },
					repo: { type: "string", required: true },
					branch: { type: "string", required: true },
					commitSha: { type: "string", required: true },
					commitUrl: { type: "string", required: true },
					filesPushed: { type: "integer", required: true },
					forced: { type: "boolean", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 推送 ${args.files?.length ?? 0} 个文件 → ${args.branch ?? "默认分支"}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const result = await pushFiles(runtime, {
					owner,
					repo: args.repo,
					branch: args.branch,
					message: args.message,
					files: args.files,
					force: Boolean(args.force),
					author: args.author_name && args.author_email ? { name: args.author_name, email: args.author_email } : void 0
				});
				return {
					owner,
					repo: args.repo,
					branch: result.branch,
					commitSha: result.commitSha,
					commitUrl: result.commitUrl,
					filesPushed: result.filesPushed,
					forced: Boolean(args.force),
					text: `已推送 ${result.filesPushed} 个文件到 ${owner}/${args.repo}@${result.branch}${args.force ? "（force）" : ""}\n提交：${result.commitSha.slice(0, 7)} ${result.commitUrl}`
				};
			}
		}),

		defineTool({
			name: "github_delete_file",
			description: "删除仓库中的单个文件（Contents API，需提交信息）。危险操作：需要审批。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				path: s("要删除的文件路径", true),
				message: s("提交信息", true),
				sha: s("文件当前 blob SHA（自动解析，一般无需传）"),
				branch: s("目标分支（缺省为默认分支）")
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					commitSha: { type: "string", required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 删除文件 ${args.path}`, "danger"),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const repoPath = `/repos/${enc(owner)}/${enc(args.repo)}/contents/${args.path.split("/").map(enc).join("/")}`;
				let sha = args.sha;
				if (!sha) {
					const existing = await api.request("GET", repoPath);
					sha = existing.data.sha;
				}
				const body = {
					message: args.message,
					sha,
					...(args.branch ? { branch: args.branch } : {})
				};
				const { data } = await api.request("DELETE", repoPath, { body });
				const commitSha = data.commit?.sha ?? "";
				return { commitSha, text: `已删除文件 ${args.path}（${owner}/${args.repo}）\n提交：${commitSha.slice(0, 7)} ${commitWebUrl(owner, args.repo, commitSha)}` };
			}
		}),

		defineTool({
			name: "github_list_tags",
			description: "列出仓库的版本标签（含 zip/tarball 下载地址）。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				per_page: i("每页数量（默认 30）")
			},
			output: {
				schema: LIST_SCHEMA,
				render: (args, value) => {
					const items = value.items ?? [];
					const lines = [`共 ${value.count ?? items.length} 个标签：`];
					for (const tag of items) {
						lines.push(`- ${tag.name}（${tag.commit?.sha?.slice(0, 7) ?? tag.sha?.slice(0, 7) ?? "?"}）`);
					}
					return renderText(lines.join("\n"));
				}
			},
			presentCall: (args) => presentCall(`GitHub: 标签列表 ${args.owner ?? "me"}/${args.repo}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				const { data } = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/tags`, { query: { per_page: args.per_page ?? 30 } });
				return { count: data.length, items: data };
			}
		}),

		defineTool({
			name: "github_get_tag",
			description: "查看某个标签的详细信息（注解标签对象：消息、打标签人；轻量标签则返回指向的提交）。传 tag 名称会自动解析。",
			parameters: {
				owner: s("仓库所有者；缺省用当前认证用户"),
				repo: s("仓库名", true),
				tag: s("标签名（如 v1.0.0）"),
				tag_sha: s("直接传标签对象 SHA（与 tag 二选一）")
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					tag: { type: "object", additionalProperties: true, required: true },
					text: { type: "string", required: true }
				} },
				render: (args, value) => renderText(value.text)
			},
			presentCall: (args) => presentCall(`GitHub: 标签 ${args.tag ?? args.tag_sha?.slice(0, 7)}`),
			async execute(args) {
				const owner = await resolveOwner(args.owner, runtime);
				let sha = args.tag_sha;
				let resolvedFrom = null;
				if (!sha && args.tag) {
					const ref = await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/git/ref/tags/${enc(args.tag)}`);
					sha = ref.data.object.sha;
					resolvedFrom = ref.data.object.type;
				}
				if (!sha) throw new Error("必须提供 tag 或 tag_sha 之一");
				let data;
				try {
					data = (await api.request("GET", `/repos/${enc(owner)}/${enc(args.repo)}/git/tags/${sha}`)).data;
				} catch (error) {
					if (error?.status === 404 && resolvedFrom === "commit") {
						return {
							tag: { tag: args.tag, type: "commit", sha },
							text: `标签 ${args.tag} 是轻量标签，直接指向提交 ${sha.slice(0, 7)}（${GITHUB_WEB_BASE}/${owner}/${args.repo}/commit/${sha}）`
						};
					}
					throw error;
				}
				const text = [
					`标签：${data.tag ?? args.tag ?? sha.slice(0, 7)}`,
					`类型：${data.object?.type ?? "tag"}`,
					...(data.message ? [`消息：${truncate(data.message, 500)}`] : []),
					...(data.tagger?.name ? [`打标签人：${data.tagger.name} <${data.tagger.email ?? ""}>（${data.tagger.date ?? ""}）`] : []),
					...(data.object?.sha ? [`指向对象：${data.object.sha.slice(0, 7)}（${data.object.type}）`] : [])
				].join("\n");
				return { tag: data, text };
			}
		})
	];
}
