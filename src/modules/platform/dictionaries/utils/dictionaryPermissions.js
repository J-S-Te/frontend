/**
 * 字典和字典项是两组独立授权边界，权限码必须同时与后端路由及初始化权限目录保持一致。
 * 页面按该集合决定模块是否可见，但写操作仍以后端鉴权为准，不能把“能读字典”推断为
 * “能维护字典项”。
 */
export const DICTIONARY_PERMISSIONS = Object.freeze({
  dictionaryRead: 'platform:dictionary:read',
  dictionaryCreate: 'platform:dictionary:create',
  dictionaryUpdate: 'platform:dictionary:update',
  itemRead: 'platform:dictionary-item:read',
  itemCreate: 'platform:dictionary-item:create',
  itemUpdate: 'platform:dictionary-item:update',
})

export const DICTIONARY_ENTRY_PERMISSIONS = Object.freeze(Object.values(DICTIONARY_PERMISSIONS))
