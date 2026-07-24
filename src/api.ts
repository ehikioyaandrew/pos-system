import { supabase, isSupabaseConfigured, type BackupUser } from './lib/supabase'

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD_HASH = btoa('Pawpaw4life@')

function mapUser(user: BackupUser): BackupUser {
  const temp = (user.temporary_password ?? '').trim()
  return {
    ...user,
    has_temporary_password: Boolean(temp),
  }
}

function argNumber(args: unknown, ...keys: string[]): number | null {
  if (typeof args === 'number' && Number.isFinite(args)) return args
  if (typeof args === 'string' && args.trim() !== '' && !Number.isNaN(Number(args))) {
    return Number(args)
  }
  if (!args || typeof args !== 'object') return null
  const obj = args as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value)
    }
  }
  if (obj.request && typeof obj.request === 'object') {
    return argNumber(obj.request, ...keys)
  }
  return null
}

export async function authenticateWebUser(
  usernameRaw: string,
  password: string
): Promise<{ user: BackupUser } | { error: string }> {
  if (!isSupabaseConfigured) {
    return {
      error:
        'Login service is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    }
  }

  const username = usernameRaw.trim()
  const passwordHash = btoa(password)

  if (username === ADMIN_USERNAME && passwordHash === ADMIN_PASSWORD_HASH) {
    const { data: existing, error: checkError } = await supabase
      .from('users_backup')
      .select('*')
      .eq('username', ADMIN_USERNAME)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking admin user:', checkError)
      return { error: 'Database connection error. Please try again.' }
    }

    if (!existing) {
      const payload = {
        id: 1,
        username: ADMIN_USERNAME,
        password_hash: ADMIN_PASSWORD_HASH,
        role: 'SuperSuperAdmin',
        name: 'System Administrator',
        email: null,
        business_id: null,
        is_active: true,
        temporary_password: '',
        created_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }

      const { data: created, error: insertError } = await supabase
        .from('users_backup')
        .insert(payload)
        .select()
        .single()

      if (insertError || !created) {
        console.error('Failed to create admin user:', insertError)
        return { error: 'Failed to initialize admin user. Please contact support.' }
      }

      await supabase
        .from('users_backup')
        .update({ last_login: new Date().toISOString() })
        .eq('id', created.id)

      return { user: mapUser(created as BackupUser) }
    }

    await supabase
      .from('users_backup')
      .update({ last_login: new Date().toISOString() })
      .eq('id', existing.id)

    return {
      user: mapUser({
        ...(existing as BackupUser),
        last_login: new Date().toISOString(),
      }),
    }
  }

  const { data: users, error } = await supabase
    .from('users_backup')
    .select('*')
    .eq('username', username)
    .eq('password_hash', passwordHash)
    .eq('is_active', true)

  if (error) {
    console.error('Supabase query error:', error)
    return { error: 'Database connection error. Please try again.' }
  }

  if (!users || users.length === 0) {
    return { error: 'Invalid username or password' }
  }

  const user = users[0] as BackupUser
  const lastLogin = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('users_backup')
    .update({ last_login: lastLogin })
    .eq('id', user.id)

  if (updateError) {
    console.error('Failed to update last_login:', updateError)
  }

  return { user: mapUser({ ...user, last_login: lastLogin }) }
}

export async function changeWebPassword(
  userId: number,
  newPassword: string
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: 'Login service is not configured.' }
  }

  const passwordHash = btoa(newPassword)
  const { error } = await supabase
    .from('users_backup')
    .update({
      password_hash: passwordHash,
      temporary_password: null,
    })
    .eq('id', userId)

  if (error) {
    console.error('Failed to change password:', error)
    return { error: error.message || 'Failed to change password' }
  }

  return {}
}

export async function verifyPasswordResetIdentity(
  usernameRaw: string,
  emailRaw: string
): Promise<{ userId: number; username: string } | { error: string }> {
  if (!isSupabaseConfigured) {
    return { error: 'Login service is not configured.' }
  }

  const username = usernameRaw.trim()
  const email = emailRaw.trim().toLowerCase()

  if (!username || !email) {
    return { error: 'Enter both username and email.' }
  }

  const { data: users, error } = await supabase
    .from('users_backup')
    .select('id, username, email, is_active')
    .eq('username', username)
    .eq('is_active', true)

  if (error) {
    console.error('Password reset lookup error:', error)
    return { error: 'Database connection error. Please try again.' }
  }

  if (!users || users.length === 0) {
    return { error: 'No active account matches that username and email.' }
  }

  const user = users[0] as Pick<BackupUser, 'id' | 'username' | 'email'>
  const storedEmail = (user.email ?? '').trim().toLowerCase()

  if (!storedEmail) {
    return {
      error:
        'This account has no email on file. Ask a Super Admin to reset your password.',
    }
  }

  if (storedEmail !== email) {
    return { error: 'No active account matches that username and email.' }
  }

  return { userId: user.id, username: user.username }
}

export async function resetWebPassword(
  userId: number,
  newPassword: string
): Promise<{ error?: string }> {
  if (newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters long.' }
  }
  return changeWebPassword(userId, newPassword)
}

async function getProductsForBusiness(businessId: number) {
  const { data, error } = await supabase
    .from('products_backup')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(error.message)
  return data || []
}

async function getLowStockProducts(businessId: number) {
  const products = await getProductsForBusiness(businessId)
  return products.filter((p: any) => {
    const fridge = Number(p.fridge_stock || 0)
    const show = Number(p.show_stock || 0)
    const store = Number(p.store_stock || 0)
    const min = Number(p.min_stock_level || 0)
    const total = fridge + show + store
    return total > 0 && (fridge <= min || show <= min || store <= min)
  })
}

async function getOutOfStockProducts(businessId: number) {
  const products = await getProductsForBusiness(businessId)
  return products.filter((p: any) => {
    return (
      Number(p.fridge_stock || 0) === 0 &&
      Number(p.show_stock || 0) === 0 &&
      Number(p.store_stock || 0) === 0
    )
  })
}

async function getPendingSales(businessId: number) {
  const { data: users, error: usersError } = await supabase
    .from('users_backup')
    .select('id, name, email, username')
    .eq('business_id', businessId)

  if (usersError) throw new Error(usersError.message)
  const userIds = (users || []).map((u) => u.id)
  if (userIds.length === 0) return []

  const userMap = new Map((users || []).map((u) => [u.id, u]))

  const { data: sales, error } = await supabase
    .from('sales_backup')
    .select('*')
    .in('user_id', userIds)
    .eq('payment_status', 'PENDING')
    .order('created_at', { ascending: false })

  if (error) {
    // Column may not exist or table empty — try without status filter
    const fallback = await supabase
      .from('sales_backup')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })
      .limit(50)
    if (fallback.error) throw new Error(fallback.error.message)
    return (fallback.data || [])
      .filter((s: any) => String(s.payment_status || '').toUpperCase() === 'PENDING')
      .map((s: any) => {
        const u = userMap.get(s.user_id)
        return {
          ...s,
          user_name: u?.name || u?.username || 'Unknown',
          user_email: u?.email || null,
          item_count: Number(s.item_count || 0),
        }
      })
  }

  return (sales || []).map((s: any) => {
    const u = userMap.get(s.user_id)
    return {
      ...s,
      user_name: u?.name || u?.username || 'Unknown',
      user_email: u?.email || null,
      item_count: Number(s.item_count || 0),
    }
  })
}

async function getPendingItemsSummary(businessId: number) {
  const [pendingSales, lowStock, outOfStock] = await Promise.all([
    getPendingSales(businessId),
    getLowStockProducts(businessId),
    getOutOfStockProducts(businessId),
  ])
  return {
    pending_sales: pendingSales.length,
    low_stock_products: lowStock.length,
    out_of_stock_products: outOfStock.length,
    total_pending: pendingSales.length + lowStock.length + outOfStock.length,
  }
}

async function markSaleAsCompleted(saleId: number) {
  const { error } = await supabase
    .from('sales_backup')
    .update({ payment_status: 'COMPLETED', synced_at: new Date().toISOString() })
    .eq('id', saleId)
  if (error) throw new Error(error.message)
  return true
}

async function processSale(request: Record<string, unknown>) {
  const items = Array.isArray(request.items) ? (request.items as any[]) : []
  if (!items.length) throw new Error('Cart is empty')

  const staffId = argNumber(request, 'staff_id', 'staffId')
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!staffId) throw new Error('staff_id is required')
  if (!businessId) throw new Error('business_id is required')

  const paymentMethod = String(request.payment_method || 'CASH').toUpperCase()
  const rawLocation = String(request.location || 'fridge').toLowerCase()
  const location = rawLocation === 'show' ? 'show' : 'fridge'
  const customerName = request.customer_name ? String(request.customer_name).trim() : ''
  const notes =
    (request.notes ? String(request.notes) : '') ||
    (paymentMethod === 'DEBT' && customerName ? `DEBT:${customerName}` : customerName) ||
    null

  if (paymentMethod === 'DEBT' && !customerName) {
    throw new Error('Customer name is required for debt sales')
  }

  // Validate stock in the selected location before writing the sale
  for (const item of items) {
    const productId = Number(item.product_id)
    const qty = Number(item.quantity || 0)
    if (!productId || qty <= 0) continue
    const { data: product, error } = await supabase
      .from('products_backup')
      .select('id, name, fridge_stock, show_stock')
      .eq('id', productId)
      .single()
    if (error) throw new Error(error.message)
    const available =
      location === 'show'
        ? Number((product as any).show_stock || 0)
        : Number((product as any).fridge_stock || 0)
    if (available < qty) {
      throw new Error(
        `Not enough ${(product as any).name || 'stock'} in ${location} (have ${available}, need ${qty})`
      )
    }
  }

  let totalAmount = 0
  for (const item of items) {
    totalAmount += Number(item.unit_price || 0) * Number(item.quantity || 0)
  }

  const saleId = Date.now()
  const salePayload = {
    id: saleId,
    user_id: staffId,
    total_amount: totalAmount,
    payment_method: paymentMethod,
    payment_status: 'PENDING',
    notes,
    created_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  }

  const { error: saleError } = await supabase.from('sales_backup').insert(salePayload)
  if (saleError) throw new Error(saleError.message)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const productId = Number(item.product_id)
    const qty = Number(item.quantity || 0)
    const unitPrice = Number(item.unit_price || 0)
    if (!productId || qty <= 0) continue

    const itemPayload = {
      id: saleId + i + 1,
      sale_id: saleId,
      product_id: productId,
      quantity: qty,
      unit_price: unitPrice,
      total_price: qty * unitPrice,
      synced_at: new Date().toISOString(),
    }

    const tables = ['sale_items_backup', 'sale_items_sync', 'sale_items']
    let inserted = false
    for (const table of tables) {
      const { error } = await supabase.from(table).insert(itemPayload)
      if (!error) {
        inserted = true
        break
      }
    }
    if (!inserted) {
      console.warn('Could not insert sale item; continuing stock update')
    }

    await updateStockType({
      productId,
      stockType: location,
      quantityChange: -qty,
    })
  }

  return {
    sale_id: saleId,
    total_amount: totalAmount,
    payment_method: paymentMethod,
    items: items.length,
    timestamp: new Date().toISOString(),
  }
}

async function getSalesLog(businessId: number, staffId?: number | null) {
  const { data: users, error: usersError } = await supabase
    .from('users_backup')
    .select('id, name, username')
    .eq('business_id', businessId)
  if (usersError) throw new Error(usersError.message)

  const userIds = (users || []).map((u) => u.id)
  if (!userIds.length) return []

  const userMap = new Map((users || []).map((u) => [u.id, u]))
  let query = supabase
    .from('sales_backup')
    .select('*')
    .in('user_id', staffId ? [staffId] : userIds)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data || []).map((s: any) => {
    const u = userMap.get(s.user_id)
    return {
      ...s,
      staff_name: u?.name || u?.username || 'Unknown',
      customer_name: parseDebtCustomer(s.notes),
    }
  })
}

function parseDebtCustomer(notes?: string | null) {
  if (!notes) return null
  const text = String(notes)
  if (text.toUpperCase().startsWith('DEBT:')) return text.slice(5).trim() || null
  return text.trim() || null
}

async function getDebtSales(businessId: number) {
  const rows = await getSalesLog(businessId)
  return rows.filter(
    (s: any) =>
      String(s.payment_method || '').toUpperCase() === 'DEBT' &&
      String(s.payment_status || '').toUpperCase() !== 'COMPLETED' &&
      String(s.payment_status || '').toUpperCase() !== 'CANCELLED'
  )
}

async function markDebtPaid(saleId: number) {
  return markSaleAsCompleted(saleId)
}

async function getUsersForBusiness(businessId: number) {
  // Ghost / support users (is_hidden) stay out of Staff records for the owner.
  const { data, error } = await supabase
    .from('users_backup')
    .select('id, username, name, email, role, is_active, created_at, business_id, last_login, is_hidden')
    .eq('business_id', businessId)
    .or('is_hidden.is.null,is_hidden.eq.false')
    .order('name')

  if (error) {
    // Column may not exist yet — fall back and filter client-side if present
    const fallback = await supabase
      .from('users_backup')
      .select('id, username, name, email, role, is_active, created_at, business_id, last_login, is_hidden')
      .eq('business_id', businessId)
      .order('name')
    if (fallback.error) throw new Error(fallback.error.message)
    return (fallback.data || []).filter((u: any) => u.is_hidden !== true)
  }
  return data || []
}

async function createUser(request: Record<string, unknown>) {
  const username = String(request.username || '').trim()
  const passwordHash = String(request.password_hash || request.passwordHash || '')
  const role = String(request.role || 'Staff')
  const name = request.name ? String(request.name) : null
  const email = request.email ? String(request.email) : null
  const businessId = argNumber(request, 'business_id', 'businessId')
  const temporaryPassword = request.temporary_password
    ? String(request.temporary_password)
    : request.temporaryPassword
      ? String(request.temporaryPassword)
      : ''

  if (!username) throw new Error('Username is required')
  if (!passwordHash) throw new Error('Password is required')
  if (!businessId) throw new Error('business_id is required')

  const { data: existing } = await supabase
    .from('users_backup')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (existing) throw new Error('Username already exists')

  const id = Date.now()
  // App/form-created users are never ghost — only SQL/support inserts set is_hidden.
  const payload = {
    id,
    username,
    password_hash: passwordHash,
    role,
    name,
    email,
    business_id: businessId,
    is_active: true,
    is_hidden: false,
    temporary_password: temporaryPassword,
    created_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from('users_backup').insert(payload).select('id').single()
  if (error) throw new Error(error.message)
  return data?.id ?? id
}

function parseLocalReportDay(reportDate?: string): { start: Date; end: Date; dateStr: string } {
  let y: number
  let m: number
  let d: number
  if (reportDate && /^\d{4}-\d{2}-\d{2}$/.test(reportDate.trim())) {
    ;[y, m, d] = reportDate.trim().split('-').map(Number)
  } else {
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    y = yesterday.getFullYear()
    m = yesterday.getMonth() + 1
    d = yesterday.getDate()
  }
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { start, end, dateStr }
}

async function getReportPermissions(businessId: number) {
  const defaults = {
    manager_can_view: true,
    secretary_can_view: false,
    staff_can_view: false,
  }
  const key = `pos_report_permissions_${businessId}`
  // Local-only: optional Supabase table not required (avoids 404 noise)
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return defaults
}

async function saveReportPermissions(args: Record<string, unknown>) {
  const businessId = argNumber(args, 'businessId', 'business_id')
  if (!businessId) throw new Error('businessId is required')
  const payload = {
    manager_can_view: Boolean(
      args.managerCanView ?? args.manager_can_view ?? false
    ),
    secretary_can_view: Boolean(
      args.secretaryCanView ?? args.secretary_can_view ?? false
    ),
    staff_can_view: Boolean(args.staffCanView ?? args.staff_can_view ?? false),
  }
  localStorage.setItem(`pos_report_permissions_${businessId}`, JSON.stringify(payload))
  return true
}

function defaultEmailConfig() {
  return {
    smtp_server: 'smtp.gmail.com',
    smtp_port: 587,
    username: '',
    password: '',
    from_email: '',
    from_name: 'POS System',
    use_tls: true,
    enabled: false,
    notification_roles: 'SuperAdmin,Manager',
    low_stock_enabled: true,
    pending_sales_enabled: true,
    daily_reports_enabled: false,
  }
}

async function getEmailConfig(businessId: number) {
  const defaults = defaultEmailConfig()
  const key = `pos_email_config_${businessId}`
  // Local-only: avoids 404 when email_config_backup table is not created yet
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return defaults
}

async function saveEmailConfig(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!businessId) throw new Error('business_id is required')
  const current = await getEmailConfig(businessId)
  const next = {
    ...current,
    smtp_server: String(request.smtp_server ?? current.smtp_server),
    smtp_port: Number(request.smtp_port ?? current.smtp_port) || 587,
    username: String(request.username ?? current.username ?? ''),
    password:
      request.password !== undefined && String(request.password) !== ''
        ? String(request.password)
        : String(current.password || ''),
    from_email: String(request.from_email ?? current.from_email ?? ''),
    from_name: String(request.from_name ?? current.from_name ?? 'POS System'),
    use_tls: Boolean(request.use_tls ?? current.use_tls),
    enabled: Boolean(request.enabled ?? current.enabled),
    notification_roles: String(
      request.notification_roles ?? current.notification_roles ?? 'SuperAdmin,Manager'
    ),
    low_stock_enabled: Boolean(
      request.low_stock_enabled ?? current.low_stock_enabled ?? true
    ),
    pending_sales_enabled: Boolean(
      request.pending_sales_enabled ?? current.pending_sales_enabled ?? true
    ),
    daily_reports_enabled: Boolean(
      request.daily_reports_enabled ?? current.daily_reports_enabled ?? false
    ),
  }
  localStorage.setItem(`pos_email_config_${businessId}`, JSON.stringify(next))
  return true
}

async function canUserViewReports(businessId: number, userRole: string) {
  if (userRole === 'SuperAdmin') return true
  const perms = await getReportPermissions(businessId)
  if (userRole === 'Manager') return Boolean(perms.manager_can_view)
  if (userRole === 'Secretary') return Boolean(perms.secretary_can_view)
  if (['Staff', 'BarStaff', 'KitchenStaff'].includes(userRole)) {
    return Boolean(perms.staff_can_view)
  }
  return false
}

async function getDailyStockReport(businessId: number, reportDate?: string) {
  const { start, end, dateStr } = parseLocalReportDay(reportDate)
  const products = await getProductsForBusiness(businessId)

  const { data: users } = await supabase
    .from('users_backup')
    .select('id')
    .eq('business_id', businessId)
  const userIds = (users || []).map((u) => u.id)

  let daySalesTotal = 0
  let daySalesCount = 0
  let saleIds: number[] = []

  if (userIds.length > 0) {
    const { data: sales } = await supabase
      .from('sales_backup')
      .select('id, total_amount, payment_status, created_at, user_id')
      .in('user_id', userIds)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    const completed = (sales || []).filter((s: any) => {
      const status = String(s.payment_status || 'COMPLETED').toUpperCase()
      return status === 'COMPLETED' || status === 'PENDING' || status === 'PAID'
    })
    daySalesTotal = completed.reduce(
      (sum: number, s: any) => sum + Number(s.total_amount || 0),
      0
    )
    daySalesCount = completed.length
    saleIds = completed.map((s: any) => Number(s.id)).filter(Boolean)
  }

  // Sale items usually have no created_at — load by sale_id for the selected day
  const soldByProduct = new Map<number, { qty: number; revenue: number }>()
  if (saleIds.length > 0) {
    const tables = ['sale_items_backup', 'sale_items_sync', 'sale_items']
    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select('product_id, quantity, total_price, unit_price, sale_id')
        .in('sale_id', saleIds)

      if (!error && data) {
        for (const row of data as any[]) {
          const pid = Number(row.product_id)
          const qty = Number(row.quantity || 0)
          const revenue =
            Number(row.total_price || 0) || qty * Number(row.unit_price || 0)
          const prev = soldByProduct.get(pid) || { qty: 0, revenue: 0 }
          soldByProduct.set(pid, {
            qty: prev.qty + qty,
            revenue: prev.revenue + revenue,
          })
        }
        break
      }
    }
  }

  const rows = products.map((p: any) => {
    const fridge = Number(p.fridge_stock || 0)
    const show = Number(p.show_stock || 0)
    const store = Number(p.store_stock || 0)
    const remaining = fridge + show + store
    const sold = soldByProduct.get(Number(p.id)) || { qty: 0, revenue: 0 }
    const opening = remaining + sold.qty
    const price = Number(p.price || 0)
    const soldRevenue = sold.revenue || sold.qty * price
    const remainingValue = remaining * price
    return {
      id: p.id,
      name: p.name,
      packaging: p.packaging || null,
      category: p.category,
      price,
      opening_stock: opening,
      sold_qty: sold.qty,
      sold_value: soldRevenue,
      remaining_stock: remaining,
      remaining_value: remainingValue,
      fridge_stock: fridge,
      show_stock: show,
      store_stock: store,
    }
  })

  const totals = rows.reduce(
    (acc, row) => {
      acc.sold_qty += row.sold_qty
      acc.sold_value += row.sold_value
      acc.remaining_stock += row.remaining_stock
      acc.remaining_value += row.remaining_value
      acc.opening_stock += row.opening_stock
      return acc
    },
    { sold_qty: 0, sold_value: 0, remaining_stock: 0, remaining_value: 0, opening_stock: 0 }
  )

  return {
    report_date: dateStr,
    day_sales_total: daySalesTotal || totals.sold_value,
    day_sales_count: daySalesCount,
    totals,
    rows: rows.sort((a, b) => b.sold_qty - a.sold_qty || a.name.localeCompare(b.name)),
  }
}

async function updateBusinessSettings(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!businessId) throw new Error('business_id is required')
  const payload: Record<string, unknown> = {
    synced_at: new Date().toISOString(),
  }
  for (const key of ['name', 'address', 'phone', 'email', 'primary_color', 'secondary_color', 'logo_path']) {
    if (key in request) payload[key] = request[key]
  }
  const { error } = await supabase.from('businesses_backup').update(payload).eq('id', businessId)
  if (error) throw new Error(error.message)
  return true
}

async function getAllProducts() {
  const { data, error } = await supabase
    .from('products_backup')
    .select('*')
    .order('name')

  if (error) throw new Error(error.message)
  return data || []
}

async function getBusinessById(businessId: number) {
  const { data, error } = await supabase
    .from('businesses_backup')
    .select('*')
    .eq('id', businessId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function getBusinesses() {
  const { data, error } = await supabase
    .from('businesses_backup')
    .select('*')
    .order('name')

  if (error) throw new Error(error.message)
  return data || []
}

async function getBusinessStaffCount(businessId: number) {
  const { data, error } = await supabase
    .from('users_backup')
    .select('role, is_active, is_hidden')
    .eq('business_id', businessId)

  if (error) throw new Error(error.message)

  // Ghost users do not consume staff seats
  const users = (data || []).filter(
    (u) => u.is_active !== false && (u as any).is_hidden !== true
  )
  const admin = users.filter((u) => u.role === 'SuperAdmin').length
  const manager = users.filter((u) => u.role === 'Manager').length
  const secretary = users.filter((u) => u.role === 'Secretary').length
  const staff = users.filter((u) =>
    ['Staff', 'BarStaff', 'KitchenStaff'].includes(String(u.role))
  ).length
  const total = admin + manager + secretary + staff

  const max_manager = 1
  const max_secretary = 1
  const max_staff = 4
  const max_total = 6

  return {
    admin,
    manager,
    secretary,
    staff,
    total,
    limits: { max_manager, max_secretary, max_staff, max_total },
    available: {
      manager: Math.max(0, max_manager - manager),
      secretary: Math.max(0, max_secretary - secretary),
      staff: Math.max(0, max_staff - staff),
      total: Math.max(0, max_total - total),
    },
  }
}

async function getDashboardMetrics(businessId: number) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const [productsRes, usersRes, salesRes] = await Promise.all([
    supabase
      .from('products_backup')
      .select('fridge_stock, show_stock, store_stock, min_stock_level, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true),
    supabase
      .from('users_backup')
      .select('id, role, is_active, is_hidden')
      .eq('business_id', businessId),
    supabase
      .from('sales_backup')
      .select('total_amount, created_at, user_id')
      .gte('created_at', start.toISOString()),
  ])

  if (productsRes.error) console.error('metrics products:', productsRes.error)
  if (usersRes.error) console.error('metrics users:', usersRes.error)
  if (salesRes.error) console.error('metrics sales:', salesRes.error)

  const products = productsRes.data || []
  const users = (usersRes.data || []).filter(
    (u) => u.is_active !== false && (u as any).is_hidden !== true
  )
  const sales = salesRes.data || []

  const itemsInStock = products.reduce((sum, p) => {
    return (
      sum +
      Number(p.fridge_stock || 0) +
      Number(p.show_stock || 0) +
      Number(p.store_stock || 0)
    )
  }, 0)

  const lowStock = products.filter((p) => {
    const fridge = Number(p.fridge_stock || 0)
    const show = Number(p.show_stock || 0)
    const store = Number(p.store_stock || 0)
    const min = Number(p.min_stock_level || 0)
    const total = fridge + show + store
    return total > 0 && (fridge <= min || show <= min || store <= min)
  }).length

  const todaySales = sales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)

  return {
    todaySales,
    itemsInStock,
    activeStaff: users.length,
    lowStockAlerts: lowStock,
  }
}

async function createProduct(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!businessId) throw new Error('Invalid business_id')

  const payload = {
    id: Date.now(),
    business_id: businessId,
    name: String(request.name || ''),
    description: request.description ? String(request.description) : null,
    category: 'BAR',
    packaging: request.packaging ? String(request.packaging) : null,
    price: Number(request.price || 0),
    cost_price: Number(request.cost_price ?? request.costPrice ?? 0),
    stock_quantity: Number(request.stock_quantity ?? request.stockQuantity ?? 0),
    min_stock_level: Number(request.min_stock_level ?? request.minStockLevel ?? 0),
    fridge_stock: Number(request.fridge_stock ?? request.fridgeStock ?? 0),
    show_stock: Number(request.show_stock ?? request.showStock ?? 0),
    store_stock: Number(request.store_stock ?? request.storeStock ?? 0),
    barcode: request.barcode ? String(request.barcode) : null,
    serial_number: request.serial_number
      ? String(request.serial_number)
      : request.serialNumber
        ? String(request.serialNumber)
        : null,
    image_path: request.image_path ? String(request.image_path) : null,
    is_active: true,
    created_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('products_backup')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data?.id ?? payload.id
}

async function updateProduct(request: Record<string, unknown>) {
  const id = argNumber(request, 'id', 'productId')
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!id) throw new Error('Invalid product id')
  if (!businessId) throw new Error('Invalid business_id')

  const payload: Record<string, unknown> = {
    name: String(request.name || ''),
    description: request.description ? String(request.description) : null,
    category: 'BAR',
    packaging: request.packaging ? String(request.packaging) : null,
    price: Number(request.price || 0),
    cost_price: Number(request.cost_price ?? request.costPrice ?? 0),
    min_stock_level: Number(request.min_stock_level ?? request.minStockLevel ?? 0),
    fridge_stock: Number(request.fridge_stock ?? request.fridgeStock ?? 0),
    show_stock: Number(request.show_stock ?? request.showStock ?? 0),
    store_stock: Number(request.store_stock ?? request.storeStock ?? 0),
    image_path: request.image_path
      ? String(request.image_path)
      : request.imagePath
        ? String(request.imagePath)
        : null,
    synced_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('products_backup')
    .update(payload)
    .eq('id', id)
    .eq('business_id', businessId)

  if (error) throw new Error(error.message)
  return id
}

async function updateStockType(args: Record<string, unknown>) {
  const productId = argNumber(args, 'productId', 'product_id')
  const stockType = String(args.stockType || args.stock_type || 'store')
  const quantityChange = Number(args.quantityChange ?? args.quantity_change ?? 0)
  if (!productId) throw new Error('productId is required')

  const column =
    stockType === 'fridge'
      ? 'fridge_stock'
      : stockType === 'show'
        ? 'show_stock'
        : 'store_stock'

  const { data: product, error: readError } = await supabase
    .from('products_backup')
    .select(`id, ${column}`)
    .eq('id', productId)
    .single()

  if (readError) throw new Error(readError.message)
  const current = Number((product as any)?.[column] || 0)
  const next = Math.max(0, current + quantityChange)

  const { error } = await supabase
    .from('products_backup')
    .update({ [column]: next, synced_at: new Date().toISOString() })
    .eq('id', productId)

  if (error) throw new Error(error.message)
  return true
}

async function transferStock(args: Record<string, unknown>) {
  const productId = argNumber(args, 'productId', 'product_id')
  const from = String(args.from || '')
  const to = String(args.to || '')
  const quantity = Number(args.quantity || 0)
  if (!productId) throw new Error('productId is required')
  if (quantity <= 0) throw new Error('quantity must be positive')

  const col = (type: string) =>
    type === 'fridge' ? 'fridge_stock' : type === 'show' ? 'show_stock' : 'store_stock'

  const fromCol = col(from)
  const toCol = col(to)

  const { data: product, error: readError } = await supabase
    .from('products_backup')
    .select('id, fridge_stock, show_stock, store_stock')
    .eq('id', productId)
    .single()

  if (readError) throw new Error(readError.message)
  const fromVal = Number((product as any)?.[fromCol] || 0)
  if (fromVal < quantity) throw new Error(`Not enough stock in ${from}`)

  const { error } = await supabase
    .from('products_backup')
    .update({
      [fromCol]: fromVal - quantity,
      [toCol]: Number((product as any)?.[toCol] || 0) + quantity,
      synced_at: new Date().toISOString(),
    })
    .eq('id', productId)

  if (error) throw new Error(error.message)
  return true
}

type ProductCategory = {
  id: number
  business_id: number
  name: string
  description?: string | null
  is_active?: boolean
  created_at?: string
}

function localCategoriesKey(businessId: number) {
  return `pos_product_categories_${businessId}`
}

function readLocalCategories(businessId: number): ProductCategory[] {
  try {
    const raw = localStorage.getItem(localCategoriesKey(businessId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalCategories(businessId: number, categories: ProductCategory[]) {
  localStorage.setItem(localCategoriesKey(businessId), JSON.stringify(categories))
}

async function getProductCategories(businessId: number): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories_backup')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  if (error) {
    // Table may not exist yet — fall back to local storage + product-derived names
    const local = readLocalCategories(businessId)
    const { data: products } = await supabase
      .from('products_backup')
      .select('category')
      .eq('business_id', businessId)
      .eq('is_active', true)

    const fromProducts = Array.from(
      new Set((products || []).map((p) => String(p.category || '').trim()).filter(Boolean))
    ).map((name, index) => ({
      id: Date.now() + index,
      business_id: businessId,
      name,
      is_active: true,
      created_at: new Date().toISOString(),
    }))

    const merged = new Map<string, ProductCategory>()
    ;[...local, ...fromProducts].forEach((cat) => {
      merged.set(cat.name.toLowerCase(), cat)
    })
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  return (data || []) as ProductCategory[]
}

async function createProductCategory(request: Record<string, unknown>): Promise<ProductCategory> {
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!businessId) throw new Error('business_id is required')
  const name = String(request.name || '').trim()
  if (!name) throw new Error('Category name is required')

  const payload: ProductCategory = {
    id: Date.now(),
    business_id: businessId,
    name,
    description: request.description ? String(request.description) : null,
    is_active: true,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('product_categories_backup')
    .insert({ ...payload, synced_at: new Date().toISOString() })
    .select('*')
    .single()

  if (error) {
    // Fallback: store locally until SQL table is created
    const existing = readLocalCategories(businessId)
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Category already exists')
    }
    const next = [...existing, payload].sort((a, b) => a.name.localeCompare(b.name))
    writeLocalCategories(businessId, next)
    return payload
  }

  return data as ProductCategory
}

async function deleteProductCategory(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  const categoryId = argNumber(request, 'id', 'categoryId', 'category_id')
  const name = String(request.name || '').trim()

  if (categoryId) {
    const { error } = await supabase
      .from('product_categories_backup')
      .update({ is_active: false, synced_at: new Date().toISOString() })
      .eq('id', categoryId)
    if (!error) return true
  }

  if (businessId && name) {
    const existing = readLocalCategories(businessId).filter(
      (c) => c.name.toLowerCase() !== name.toLowerCase()
    )
    writeLocalCategories(businessId, existing)
    if (categoryId) {
      const filtered = existing.filter((c) => c.id !== categoryId)
      writeLocalCategories(businessId, filtered)
    }
    return true
  }

  throw new Error('Could not delete category')
}

/** Web API bridge — routes former Tauri commands to Supabase. */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown> | number
): Promise<T> {
  const command = String(cmd || '').trim()

  // Local-first settings: work even if Supabase tables are missing
  if (
    command === 'get_report_permissions' ||
    command === 'save_report_permissions' ||
    command === 'get_email_config' ||
    command === 'save_email_config' ||
    command === 'send_test_email'
  ) {
    try {
      if (command === 'get_report_permissions') {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getReportPermissions(businessId)) as T
      }
      if (command === 'save_report_permissions') {
        return (await saveReportPermissions((args || {}) as Record<string, unknown>)) as T
      }
      if (command === 'get_email_config') {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getEmailConfig(businessId)) as T
      }
      if (command === 'save_email_config') {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await saveEmailConfig(request)) as T
      }
      throw new Error(
        'Test email is not available in the web app. Save your SMTP settings for when email sending is configured on the server.'
      )
    } catch (error) {
      console.error(`Web command '${command}' failed:`, error)
      throw error
    }
  }

  if (!isSupabaseConfigured) {
    console.warn(`Supabase not configured; cannot run '${command}'`)
    return null as T
  }

  try {
    switch (command) {
      case 'get_products_for_business': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getProductsForBusiness(businessId)) as T
      }
      case 'get_all_products':
        return (await getAllProducts()) as T
      case 'get_business_by_id': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getBusinessById(businessId)) as T
      }
      case 'get_businesses':
        return (await getBusinesses()) as T
      case 'get_business_staff_count': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getBusinessStaffCount(businessId)) as T
      }
      case 'get_dashboard_metrics': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getDashboardMetrics(businessId)) as T
      }
      case 'create_product': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await createProduct(request)) as T
      }
      case 'update_product': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await updateProduct(request)) as T
      }
      case 'update_stock_type': {
        return (await updateStockType((args || {}) as Record<string, unknown>)) as T
      }
      case 'transfer_stock': {
        return (await transferStock((args || {}) as Record<string, unknown>)) as T
      }
      case 'get_product_categories': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getProductCategories(businessId)) as T
      }
      case 'create_product_category': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await createProductCategory(request)) as T
      }
      case 'delete_product_category': {
        const request = (args || {}) as Record<string, unknown>
        return (await deleteProductCategory(request)) as T
      }
      case 'get_pending_items_summary': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getPendingItemsSummary(businessId)) as T
      }
      case 'get_pending_sales': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getPendingSales(businessId)) as T
      }
      case 'get_low_stock_products_for_business': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getLowStockProducts(businessId)) as T
      }
      case 'get_out_of_stock_products_for_business': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getOutOfStockProducts(businessId)) as T
      }
      case 'mark_sale_as_completed': {
        const saleId = argNumber(args, 'saleId', 'sale_id')
        if (!saleId) throw new Error('saleId is required')
        return (await markSaleAsCompleted(saleId)) as T
      }
      case 'process_sale': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await processSale(request)) as T
      }
      case 'get_sales_log': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        const staffId = argNumber(args, 'staffId', 'staff_id')
        return (await getSalesLog(businessId, staffId)) as T
      }
      case 'get_debt_sales': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getDebtSales(businessId)) as T
      }
      case 'mark_debt_paid': {
        const saleId = argNumber(args, 'saleId', 'sale_id')
        if (!saleId) throw new Error('saleId is required')
        return (await markDebtPaid(saleId)) as T
      }
      case 'get_users_for_business':
      case 'get_staff_for_business': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getUsersForBusiness(businessId)) as T
      }
      case 'create_user': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await createUser(request)) as T
      }
      case 'can_user_view_reports': {
        const businessId = argNumber(args, 'businessId', 'business_id') || 0
        const userRole = String(
          (args as any)?.userRole || (args as any)?.user_role || ''
        )
        return (await canUserViewReports(businessId, userRole)) as T
      }
      case 'get_daily_stock_report': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        const reportDate = String((args as any)?.reportDate || (args as any)?.report_date || '')
        return (await getDailyStockReport(businessId, reportDate || undefined)) as T
      }
      case 'update_business_settings': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await updateBusinessSettings(request)) as T
      }
      case 'get_report_permissions': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getReportPermissions(businessId)) as T
      }
      case 'save_report_permissions': {
        return (await saveReportPermissions((args || {}) as Record<string, unknown>)) as T
      }
      case 'get_email_config': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getEmailConfig(businessId)) as T
      }
      case 'save_email_config': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await saveEmailConfig(request)) as T
      }
      case 'send_test_email': {
        throw new Error(
          'Test email is not available in the web app. Save your SMTP settings — they will be used when email sending is configured on the server.'
        )
      }
      default:
        console.warn(`Unhandled web command '${cmd}'`)
        return null as T
    }
  } catch (error) {
    console.error(`Web command '${cmd}' failed:`, error)
    throw error
  }
}
