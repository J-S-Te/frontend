/**
 * 为无法取消在途请求的视图提供轻量的请求世代号保护。
 * 已完成请求仅在仍属于最新世代时才可修改状态。
 */
export function createLatestRequestGuard() {
  let generation = 0

  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(candidate) {
      return candidate === generation
    },
    invalidate() {
      generation += 1
      return generation
    },
  }
}
