/**
 * 工具定义公共辅助：参数 schema DSL（dsh-tools ParameterSchemaSpec）构造器、
 * 输出 schema、运行时辅助（owner 解析、当前用户缓存）。
 *
 * @module dsh-github/tools/common
 */

/** 字符串参数。 */
export function s(description, required = false) {
	return { type: "string", ...(required ? { required: true } : {}), description };
}

/** 数字参数。 */
export function n(description, required = false) {
	return { type: "number", ...(required ? { required: true } : {}), description };
}

/** 整数参数。 */
export function i(description, required = false) {
	return { type: "integer", ...(required ? { required: true } : {}), description };
}

/** 布尔参数。 */
export function b(description, required = false) {
	return { type: "boolean", ...(required ? { required: true } : {}), description };
}

/** 枚举参数。 */
export function e(description, values, required = false) {
	return { type: "string", enum: values, ...(required ? { required: true } : {}), description };
}

/** 数组参数。 */
export function arr(items, description, required = false) {
	return { type: "array", items, ...(required ? { required: true } : {}), description };
}

/** 对象参数。 */
export function obj(properties, additionalProperties = false, description, required = false) {
	return {
		type: "object",
		properties,
		additionalProperties,
		...(description !== void 0 ? { description } : {}),
		...(required ? { required: true } : {})
	};
}

/** 文件条目参数（push_files / upload_project 共用）。 */
export function fileEntry(description = "要写入的文件：path 为仓库内路径，content 为 UTF-8 文本内容") {
	return obj({
		path: s("仓库内文件路径，如 `src/index.js`", true),
		content: s("文件文本内容（UTF-8）", true),
		encoding: e("编码（可选）：base64 表示 content 已为 base64；缺省按 UTF-8 处理", ["utf-8", "base64"])
	}, false, description);
}

/** 宽松输出 schema：完整透传 GitHub 原始响应（结构由 render 呈现）。 */
export const RAW_OUTPUT = { schema: { type: "json" } };

/**
 * 获取当前认证用户（带进程内缓存）。
 * @param {object} runtime - { api, state }。
 * @returns {Promise<object>} GitHub user 对象。
 */
export async function currentUser(runtime) {
	if (runtime.state?.authInfo?.login) return runtime.state.authInfo;
	const { data } = await runtime.api.request("GET", "/user");
	runtime.state.authInfo = data;
	return data;
}

/**
 * 解析 owner：缺省用当前认证用户登录名。
 * @param {string | undefined} owner
 * @param {object} runtime
 * @returns {Promise<string>}
 */
export async function resolveOwner(owner, runtime) {
	if (typeof owner === "string" && owner.length > 0) return owner;
	const user = await currentUser(runtime);
	return user.login;
}

/** 对路径段做 URL 编码（分支名含斜杠时保留）。 */
export function enc(segment) {
	return encodeURIComponent(String(segment));
}

/** 提交的 web 地址。 */
export function commitWebUrl(owner, repo, sha) {
	return `https://github.com/${owner}/${repo}/commit/${sha}`;
}

/** 组合输出对象：把 GitHub 响应 + 派生字段拼成工具 value。 */
export function withText(value, text) {
	return { ...value, text };
}
