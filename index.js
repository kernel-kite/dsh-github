/**
 * dsh-github — DeepSeek Harness 的 GitHub 集成插件（宿主端，零依赖）。
 *
 * 对标 opencode 的 GitHub MCP server，把 GitHub REST API v3 包装成 45 个
 * `github_*` 工具，模型可直接在对话中调用：建仓、推送多文件、提/合 PR、
 * 管 issue、搜索代码、版本与组织等。
 *
 * ## 认证（配置一次，长期可用）
 *  - PAT：`GITHUB_TOKEN`（环境变量，或通过 DSH 设置页/credentials.set 写入
 *    `$DSH_HOME/.credentials.yaml`，重启依然有效）；
 *  - OAuth Device Flow：`github_auth_login` 浏览器授权一次，token 自动持久化
 *    到 DSH credentials 服务；GitHub device-flow token 长期有效，失效表现为
 *    401，届时清除凭据重新登录。
 *
 * ## 权限与审批
 *  - 读操作与常规写操作（create_issue / create_or_update_file / push_files
 *    / create_repository / upload_project 等）直接放行，不逐次弹审批；
 *  - 危险操作保留审批门（`tools/pre-execute` → `ctx.approval`）：
 *    删除仓库/文件/分支、force push、合并 PR、关闭 issue。
 *
 * ## 安全
 *  - token 只进 `Authorization` 请求头；日志只记方法/路径/状态码；
 *  - 工具输出与错误信息对 token 做防御性脱敏（redact）。
 *
 * @module dsh-github
 */

import z from "@deepseek-ai/schemastery";
import { createClient } from "./lib/client.js";
import { resolveToken, isTokenConfiguredSync } from "./lib/auth.js";
import { createApprovalGate } from "./lib/approval.js";
import { buildTools, TOOL_COUNT } from "./lib/tools.js";

/** Cordis 插件名（cordis.patch.yml 里 name 用包名 dsh-github，id 建议 github）。 */
export const name = "github";

/** 需要的服务：工具注册表 + systemPrompt 段落。 */
export const inject = ["tools", "systemPrompt"];

/**
 * 插件配置。
 * @property {string} tokenRef - PAT 凭据引用名（env / credentials 键名）。
 * @property {string} [oauthClientId] - GitHub OAuth App Client ID（Device Flow）。
 * @property {string} [oauthClientSecret] - OAuth App Client Secret（直接配置，不推荐明文）。
 * @property {string} oauthClientSecretRef - Client Secret 的凭据引用名（推荐）。
 * @property {string} [oauthScope] - Device Flow 申请的 scope。
 * @property {boolean} approvalGate - 危险操作是否走审批门（默认 true）。
 * @property {number} timeoutMs - GitHub 请求超时。
 */
export const Config = z.object({
	tokenRef: z.string().default("GITHUB_TOKEN"),
	oauthClientId: z.string(),
	oauthClientSecret: z.string(),
	oauthClientSecretRef: z.string().default("GITHUB_OAUTH_CLIENT_SECRET"),
	oauthScope: z.string(),
	approvalGate: z.boolean().default(true),
	timeoutMs: z.number().min(1000).max(300000).default(30000)
});

/**
 * Cordis 插件 apply：注册审批门、systemPrompt 引导段与全部 github_* 工具。
 * @param {object} ctx - cordis 上下文。
 * @param {object} [config] - 见 {@link Config}。
 */
export function apply(ctx, config = {}) {
	const state = {
		authInfo: null,          // get_me 缓存（owner 缺省解析用）
		pendingFlow: null,       // Device Flow 轮询器
		deviceFlowStatus: null,  // pending/completed/expired/denied/failed
		lastFlowPublic: null     // 展示给用户的 userCode/verificationUri
	};
	const runtime = {
		api: null,
		config,
		state,
		ctx,
		logger: ctx.logger
	};
	runtime.api = createClient({
		resolveToken: () => resolveToken(ctx, config),
		logger: ctx.logger,
		timeoutMs: config.timeoutMs ?? 30000
	});

	// ── 审批门：危险操作（删除/force push/合并 PR/关闭 issue）→ approval seam ──
	if (config.approvalGate !== false) {
		ctx.on("tools/pre-execute", createApprovalGate(config), { prepend: true });
	}

	// ── systemPrompt 引导段：告诉模型工具集与认证/审批约定 ──
	ctx.systemPrompt.section({
		name: "tool:github",
		order: 108,
		text: () => {
			const configured = isTokenConfiguredSync(ctx, config);
			return [
				`GitHub 工具集（45 个 github_* 工具）：可通过 GitHub REST API 完成建仓、推送文件、提/合 PR、管 issue、搜索代码、查看版本与组织等。`,
				`认证：${configured
					? "已检测到 GITHUB_TOKEN（环境变量或插件配置）。"
					: "未检测到环境变量 token；若已通过 DSH 设置页配置凭据，先调用 github_auth_status 确认；未配置则调用 github_auth_login 完成 OAuth 登录，或让用户设置 GITHUB_TOKEN。"}`,
				`审批：读操作与常规写操作（create_issue、create_or_update_file、push_files、create_repository、upload_project 等）直接放行；删除仓库/文件/分支、force push、合并 PR、关闭 issue 会触发审批弹窗，等待用户批准后放行，被拒时不要重试，向用户说明。`,
				`开始任何 GitHub 任务前，先调用 github_get_me 校验认证是否有效。`
			].join("\n");
		}
	});

	// ── 注册全部工具 ──
	const tools = buildTools(runtime);
	for (const tool of tools) ctx.tools.register(tool);
	ctx.logger?.info?.("dsh-github: 已注册 %d 个 github_* 工具", tools.length);

	// ── 清理：停止进行中的 Device Flow 轮询 ──
	ctx.on("dispose", () => {
		state.pendingFlow?.stop?.();
	});
}

/** 测试/文档用：工具总数。 */
export { TOOL_COUNT };
