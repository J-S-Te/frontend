import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前后端联调说明：
//   1. 本地启动后端（cd ../platform && go run ./cmd/api）监听 8080。
//   2. 前端 vite dev server 监听 5173，把基础平台 /api/v1/* 反代到后端 8080。
//   3. 如果需要指向已部署的环境，把 API_BASE_URL 改成绝对 URL（必须带 https/http 协议），
//      此时浏览器会直接走跨域请求，需后端 CORS 放行；本地联调时不要设置。
const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:8080'
const DEFAULT_CONTRACT_API_PROXY_TARGET = 'http://127.0.0.1:8081'
const DEFAULT_PROJECT_API_PROXY_TARGET = 'http://127.0.0.1:8082'
const DEFAULT_SETTLEMENT_API_PROXY_TARGET = 'http://127.0.0.1:8085'
// customer-api is kept inside the local Compose network. The local Vite server
// reaches it through the loopback-only port published by compose.local.yaml.
const DEFAULT_CUSTOMER_OPPORTUNITY_PROXY_TARGET = 'http://127.0.0.1:18083'
const DEFAULT_CUSTOMER_PORTAL_PROXY_TARGET = 'http://127.0.0.1:8091'
const DEFAULT_DATA_ANALYSIS_PROXY_TARGET = 'http://127.0.0.1:8080'
const PROXIED_PATHS = ['/api', '/authorize', '/oauth2', '/.well-known']
const CONTRACT_BACKEND_PATHS = [
  '/contract_management/api',
  '/contract_management/auth',
  '/contract_management/logged-out',
  '/contract_management/healthz',
]
const PROJECT_BACKEND_PATHS = [
  '/project_management/api',
  '/project_management/auth',
  '/project_management/logged-out',
  '/project_management/healthz',
]
const SETTLEMENT_BACKEND_PATHS = [
  '/settlement/api',
  '/settlement/auth',
  '/settlement/logged-out',
  '/settlement/healthz',
  '/settlement/readyz',
]
const DATA_ANALYSIS_BACKEND_PATHS = [
  '/data_analysis/api',
  '/data_analysis/auth',
  '/data_analysis/logged-out',
  '/data_analysis/healthz',
  '/data_analysis/readyz',
]

function apiProxy(target) {
  return {
    target,
    changeOrigin: true,
    secure: false,
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  const contractProxyTarget = env.VITE_CONTRACT_API_PROXY_TARGET || DEFAULT_CONTRACT_API_PROXY_TARGET
  const projectProxyTarget = env.VITE_PROJECT_API_PROXY_TARGET || DEFAULT_PROJECT_API_PROXY_TARGET
  const settlementProxyTarget = env.VITE_SETTLEMENT_API_PROXY_TARGET || DEFAULT_SETTLEMENT_API_PROXY_TARGET
  const customerOpportunityProxyTarget = env.VITE_CUSTOMER_OPPORTUNITY_PROXY_TARGET || DEFAULT_CUSTOMER_OPPORTUNITY_PROXY_TARGET
  const customerPortalProxyTarget = env.VITE_CUSTOMER_PORTAL_PROXY_TARGET || DEFAULT_CUSTOMER_PORTAL_PROXY_TARGET
  const dataAnalysisProxyTarget = env.VITE_DATA_ANALYSIS_PROXY_TARGET || DEFAULT_DATA_ANALYSIS_PROXY_TARGET

  const proxy = Object.fromEntries(PROXIED_PATHS.map((path) => [path, apiProxy(proxyTarget)]))
  for (const path of CONTRACT_BACKEND_PATHS) {
    proxy[path] = {
      ...apiProxy(contractProxyTarget),
      rewrite: (requestPath) => requestPath.replace(/^\/contract_management/, ''),
    }
  }
  for (const path of PROJECT_BACKEND_PATHS) {
    proxy[path] = {
      ...apiProxy(projectProxyTarget),
      rewrite: (requestPath) => requestPath.replace(/^\/project_management/, ''),
    }
  }
  for (const path of SETTLEMENT_BACKEND_PATHS) {
    proxy[path] = {
      ...apiProxy(settlementProxyTarget),
      rewrite: (requestPath) => requestPath.replace(/^\/settlement/, ''),
    }
  }
  // CRM and the external-customer Portal are independent services and both
  // retain their public path prefix at the backend boundary.
  proxy['/customer-opportunity'] = apiProxy(customerOpportunityProxyTarget)
  proxy['/customer-portal'] = apiProxy(customerPortalProxyTarget)
  // 数据分析后端自身保留 /data_analysis 前缀；只代理会话、API 和健康检查，
  // 页面路径继续交给 Vite 的 SPA fallback，避免开发服务器把 Vue 页面转发给 API。
  for (const path of DATA_ANALYSIS_BACKEND_PATHS) {
    proxy[path] = apiProxy(dataAnalysisProxyTarget)
  }

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy,
    },
    build: {
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          login: fileURLToPath(new URL('./login.html', import.meta.url)),
        },
        output: {
          // 第三方运行时单独缓存，避免平台主入口随业务代码变更整体失效，
          // 同时把首屏主包控制在构建告警阈值以内。
          manualChunks(id) {
            if (id.includes('/node_modules/')) return 'vendor'
            return undefined
          },
        },
      },
    },
  }
})
