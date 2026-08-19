/**
 * GitHub REST API v3 客户端（零依赖，基于全局 fetch）。
 *
 * 安全约定（对应验收标准 5：token 不出现于日志与工具输出）：
 *  - token 只进入 `Authorization: Bearer` 请求头，绝不进 URL、请求体、日志；
 *  - 日志只记录方法 + 路径 + 状态码；
 *  - 构造错误信息时对任何可能回显的内容做 `redact()` 防御性脱敏。
 *
 * @module dsh-github/client
 */

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_WEB_BASE = "https://github.com";

/** 插件统一的 GitHub API 版本头。 */
export const GITHUB_API_VERSION = "2022-11-28";

/** 插件自身的 User-Agent（GitHub 要求自定义 UA，空 UA 会被拒绝）。 */
export const USER_AGENT = "dsh-github-plugin/1.0";

/** 工具错误基类：code 用于模型识别（如 GITHUB_AUTH_REQUIRED）。 */
export class GithubError extends Error {
	constructor(message, code = "GITHUB_ERROR", info = {}) {
		super(message);
		this.name = "GithubError";
		this.code = code;
		if (info.status !== void 0) this.status = info.status;
		if (info.path !== void 0) this.path = info.path;
		if (info.rateLimit !== void 0) this.rateLimit = info.rateLimit;
	}
}

/** 认证缺失 / 401：提示重新登录。 */
export class GithubAuthError extends GithubError {
	constructor(message = "GitHub 未认证或 token 已失效：请配置 GITHUB_TOKEN 或调用 github_auth_login 完成 OAuth Device Flow 登录。") {
		super(message, "GITHUB_AUTH_REQUIRED");
		this.name = "GithubAuthError";
	}
}

/** GitHub API 4xx/5xx。 */
export class GithubApiError extends GithubError {
	constructor(status, message, path, rateLimit) {
		super(message, `GITHUB_HTTP_${status}`, { status, path, rateLimit });
		this.name = "GithubApiError";
	}
}

/** 防御性脱敏：把 token 从任意文本中抹掉（错误信息、渲染文本兜底）。 */
export function redact(text, token) {
	if (typeof text !== "string" || typeof token !== "string" || token.length === 0) return text;
	return text.split(token).join("***");
}

/**
 * 创建 GitHub API 客户端。
 * @param {object} options
 * @param {() => Promise<{token: string, source: string} | null>} options.resolveToken - 每次请求前解析 token。
 * @param {{warn?: Function, error?: Function}} [options.logger] - 可选日志器；只记录方法/路径/状态码。
 * @param {number} [options.timeoutMs] - 单请求超时。
 * @param {string} [options.baseUrl] - API 基址（测试可注入）。
 * @param {typeof fetch} [options.fetchImpl] - fetch 实现（测试注入）。
 * @returns {{request: Function, baseUrl: string, resolveToken: Function}}
 */
export function createClient(options = {}) {
	const {
		resolveToken,
		logger,
		timeoutMs = 30000,
		baseUrl = GITHUB_API_BASE,
		fetchImpl
	} = options;
	const fetchFn = fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : void 0);
	if (typeof fetchFn !== "function") throw new Error("dsh-github: no fetch implementation available (Node >= 22 required)");

	/**
	 * 发一次 GitHub REST 请求。
	 * @param {string} method - HTTP 方法。
	 * @param {string} path - API 路径，如 `/repos/owner/repo`。
	 * @param {object} [opts]
	 * @param {object} [opts.query] - 查询参数（跳过 undefined/null/空串）。
	 * @param {object} [opts.body] - JSON 请求体。
	 * @param {boolean} [opts.raw] - true 时返回原始文本（diff 等）。
	 * @param {string} [opts.accept] - Accept 覆盖（如 diff）。
	 * @param {AbortSignal} [opts.signal] - 外部取消信号（exec.signal）。
	 * @param {string} [opts.token] - 显式 token（默认走 resolveToken）。
	 * @returns {Promise<{data?: any, text?: string, rateLimit?: object}>}
	 */
	async function request(method, path, opts = {}) {
		const { query, body, raw = false, accept, signal, token: explicitToken } = opts;
		let token = explicitToken;
		let source = "explicit";
		if (token === void 0) {
			const resolved = await resolveToken();
			if (resolved === null) throw new GithubAuthError();
			token = resolved.token;
			source = resolved.source;
		}
		const url = new URL(baseUrl + path);
		if (query !== void 0) {
			for (const [key, value] of Object.entries(query)) {
				if (value === void 0 || value === null || value === "") continue;
				url.searchParams.set(key, String(value));
			}
		}
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const combined = signal !== void 0 ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
		let response;
		try {
			response = await fetchFn(url, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: accept ?? "application/vnd.github+json",
					"X-GitHub-Api-Version": GITHUB_API_VERSION,
					"User-Agent": USER_AGENT,
					...(body !== void 0 ? { "Content-Type": "application/json" } : {})
				},
				body: body !== void 0 ? JSON.stringify(body) : void 0,
				signal: combined
			});
		} catch (error) {
			if (error?.name === "AbortError" || error?.name === "TimeoutError") {
				throw new GithubError(`GitHub 请求超时（${timeoutMs}ms）：${method} ${path}`, "GITHUB_TIMEOUT", { path });
			}
			throw new GithubError(`GitHub 网络请求失败：${error?.message ?? String(error)}`, "GITHUB_NETWORK", { path });
		}
		const rateLimit = {
			remaining: response.headers.get("x-ratelimit-remaining"),
			limit: response.headers.get("x-ratelimit-limit"),
			reset: response.headers.get("x-ratelimit-reset")
		};
		logger?.warn?.(`github api ${method} ${path} -> ${response.status} (rate ${rateLimit.remaining}/${rateLimit.limit})`);

		if (!response.ok) {
			let message = `GitHub API ${response.status} ${response.statusText}`;
			try {
				const data = await response.json();
				if (typeof data?.message === "string") message = redact(data.message, token);
				if (Array.isArray(data?.errors) && data.errors.length > 0) {
					const detail = data.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).join("; ");
					message = `${message}（${detail}）`;
				}
			} catch { /* 非 JSON 错误体：保留默认文案 */ }
			if (response.status === 401) throw new GithubAuthError(`GitHub 认证失败（401）：${message}`);
			throw new GithubApiError(response.status, message, path, rateLimit);
		}
		if (raw) return { text: await response.text(), rateLimit };
		if (response.status === 204 || response.headers.get("content-length") === "0") return { data: void 0, rateLimit };
		const data = await response.json();
		return { data, rateLimit };
	}

	return { request, baseUrl, resolveToken };
}
