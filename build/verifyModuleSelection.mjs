import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { selectModules } from './moduleSelection.mjs'

const directory = await mkdtemp(join(tmpdir(), 'frontend-selected-modules-'))
const selections = process.argv.slice(2)
if (!selections.length) selections.push('none', 'contract_management', 'contract_management,project_management',
  'reimbursement', 'reimbursement,project_management', 'all')
for (const [index, selection] of selections.entries()) {
  process.env.VITE_ENABLED_MODULES = selection
  const outDir = join(directory, `build-${index}`)
  await build({ root: new URL('../', import.meta.url).pathname, build: { outDir, emptyOutDir: true } })
  const manifest = JSON.parse(await readFile(join(outDir, 'frontend-modules.json'), 'utf8'))
  const expected = selectModules(selection).map(({ code }) => code)
  assert.deepEqual(manifest.enabled_modules, expected)
  assert.deepEqual(manifest.compiled_modules, expected)
  const assets = await readdir(join(outDir, 'assets'))
  for (const [code, view] of [['contract_management', 'ContractManagementView'],
    ['project_management', 'ProjectManagementView'], ['settlement', 'SettlementView'],
    ['customer_and_opportunity', 'CustomerOpportunityView'], ['customer_portal', 'CustomerPortalView'],
    ['data_analysis', 'DashboardShellView'], ['reimbursement', 'ReimbursementView']]) {
    assert.equal(assets.some((file) => file.startsWith(`${view}-`)), expected.includes(code), code)
  }
  console.log(JSON.stringify({ selection, outDir, manifest, status: 'PASS' }))
}
console.log(`VERIFIED_OUTPUT_ROOT=${directory}`)
