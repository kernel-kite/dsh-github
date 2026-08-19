/**
 * 权限与审批策略（对标 opencode GitHub MCP + PerryLink/dsh-github 的
 * approval-gated 写法）：
 *
 *  - 配置一次认证后，读操作与常规写操作（create_issue、create_or_update_file、
 *    push_files(非 force)、create_repository、fork 等）默认放行，不逐次弹审批；
 *  - 危险操作保留审批门：删除仓库/文件/分支、force push、合并 PR、关闭 issue。
 *
 * 实现方式：在 `tools/pre-execute` waterfall 上挂一个监听器（与 DSH 内置
 * `dsh-tool-jobs` 同模式），命中危险工具（或带危险参数）返回
 * `{ kind: "ask", reason }`，由 ToolRuntime 经 `ctx.approval.request` 走
 * 审批通道；`allowed-once` 才放行，其余（rejected/cancelled/unavailable）
 * 一律 fail closed。
 *
 * @module dsh-github/approval
 */

/** 危险工具 → 生成审批理由（args 为模型传参）。返回 null 表示不拦截。 */
const DANGEROUS_RULES = {
	github_delete_repository: (args) => `删除仓库 ${args.owner}/${args.repo}`,
	github_delete_file: (args) => `删除文件 ${args.path}（${args.owner}/${args.repo}）`,
	github_delete_branch: (args) => `删除分支 ${args.branch}（${args.owner}/${args.repo}）`,
	github_merge_pull_request: (args) => `合并 PR #${args.pull_number}（${args.owner}/${args.repo}）`,
	github_push_files: (args) => args.force ? `强制推送 ${Array.isArray(args.files) ? args.files.length : 0} 个文件到 ${args.branch}（${args.owner}/${args.repo}）` : null,
	github_update_issue: (args) => args.state === "closed" ? `关闭 issue #${args.issue_number}（${args.owner}/${args.repo}）` : null,
	github_update_pull_request: (args) => args.state === "closed" ? `关闭 PR #${args.pull_number}（${args.owner}/${args.repo}，不合并直接关闭）` : null
};

/**
 * 判定一次工具调用是否命中危险操作。
 * @param {string} toolName - 工具名。
 * @param {object} [args] - 模型传参。
 * @returns {string | null} - 需要审批时返回理由（供审批弹窗展示），否则 null。
 */
export function classifyDanger(toolName, args = {}) {
	const rule = DANGEROUS_RULES[toolName];
	if (typeof rule !== "function") return null;
	return rule(args ?? {}) ?? null;
}

/** 危险工具集合（供文档/测试使用）。 */
export const DANGEROUS_TOOLS = Object.keys(DANGEROUS_RULES);

/**
 * 构造 `tools/pre-execute` 审批门监听器。
 * @param {object} config - 插件配置（approvalGate: false 可关闭门）。
 * @returns {(exec: object, next: Function) => any}
 */
export function createApprovalGate(config = {}) {
	const enabled = config.approvalGate !== false;
	return (exec, next) => {
		const name = exec?.name;
		if (!enabled || typeof name !== "string" || !name.startsWith("github_")) return next();
		const reason = classifyDanger(name, exec.arguments);
		if (reason !== null) {
			return { kind: "ask", reason: `GitHub 危险操作审批：${reason}。确认后放行本次调用。` };
		}
		return next();
	};
}
