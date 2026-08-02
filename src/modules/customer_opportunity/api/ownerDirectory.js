import { request, toQuery } from './client.js'

/**
 * Lists CRM owner candidates authorized by the base platform for this subsystem.
 * The browser never calls the platform management API or handles machine credentials.
 */
export const listOwnerDirectory = (params = {}) => request(`/owner-directory${toQuery(params)}`)
