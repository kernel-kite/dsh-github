/**
 * 工具聚合：把所有域的工具定义拼成一个数组，供插件 apply() 注册，
 * 也供测试直接调用 buildTools(runtime) 校验。
 *
 * @module dsh-github/tools
 */

import { buildAuthTools } from "./tools/auth.js";
import { buildRepoTools } from "./tools/repos.js";
import { buildIssueTools } from "./tools/issues.js";
import { buildPullTools } from "./tools/pulls.js";
import { buildCommitTools } from "./tools/commits.js";
import { buildSearchTools } from "./tools/search.js";
import { buildReleaseTools } from "./tools/releases.js";
import { buildOrgTools } from "./tools/orgs.js";
import { buildWorkflowTools } from "./tools/workflow.js";

/**
 * 构建全部工具定义。
 * @param {object} runtime - { api, config, state, ctx, logger }。
 * @returns {Array<object>} defineTool 产物数组。
 */
export function buildTools(runtime) {
	return [
		...buildAuthTools(runtime),
		...buildRepoTools(runtime),
		...buildIssueTools(runtime),
		...buildPullTools(runtime),
		...buildCommitTools(runtime),
		...buildSearchTools(runtime),
		...buildReleaseTools(runtime),
		...buildOrgTools(runtime),
		...buildWorkflowTools(runtime)
	];
}

/** 工具总数（供文档/测试断言）。 */
export const TOOL_COUNT = 45;
