/**
 * 输出渲染与 UI 展示辅助：把结构化 JSON 结果转成模型/UI 友好文本。
 * 所有 render 必须返回内容块数组 `[{ type: "text", text }]`。
 * 约定：任何 render 绝不包含 token 值（token 只存在于请求头）。
 *
 * @module dsh-github/format
 */

/** 生成单一文本内容块。 */
export function renderText(text) {
	return [{ type: "text", text: String(text) }];
}

/** 调用卡片（generic）展示元数据。 */
export function presentCall(title, kind = "generic") {
	return { card: "generic", title, kind };
}

/** 从对象中挑选字段，忽略 undefined。 */
export function pick(source, keys) {
	const out = {};
	for (const key of keys) {
		if (source[key] !== void 0) out[key] = source[key];
	}
	return out;
}

/** 用户可见的仓库标识。 */
export function repoLabel(owner, repo) {
	return `${owner}/${repo}`;
}

/** 截断长文本（diff/正文渲染用）。 */
export function truncate(text, max = 4000) {
	if (typeof text !== "string" || text.length <= max) return text;
	return `${text.slice(0, max)}\n…[已截断，共 ${text.length} 字符]`;
}

/** 渲染用户信息（get_me / get_authenticated_user 共用）。 */
export function renderUser(user) {
	const lines = [
		`GitHub 用户：${user.login}`,
		`名称：${user.name ?? "（未设置）"}`,
		`主页：${user.html_url ?? ""}`,
		...(user.bio ? [`简介：${user.bio}`] : []),
		...(user.company ? [`公司：${user.company}`] : []),
		...(user.email ? [`邮箱：${user.email}`] : []),
		...(user.location ? [`所在地：${user.location}`] : []),
		`公开仓库：${user.public_repos ?? 0}，关注者：${user.followers ?? 0}，关注：${user.following ?? 0}`
	];
	return lines.join("\n");
}

/** 渲染仓库摘要。 */
export function renderRepository(repo) {
	const lines = [
		`仓库：${repo.full_name ?? repoLabel(repo.owner?.login, repo.name)}`,
		`地址：${repo.html_url ?? ""}`,
		...(repo.description ? [`描述：${repo.description}`] : []),
		`默认分支：${repo.default_branch ?? "main"}`,
		...(repo.language ? [`语言：${repo.language}`] : []),
		...(repo.visibility ? [`可见性：${repo.visibility}`] : repo.private !== void 0 ? [`私有：${repo.private}`] : []),
		`星标：${repo.stargazers_count ?? 0}，分支：${repo.forks_count ?? 0}，打开 issue：${repo.open_issues_count ?? 0}`
	];
	return lines.join("\n");
}

/** 渲染 issue/PR 摘要（两者结构相似）。 */
export function renderIssueLike(item, kind = "issue") {
	const state = item.state ?? "";
	const labels = Array.isArray(item.labels) ? item.labels.map((label) => typeof label === "string" ? label : label.name).filter(Boolean).join(", ") : "";
	const lines = [
		`${kind === "pr" ? "PR" : "Issue"} #${item.number}：${item.title}`,
		`状态：${state}${item.draft ? "（draft）" : ""}`,
		`作者：${item.user?.login ?? "?"}`,
		...(item.html_url ? [`地址：${item.html_url}`] : []),
		...(labels ? [`标签：${labels}`] : []),
		...(item.assignees?.length ? [`指派：${item.assignees.map((a) => a.login).join(", ")}`] : []),
		...(item.created_at ? [`创建：${item.created_at}`] : [])
	];
	return lines.join("\n");
}

/** 渲染 PR 列表条目。 */
export function renderPullRequest(pr) {
	return [
		`PR #${pr.number}：${pr.title}`,
		`状态：${pr.state ?? ""}${pr.draft ? "（draft）" : ""} 合并状态：${pr.merged ? "已合并" : pr.mergeable_state ?? "?"}`,
		`分支：${pr.head?.ref ?? "?"} → ${pr.base?.ref ?? "?"}`,
		`作者：${pr.user?.login ?? "?"}`,
		...(pr.html_url ? [`地址：${pr.html_url}`] : []),
		...(pr.body ? [`说明：${truncate(pr.body, 500)}`] : [])
	].join("\n");
}

/** 渲染提交列表条目。 */
export function renderCommit(commit) {
	const message = (commit.commit?.message ?? "").split("\n")[0];
	return [
		`${commit.sha?.slice(0, 7) ?? "?"} ${message}`,
		`作者：${commit.commit?.author?.name ?? commit.author?.login ?? "?"} 于 ${commit.commit?.author?.date ?? "?"}`,
		...(commit.html_url ? [`地址：${commit.html_url}`] : [])
	].join("\n");
}
