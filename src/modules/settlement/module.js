export default Object.freeze({
  code: 'settlement',
  aliases: ['settlement_management'],
  name: '结算与开票管理',
  description: '应收、开票、回款、核销、账龄与催收管理',
  icon: 'account',
  builtIn: false,
  route: Object.freeze({ name: 'settlement', params: Object.freeze({ section: 'dashboard' }) }),
})
