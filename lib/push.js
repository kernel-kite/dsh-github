/**
 * 共享推送实现：Git Data API 一次提交多文件（blob → tree → commit → ref）。
 * 被 github_push_files 与 github_upload_project 复用。
 *
 * @module dsh-github/push
 */

import { enc, commitWebUrl } from "./tools/common.js";

/**
 * 推送多个文件到指定分支（分支不存在时自动从默认分支创建；空仓库直接建首个提交）。
 * @param {object} runtime - { api }。
 * @param {object} input
 * @param {string} input.owner
 * @param {string} input.repo
 * @param {string} input.branch - 目标分支（可缺省：取默认分支）。
 * @param {string} input.message - 提交信息。
 * @param {Array<{path: string, content: string, encoding?: string}>} input.files
 * @param {boolean} [input.force] - force push（危险）。
 * @param {{name?: string, email?: string}} [input.author]
 * @returns {Promise<{commitSha: string, commitUrl: string, filesPushed: number, branch: string}>}
 */
export async function pushFiles(runtime, input) {
	const { api } = runtime;
	const { owner, repo, message, files, force = false, author } = input;
	if (!Array.isArray(files) || files.length === 0) throw new Error("files 至少需要一个条目：{ path, content }");
	for (const file of files) {
		if (typeof file?.path !== "string" || file.path.length === 0) throw new Error("每个文件条目都必须有非空 path");
		if (typeof file?.content !== "string") throw new Error(`文件 ${file?.path} 缺少 content`);
	}

	// 1) 仓库默认分支
	const repoInfo = await api.request("GET", `/repos/${enc(owner)}/${enc(repo)}`);
	const defaultBranch = repoInfo.data.default_branch ?? "main";
	const targetBranch = input.branch ?? defaultBranch;

	// 2) 解析目标分支头部（不存在则从默认分支建，或视为空仓库）
	// GitHub 对「无任何提交的空仓库」在 git data API（含读 ref、建 blob）上
	// 统一返回 409 "Git Repository is empty"；此时先用 Contents API 播种首文件
	// 建出首个提交，再走 blob→tree→commit→ref 全量提交。
	const missingRef = (error) => error?.status === 404 || (error?.status === 409 && /empty/i.test(error?.message ?? ""));
	let headSha = null;
	let baseTreeSha = null;
	let refExists = true;
	let seeded = false;
	try {
		const ref = await api.request("GET", `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(targetBranch)}`);
		headSha = ref.data.object.sha;
	} catch (error) {
		if (!missingRef(error)) throw error;
		refExists = false;
		try {
			const defRef = await api.request("GET", `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(defaultBranch)}`);
			headSha = defRef.data.object.sha;
			const headCommit = await api.request("GET", `/repos/${enc(owner)}/${enc(repo)}/git/commits/${headSha}`);
			baseTreeSha = headCommit.data.tree.sha;
			if (targetBranch !== defaultBranch) {
				await api.request("POST", `/repos/${enc(owner)}/${enc(repo)}/git/refs`, {
					body: { ref: `refs/heads/${targetBranch}`, sha: headSha }
				});
				refExists = true;
			}
		} catch (error2) {
			if (!missingRef(error2)) throw error2;
			// 空仓库：先用 Contents API 播种第一个文件，建立首个提交
			const seed = files[0];
			if (!seed) throw new Error("仓库为空且没有可推送的文件");
			const seedContent = seed.encoding === "base64" ? seed.content : Buffer.from(seed.content, "utf8").toString("base64");
			const seedResponse = await api.request("PUT", `/repos/${enc(owner)}/${enc(repo)}/contents/${seed.path.split("/").map(enc).join("/")}`, {
				body: {
					message: `${message}（初始化）`,
					content: seedContent,
					...(targetBranch !== defaultBranch ? { branch: targetBranch } : {})
				}
			});
			headSha = seedResponse.data.commit.sha;
			baseTreeSha = seedResponse.data.commit.tree.sha;
			refExists = true;
			seeded = true;
		}
	}
	if (headSha && !baseTreeSha) {
		const headCommit = await api.request("GET", `/repos/${enc(owner)}/${enc(repo)}/git/commits/${headSha}`);
		baseTreeSha = headCommit.data.tree.sha;
	}

	// 3) 建 blob
	const blobs = [];
	for (const file of files) {
		const isBase64 = file.encoding === "base64";
		const content = isBase64 ? file.content : Buffer.from(file.content, "utf8").toString("base64");
		const { data } = await api.request("POST", `/repos/${enc(owner)}/${enc(repo)}/git/blobs`, {
			body: { content, encoding: "base64" }
		});
		blobs.push({ path: file.path, sha: data.sha });
	}

	// 4) 建 tree
	const tree = await api.request("POST", `/repos/${enc(owner)}/${enc(repo)}/git/trees`, {
		body: {
			tree: blobs.map((entry) => ({ path: entry.path, mode: "100644", type: "blob", sha: entry.sha })),
			...(baseTreeSha ? { base_tree: baseTreeSha } : {})
		}
	});

	// 5) 建 commit
	const commitBody = {
		message,
		tree: tree.data.sha,
		...(headSha ? { parents: [headSha] } : {}),
		...(author?.name && author?.email ? {
			author: { name: author.name, email: author.email, date: new Date().toISOString() }
		} : {})
	};
	const commit = await api.request("POST", `/repos/${enc(owner)}/${enc(repo)}/git/commits`, { body: commitBody });

	// 6) 更新 ref
	const refPath = `/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(targetBranch)}`;
	if (refExists) {
		await api.request("PATCH", refPath, { body: { sha: commit.data.sha, force } });
	} else {
		await api.request("POST", refPath, { body: { ref: `refs/heads/${targetBranch}`, sha: commit.data.sha } });
	}

	return {
		commitSha: commit.data.sha,
		commitUrl: commitWebUrl(owner, repo, commit.data.sha),
		filesPushed: blobs.length,
		branch: targetBranch
	};
}
