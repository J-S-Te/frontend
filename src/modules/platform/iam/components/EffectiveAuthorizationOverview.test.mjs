import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./EffectiveAuthorizationOverview.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'effective-authorization-overview' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'EffectiveAuthorizationOverview.vue',
  id: 'effective-authorization-overview',
  compilerOptions: { bindingMetadata: script.bindings },
})

test('effective authorization overview compiles and keeps accessible expand controls', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.template.content, /aria-expanded="isExpanded\(row\)"/)
  assert.match(descriptor.template.content, /:aria-controls="detailId\(row\)"/)
  assert.match(descriptor.template.content, /@click="retry\(row\)"/)
  assert.match(descriptor.template.content, /@click="emit\('manage', row\.application_code\)"/)
  assert.doesNotMatch(descriptor.template.content, /iam-effective-authorization-grid/)
  assert.match(descriptor.template.content, /授权如何计算/)
  assert.match(descriptor.template.content, /技术信息/)
})

test('overview displays application status, role summary and every source without merging provenance', () => {
  assert.match(descriptor.template.content, /applicationRoleSummary\(row\)/)
  assert.match(descriptor.template.content, /statusOf\(row\)\.label/)
  assert.match(descriptor.template.content, /sourceLabel\(source\)/)
  assert.match(descriptor.template.content, /roleScopeText\(source\)/)
  assert.match(descriptor.template.content, /roleValidityText\(source\)/)
  assert.match(descriptor.template.content, /v-for="\(source, sourceIndex\) in group\.sources"/)
})
