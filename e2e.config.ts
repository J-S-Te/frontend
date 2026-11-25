import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'

/**
 * 用途：声明 e2e 端到端测试的运行配置，目标指向本地 Vite 开发服务器。
 * 参数：无，应用地址可由 APP_URL 覆盖，测试账号由 E2E_ADMIN_* 提供。
 * 返回值：默认导出的 E2EConfig 配置对象。
 */
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173'

// 指向已部署的构建产物（如本地 8081 容器）时，用 E2E_SERVER=external 让 e2e 不再拉起 dev server。
const useManagedServer = process.env.E2E_SERVER !== 'external'

// 设置 E2E_CDP_ENDPOINT 时改为连接外部 Chromium：
// 同一浏览器可被 Midscene 等第二个消费者接管，实现"同页混用"。
const cdpEndpoint = process.env.E2E_CDP_ENDPOINT

// 未配置测试账号时不下发 credentials 块：e2e 在加载配置阶段会校验每个密码，
// 密码缺失会让 list/run 等所有命令以 INVALID_CONFIG 失败，连零模型的冒烟测试也跑不了。
// 本地与线上是两套独立数据，口令不同：本地优先读 E2E_LOCAL_*，未设置时退回 E2E_ADMIN_*。
const localPassword = process.env.E2E_LOCAL_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD
const adminCredentials =
  localPassword && localPassword.length >= 6
    ? {
        admin: {
          username: process.env.E2E_LOCAL_USERNAME ?? process.env.E2E_ADMIN_USERNAME ?? 'admin',
          password: localPassword,
        },
      }
    : undefined

export default {
  projectId: 'basic-platform-frontend',
  targets: [
    {
      name: 'chromium',
      engine: web({
        viewport: { width: 1440, height: 900 },
        ...(cdpEndpoint ? { connect: { cdpEndpoint: async () => cdpEndpoint } } : {}),
      }),
      app: {
        url: appUrl,
        // 使用本仓启动的开发服务器，避免误测占用同一端口的其他应用。
        ...(useManagedServer
          ? {
              command: {
                executable: 'npm',
                args: ['run', 'dev', '--', '--port', new URL(appUrl).port || '5173', '--strictPort'],
              },
            }
          : {}),
      },
    },
  ],
  ...(adminCredentials ? { credentials: adminCredentials } : {}),
  timeout: 60_000,
  actionTimeout: 10_000,
  assertionTimeout: 10_000,
  workers: 1,
  reporters: ['list'],
  video: 'retain-on-failure',
} satisfies E2EConfig
