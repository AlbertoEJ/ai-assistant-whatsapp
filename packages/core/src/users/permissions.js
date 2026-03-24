/**
 * Tool permission system.
 * Defines which tools each plan/role can access.
 */

/** Base tools available to all paid plans */
const BASE_TOOLS = ['read_file', 'write_file', 'list_files', 'create_pdf', 'create_excel', 'create_reminder']

/** All Google tools */
const GOOGLE_TOOLS = [
  'gmail_search', 'gmail_read', 'gmail_send', 'gmail_reply', 'gmail_forward', 'gmail_trash', 'gmail_mark_read', 'gmail_get_attachments',
  'calendar_list', 'calendar_create', 'calendar_update', 'calendar_delete',
  'drive_list', 'drive_search', 'drive_download',
  'tasks_list', 'tasks_create', 'tasks_complete', 'tasks_delete',
]

/** All Microsoft tools */
const MICROSOFT_TOOLS = [
  'outlook_list', 'outlook_search', 'outlook_read', 'outlook_send', 'outlook_reply', 'outlook_forward', 'outlook_trash', 'outlook_mark_read', 'outlook_get_attachments',
  'ms_calendar_list', 'ms_calendar_create', 'ms_calendar_update', 'ms_calendar_delete',
  'onedrive_list', 'onedrive_search', 'onedrive_download',
  'ms_tasks_list', 'ms_tasks_create', 'ms_tasks_complete', 'ms_tasks_delete',
]

const PLAN_TOOLS = {
  free: [
    'read_file', 'write_file', 'list_files',
  ],
  inicio: [
    ...BASE_TOOLS,
    ...GOOGLE_TOOLS,
    ...MICROSOFT_TOOLS,
  ],
  equipo: [
    ...BASE_TOOLS,
    ...GOOGLE_TOOLS,
    ...MICROSOFT_TOOLS,
  ],
  empresa: [
    ...BASE_TOOLS,
    ...GOOGLE_TOOLS,
    ...MICROSOFT_TOOLS,
  ],
}

/**
 * Get allowed tools for a user based on their org plan and personal overrides.
 */
function getAllowedTools(plan, userOverrides = []) {
  const planTools = PLAN_TOOLS[plan] || PLAN_TOOLS.free
  if (userOverrides.length > 0) {
    // User-specific overrides take precedence (admin can restrict)
    return userOverrides
  }
  return planTools
}

/**
 * Check if a specific tool is allowed.
 */
function isToolAllowed(toolName, plan, userOverrides = []) {
  const allowed = getAllowedTools(plan, userOverrides)
  return allowed.includes(toolName)
}

/**
 * Integration limits per plan.
 * Defines which providers each plan can connect.
 */
const PLAN_INTEGRATIONS = {
  free: [],
  inicio: { max: 1, allowed: ['google', 'microsoft'] },
  equipo: { max: 2, allowed: ['google', 'microsoft'] },
  empresa: { max: 2, allowed: ['google', 'microsoft'] },
}

/**
 * Check if a plan can connect a specific provider.
 * @param {string} plan
 * @param {string} provider - 'google' or 'microsoft'
 * @param {string[]} currentProviders - providers already connected
 */
function canConnectIntegration(plan, provider, currentProviders = []) {
  const limits = PLAN_INTEGRATIONS[plan] || PLAN_INTEGRATIONS.free

  if (Array.isArray(limits)) return { allowed: false, reason: 'Tu plan no incluye integraciones. Actualiza tu plan.' }
  if (!limits.allowed.includes(provider)) return { allowed: false, reason: `Proveedor ${provider} no soportado.` }
  if (currentProviders.includes(provider)) return { allowed: true, reason: 'Ya conectado.' }
  if (currentProviders.length >= limits.max) {
    return { allowed: false, reason: `Tu plan permite ${limits.max} integración(es). Desconecta una antes de conectar otra.` }
  }

  return { allowed: true }
}

export { getAllowedTools, isToolAllowed, canConnectIntegration, PLAN_TOOLS, PLAN_INTEGRATIONS }
