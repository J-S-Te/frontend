// 自动生成的默认 all 入口；Vite 按发行选择在内存中替换本模块。
import module0 from '../platform/module.js'
import module1 from '../project_management/module.js'
import module2 from '../settlement/module.js'
import module3 from '../contract_management/module.js'
import module4 from '../customer_opportunity/module.js'
import module5 from '../customer_portal/module.js'
import module6 from '../reimbursement/module.js'
import module7 from '../data_analysis/module.js'
export const frontendModules = Object.freeze([module0, module1, module2, module3, module4, module5, module6, module7])
export const businessViews = Object.freeze({ProjectManagementView: () => import('../project_management/views/ProjectManagementView.vue'),
SettlementView: () => import('../settlement/views/SettlementView.vue'),
ContractManagementView: () => import('../contract_management/views/ContractManagementView.vue'),
CustomerOpportunityView: () => import('../customer_opportunity/views/CustomerOpportunityView.vue'),
CRMLoginCompleteView: () => import('../customer_opportunity/views/CRMLoginCompleteView.vue'),
CustomerPortalView: () => import('../customer_portal/views/CustomerPortalView.vue'),
ReimbursementView: () => import('../reimbursement/views/ReimbursementView.vue'),
DataAnalysisView: () => import('../data_analysis/views/DashboardShellView.vue')})
export const sessionLoaders = Object.freeze({Project: async () => (await import('../project_management/api/projectManagement.js')).ensureProjectSession(),
Settlement: async () => (await import('../settlement/api/settlement.js')).ensureSettlementSession(),
Contract: async () => (await import('../contract_management/api/contract.js')).ensureContractSession(),
CRM: async () => (await import('../customer_opportunity/api/client.js')).ensureCRMSession(),
Portal: async () => (await import('../customer_portal/api/portal.js')).ensurePortalSession(),
Reimbursement: async () => (await import('../reimbursement/api/reimbursement.js')).ensureReimbursementSession(),
DataAnalysis: async () => (await import('../data_analysis/api/dataAnalysis.js')).ensureDataAnalysisSession()})
export const sessionSystems = Object.freeze([["Platform","VITE_API_BASE_URL","/api/v1"],["Project","VITE_PROJECT_PUBLIC_PATH_PREFIX","/project_management"],["Settlement","VITE_SETTLEMENT_PUBLIC_PATH_PREFIX","/settlement"],["Contract","VITE_CONTRACT_PUBLIC_PATH_PREFIX","/contract_management"],["CRM","VITE_CRM_PUBLIC_PATH_PREFIX","/customer-opportunity"],["Portal","VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX","/customer-portal"],["Reimbursement","VITE_REIMBURSEMENT_PUBLIC_PATH_PREFIX","/reimbursement"],["DataAnalysis","VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX","/data_analysis"]])
export const unavailablePrefixes = Object.freeze([])
