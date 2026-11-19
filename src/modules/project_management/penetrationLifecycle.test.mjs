import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { nextTick, reactive } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'
import { penetrationParentAllows } from './penetrationLifecycle.js'

test('专项结论只在父项现场完成前可变更，后续报告动作仍可执行', () => {
  assert.equal(penetrationParentAllows({ status: '实施中', report_status: 'NONE' }, 'decision'), true)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'RECTIFYING' }, 'decision'), false)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'ISSUED' }), true)
  assert.equal(penetrationParentAllows({ status: '现场实施完成', report_status: 'ARCHIVED' }), false)
  assert.equal(penetrationParentAllows({ status: '已终止', report_status: 'NONE' }), false)
  assert.equal(penetrationParentAllows({ status: '实施中', archived_at: '2026-11-08T00:00:00Z' }), false)
})


test('专项后台版本变化保留草稿，拒绝旧快照并等待用户采用新版本', async () => {
  const filename = fileURLToPath(new URL('./components/PenetrationWorkPackageCard.vue', import.meta.url))
  const item = reactive({ id: 'SI-1', status: '待实施',
    penetration_work_package: { id: 'PKG-1', version: 1, customer_contact: '原联系人' } })
  const mounted = await mountSFC(filename, {}, { item })
  try {
    const { decision, draftConflict, resetPackageDraft, workPackage } = mounted.state
    decision.value.customerContact = '未提交'
    item.penetration_work_package = { id: 'PKG-1', version: 2, customer_contact: '新联系人' }
    await nextTick()
    assert.equal(workPackage.value.version, 2)
    assert.equal(decision.value.customerContact, '未提交')
    assert.equal(draftConflict.value, true)
    item.penetration_work_package = { id: 'PKG-1', version: 1, customer_contact: '过期联系人' }
    await nextTick()
    assert.equal(workPackage.value.version, 2)
    resetPackageDraft()
    assert.equal(draftConflict.value, false)
    assert.equal(decision.value.customerContact, '新联系人')
  } finally { mounted.unmount() }
})
