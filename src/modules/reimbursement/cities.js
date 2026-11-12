// 城市目录与拼音检索按需加载：行政区划数据（约 116 KiB）和拼音库体积较大，
// 只在报销表单实际出现城市选择器时下载，避免拖慢报销首页与其他子系统的首屏。
let cityCatalog = null
let cityCatalogPromise = null
export let cityOptions = Object.freeze([])

// 用途：统一本地城市搜索的大小写、空白及拼音声调。
// 参数：value为用户搜索词或城市检索文本。
// 返回值：只用于匹配的规范文本，不作为城市编码写入。
function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '').toLowerCase()
}

// 用途：同步判断城市目录是否已经加载完成。
// 参数：无。
// 返回值：只读布尔值，供城市选择器在首帧决定是否显示加载态。
export function cityCatalogLoaded() {
  return Boolean(cityCatalog)
}

// 用途：加载并缓存城市目录与拼音检索索引。
// 参数：无。
// 返回值：加载完成后的城市目录；重复调用复用同一个 Promise，失败后可重试。
export function ensureCityCatalog() {
  if (cityCatalog) return Promise.resolve(cityCatalog)
  if (cityCatalogPromise) return cityCatalogPromise
  cityCatalogPromise = Promise.all([
    import('@vant/area-data'),
    import('pinyin-pro'),
  ]).then(([areaModule, pinyinModule]) => {
    const areaList = areaModule.areaList
    const { pinyin } = pinyinModule
    const options = Object.freeze(Object.entries(areaList.city_list).map(([code, name]) => {
      const province = areaList.province_list[`${code.slice(0, 2)}0000`] || ''
      return Object.freeze({ code, name, province, label: `${name} · ${province}` })
    }))
    const byCode = new Map(options.map((city) => [city.code, city]))
    const searchIndex = options.map((city) => ({
      city,
      terms: [city.code, city.name, city.province,
        pinyin(city.name, { toneType: 'none' }),
        pinyin(city.name, { pattern: 'first', toneType: 'none' }),
        pinyin(city.province, { toneType: 'none' }),
      ].map(normalizeSearch),
    }))
    cityOptions = options
    cityCatalog = { cityOptions: options, citiesByCode: byCode, searchIndex }
    return cityCatalog
  }).catch((error) => {
    // 失败不缓存失败态；下次打开城市选择器可以重试。
    cityCatalogPromise = null
    throw error
  })
  return cityCatalogPromise
}

// 用途：按已有六位编码读取城市名称，不从自由文本推断城市。
// 参数：code为行程表单保存的原始城市编码。
// 返回值：认识的内置城市；目录尚未加载、空值或未知编码返回undefined。
export function cityByCode(code) {
  return cityCatalog?.citiesByCode.get(code)
}

// 用途：在内置省市目录中搜索中文名、编码或拼音，不发送网络请求。
// 参数：query为城市搜索词，支持拼音全拼、首字母及空白。
// 返回值：匹配的只读城市选项；目录未加载或空搜索返回已加载的完整目录，未命中返回空数组。
export function searchCities(query) {
  if (!cityCatalog) return []
  const term = normalizeSearch(query)
  if (!term) return cityCatalog.cityOptions
  return cityCatalog.searchIndex
    .filter(({ terms }) => terms.some((value) => value.includes(term)))
    .map(({ city }) => city)
}
