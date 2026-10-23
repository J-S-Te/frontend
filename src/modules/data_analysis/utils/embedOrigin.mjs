// 纵深防御：绝不给平台主机下的框架授予同源沙箱能力，
// 即使端口不同也不允许，因为 Cookie 不区分端口。
export function isolatedEmbedUrl(raw, token, parentOrigin) {
  const parent = new URL(parentOrigin)
  const embed = new URL(raw)
  if (!token || embed.username || embed.password || embed.search || embed.hash ||
      embed.hostname === parent.hostname ||
      embed.pathname !== `/data_analysis/api/v1/embed-proxy/${encodeURIComponent(token)}` ||
      !(embed.protocol === 'https:' || (embed.protocol === 'http:' && (embed.hostname === 'localhost' || /^127\./.test(embed.hostname)))) ||
      (parent.protocol === 'https:' && embed.protocol !== 'https:')) {
    throw new Error('看板独立嵌入来源配置无效，请联系管理员')
  }
  return embed.href
}
