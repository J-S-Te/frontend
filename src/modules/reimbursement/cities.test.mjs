import test from 'node:test'
import assert from 'node:assert/strict'
import { cityByCode, cityOptions, searchCities } from './cities.js'

test('城市目录展示中文省市并保留内置六位编码，不接收自由文本', () => {
  assert.ok(cityOptions.length > 300)
  assert.equal(cityByCode('440300').name, '深圳市')
  assert.equal(cityByCode('440300').province, '广东省')
  assert.equal(cityByCode('110100').name, '北京市')
  assert.ok(cityOptions.every((city) => /^\d{6}$/.test(city.code)))
  assert.equal(cityByCode('深圳'), undefined)
  assert.equal(cityByCode('999999'), undefined)
  assert.equal(cityByCode(''), undefined)
})

test('城市搜索支持中文、拼音和首字母，未知搜索不会伪造城市编码', () => {
  for (const query of ['深圳', 'Shen Zhen', 'sz', '440300']) {
    assert.ok(searchCities(query).some((city) => city.code === '440300'), query)
  }
  assert.ok(searchCities('广东').some((city) => city.code === '440100'))
  assert.deepEqual(searchCities('找不到的城市'), [])
  assert.equal(searchCities('  ').length, cityOptions.length)
})
