import test from 'node:test'
import assert from 'node:assert/strict'
const display = await import('./utils/agingDisplay.js').catch(() => ({}))
test('可配置五档按数值顺序展示标签色阶，并按币种计算占比',()=>{
 assert.equal(typeof display.agingDisplayRows,'function')
 const rows=display.agingDisplayRows(['180+','31-60','0-30','91-180','61-90'].map(bucket=>({bucket,currency:'CNY',amount:'10',count:1})))
 assert.deepEqual(rows.map(r=>r.label),['180 天以上 · CNY','31–60 天 · CNY','0–30 天 · CNY','91–180 天 · CNY','61–90 天 · CNY'])
 assert.equal(rows[0].tone,'red');assert.equal(rows[2].tone,'green')
 assert.equal(rows[0].isOldestBucket,true);assert.equal(rows[3].isOldestBucket,false)
 assert.equal(rows[0].percent,20)
})
test('自定义区间及多币种末档风险不依赖固定90天',()=>{
 const rows=display.agingDisplayRows([{bucket:'0-15',currency:'USD',amount:'100'},{bucket:'16-45',currency:'USD',amount:'100'},{bucket:'45+',currency:'USD',amount:'0'},{bucket:'45+',currency:'CNY',amount:'10'}])
 assert.equal(rows[1].label,'16–45 天 · USD');assert.equal(rows[1].percent,50)
 assert.equal(rows[2].isOldestBucket,true)
 assert.equal(rows[3].isOldestBucket,true)
 assert.equal(rows[3].percent,100)
 assert.equal(display.agingDisplayRows([{bucket:'unknown',currency:'CNY',amount:'10'}])[0].isOldestBucket,false)
})
test('有余额档缺失时保留配置色阶，闭区间不能冒充末档风险',()=>{
 const rows=display.agingDisplayRows([{bucket:'0-30',currency:'CNY',amount:'10'},{bucket:'91-180',currency:'CNY',amount:'20'}],[30,60,90,180])
 assert.equal(rows[0].tone,'green');assert.equal(rows[1].tone,'purple')
 assert.equal(rows[0].isOldestBucket,false);assert.equal(rows[1].isOldestBucket,false)
 assert.equal(display.agingDisplayRows([{bucket:'0-30',currency:'CNY',amount:'10'}])[0].isOldestBucket,false)
})
