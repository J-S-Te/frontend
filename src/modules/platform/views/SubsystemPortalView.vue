<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AuthError, getCurrentPrincipal, logoutCurrentSession } from '@/modules/platform/auth/api/auth'
import { AUTHORIZATION_REFRESHED_EVENT } from '@/modules/platform/auth/utils/authorizationRefresh'
import { ApplicationRegistryError, listPortalApplications } from '@/modules/platform/applications/api/applications'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { buildPortalSubsystems } from '@/modules/registry/moduleRegistry.js'
import {
  canAccessPlatformConsole,
  platformConsoleLandingRoute,
} from '@/modules/platform/auth/utils/platformConsoleAccess'
import '@/modules/platform/styles/subsystem-portal.css'

const router = useRouter()
const canvasRef = ref(null)
const userMenuRef = ref(null)
const toast = ref({ visible: false, message: '', type: '' })
const currentPrincipal = ref(null)
const isPrincipalLoading = ref(true)
const isLoggingOut = ref(false)
const userMenuOpen = ref(false)
const principalLoadFailed = ref(false)
const registeredSubsystems = ref([])
const subsystemCatalogLoading = ref(true)
const subsystemCatalogError = ref('')
const portalEnvironment = String(import.meta.env?.VITE_PORTAL_ENVIRONMENT || '').trim().toLowerCase()

const userDisplayName = computed(() => {
  const principal = currentPrincipal.value
  if (principal?.user?.name) {
    return principal.user.name
  }
  if (principal?.account?.name) {
    return principal.account.name
  }
  return principalLoadFailed.value ? '用户信息暂不可用' : '当前登录用户'
})

const accountDisplayName = computed(() => {
  const account = currentPrincipal.value?.account
  if (!account) {
    return isPrincipalLoading.value ? '正在读取账号信息' : '账号信息暂不可用'
  }
  return account.code || account.name || '账号信息暂不可用'
})

const userAvatarText = computed(() => {
  const name = userDisplayName.value.trim()
  return Array.from(name).slice(0, 2).join('') || '用户'
})

const roleNames = computed(() => {
  const roles = currentPrincipal.value?.roles
  if (!Array.isArray(roles) || roles.length === 0) {
    return '未分配角色'
  }
  return roles.map((role) => role.name || role.code || role.id).filter(Boolean).join('、') || '未分配角色'
})

// 代码模块和运行时接入是两层概念：除内置平台外，门户卡片必须来自
// 当前租户的后端应用目录，不能因为 src/modules 下存在目录就自动开放访问。
const subsystems = computed(() => {
  const platformRoute = platformConsoleLandingRoute(currentPrincipal.value)
  return buildPortalSubsystems(registeredSubsystems.value, {
    includeBuiltInPlatform: canAccessPlatformConsole(currentPrincipal.value),
  }).map((subsystem) => (
    subsystem.source === 'built-in' ? { ...subsystem, route: platformRoute } : subsystem
  ))
})

let toastTimer = 0
let projectionRefreshTimer = 0
let animationFrame = 0
let resizeCanvas = null
let particles = []

function showToast(message, type = 'enter') {
  toast.value = { visible: true, message, type }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value.visible = false
  }, 2200)
}

async function loadPortalCatalog({ silent = false } = {}) {
  // 静默刷新（授权后台轮询）不切换加载状态、不清空已有卡片，避免门户每 15 秒
  // 出现“正在加载已接入的子系统…”并整体重绘；仅首次加载时显示加载态。
  if (!silent) {
    subsystemCatalogLoading.value = true
    subsystemCatalogError.value = ''
  }
  try {
    const data = await listPortalApplications({ environment: portalEnvironment })
    registeredSubsystems.value = Array.isArray(data) ? data : []
    if (silent) subsystemCatalogError.value = ''
  } catch (error) {
    if (!silent) {
      registeredSubsystems.value = []
      subsystemCatalogError.value = error instanceof ApplicationRegistryError
        ? error.message
        : '无法加载已接入的子系统。'
    }
    // 静默刷新失败时保留当前卡片，避免后台轮询抖动破坏已展示的门户。
  } finally {
    subsystemCatalogLoading.value = false
  }
}

function onAuthorizationRefreshed(event) {
  const principal = event?.detail?.principal
  if (principal === null) {
    // 退出或换号会在跳转前清空共享授权快照；立即移除用户专属卡片，不能在路由与
    // Set-Cookie 切换期间继续展示上一账号入口。
    currentPrincipal.value = null
    registeredSubsystems.value = []
    isPrincipalLoading.value = true
    subsystemCatalogLoading.value = true
    principalLoadFailed.value = false
    return
  }
  if (principal && typeof principal === 'object') {
    currentPrincipal.value = principal
    isPrincipalLoading.value = false
    principalLoadFailed.value = false
  }
  // 应用入口也属于授权结果。只有角色/权限确实发生变化时才静默重新读取门户目录；
  // 普通 15 秒授权轮询不再刷新页面，也不会触发加载提示或重绘卡片。
  if (event?.detail?.changed) {
    void loadPortalCatalog({ silent: true })
    showToast('角色或权限已更新，已按最新授权刷新可访问应用。', 'enter')
  }
}

async function loadCurrentPrincipal() {
  isPrincipalLoading.value = true
  principalLoadFailed.value = false

  try {
    currentPrincipal.value = await getCurrentPrincipal()
  } catch (error) {
    principalLoadFailed.value = true

    if (error instanceof AuthError && error.status === 401) {
      await router.replace({ name: 'login' })
      return
    }

    showToast(error.message || '当前登录用户信息读取失败，请稍后重试。', 'deny')
  } finally {
    isPrincipalLoading.value = false
  }
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
}

function closeUserMenuWhenClickOutside(event) {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    userMenuOpen.value = false
  }
}

function closeUserMenuOnEscape(event) {
  if (event.key === 'Escape') {
    userMenuOpen.value = false
  }
}

async function logoutApplication() {
  if (isLoggingOut.value) {
    return
  }

  isLoggingOut.value = true

  try {
    await logoutCurrentSession()
    userMenuOpen.value = false
    await router.replace({ name: 'login' })
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      await router.replace({ name: 'login' })
      return
    }

    showToast(error.message || '退出登录失败，请稍后重试。', 'deny')
  } finally {
    isLoggingOut.value = false
  }
}

// 门户入口优先在新标签页打开，避免覆盖门户上下文；如果浏览器拦截弹窗，
// 必须回退到当前窗口，否则用户点击卡片后会看不到任何反馈。
function openSubsystemTarget(targetURL) {
  const target = String(targetURL || '').trim()
  if (!target) return false

  let opened = null
  try {
    // 直接以 noopener 打开时，部分浏览器即使成功也会按规范返回 null，
    // 从而被下面的弹窗拦截兜底误判，造成“新标签页 + 当前页”同时跳转。
    // 先取得同源空白窗口句柄，断开 opener 后再导航，既避免反向控制
    // 门户窗口，也能可靠地区分弹窗是否真的被拦截。
    opened = window.open('', '_blank')
    if (opened) {
      opened.opener = null
      opened.location.replace(target)
      return true
    }
  } catch {
    opened = null
  }

  window.location.assign(target)
  return true
}

function openSubsystem(subsystem) {
  if (!subsystem.allowed) {
    showToast(
      subsystem.projectionNextAction || `「${subsystem.name}」账号权限尚未同步完成，请稍后重试。`,
      'deny',
    )
    return
  }

  if (subsystem.authenticationURL) {
    // 需要统一认证的内嵌子系统不能直接打开 SPA 路由。始终从子系统服务端
    // OIDC 入口开始，确保本次访问经过 Keycloak；有效的基础平台会话会由
    // Broker 自动复用，因此用户不会看到 Keycloak 登录或选择页面。
    const targetURL = new URL(subsystem.authenticationURL, window.location.origin).href
    openSubsystemTarget(targetURL)
    return
  }

  if (subsystem.publicURL) {
    // 外部系统不在统一前端路由内，保持新标签页打开，避免当前门户页被替换。
    openSubsystemTarget(subsystem.publicURL)
    return
  }

  if (subsystem.route) {
    // 内部子系统虽然与门户同源，也要在独立页面展示，避免覆盖门户上下文；
    // 通过 Router 解析保持 base、编码和命名路由参数一致。
    const routeURL = router.resolve(subsystem.route).href
    const targetURL = new URL(routeURL, window.location.origin).href
    openSubsystemTarget(targetURL)
    return
  }

  showToast(`「${subsystem.name}」尚未配置公开访问地址`, 'deny')
}

function handleCardPointerMove(event) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }

  const card = event.currentTarget
  const bounds = card.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / bounds.width
  const y = (event.clientY - bounds.top) / bounds.height
  const rotateX = (y - 0.5) * -8
  const rotateY = (x - 0.5) * 10

  card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`
  card.style.setProperty('--portal-mouse-x', `${x * 100}%`)
  card.style.setProperty('--portal-mouse-y', `${y * 100}%`)
}

function resetCardTransform(event) {
  const card = event.currentTarget
  card.style.transform = ''
  card.style.setProperty('--portal-mouse-x', '50%')
  card.style.setProperty('--portal-mouse-y', '50%')
}

function startParticleBackground() {
  const canvas = canvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) {
    return
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let width = 0
  let height = 0

  resizeCanvas = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.floor(width * pixelRatio)
    canvas.height = Math.floor(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

    const particleCount = Math.min(90, Math.floor((width * height) / 18000))
    particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      velocityX: (Math.random() - 0.5) * 0.22,
      velocityY: (Math.random() - 0.5) * 0.22,
    }))
  }

  const draw = () => {
    context.clearRect(0, 0, width, height)

    particles.forEach((particle, index) => {
      if (!reducedMotion) {
        particle.x += particle.velocityX
        particle.y += particle.velocityY

        if (particle.x < 0 || particle.x > width) {
          particle.velocityX *= -1
        }
        if (particle.y < 0 || particle.y > height) {
          particle.velocityY *= -1
        }
      }

      context.beginPath()
      context.arc(particle.x, particle.y, 1.2, 0, Math.PI * 2)
      context.fillStyle = 'rgba(147, 197, 253, 0.52)'
      context.fill()

      for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
        const nextParticle = particles[nextIndex]
        const distanceX = particle.x - nextParticle.x
        const distanceY = particle.y - nextParticle.y
        const distanceSquared = distanceX * distanceX + distanceY * distanceY
        const connectionDistance = 145

        if (distanceSquared >= connectionDistance * connectionDistance) {
          continue
        }

        const opacity = 0.12 * (1 - Math.sqrt(distanceSquared) / connectionDistance)
        context.beginPath()
        context.moveTo(particle.x, particle.y)
        context.lineTo(nextParticle.x, nextParticle.y)
        context.strokeStyle = `rgba(96, 165, 250, ${opacity})`
        context.lineWidth = 1
        context.stroke()
      }
    })

    if (!reducedMotion) {
      animationFrame = window.requestAnimationFrame(draw)
    }
  }

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener(AUTHORIZATION_REFRESHED_EVENT, onAuthorizationRefreshed)
  draw()
}

onMounted(() => {
  startParticleBackground()
  loadCurrentPrincipal()
  loadPortalCatalog()
  projectionRefreshTimer = window.setInterval(() => {
    const hasProjectionInFlight = registeredSubsystems.value.some((application) => (
      ['PENDING', 'RUNNING'].includes(String(application?.projection_status || '').toUpperCase())
    ))
    if (hasProjectionInFlight) {
      void loadPortalCatalog({ silent: true })
    }
  }, 3000)
  document.addEventListener('click', closeUserMenuWhenClickOutside)
  document.addEventListener('keydown', closeUserMenuOnEscape)
})

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
  window.clearInterval(projectionRefreshTimer)
  window.cancelAnimationFrame(animationFrame)
  document.removeEventListener('click', closeUserMenuWhenClickOutside)
  document.removeEventListener('keydown', closeUserMenuOnEscape)
  if (resizeCanvas) {
    window.removeEventListener('resize', resizeCanvas)
  }
  window.removeEventListener(AUTHORIZATION_REFRESHED_EVENT, onAuthorizationRefreshed)
})
</script>

<template>
  <main class="subsystem-portal" aria-label="子系统门户">
    <canvas ref="canvasRef" class="subsystem-portal__particles" aria-hidden="true"></canvas>
    <div class="subsystem-portal__grid" aria-hidden="true"></div>
    <div class="subsystem-portal__glow subsystem-portal__glow--top" aria-hidden="true"></div>
    <div class="subsystem-portal__glow subsystem-portal__glow--bottom" aria-hidden="true"></div>

    <header class="subsystem-portal__header">
      <div class="subsystem-portal__brand">
        <span class="subsystem-portal__logo"><ConsoleIcon name="logo" /></span>
        <span>
          <strong>基础能力平台</strong>
          <small>BASIC PLATFORM</small>
        </span>
      </div>
      <div ref="userMenuRef" class="subsystem-portal__user-menu">
        <button
          class="subsystem-portal__user-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-controls="portal-user-panel"
          :aria-expanded="userMenuOpen"
          @click="toggleUserMenu"
        >
          <span class="subsystem-portal__user-avatar" aria-hidden="true">{{ userAvatarText }}</span>
          <span class="subsystem-portal__user-summary">
            <strong>{{ userDisplayName }}</strong>
            <small>{{ accountDisplayName }}</small>
          </span>
          <ConsoleIcon class="subsystem-portal__user-chevron" :class="{ 'is-open': userMenuOpen }" name="chevron" />
        </button>

        <Transition name="portal-user-panel">
          <section v-if="userMenuOpen" id="portal-user-panel" class="subsystem-portal__user-panel" aria-label="个人信息">
            <p class="subsystem-portal__user-panel-title">个人信息</p>

            <p v-if="isPrincipalLoading" class="subsystem-portal__user-panel-status">正在读取当前登录用户信息…</p>
            <template v-else-if="currentPrincipal">
              <dl class="subsystem-portal__user-details">
                <div>
                  <dt>用户名</dt>
                  <dd>{{ currentPrincipal.user?.name || '—' }}</dd>
                </div>
                <div>
                  <dt>账号</dt>
                  <dd>{{ currentPrincipal.account?.code || currentPrincipal.account?.name || '—' }}</dd>
                </div>
                <div>
                  <dt>租户</dt>
                  <dd>{{ currentPrincipal.tenant?.name || currentPrincipal.tenant?.code || '—' }}</dd>
                </div>
                <div>
                  <dt>角色</dt>
                  <dd>{{ roleNames }}</dd>
                </div>
              </dl>
            </template>
            <p v-else class="subsystem-portal__user-panel-status is-error">当前用户信息暂不可用。</p>

            <button class="subsystem-portal__logout-button" type="button" :disabled="isLoggingOut" @click="logoutApplication">
              {{ isLoggingOut ? '正在退出…' : '退出应用系统' }}
            </button>
          </section>
        </Transition>
      </div>
    </header>

    <section class="subsystem-portal__content" aria-labelledby="portal-title">
      <div class="subsystem-portal__title-group">
        <p class="subsystem-portal__eyebrow">UNIFIED ACCESS</p>
        <h1 id="portal-title">子系统门户</h1>
        <p>请选择需要访问的业务子系统</p>
      </div>

      <p v-if="subsystemCatalogError" class="subsystem-portal__catalog-status is-error" role="alert">{{ subsystemCatalogError }}</p>
      <p v-else-if="registeredSubsystems.length === 0" class="subsystem-portal__catalog-status">当前账号暂无可访问的业务子系统。若子系统已经接入，请联系平台管理员为当前用户分配对应应用角色。</p>

      <div class="subsystem-portal__cards" aria-label="子系统列表">
        <button
          v-for="(subsystem, index) in subsystems"
          :key="subsystem.key"
          class="subsystem-card"
          :class="{ 'is-syncing': !subsystem.allowed }"
          :style="{ '--portal-card-delay': `${(index + 1) * 0.06}s` }"
          type="button"
          :aria-label="subsystem.allowed ? `进入${subsystem.name}` : `${subsystem.name}权限同步未完成`"
          :aria-disabled="!subsystem.allowed"
          @click="openSubsystem(subsystem)"
          @pointermove="handleCardPointerMove"
          @pointerleave="resetCardTransform"
        >
          <span v-if="subsystem.todo" class="subsystem-card__todo">待办 {{ subsystem.todo }}</span>
          <span class="subsystem-card__icon"><ConsoleIcon :name="subsystem.icon" /></span>
          <span class="subsystem-card__name">{{ subsystem.name }}</span>
          <span v-if="subsystem.description" class="subsystem-card__description">{{ subsystem.description }}</span>
          <span class="subsystem-card__action">
            {{ subsystem.allowed ? '进入系统' : '权限同步中' }}
            <ConsoleIcon name="chevron" />
          </span>
        </button>
      </div>
    </section>

    <footer class="subsystem-portal__footer">
      <span class="subsystem-portal__footer-note">建议分辨率：1920×1080 · 浏览器：Chrome / Edge 最新版</span>
      <span class="subsystem-portal__footer-copyright">© 2026 V2.1.0</span>
    </footer>

    <Transition name="portal-toast">
      <div v-if="toast.visible" class="subsystem-portal__toast" :class="`is-${toast.type}`" role="status" aria-live="polite">
        {{ toast.message }}
      </div>
    </Transition>
  </main>
</template>
