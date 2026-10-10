// Defense in depth: never grant same-origin sandbox capabilities to a
// platform-host frame, including a different port (cookies ignore ports).
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
