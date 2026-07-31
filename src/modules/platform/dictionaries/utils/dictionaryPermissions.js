/**
 * Dictionary permissions must stay aligned with the backend router and
 * authz_permission seeds in migration 000015.
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
