/**
 * sourceSHA256 校验原字节，兼容HTTPS WebCrypto及既有HTTP部署。
 * 参数：blob为已限制体积的原件，provider默认浏览器密码接口。
 * 返回值：Promise<string> 十六进制SHA256；失败不降级为跳过校验。
 */
export async function sourceSHA256(blob, provider = globalThis.crypto) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (provider?.subtle) {
    const digest = new Uint8Array(await provider.subtle.digest('SHA-256', bytes))
    return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
  }
  const module = await import('node-forge')
  const forge = module.default || module
  const digest = forge.md.sha256.create()
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    digest.update(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  }
  return digest.digest().toHex()
}
