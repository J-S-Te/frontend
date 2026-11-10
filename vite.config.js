import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { selectedModulesPlugin } from './build/moduleSelection.mjs'

// 前后端联调说明：
//   1. 本地启动后端（cd ../platform && go run ./cmd/api）监听 8080。
//   2. 前端 Vite 开发服务器 监听 5173，把基础平台 /api/v1/* 反代到后端 8080。
//   3. 如果需要指向已部署的环境，把 API_BASE_URL 改成绝对 URL（必须带 https/http 协议），
//      此时浏览器会直接走跨域请求，需后端 CORS 放行；本地联调时不要设置。
const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:8080'
const DEFAULT_CONTRACT_API_PROXY_TARGET = 'http://127.0.0.1:8081'
const DEFAULT_PROJECT_API_PROXY_TARGET = 'http://127.0.0.1:8082'
const DEFAULT_REIMBURSEMENT_API_PROXY_TARGET = 'http://127.0.0.1:8087'
const DEFAULT_SETTLEMENT_API_PROXY_TARGET = 'http://127.0.0.1:8085'
// customer-api 保留在本地 Compose 网络内。本地 Vite 服务器
// 通过 compose.local.yaml 仅向回环地址发布的端口访问它。
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

// apiProxy 构造本地联调反向代理选项。
// 参数：target 为显式配置或默认回环后端地址。
// 返回值：Vite 代理配置。
function apiProxy(target) {
  return {
    target,
    changeOrigin: true,
    // SEC-N7：默认代理目标全是 http://127.0.0.1:*，secure 对其无影响；
    // 仅当通过 VITE_*_PROXY_TARGET 显式指向“本地自签证书”的 https 后端时才需要
    // 跳过证书校验。保留 false 只服务该本地自签场景，不要用于跨主机代理。
    secure: false,
  }
}

// SEC-N7：dev/preview 默认只绑定回环地址，避免开发服务器把源码与 HMR 端口
// 暴露到局域网（0.0.0.0 会让同网段任意主机访问未构建源码与代理通道）。
// 需要临时开 LAN 联调时显式传 VITE_HOST=0.0.0.0；多个允许的 Host 头用逗号分隔。
// devHostConfig 限定开发入口主机及允许的 Host。
// 参数：env 为开发公开配置。
// 返回值：开发及预览服务器的主机限制。
function devHostConfig(env) {
  const allowedHosts = String(env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  return {
    host: env.VITE_HOST || '127.0.0.1',
    // 补齐 allowedHosts：除回环地址外，只放行显式配置的主机名，
    // 防止 DNS-rebinding / Host 头伪造让攻击者以合法来源打到开发服务器。
    allowedHosts: ['localhost', '127.0.0.1', '[::1]', '.localhost', ...allowedHosts],
  }
}

// 主题引导脚本的 CSP 哈希校验。
// 生产 nginx 的 script-src 只有 'self' 加 index.html / login.html 里那段首帧主题脚本的
// 内容哈希（不放 'unsafe-inline'），因此内联脚本只要变动一个字节，哈希就失配、脚本在
// 生产被拦截，深色用户会重新看到白闪；而 vite dev / preview 没有 CSP，本地完全看不出来。
// 这里把「改脚本没同步 nginx 哈希」提前成构建失败，避免它只在生产暴露。
// 参数：无。
// 返回值：Vite 插件；构建产物里每个 HTML 的内联 <script> 哈希都必须出现在每条 CSP 的
// script-src 中，nginx/default.conf 不存在时（例如裁剪过的前端包）跳过校验。
function themeCspHashPlugin() {
  const cspFile = fileURLToPath(new URL('./nginx/default.conf', import.meta.url))
  let outDir = ''
  return {
    name: 'theme-csp-hash',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    // 用 closeBundle 读盘而不是 generateBundle：HTML 资源由 Vite 自己的插件在
    // 其 generateBundle 阶段写入，排在更早的插件拿不到；读盘校验的就是 nginx 将要
    // 提供的同一份文件。
    closeBundle() {
      if (!existsSync(cspFile) || !outDir || !existsSync(outDir)) return
      const cspLines = readFileSync(cspFile, 'utf8')
        .split('\n')
        .filter((line) => line.includes('add_header Content-Security-Policy') && line.includes('script-src'))
      if (cspLines.length === 0) return
      // 不允许为了让内联脚本过关而放开 'unsafe-inline'：哈希白名单已经足够。
      const weakened = cspLines.filter((line) => /script-src[^;]*'unsafe-inline'/.test(line))
      if (weakened.length > 0) {
        this.error(`[theme-csp-hash] nginx/default.conf 有 ${weakened.length} 条 CSP 的 script-src 放开 'unsafe-inline'；内联主题脚本应使用 'sha256-…' 哈希白名单，不要放宽脚本源。`)
      }
      const inlineScripts = new Map()
      for (const fileName of readdirSync(outDir, { recursive: true, encoding: 'utf8' })) {
        if (!fileName.endsWith('.html')) continue
        const html = readFileSync(join(outDir, fileName), 'utf8')
        // 只匹配没有属性的内联 <script>：带 src 的是同源外链，由 'self' 放行。
        for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
          const hash = `sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}`
          inlineScripts.set(hash, fileName)
        }
      }
      for (const [hash, fileName] of inlineScripts) {
        const missing = cspLines.filter((line) => !line.includes(hash))
        if (missing.length > 0) {
          this.error(`[theme-csp-hash] ${fileName} 的内联脚本哈希 ${hash} 未写入 nginx/default.conf 的 ${missing.length} 条 CSP script-src；生产环境会按 CSP 拦截该脚本（深色主题白闪）。请把该哈希同步到所有 script-src 指令。`)
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET
  const contractProxyTarget = env.VITE_CONTRACT_API_PROXY_TARGET || DEFAULT_CONTRACT_API_PROXY_TARGET
  const projectProxyTarget = env.VITE_PROJECT_API_PROXY_TARGET || DEFAULT_PROJECT_API_PROXY_TARGET
  const reimbursementProxyTarget = env.VITE_REIMBURSEMENT_API_PROXY_TARGET || DEFAULT_REIMBURSEMENT_API_PROXY_TARGET
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
  for (const path of ['/reimbursement/api', '/reimbursement/auth', '/reimbursement/logged-out',
    '/reimbursement/healthz', '/reimbursement/readyz']) {
    proxy[path] = { ...apiProxy(reimbursementProxyTarget),
      rewrite: (requestPath) => requestPath.replace(/^\/reimbursement/, '') }
  }
  for (const path of SETTLEMENT_BACKEND_PATHS) {
    proxy[path] = {
      ...apiProxy(settlementProxyTarget),
      rewrite: (requestPath) => requestPath.replace(/^\/settlement/, ''),
    }
  }
  // CRM 与外部客户门户是独立服务，二者在后端边界
  // 均保留各自的公开路径前缀。
  proxy['/customer-opportunity'] = apiProxy(customerOpportunityProxyTarget)
  proxy['/customer-portal'] = apiProxy(customerPortalProxyTarget)
  // 数据分析后端自身保留 /data_analysis 前缀；只代理会话、API 和健康检查，
  // 页面路径继续交给 Vite 的 SPA 回退逻辑，避免开发服务器把 Vue 页面转发给 API。
  for (const path of DATA_ANALYSIS_BACKEND_PATHS) {
    proxy[path] = apiProxy(dataAnalysisProxyTarget)
  }

  return {
    plugins: [themeCspHashPlugin(), selectedModulesPlugin(env.VITE_ENABLED_MODULES, env), vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      ...devHostConfig(env),
      proxy,
    },
    preview: {
      port: 4173,
      strictPort: true,
      ...devHostConfig(env),
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
          // manualChunks 按运行时依赖划分缓存。
          // 参数：id 为已解析的编译模块路径。
          // 返回值：共享块名称；业务模块由构建器按需分块。
          manualChunks(id) {
            // Keep the credential crypto library out of the eager vendor chunk;
            // it is dynamically imported only when an encrypted credential route runs.
            if (id.includes('/node_modules/node-forge/')) return 'credential-forge'
            // pdf.js 体积大且只在打开合同原件预览时用到，单独切块以保持首屏体积；
            // 由 contractPDFRuntime 动态 import，未打开预览的页面不会下载。
            if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf-engine'
            // 批量导入的姓名转拼音只在 IAM 批量建员工对话框解析 CSV 时用到；
            // 单独成块后即使该对话框静态 import 也不会进入首屏 vendor。
            if (id.includes('/node_modules/pinyin-pro/')) return 'pinyin'
            // 合同 Excel 导入的读取器与解压依赖按需加载，不随首屏 vendor 下发。
            if (id.includes('/node_modules/read-excel-file/')) return 'excel'
            if (id.includes('/node_modules/fflate/')) return 'excel'
            if (id.includes('/node_modules/')) return 'vendor'
            return undefined
          },
        },
      },
    },
  }
})
