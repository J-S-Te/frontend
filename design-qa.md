## 证据

- 视觉基准：`/Users/yglf/GOPATH/src/Unified_Identity_Authentication_Platform/customer_and_opportunity/原型/客户与商机管理子系统-管理端（含售前技术支持）.html`，重点为 `presale-list` 和 `presale-request-create` 状态。
- 实现文件：`/Users/yglf/GOPATH/src/Unified_Identity_Authentication_Platform/frontend/src/modules/customer_opportunity/views/CustomerOpportunityView.vue`。
- 目标视口：响应式桌面 Web 应用，沿用 620 CSS px 移动端断点。
- 源文件与实现页面的像素尺寸/密度归一化：暂不可用。当前环境无法启动本地预览服务，也没有可复用的已登录浏览器页面。
- 页面状态：默认售前列表和独立的新建申请页面。
- 全页面比对证据：因无法捕获浏览器渲染截图，暂未完成。
- 局部区域比对证据：因同一原因，暂未完成。

## 检查结论

- Code and specification review found no remaining functional mismatch in the requested flow: the default page contains only the filters plus list/board, “新建申请” is permission/capability gated, creation is a separate page state, and cancel/success returns to the list.
- 字体和排版：沿用现有产品 Token 与组件排版；渲染后的视觉一致性尚未完成截图复核。
- 间距和布局节奏：移除了过时的列表/表单双栏布局，新建表单沿用现有面板节奏并限制最大宽度为 780 px；渲染后的视觉一致性尚未完成截图复核。
- 颜色和视觉 Token：复用 CRM 语义 Token、按钮和面板样式；渲染后的视觉一致性尚未完成截图复核。
- 图片和资源：涉及状态没有新增位图、Logo、插画或非标准图标资源。
- 文案和内容：与原型意图一致，保留“新建申请”、返回列表、独立表单以及生产字段校验语义。

## 比对历史

- Initial code review found a P1 information-architecture mismatch: the create form was permanently displayed beside the list. Fixed by separating the list and create states and moving creation behind the primary action.
- Follow-up contract review found a potential P1 data-source regression: presale filter options only enumerate opportunities already present in visible presale requests, so they cannot safely serve as the create selector. Fixed by retaining the existing explicit visible opportunity-ID input until the documented create-context endpoint is implemented.
- Post-fix browser visual evidence remains unavailable because the preview could not be started in this environment.

## 实现检查清单

- [x] Default presale page shows list/board only.
- [x] Create action is gated by `presale.create` and runtime submission readiness.
- [x] Independent create state supports cancel and successful return to page 1 of the list.
- [x] Existing opportunity-detail locked-create flow remains intact.
- [x] Responsive form rows collapse at the existing mobile breakpoint.
- [x] Targeted test suite passes (67/67) and Vite production build succeeds.
- [ ] Capture and compare the rendered list and create states once a local authenticated preview is available.

## 后续优化

- Replace the numeric opportunity-ID field with the documented scoped `presale-create-context` selector when that endpoint is implemented.

final result: blocked
