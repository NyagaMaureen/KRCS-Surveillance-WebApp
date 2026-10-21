export const rolePermissionsLink = (role) =>
  `/user-management?tab=roles${role ? `&role=${encodeURIComponent(role)}` : ''}`
