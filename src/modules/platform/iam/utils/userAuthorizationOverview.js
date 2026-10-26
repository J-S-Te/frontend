/**
 * 兼容入口：有效授权总览的聚合实现位于 effectiveAuthorizationOverview.js。
 * 现有调用方仍可从这里导入，避免在展示改造期间同时改两套调用契约。
 */
export { buildUserAuthorizationOverview } from './effectiveAuthorizationOverview.js'
