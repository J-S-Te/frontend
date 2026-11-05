# pdf.js 扫描件解码器资源

本目录存放 PDF 扫描件（CCITTFaxDecode / JBIG2Decode / JPXDecode）解码所需的 pdf.js 资源，
由 `src/modules/contract_management/utils/contractPDFRenderer.js` 通过 `wasmUrl` 指向
`<BASE_URL>pdfjs-wasm/` 同源加载。

## 文件来源

全部文件直接复制自 `node_modules/pdfjs-dist/wasm/`（pdfjs-dist **6.4.299**）：

- `jbig2_nowasm_fallback.js`：JBIG2 与 CCITT Fax 解码器
- `openjpeg_nowasm_fallback.js`：JPEG 2000（JPX）解码器
- `LICENSE_JBIG2`、`LICENSE_OPENJPEG`、`LICENSE_PDFJS_JBIG2`、`LICENSE_PDFJS_OPENJPEG`：对应许可证

## 升级 pdfjs-dist 时必须同步替换

升级 `pdfjs-dist` 后，必须用新版本 `node_modules/pdfjs-dist/wasm/` 下的同名文件覆盖本目录，
否则 worker 与本目录解码器版本不匹配，扫描件会再次整页空白或解码失败。

## 为什么用 nowasm fallback 而不是 .wasm

生产 nginx 的 `script-src` 未包含 `'wasm-unsafe-eval'`，浏览器会拒绝编译 `.wasm`，
因此渲染器保持 `useWasm: false`，让 pdf.js 加载这里的 `*_nowasm_fallback.js`（纯 JS 解码器）。
如需切换到 `.wasm` 版本，必须先评估并调整 CSP 发布配置，不能只改代码。

## 注意

- 本目录由 Vite 原样发布到 `dist/pdfjs-wasm/`（`public/` 约定，与 `contract-import-template.xlsx` 相同）。
- `contractPDFRenderer.image.test.mjs` 会校验两个 fallback 文件存在且非空，防止打包/发布漏资源。
