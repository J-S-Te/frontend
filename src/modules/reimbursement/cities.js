import { areaList } from '@vant/area-data'
import { pinyin } from 'pinyin-pro'

// 用途：统一本地城市搜索的大小写、空白及拼音声调。
// 参数：value为用户搜索词或城市检索文本。
// 返回值：只用于匹配的规范文本，不作为城市编码写入。
function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '').toLowerCase()
}

export const cityOptions = Object.freeze(Object.entries(areaList.city_list).map(([code, name]) => {
  const province = areaList.province_list[`${code.slice(0, 2)}0000`] || ''
  return Object.freeze({ code, name, province, label: `${name} · ${province}` })
}))
const citiesByCode = new Map(cityOptions.map((city) => [city.code, city]))
const searchIndex = cityOptions.map((city) => ({
  city,
  terms: [city.code, city.name, city.province,
    pinyin(city.name, { toneType: 'none' }),
    pinyin(city.name, { pattern: 'first', toneType: 'none' }),
    pinyin(city.province, { toneType: 'none' }),
  ].map(normalizeSearch),
}))

// 用途：按已有六位编码读取城市名称，不从自由文本推断城市。
// 参数：code为行程表单保存的原始城市编码。
// 返回值：认识的内置城市；空值或未知编码返回undefined以保留人工重选边界。
export function cityByCode(code) {
  return citiesByCode.get(code)
}

// 用途：在内置省市目录中搜索中文名、编码或拼音，不发送网络请求。
// 参数：query为城市搜索词，支持拼音全拼、首字母及空白。
// 返回值：匹配的只读城市选项；空搜索返回全部，未命中返回空数组。
export function searchCities(query) {
  const term = normalizeSearch(query)
  if (!term) return cityOptions
  return searchIndex.filter(({ terms }) => terms.some((value) => value.includes(term)))
    .map(({ city }) => city)
}
