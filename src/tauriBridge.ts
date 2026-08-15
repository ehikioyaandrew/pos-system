import { isTauriApp } from './lib/platform'

/**
 * Tauri 2 renames Rust snake_case command args to camelCase.
 * Keep payload keys in camelCase to match that IPC layer.
 */
function toCamelKey(key: string): string {
  if (key.includes('_')) {
    return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  }
  return key
}

function camelKeys(input: Record<string, unknown>, deep = false): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const mapped = toCamelKey(key)
    if (
      deep &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (key === 'request' || mapped === 'request')
    ) {
      // Inner request bodies often use snake_case for serde structs — leave as-is
      out[mapped] = value
    } else {
      out[mapped] = value
    }
  }
  return out
}

/** Normalize frontend invoke args to Tauri 2 camelCase parameter names. */
export function normalizeTauriArgs(
  command: string,
  args?: Record<string, unknown> | number
): Record<string, unknown> {
  if (typeof args === 'number') {
    if (command === 'get_business_by_id') {
      return { request: args }
    }
    if (command === 'mark_sale_as_completed' || command === 'mark_debt_paid' || command === 'get_sale_items') {
      return { saleId: args }
    }
    if (command === 'get_sale_receipt') {
      return { saleId: args }
    }
    return { businessId: args }
  }

  const raw = { ...((args || {}) as Record<string, unknown>) }
  const normalized = camelKeys(raw, true)

  // get_business_by_id(request: Value) — must wrap
  if (command === 'get_business_by_id') {
    if (normalized.request != null) return { request: normalized.request }
    const bid = normalized.businessId ?? normalized.id
    if (bid != null) return { request: { businessId: bid } }
    return { request: normalized }
  }

  // authenticate_user / create_user / create_business take `request`
  if (
    (command === 'authenticate_user' ||
      command === 'create_user' ||
      command === 'create_business' ||
      command === 'create_product' ||
      command === 'add_manual_debt' ||
      command === 'record_debt_payment' ||
      command === 'create_product_category' ||
      command === 'delete_product_category' ||
      command === 'update_business_settings') &&
    normalized.request == null
  ) {
    return { request: raw.request ?? raw }
  }

  // change_password(user_id, new_password_hash)
  if (command === 'change_password') {
    return {
      userId: normalized.userId ?? normalized.user_id,
      newPasswordHash:
        normalized.newPasswordHash ??
        normalized.new_password_hash ??
        normalized.passwordHash,
    }
  }

  // update_stock_type / transfer_stock — flat camelCase params
  if (command === 'update_stock_type' || command === 'transfer_stock') {
    const inner =
      normalized.request && typeof normalized.request === 'object'
        ? camelKeys(normalized.request as Record<string, unknown>)
        : normalized
    return inner
  }

  // process_sale already uses { request: {...} } with snake_case fields for serde
  if (command === 'process_sale') {
    if (normalized.request != null) return { request: normalized.request }
    return { request: raw }
  }

  // update_sale_details — flat camelCase; keep items array as-is
  if (command === 'update_sale_details' || command === 'update_sale_date') {
    return {
      saleId: normalized.saleId,
      businessId: normalized.businessId,
      saleDate: normalized.saleDate ?? null,
      items: normalized.items ?? null,
      actorUserId: normalized.actorUserId ?? null,
    }
  }

  if (command === 'void_sale') {
    return {
      saleId: normalized.saleId,
      businessId: normalized.businessId,
      actorUserId: normalized.actorUserId,
    }
  }

  return normalized
}

/** Tauri often rejects with a plain string, not an Error. */
export function tauriErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (typeof err === 'string' && err.trim()) return err
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown; error?: unknown }
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) return anyErr.message
    if (typeof anyErr.error === 'string' && anyErr.error.trim()) return anyErr.error
  }
  try {
    const s = String(err ?? '')
    if (s && s !== '[object Object]') return s
  } catch {
    /* ignore */
  }
  return fallback
}

export async function invokeTauri<T = unknown>(
  command: string,
  args?: Record<string, unknown> | number
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  const payload = normalizeTauriArgs(command, args)
  return invoke<T>(command, payload)
}

export async function syncFromCloudDesktop(): Promise<unknown> {
  return invokeTauri('sync_from_cloud')
}

export async function syncToCloudDesktop(): Promise<unknown> {
  return invokeTauri('sync_to_cloud')
}

export async function authenticateDesktopUser(
  username: string,
  password: string
): Promise<{ user: any } | { error: string }> {
  try {
    const password_hash = btoa(password)
    try {
      const user = await invokeTauri<any>('authenticate_user', {
        request: { username: username.trim(), password_hash },
      })
      return { user }
    } catch (firstErr) {
      // Empty local DB — pull cloud catalog once, then retry login
      try {
        await syncFromCloudDesktop()
        const user = await invokeTauri<any>('authenticate_user', {
          request: { username: username.trim(), password_hash },
        })
        return { user }
      } catch {
        const msg = tauriErrorMessage(firstErr, 'Invalid username or password')
        if (/not configured|network|fetch|Failed to fetch/i.test(msg)) {
          return {
            error:
              'Offline login failed. Connect once to sync users/products, then you can work offline.',
          }
        }
        return { error: msg.includes('Invalid') ? msg : 'Invalid username or password' }
      }
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Login failed' }
  }
}

export { isTauriApp }
