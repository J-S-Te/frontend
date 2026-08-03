/**
 * 每次读取商机成员任期时分配递增令牌，不用一个全局“加载中”锁阻塞不同商机。
 * 用户快速切换详情时，只有最新令牌且仍对应当前商机的响应可以提交到界面，
 * 从而避免较慢的旧响应覆盖新详情。
 */
export function createMemberTermLoadState() {
  let sequence = 0
  return {
    begin(opportunityID) {
      return { sequence: ++sequence, opportunityID: Number(opportunityID) }
    },
    isCurrent(token, selectedOpportunityID) {
      return token?.sequence === sequence && token.opportunityID === Number(selectedOpportunityID)
    },
  }
}
