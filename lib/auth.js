/**
 * 认证层：token 解析（PAT：环境变量 / DSH credentials 服务）与
 * OAuth Device Flow 状态机（GitHub OAuth App，浏览器授权一次、token 持久保存）。
 *
 * 持久化策略：
 *  - PAT：用户通过 DSH 设置页（credentials.set）或环境变量配置 `GITHUB_TOKEN`；
 *    每次操作经 `ctx.credentials.resolve(ref)` 解析（env → 托管文件 → .env 分层）。
 *  - OAuth：device flow 拿到的 access_token 通过 `credentials.set(ref, token)`
 *    写入 `$DSH_HOME/.credentials.yaml`，重启 DSH 依然有效。
 *    GitHub 的 device-flow token 长期有效、无 refresh token 机制；
 *    失效表现为 401，届时清除凭据并提示重新登录。
 *
 * 安全约定：token 值绝不进入工具输出与日志。
 *
 * @module dsh-github/auth
 */

import { GITHUB_WEB_BASE, GithubError, redact } from "./client.js";

/** GitHub device flow 支持的 scope（对标 opencode GitHub MCP）。 */
export const DEFAULT_SCOPES = "repo,read:org,user";

/** Device flow 轮询状态。 */
export const DEVICE_FLOW_STATUS = {
	PENDING: "pending",
	COMPLETED: "completed",
	EXPIRED: "expired",
	DENIED: "denied",
	FAILED: "failed"
};

/**
 * 解析当前 token（幂等，每次操作调用一次，便于凭据热更新）。
 * 顺序：显式 config.token（测试用）→ ctx.credentials.resolve(ref)（env/托管文件/.env）
 * → process.env[ref] 兜底。
 * @param {object} ctx - cordis 上下文（可无 credentials 服务）。
 * @param {object} config - 插件配置（tokenRef 等）。
 * @returns {Promise<{token: string, source: string} | null>}
 */
export async function resolveToken(ctx, config = {}) {
	const ref = String(config.tokenRef ?? "GITHUB_TOKEN");
	if (typeof config.token === "string" && config.token.length > 0) {
		return { token: config.token, source: "config" };
	}
	const credentials = ctx.get?.("credentials");
	if (credentials !== void 0 && typeof credentials.resolve === "function") {
		try {
			const resolved = await credentials.resolve(ref);
			if (resolved !== void 0 && typeof resolved.value === "string" && resolved.value.length > 0) {
				return { token: resolved.value, source: resolved.source ?? "credentials" };
			}
		} catch (error) {
			ctx.logger?.warn?.("dsh-github: 解析凭据 %s 失败：%s", ref, error?.message ?? String(error));
		}
	}
	const inherited = process.env[ref];
	if (typeof inherited === "string" && inherited.length > 0) {
		return { token: inherited, source: "env" };
	}
	return null;
}

/** 当前认证是否已配置（同步、快速、供 systemPrompt 段使用）。 */
export function isTokenConfiguredSync(ctx, config = {}) {
	if (typeof config.token === "string" && config.token.length > 0) return true;
	if (typeof process.env[String(config.tokenRef ?? "GITHUB_TOKEN")] === "string") return true;
	return false;
}

/**
 * 启动 GitHub OAuth Device Flow：
 * 1) POST /login/device/code 获取 user_code / device_code / verification_uri；
 * 2) 返回给调用方展示给用户；
 * 3) 由 poller 按 interval 轮询 POST /login/oauth/access_token，成功即回调 onToken。
 * @param {object} options
 * @param {string} options.clientId - GitHub OAuth App Client ID。
 * @param {string} [options.clientSecret] - Client Secret（GitHub device flow 换取 token 必须）。
 * @param {string} [options.scope] - 申请的 scope。
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{deviceCode: string, userCode: string, verificationUri: string, expiresIn: number, interval: number}>}
 */
export async function startDeviceFlow(options = {}) {
	const { clientId, clientSecret, scope = DEFAULT_SCOPES, fetchImpl } = options;
	const fetchFn = fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : void 0);
	if (typeof fetchFn !== "function") throw new GithubError("dsh-github: 当前运行时没有 fetch，无法执行 Device Flow", "GITHUB_NETWORK");
	if (!clientId) throw new GithubError("OAuth Device Flow 需要配置 oauthClientId（GitHub OAuth App 的 Client ID）", "GITHUB_OAUTH_MISCONFIG");
	if (!clientSecret) throw new GithubError("OAuth Device Flow 需要配置 oauthClientSecret（GitHub 要求 device flow 换取 token 时携带 Client Secret）", "GITHUB_OAUTH_MISCONFIG");

	const initResponse = await fetchFn(`${GITHUB_WEB_BASE}/login/device/code`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ client_id: clientId, scope })
	});
	if (!initResponse.ok) {
		let message = `GitHub 拒绝了 device flow 初始化（HTTP ${initResponse.status}）`;
		try {
			const data = await initResponse.json();
			if (typeof data?.error_description === "string") message = redact(data.error_description, clientSecret);
		} catch { /* ignore */ }
		throw new GithubError(message, "GITHUB_OAUTH_INIT_FAILED");
	}
	const init = await initResponse.json();
	// { device_code, user_code, verification_uri, expires_in, interval }
	if (typeof init.device_code !== "string" || typeof init.user_code !== "string") {
		throw new GithubError("GitHub device flow 响应缺少必要字段", "GITHUB_OAUTH_INIT_FAILED");
	}
	return {
		deviceCode: init.device_code,
		userCode: init.user_code,
		verificationUri: init.verification_uri ?? "https://github.com/login/device",
		expiresIn: Number(init.expires_in ?? 900),
		interval: Number(init.interval ?? 5)
	};
}

/**
 * 轮询一次 access_token 交换。
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.deviceCode
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{status: string, token?: string, scope?: string}>}
 *   status ∈ pending | completed | expired | denied | failed
 */
export async function pollDeviceFlow(options = {}) {
	const { clientId, clientSecret, deviceCode, fetchImpl } = options;
	const fetchFn = fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : void 0);
	const response = await fetchFn(`${GITHUB_WEB_BASE}/login/oauth/access_token`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			client_id: clientId,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			...(clientSecret ? { client_secret: clientSecret } : {})
		})
	});
	let data = {};
	try { data = await response.json(); } catch { /* ignore */ }
	if (typeof data.access_token === "string" && data.access_token.length > 0) {
		return { status: DEVICE_FLOW_STATUS.COMPLETED, token: data.access_token, scope: data.scope };
	}
	switch (data.error) {
		case "authorization_pending": return { status: DEVICE_FLOW_STATUS.PENDING };
		case "slow_down": return { status: DEVICE_FLOW_STATUS.PENDING, slowDown: true };
		case "expired_token": return { status: DEVICE_FLOW_STATUS.EXPIRED };
		case "access_denied": return { status: DEVICE_FLOW_STATUS.DENIED };
		default:
			return { status: DEVICE_FLOW_STATUS.FAILED, error: data.error_description ?? data.error ?? "unknown" };
	}
}

/**
 * 创建 Device Flow 轮询器：立即开始按 interval 轮询，成功/失败后停止，
 * 并调用回调。返回 stop() 与 status()。
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.deviceCode
 * @param {number} [options.interval] - 初始轮询间隔（毫秒）。
 * @param {number} [options.expiresIn] - 过期时间（秒）。
 * @param {(token: string, scope?: string) => void} [options.onToken]
 * @param {(status: string, error?: string) => void} [options.onStatus]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {{ stop: () => void, status: () => string }}
 */
export function createDeviceFlowPoller(options = {}) {
	const { clientId, clientSecret, deviceCode, onToken, onStatus, fetchImpl } = options;
	let intervalMs = Number(options.interval ?? 5) * 1000;
	const expiresAt = Date.now() + Number(options.expiresIn ?? 900) * 1000;
	let status = DEVICE_FLOW_STATUS.PENDING;
	let timer = null;
	let stopped = false;
	const fire = (next) => {
		status = next;
		onStatus?.(next);
	};
	const tick = async () => {
		if (stopped) return;
		if (Date.now() > expiresAt) {
			stop();
			fire(DEVICE_FLOW_STATUS.EXPIRED);
			return;
		}
		let outcome;
		try {
			outcome = await pollDeviceFlow({ clientId, clientSecret, deviceCode, fetchImpl });
		} catch (error) {
			// 网络抖动不终止流程：保持 pending，下一轮再试。
			return;
		}
		if (outcome.status === DEVICE_FLOW_STATUS.COMPLETED) {
			stop();
			fire(DEVICE_FLOW_STATUS.COMPLETED);
			onToken?.(outcome.token, outcome.scope);
			return;
		}
		if (outcome.status === DEVICE_FLOW_STATUS.EXPIRED || outcome.status === DEVICE_FLOW_STATUS.DENIED || outcome.status === DEVICE_FLOW_STATUS.FAILED) {
			stop();
			fire(outcome.status);
			return;
		}
		if (outcome.slowDown) intervalMs = Math.min(intervalMs + 5000, 60000);
	};
	const start = () => {
		if (stopped || timer !== null) return;
		timer = setInterval(() => { void tick(); }, intervalMs);
	};
	const stop = () => {
		stopped = true;
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	};
	start();
	return { stop, status: () => status };
}
