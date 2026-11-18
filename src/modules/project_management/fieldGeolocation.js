const TARGET_ACCURACY_METERS = 50
const MAX_ACCURACY_METERS = 100
const ACQUISITION_TIMEOUT_MS = 20_000
const MAX_SAMPLE_AGE_MS = 10_000
const IMPROVEMENT_WINDOW_MS = 5_000

// 用途：过滤无效坐标、缓存位置和异常设备时间，避免构造假的采集时间。
// 参数：position 为设备位置，startedAt 为本次定位开始时间，now 为当前时间。
// 返回值：本次采集且仍有效时为 true，否则为 false。
function usablePosition(position, startedAt, now) {
  const { latitude, longitude, accuracy } = position?.coords || {}
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy > 0
    && Number.isFinite(position.timestamp) && position.timestamp > 0
    && position.timestamp >= startedAt - 1000 && position.timestamp <= now + 1000
    && now - position.timestamp <= MAX_SAMPLE_AGE_MS
}

// 用途：将定位失败转为现场人员能处理的提示，保留失败类型。
// 参数：code 为设备失败码或业务定位失败码，message 为具体指引。
// 返回值：带定位失败码的 Error；不包含设备内部诊断或坐标。
function locationError(code, message) {
  return Object.assign(new Error(message), { code })
}

// 用途：连续采集本次新位置，优先采用精确结果，超时后只接受仍有效的一百米内结果。
// 参数：geolocation 为设备定位接口，secureContext 为安全来源标记，signal 用于取消，onProgress 接收当前最佳位置。
// 返回值：有效位置的 Promise；权限、环境、精度、超时或取消失败时拒绝并释放设备监听。
export function acquireFieldPosition({ geolocation = globalThis.navigator?.geolocation, secureContext = globalThis.isSecureContext, signal, onProgress } = {}) {
  if (secureContext === false) return Promise.reject(locationError('INSECURE_CONTEXT', '现场定位需要 HTTPS 安全连接，请通过系统的 HTTPS 地址打开后重试'))
  if (typeof geolocation?.watchPosition !== 'function' || typeof geolocation?.clearWatch !== 'function') {
    return Promise.reject(locationError('UNSUPPORTED', '当前浏览器不支持设备定位，请使用支持精确定位的手机浏览器'))
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    let watchID, timer, improvementTimer, best, lastErrorCode, settled = false
    let samples = []

    // 用途：结束本次采集并释放计时器、定位监听和取消监听。
    // 参数：error 为失败原因，position 为成功采集的位置，二者按结果择一提供。
    // 返回值：无；只结算一次定位 Promise。
    function finish(error, position) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(improvementTimer)
      if (watchID !== undefined) geolocation.clearWatch(watchID)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(position)
    }

    // 用途：在页面或操作对象变化后中止采集，禁止旧位置继续提交。
    // 参数：无。
    // 返回值：无；以 AbortError 结束定位。
    function cancel() {
      finish(Object.assign(new Error('定位已取消，请在当前服务项重新签到'), { name: 'AbortError' }))
    }

    // 用途：从仍新鲜的候选中选取最佳位置，避免过期的更高精度样本遮住新样本。
    // 参数：无，读取本次采样集合和当前设备时钟。
    // 返回值：有效候选中精度最好的位置；没有时返回 undefined。
    function freshBest() {
      samples = samples.filter(position => usablePosition(position, startedAt, Date.now()))
      return samples.reduce((current, position) => !current || position.coords.accuracy <= current.coords.accuracy ? position : current, undefined)
    }

    // 用途：在采集窗口结束时核验最佳位置的新鲜度和实际精度。
    // 参数：无，读取本次采集结果与最近设备失败码。
    // 返回值：无；返回合格位置或包含操作指引的定位错误。
    function expire() {
      best = freshBest()
      if (best && usablePosition(best, startedAt, Date.now())) {
        if (best.coords.accuracy <= MAX_ACCURACY_METERS) { finish(null, best); return }
        finish(locationError('LOW_ACCURACY', `当前定位误差约 ${Math.ceil(best.coords.accuracy)} 米，超过 ${MAX_ACCURACY_METERS} 米；请开启系统精确定位并移至开阔处后重试`))
        return
      }
      const message = lastErrorCode === 2
        ? '暂时无法获取位置信号，请开启系统定位服务并移至窗边或室外后重试'
        : '定位获取超时，未获取到本次有效位置；请检查系统定位和网络后重试'
      finish(locationError(lastErrorCode === 2 ? 'POSITION_UNAVAILABLE' : 'GEO_ACQUISITION_EXPIRED', message))
    }

    // 用途：改善等待结束时只采用仍有效的合格位置，过期时继续等待总采集时限。
    // 参数：无，读取当前候选位置。
    // 返回值：无；没有合格新位置时保持定位监听。
    function finishImprovement() {
      improvementTimer = undefined
      best = freshBest()
      if (best && best.coords.accuracy <= MAX_ACCURACY_METERS) finish(null, best)
    }

    // 用途：筛选本次采样并保留精度更高且仍有效的位置。
    // 参数：position 为设备新返回的位置。
    // 返回值：无；精度达到目标后立即结束，否则继续采样。
    function receive(position) {
      if (settled || !usablePosition(position, startedAt, Date.now())) return
      const previous = best
      samples.push(position)
      best = freshBest()
      if (best !== previous) onProgress?.(best)
      if (best.coords.accuracy <= TARGET_ACCURACY_METERS) finish(null, best)
      // 静止设备可能只回传一个位置；合格结果再等五秒改善后采用，不能等到它自己过期。
      else if (best.coords.accuracy <= MAX_ACCURACY_METERS && !improvementTimer) improvementTimer = setTimeout(finishImprovement, IMPROVEMENT_WINDOW_MS)
    }

    // 用途：对权限拒绝立即给出指引，临时信号失败则继续等待采集窗口。
    // 参数：error 为浏览器定位失败对象。
    // 返回值：无；权限失败拒绝定位，其余失败由窗口结束统一判断。
    function failed(error) {
      if (settled) return
      lastErrorCode = error?.code
      if (lastErrorCode === 1) finish(locationError('PERMISSION_DENIED', '定位权限未开启，请在系统设置和浏览器网站权限中允许精确定位，再重新签到'))
    }

    if (signal?.aborted) { cancel(); return }
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(expire, ACQUISITION_TIMEOUT_MS)
    try {
      watchID = geolocation.watchPosition(receive, failed, {
        enableHighAccuracy: true, timeout: ACQUISITION_TIMEOUT_MS, maximumAge: 0,
      })
      // 兼容同步回调的设备封装：回调结束时监听编号可能还未赋值。
      if (settled) geolocation.clearWatch(watchID)
    } catch {
      finish(locationError('POSITION_UNAVAILABLE', '无法启动设备定位，请检查系统定位服务和浏览器权限后重试'))
    }
  })
}
