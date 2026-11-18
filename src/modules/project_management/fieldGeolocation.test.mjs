import assert from 'node:assert/strict'
import test from 'node:test'
import { acquireFieldPosition } from './fieldGeolocation.js'
import { formatUserError } from '../shared/utils/userError.js'

// 用途：建立可控的设备定位边界，真实执行精度筛选、计时与取消逻辑。
// 参数：t 为测试上下文，固定采集时钟。
// 返回值：定位入口、设备回调、清理记录和位置构造器。
function locationFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 })
  let success, failure, options
  const cleared = []
  const geolocation = {
    watchPosition: (onSuccess, onError, received) => { success = onSuccess; failure = onError; options = received; return 0 },
    clearWatch: id => cleared.push(id),
  }
  return {
    start: (extra = {}) => acquireFieldPosition({ geolocation, secureContext: true, ...extra }),
    success: value => success(value), failure: code => failure({ code }),
    position: (accuracy, extra = {}) => ({ coords: { latitude: 30.2741, longitude: 120.1551, accuracy }, timestamp: Date.now(), ...extra }),
    options: () => options, cleared,
  }
}

test('首次粗定位不签到，采用随后采集的精确位置并释放监听', async t => {
  const f = locationFixture(t)
  const progress = []
  const pending = f.start({ onProgress: position => progress.push(position.coords.accuracy) })
  let settled = false
  pending.then(() => { settled = true })
  f.success(f.position(2500))
  await Promise.resolve()
  assert.equal(settled, false)
  f.success(f.position(18))
  assert.equal((await pending).coords.accuracy, 18)
  assert.deepEqual(f.cleared, [0])
  assert.deepEqual(progress, [2500, 18])
  assert.deepEqual(f.options(), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
})

test('限时内保留最准确的可用位置，避免后续较差位置覆盖', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  t.mock.timers.tick(12000)
  f.success(f.position(85))
  t.mock.timers.tick(500)
  f.success(f.position(95))
  t.mock.timers.tick(7500)
  assert.equal((await pending).coords.accuracy, 85)
  assert.deepEqual(f.cleared, [0])
})

test('超过一百米误差时拒绝签到，提示当前精度和改善办法', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /350.*100.*精确定位|350.*100.*开阔/)
  t.mock.timers.tick(15000)
  f.success(f.position(350))
  t.mock.timers.tick(5000)
  await rejected
  assert.deepEqual(f.cleared, [0])
})

test('缓存、未来时间和非法坐标都不能成为签到证据', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /定位.*超时|未获取.*有效/)
  f.success(f.position(5, { timestamp: Date.now() - 30000 }))
  f.success(f.position(5, { timestamp: Date.now() + 60000 }))
  f.success(f.position(5, { timestamp: 0 }))
  f.success(f.position(5, { coords: { latitude: NaN, longitude: 120, accuracy: 5 } }))
  f.success(f.position(5, { coords: { latitude: 91, longitude: 120, accuracy: 5 } }))
  f.success(f.position(5, { coords: { latitude: 30, longitude: 120, accuracy: 0 } }))
  t.mock.timers.tick(20000)
  await rejected
})

test('先前可用位置过期后不能在截止时被当作当前位置', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /定位.*超时|未获取.*有效/)
  f.success(f.position(75))
  t.mock.timers.tick(20001)
  await rejected
})

test('定位权限被拒绝时给出系统与浏览器授权指引', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /权限.*系统.*浏览器|系统.*浏览器.*权限/)
  f.failure(1)
  await rejected
  assert.deepEqual(f.cleared, [0])
})

test('临时定位不可用后仍等待设备恢复，不立即冒充权限错误', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  f.failure(2)
  f.success(f.position(12))
  assert.equal((await pending).coords.accuracy, 12)
})

test('设备一直无信号与一直超时分别给出可操作提示', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /信号|定位服务/)
  f.failure(2)
  t.mock.timers.tick(20000)
  await rejected
  const timeout = f.start()
  const timedOut = assert.rejects(timeout, /超时/)
  f.failure(3)
  t.mock.timers.tick(20000)
  await timedOut
})

test('非安全来源和缺少设备定位能力在请求前明确拒绝', async () => {
  await assert.rejects(acquireFieldPosition({ geolocation: {}, secureContext: false }), /HTTPS/)
  await assert.rejects(acquireFieldPosition({ geolocation: null, secureContext: true }), /不支持.*定位/)
})

test('切换操作上下文取消定位，停止监听且不返回旧结果', async t => {
  const f = locationFixture(t)
  const controller = new AbortController()
  const pending = f.start({ signal: controller.signal })
  const rejected = assert.rejects(pending, error => error.name === 'AbortError')
  controller.abort()
  await rejected
  f.success(f.position(5))
  assert.deepEqual(f.cleared, [0])
})

test('定位超时经过页面错误格式化后仍保留定位指引', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, error => {
    assert.match(formatUserError(error), /定位.*超时/)
    return true
  })
  t.mock.timers.tick(20000)
  await rejected
})

test('可用的单次定位在等待改善后及时采用，避免静止设备的位置白白过期', async t => {
  const f = locationFixture(t)
  const controller = new AbortController()
  t.after(() => controller.abort())
  let received
  const pending = f.start({ signal: controller.signal }).then(position => { received = position }, () => {})
  f.success(f.position(80))
  t.mock.timers.tick(5000)
  await Promise.resolve()
  assert.equal(received?.coords.accuracy, 80)
  await pending
})

test('更精确的旧样本过期后仍能反馈较差但新鲜的采样精度', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  const rejected = assert.rejects(pending, /180.*100/)
  t.mock.timers.tick(7000)
  f.success(f.position(160))
  t.mock.timers.tick(7000)
  f.success(f.position(180))
  t.mock.timers.tick(6000)
  await rejected
})

test('改善窗口内样本过期时继续等待总时限内的新位置', async t => {
  const f = locationFixture(t)
  const pending = f.start()
  let failure
  pending.catch(error => { failure = error })
  t.mock.timers.tick(8500)
  f.success(f.position(80, { timestamp: Date.now() - 7000 }))
  t.mock.timers.tick(5000)
  await Promise.resolve()
  assert.equal(failure, undefined, '改善窗口不能截断尚未耗尽的定位总时限')
  assert.deepEqual(f.cleared, [])
  t.mock.timers.tick(1500)
  f.success(f.position(18))
  assert.equal((await pending).coords.accuracy, 18)
})
