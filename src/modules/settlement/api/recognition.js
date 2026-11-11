import { sourceSHA256 } from '../../shared/utils/sourceIntegrity.js'

// 用途：复用结算现有身份、CSRF与幂等transport调用完整财务确认业务。
// 参数：request为既有结算请求函数。
// 返回值：有界读取、草稿编辑、提交及独立复核接口。
export function createRecognitionAPI(request, downloadEvidence) {
  // 用途：提交使用既有幂等网络重试机制的财务命令。
  // 参数：path为受控资源路径，input为完整输入，method为明确HTTP写方法。
  // 返回值：真实业务响应或错误。
  const write=(path,input,method='POST')=>request(path,{method,body:JSON.stringify(input),idempotent:true})
  // 用途：按真实文件摘要绑定重试键，上传独立财务证据。
  // 参数：file为原件，organization/witness为已选择受控组织及依据人员。
  // 返回值：只有上传绑定完成才返回可用于确认的证据引用。
  const upload=async(file,organization,witness)=>{
    if(!file || file.size<=0 || file.size>10*1024*1024) throw new Error('请选择不超过10MiB的PDF/JPEG/PNG证据')
    const digest=await sourceSHA256(file)
    const body=new FormData();body.append('file',file);body.append('organization_id',organization);body.append('organization_witness_id',witness)
    return request('/recognitions/evidence',{method:'POST',body,idempotent:true,idempotencyFingerprint:JSON.stringify([organization,witness,file.name,file.size,digest])})
  }
  return {
    // 用途：上传经组织范围验证的真实财务证据。
    // 参数：file为文件，org/witness为受控组织及目录依据。
    // 返回值：就绪证据或真实错误。
    uploadEvidence:upload,
    // 用途：导出有权组织的财务依据原件。
    // 参数：id为本地证据引用。
    // 返回值：受控下载结果。
    downloadEvidence: (id) => {
      if (typeof downloadEvidence !== 'function') throw new Error('财务证据下载未配置')
      return downloadEvidence(id)
    },

    // 用途：读取当前财务范围内的有界确认列表。
    // 参数：limit/offset为页大小与偏移。
    // 返回值：真实列表与来源状态。
    list:({limit=20,offset=0}={})=>request(`/recognitions?limit=${limit}&offset=${offset}`),
    // 用途：读取可见在职人员与组织候选。
    // 参数：keyword为搜索词。
    // 返回值：受控目录候选。
    people:(keyword='')=>request(`/recognitions/people?keyword=${encodeURIComponent(keyword)}`),
    // 用途：精确读取一张报销单的冻结费用候选。
    // 参数：claim为真实单据引用。
    // 返回值：完整费用历史与冲正差异。
    candidates:(claim)=>request(`/recognitions/candidates?claim_id=${encodeURIComponent(claim)}`),
    // 用途：校验真实项目并读取合法服务项。
    // 参数：id为项目引用。
    // 返回值：权威引用及服务项。
    project:(id)=>request(`/recognitions/project-reference?project_id=${encodeURIComponent(id)}`),
    // 用途：登记独立确认或冲回草稿。
    // 参数：input为完整业务输入。
    // 返回值：服务端保存的草稿。
    create:(input)=>write('/recognitions',input),
    // 用途：编辑本人未确认草稿。
    // 参数：id为记录引用，input为预期版本与完整输入。
    // 返回值：新草稿版本。
    update:(id,input)=>write(`/recognitions/${encodeURIComponent(id)}`,input,'PATCH'),
    // 用途：将本人草稿提交独立复核。
    // 参数：id为记录引用，input为预期版本。
    // 返回值：真实待审状态。
    submit:(id,input)=>write(`/recognitions/${encodeURIComponent(id)}/submit`,input),
    // 用途：独立确认或退回他人提交的事实。
    // 参数：id为记录引用，input为版本、决定及说明。
    // 返回值：真实审核结果。
    decision:(id,input)=>write(`/recognitions/${encodeURIComponent(id)}/decision`,input),
  }
}
