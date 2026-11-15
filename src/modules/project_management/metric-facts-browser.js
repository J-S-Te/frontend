import { createApp, h } from 'vue'
import ResourceMetricFactsPanel from './components/ResourceMetricFactsPanel.vue'
import ReportReviewFactsPanel from './components/ReportReviewFactsPanel.vue'

const role = new URLSearchParams(location.search).get('role') || 'quality'
const permissions = {
  quality: ['project.read', 'project.person_capacity.manage', 'project.resource_usage.confirm', 'project.report.review'],
  device: ['project.read', 'project.equipment_capacity.manage', 'project.device.manage', 'project.resource_usage.record'],
  engineer: ['project.read', 'project.field.execute', 'project.resource_usage.record'],
}
const session = { user_id: role, permissions: permissions[role] }
const items = [{ id: 'SI-running', project_id: 'PJ-1', site: '进行中现场', status: '实施中' }, { id: 'SI-done', project_id: 'PJ-2', site: '已完成现场', status: '已完成' }]
createApp({
  // 用途：挂载真实业务组件，仅用合成会话及浏览器拦截HTTP作为组件回归夹具。
  // 参数：无。
  // 返回值：真实组件树；不连接SSO或业务数据库。
  render() {
    return h('main', { style: 'max-width:1100px;margin:20px auto;font-family:sans-serif' }, [
      h('h1', `项目指标组件回归：${role}`),
      h(ResourceMetricFactsPanel, { session, items, resources: [{ resource_type: 'PERSON', resource_id: 'person', resource_name: '测试人员' }], equipment: [{ resource_type: 'EQUIPMENT', resource_id: 'device', resource_name: '测试设备' }] }),
      role === 'quality' ? h(ReportReviewFactsPanel, { session, item: { id: 'SI-running', report_revision: 0, report_status: 'COMPILING', version: 5 } }) : null,
    ])
  },
}).mount('#app')
