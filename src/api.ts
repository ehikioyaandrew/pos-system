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

/** Build created_at from YYYY-MM-DD (local calendar day) or now.
 * When baseIso is provided (e.g. editing a sale), keep that time-of-day. */
function resolveSaleCreatedAt(saleDate?: string | null, baseIso?: string | null) {
  const base = baseIso ? new Date(baseIso) : new Date()
  const clock = Number.isNaN(base.getTime()) ? new Date() : base
  const raw = String(saleDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    const picked = new Date(
      y,
      m - 1,
      d,
      clock.getHours(),
      clock.getMinutes(),
      clock.getSeconds(),
      clock.getMilliseconds()
    )
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const pickedStart = new Date(y, m - 1, d)
    if (pickedStart.getTime() > todayStart.getTime()) {
      throw new Error('Sale date cannot be in the future')
    }
    return picked.toISOString()
  }
  return clock.toISOString()
}

async function updateSaleDate(opts: {
  saleId: number
  businessId: number
  saleDate: string
}) {
  const saleId = Number(opts.saleId)
  const businessId = Number(opts.businessId)
  if (!saleId) throw new Error('saleId is required')
  if (!businessId) throw new Error('businessId is required')

  const { data: sale, error: saleError } = await supabase
    .from('sales_backup')
    .select('*')
    .eq('id', saleId)
    .maybeSingle()
  if (saleError) throw new Error(saleError.message)
  if (!sale) throw new Error('Sale not found')

  const { data: staff, error: staffError } = await supabase
    .from('users_backup')
    .select('id, business_id')
    .eq('id', sale.user_id)
    .maybeSingle()
  if (staffError) throw new Error(staffError.message)
  if (!staff || Number(staff.business_id) !== businessId) {
    throw new Error('Sale does not belong to this business')
  }

  const createdAt = resolveSaleCreatedAt(opts.saleDate, sale.created_at)
  const syncedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('sales_backup')
    .update({ created_at: createdAt, synced_at: syncedAt })
    .eq('id', saleId)
  if (updateError) throw new Error(updateError.message)

  // Keep linked debt charge dates in sync when present
  try {
    const useRemote = await debtsTableAvailable()
    if (useRemote) {
      await supabase
        .from('debt_entries_backup')
        .update({ entry_date: createdAt, synced_at: syncedAt })
        .eq('sale_id', saleId)
        .eq('business_id', businessId)
    } else {
      const entries = readLocalDebtEntries(businessId)
      let changed = false
      for (const e of entries) {
        if (Number(e.sale_id) === saleId) {
          e.entry_date = createdAt
          e.synced_at = syncedAt
          changed = true
        }
      }
      if (changed) writeLocalDebtEntries(businessId, entries)
    }
  } catch {
    // Sale date still updated even if debt sync is unavailable
  }

  return { ...sale, created_at: createdAt, synced_at: syncedAt }
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
  const location =
    rawLocation === 'show' ? 'show' : rawLocation === 'sports' ? 'sports' : 'fridge'
  let customerName = request.customer_name ? String(request.customer_name).trim() : ''
  if (paymentMethod === 'DEBT') {
    if (!customerName) throw new Error('Customer name is required for debt sales')
    if (normalizeCustomerKey(customerName) === normalizeCustomerKey(WALK_IN_CUSTOMER)) {
      throw new Error('Walk-in customer cannot hold debt. Enter a real customer name.')
    }
  } else if (!customerName) {
    customerName = WALK_IN_CUSTOMER
  }

  const notes =
    (request.notes ? String(request.notes) : '') ||
    (paymentMethod === 'DEBT' ? `DEBT:${customerName}` : customerName) ||
    null

  const saleDateRaw = String(request.sale_date || request.saleDate || '').trim()
  const createdAt = resolveSaleCreatedAt(saleDateRaw)

  // Validate stock in the selected location before writing the sale
  // Sports amenities are services (price + duration) — no stock check/deduction
  if (location !== 'sports') {
    for (const item of items) {
      const productId = Number(item.product_id)
      const qty = Number(item.quantity || 0)
      if (!productId || qty <= 0) continue
      const { data: product, error } = await supabase
        .from('products_backup')
        .select('id, name, fridge_stock, show_stock, sports_stock')
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
    created_at: createdAt,
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

    if (location !== 'sports') {
      await updateStockType({
        productId,
        stockType: location,
        quantityChange: -qty,
      })
    }
  }

  if (paymentMethod === 'DEBT') {
    try {
      await chargeSaleToDebt({
        businessId,
        customerName,
        amount: totalAmount,
        saleId,
        staffId,
        entryDate: createdAt,
      })
    } catch (e) {
      console.error('Failed to add sale to debt ledger:', e)
      throw new Error(
        `Sale saved but debt ledger update failed: ${e instanceof Error ? e.message : e}`
      )
    }
  }

  return {
    sale_id: saleId,
    total_amount: totalAmount,
    payment_method: paymentMethod,
    customer_name: customerName,
    created_at: createdAt,
    items: items.length,
    timestamp: createdAt,
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
      customer_name: parseDebtCustomer(s.notes) || WALK_IN_CUSTOMER,
    }
  })
}

async function getSaleItemsForSale(saleId: number) {
  const tables = ['sale_items_backup', 'sale_items_sync', 'sale_items']
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('product_id, quantity, total_price, unit_price, sale_id')
      .eq('sale_id', saleId)
    if (!error && data) return data as any[]
  }
  return []
}

async function getSaleReceipt(saleId: number, businessId?: number | null) {
  const { data: sale, error: saleError } = await supabase
    .from('sales_backup')
    .select('*')
    .eq('id', saleId)
    .maybeSingle()
  if (saleError) throw new Error(saleError.message)
  if (!sale) throw new Error('Sale not found')

  let staffName = 'Staff'
  if (sale.user_id) {
    const { data: user } = await supabase
      .from('users_backup')
      .select('id, name, username, business_id')
      .eq('id', sale.user_id)
      .maybeSingle()
    if (user) staffName = user.name || user.username || staffName
    if (!businessId && user?.business_id) businessId = user.business_id
  }

  let businessName = 'POS System'
  let businessAddress: string | null = null
  let businessPhone: string | null = null
  if (businessId) {
    const { data: business } = await supabase
      .from('businesses_backup')
      .select('*')
      .eq('id', businessId)
      .maybeSingle()
    if (business) {
      businessName = business.name || businessName
      businessAddress = (business as any).address || null
      businessPhone = (business as any).phone || null
    }
  }

  const rawItems = await getSaleItemsForSale(saleId)
  const productIds = [
    ...new Set(rawItems.map((i) => Number(i.product_id)).filter(Boolean)),
  ]
  const productMap = new Map<number, any>()
  if (productIds.length) {
    const { data: products } = await supabase
      .from('products_backup')
      .select('id, name, packaging')
      .in('id', productIds)
    for (const p of products || []) productMap.set(Number(p.id), p)
  }

  const items = rawItems.map((item) => {
    const product = productMap.get(Number(item.product_id))
    const qty = Number(item.quantity || 0)
    const unitPrice = Number(item.unit_price || 0)
    const total =
      Number(item.total_price || 0) || qty * unitPrice
    const name = product?.name || `Product #${item.product_id}`
    const packaging = product?.packaging ? ` (${product.packaging})` : ''
    return {
      product_id: Number(item.product_id),
      name: `${name}${packaging}`,
      quantity: qty,
      unit_price: unitPrice,
      total_price: total,
    }
  })

  return {
    id: sale.id,
    created_at: sale.created_at,
    total_amount: Number(sale.total_amount || 0),
    payment_method: sale.payment_method || 'CASH',
    payment_status: sale.payment_status || 'COMPLETED',
    staff_name: staffName,
    customer_name: parseDebtCustomer(sale.notes) || WALK_IN_CUSTOMER,
    location: sale.location || null,
    business_name: businessName,
    business_address: businessAddress,
    business_phone: businessPhone,
    items,
  }
}

function parseDebtCustomer(notes?: string | null) {
  if (!notes) return null
  const text = String(notes)
  if (text.toUpperCase().startsWith('DEBT:')) return text.slice(5).trim() || null
  return text.trim() || null
}

const WALK_IN_CUSTOMER = 'Walk-in customer'

function normalizeCustomerKey(name: string) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function debtLocalKey(businessId: number) {
  return `pos_customer_debts_${businessId}`
}

function debtEntriesLocalKey(businessId: number) {
  return `pos_debt_entries_${businessId}`
}

function readLocalDebts(businessId: number): any[] {
  try {
    const raw = localStorage.getItem(debtLocalKey(businessId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeLocalDebts(businessId: number, rows: any[]) {
  localStorage.setItem(debtLocalKey(businessId), JSON.stringify(rows))
}

function readLocalDebtEntries(businessId: number): any[] {
  try {
    const raw = localStorage.getItem(debtEntriesLocalKey(businessId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeLocalDebtEntries(businessId: number, rows: any[]) {
  localStorage.setItem(debtEntriesLocalKey(businessId), JSON.stringify(rows))
}

function mapDebtRow(row: any) {
  if (!row) return null
  const charged = Number(row.total_charged || 0)
  const paid = Number(row.total_paid || 0)
  const balance = Math.max(0, charged - paid)
  return {
    ...row,
    total_charged: charged,
    total_paid: paid,
    balance,
    status: balance <= 0.0001 ? 'SETTLED' : row.status || 'OPEN',
  }
}

let debtsRemoteCache: boolean | null = null

async function debtsTableAvailable() {
  if (debtsRemoteCache !== null) return debtsRemoteCache
  const { error } = await supabase.from('customer_debts_backup').select('id').limit(1)
  if (!error) {
    debtsRemoteCache = true
    return true
  }
  const msg = String(error.message || '')
  if (/relation|does not exist|Could not find the table|PGRST/i.test(msg) || error.code === 'PGRST205') {
    debtsRemoteCache = false
    return false
  }
  // Transient/other errors: prefer remote attempt
  return true
}

async function findOrCreateDebtAccount(opts: {
  businessId: number
  customerName: string
  debtDate?: string | null
  notes?: string | null
  useRemote: boolean
}) {
  const customerName = String(opts.customerName || '').trim()
  if (!customerName) throw new Error('Customer name is required')
  if (normalizeCustomerKey(customerName) === normalizeCustomerKey(WALK_IN_CUSTOMER)) {
    throw new Error('Walk-in customer cannot hold debt. Enter a real customer name.')
  }

  const customerKey = normalizeCustomerKey(customerName)
  const now = new Date().toISOString()

  if (opts.useRemote) {
    const { data: existing, error } = await supabase
      .from('customer_debts_backup')
      .select('*')
      .eq('business_id', opts.businessId)
      .eq('customer_key', customerKey)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (existing) return mapDebtRow(existing)

    const id = Date.now()
    const payload = {
      id,
      business_id: opts.businessId,
      customer_name: customerName,
      customer_key: customerKey,
      total_charged: 0,
      total_paid: 0,
      debt_date: opts.debtDate || now,
      notes: opts.notes || null,
      status: 'OPEN',
      created_at: now,
      updated_at: now,
      synced_at: now,
    }
    const { data, error: insertError } = await supabase
      .from('customer_debts_backup')
      .insert(payload)
      .select('*')
      .single()
    if (insertError) throw new Error(insertError.message)
    return mapDebtRow(data)
  }

  const rows = readLocalDebts(opts.businessId)
  const existing = rows.find((r) => r.customer_key === customerKey)
  if (existing) return mapDebtRow(existing)
  const created = {
    id: Date.now(),
    business_id: opts.businessId,
    customer_name: customerName,
    customer_key: customerKey,
    total_charged: 0,
    total_paid: 0,
    debt_date: opts.debtDate || now,
    notes: opts.notes || null,
    status: 'OPEN',
    created_at: now,
    updated_at: now,
    synced_at: now,
  }
  rows.unshift(created)
  writeLocalDebts(opts.businessId, rows)
  return mapDebtRow(created)
}

async function appendDebtEntry(opts: {
  businessId: number
  debtId: number
  entryType: 'CHARGE' | 'PAYMENT' | 'MANUAL'
  amount: number
  saleId?: number | null
  note?: string | null
  entryDate?: string | null
  staffId?: number | null
  useRemote: boolean
}) {
  const amount = Number(opts.amount || 0)
  if (!(amount > 0)) throw new Error('Amount must be greater than zero')
  const now = new Date().toISOString()
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    debt_id: opts.debtId,
    business_id: opts.businessId,
    entry_type: opts.entryType,
    amount,
    sale_id: opts.saleId || null,
    note: opts.note || null,
    entry_date: opts.entryDate || now,
    staff_id: opts.staffId || null,
    created_at: now,
    synced_at: now,
  }

  if (opts.useRemote) {
    const { error } = await supabase.from('debt_entries_backup').insert(entry)
    if (error) throw new Error(error.message)

    const { data: debt, error: debtError } = await supabase
      .from('customer_debts_backup')
      .select('*')
      .eq('id', opts.debtId)
      .single()
    if (debtError) throw new Error(debtError.message)

    const charged =
      Number(debt.total_charged || 0) +
      (opts.entryType === 'PAYMENT' ? 0 : amount)
    const paid =
      Number(debt.total_paid || 0) + (opts.entryType === 'PAYMENT' ? amount : 0)
    const balance = charged - paid
    const status = balance <= 0.0001 ? 'SETTLED' : 'OPEN'
    const { data: updated, error: updateError } = await supabase
      .from('customer_debts_backup')
      .update({
        total_charged: charged,
        total_paid: paid,
        status,
        updated_at: now,
        synced_at: now,
      })
      .eq('id', opts.debtId)
      .select('*')
      .single()
    if (updateError) throw new Error(updateError.message)
    return { debt: mapDebtRow(updated), entry }
  }

  const entries = readLocalDebtEntries(opts.businessId)
  entries.unshift(entry)
  writeLocalDebtEntries(opts.businessId, entries)

  const rows = readLocalDebts(opts.businessId)
  const idx = rows.findIndex((r) => Number(r.id) === Number(opts.debtId))
  if (idx < 0) throw new Error('Debt account not found')
  const debt = rows[idx]
  debt.total_charged =
    Number(debt.total_charged || 0) + (opts.entryType === 'PAYMENT' ? 0 : amount)
  debt.total_paid =
    Number(debt.total_paid || 0) + (opts.entryType === 'PAYMENT' ? amount : 0)
  debt.status = Number(debt.total_charged) - Number(debt.total_paid) <= 0.0001 ? 'SETTLED' : 'OPEN'
  debt.updated_at = now
  rows[idx] = debt
  writeLocalDebts(opts.businessId, rows)
  return { debt: mapDebtRow(debt), entry }
}

async function settleCustomerDebtSales(businessId: number, customerName: string) {
  const sales = await getDebtSales(businessId)
  const key = normalizeCustomerKey(customerName)
  for (const sale of sales) {
    const name = parseDebtCustomer(sale.notes) || sale.customer_name
    if (normalizeCustomerKey(String(name || '')) === key) {
      await markSaleAsCompleted(Number(sale.id))
    }
  }
}

async function migrateLegacyDebtSales(businessId: number, useRemote: boolean) {
  const sales = await getDebtSales(businessId)
  for (const sale of sales) {
    const customerName =
      parseDebtCustomer(sale.notes) || sale.customer_name || 'Unnamed customer'
    const amount = Number(sale.total_amount || 0)
    if (!(amount > 0)) continue

    const account = await findOrCreateDebtAccount({
      businessId,
      customerName,
      debtDate: sale.created_at,
      useRemote,
    })

    // Skip if this sale was already charged into the ledger
    if (useRemote) {
      const { data: existing } = await supabase
        .from('debt_entries_backup')
        .select('id')
        .eq('sale_id', sale.id)
        .limit(1)
      if (existing && existing.length) continue
    } else {
      const entries = readLocalDebtEntries(businessId)
      if (entries.some((e) => Number(e.sale_id) === Number(sale.id))) continue
    }

    await appendDebtEntry({
      businessId,
      debtId: Number(account.id),
      entryType: 'CHARGE',
      amount,
      saleId: Number(sale.id),
      note: `Migrated sale #${sale.id}`,
      entryDate: sale.created_at,
      staffId: sale.user_id || null,
      useRemote,
    })
  }
}

async function getDebtors(
  businessId: number,
  opts?: { openOnly?: boolean; staffId?: number | null }
) {
  const useRemote = await debtsTableAvailable()
  try {
    await migrateLegacyDebtSales(businessId, useRemote)
  } catch (e) {
    console.warn('Debt migration skipped:', e)
  }

  let rows: any[] = []
  if (useRemote) {
    const { data, error } = await supabase
      .from('customer_debts_backup')
      .select('*')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    rows = (data || []).map(mapDebtRow).filter(Boolean)
  } else {
    rows = readLocalDebts(businessId).map(mapDebtRow).filter(Boolean)
  }

  const staffId = opts?.staffId ? Number(opts.staffId) : null
  if (staffId) {
    let allowedDebtIds = new Set<number>()
    if (useRemote) {
      const { data: entries, error } = await supabase
        .from('debt_entries_backup')
        .select('debt_id')
        .eq('business_id', businessId)
        .eq('staff_id', staffId)
      if (error) throw new Error(error.message)
      allowedDebtIds = new Set(
        (entries || []).map((e: any) => Number(e.debt_id)).filter(Boolean)
      )
    } else {
      allowedDebtIds = new Set(
        readLocalDebtEntries(businessId)
          .filter((e) => Number(e.staff_id) === staffId)
          .map((e) => Number(e.debt_id))
          .filter(Boolean)
      )
    }

    // Also include open DEBT sales created by this staff (covers edge cases)
    try {
      const ownSales = await getDebtSales(businessId)
      for (const sale of ownSales) {
        if (Number(sale.user_id) !== staffId) continue
        const customerName =
          parseDebtCustomer(sale.notes) || sale.customer_name || ''
        const key = normalizeCustomerKey(String(customerName))
        for (const row of rows) {
          if (normalizeCustomerKey(String(row.customer_name || '')) === key) {
            allowedDebtIds.add(Number(row.id))
          }
        }
      }
    } catch {
      // ignore
    }

    rows = rows.filter((r) => allowedDebtIds.has(Number(r.id)))
  }

  if (opts?.openOnly !== false) {
    rows = rows.filter((r) => Number(r.balance) > 0.0001)
  }
  return rows
}

async function addManualDebt(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!businessId) throw new Error('businessId is required')
  const customerName = String(request.customer_name || request.customerName || '').trim()
  const amount = Number(request.amount || 0)
  const debtDate = request.debt_date || request.debtDate || new Date().toISOString()
  const notes = request.notes ? String(request.notes) : null
  const staffId = argNumber(request, 'staff_id', 'staffId')

  if (!customerName) throw new Error('Customer name is required')
  if (!(amount > 0)) throw new Error('Amount must be greater than zero')

  const useRemote = await debtsTableAvailable()
  const account = await findOrCreateDebtAccount({
    businessId,
    customerName,
    debtDate: String(debtDate),
    notes,
    useRemote,
  })

  const result = await appendDebtEntry({
    businessId,
    debtId: Number(account.id),
    entryType: 'MANUAL',
    amount,
    note: notes || 'Manual / old debt',
    entryDate: String(debtDate),
    staffId,
    useRemote,
  })
  return result.debt
}

async function recordDebtPayment(request: Record<string, unknown>) {
  const businessId = argNumber(request, 'business_id', 'businessId')
  const debtId = argNumber(request, 'debt_id', 'debtId')
  const amount = Number(request.amount || 0)
  const staffId = argNumber(request, 'staff_id', 'staffId')
  const note = request.note ? String(request.note) : 'Payment received'

  if (!businessId) throw new Error('businessId is required')
  if (!debtId) throw new Error('debtId is required')
  if (!(amount > 0)) throw new Error('Payment amount must be greater than zero')

  const useRemote = await debtsTableAvailable()
  let debt: any
  if (useRemote) {
    const { data, error } = await supabase
      .from('customer_debts_backup')
      .select('*')
      .eq('id', debtId)
      .eq('business_id', businessId)
      .single()
    if (error) throw new Error(error.message)
    debt = mapDebtRow(data)
  } else {
    debt = mapDebtRow(
      readLocalDebts(businessId).find((r) => Number(r.id) === debtId) || null
    )
    if (!debt?.id) throw new Error('Debt account not found')
  }

  if (amount > Number(debt.balance) + 0.0001) {
    throw new Error(`Payment exceeds balance of ₦${Number(debt.balance).toFixed(2)}`)
  }

  const result = await appendDebtEntry({
    businessId,
    debtId,
    entryType: 'PAYMENT',
    amount,
    note,
    staffId,
    useRemote,
  })

  if (Number(result.debt.balance) <= 0.0001) {
    try {
      await settleCustomerDebtSales(businessId, result.debt.customer_name)
    } catch (e) {
      console.warn('Could not auto-complete related debt sales:', e)
    }
  }

  return result.debt
}

async function chargeSaleToDebt(opts: {
  businessId: number
  customerName: string
  amount: number
  saleId: number
  staffId?: number | null
  entryDate?: string | null
}) {
  const useRemote = await debtsTableAvailable()
  const account = await findOrCreateDebtAccount({
    businessId: opts.businessId,
    customerName: opts.customerName,
    debtDate: opts.entryDate || undefined,
    useRemote,
  })
  const result = await appendDebtEntry({
    businessId: opts.businessId,
    debtId: Number(account.id),
    entryType: 'CHARGE',
    amount: opts.amount,
    saleId: opts.saleId,
    note: `Sale #${opts.saleId}`,
    entryDate: opts.entryDate || undefined,
    staffId: opts.staffId,
    useRemote,
  })
  return result.debt
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

async function resetStaffPassword(request: Record<string, unknown>) {
  const userId = argNumber(request, 'user_id', 'userId')
  if (!userId) throw new Error('userId is required')
  const temporaryPassword = String(
    request.temporary_password || request.temporaryPassword || ''
  ).trim()
  if (!temporaryPassword || temporaryPassword.length < 6) {
    throw new Error('Temporary password must be at least 6 characters')
  }
  const passwordHash = btoa(temporaryPassword)
  const { data, error } = await supabase
    .from('users_backup')
    .update({
      password_hash: passwordHash,
      temporary_password: temporaryPassword,
      synced_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id, username, name, role')
    .single()
  if (error) throw new Error(error.message)
  return { ...data, temporary_password: temporaryPassword }
}

async function setStaffActive(request: Record<string, unknown>) {
  const userId = argNumber(request, 'user_id', 'userId')
  if (!userId) throw new Error('userId is required')
  const isActive = Boolean(
    request.is_active ?? request.isActive ?? false
  )

  const { data: existing, error: findError } = await supabase
    .from('users_backup')
    .select('id, username, name, role, is_active, is_hidden')
    .eq('id', userId)
    .maybeSingle()
  if (findError) throw new Error(findError.message)
  if (!existing) throw new Error('Staff member not found')
  if ((existing as any).is_hidden === true) {
    throw new Error('This account cannot be changed from staff management')
  }

  const { data, error } = await supabase
    .from('users_backup')
    .update({
      is_active: isActive,
      synced_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id, username, name, role, is_active')
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function deleteStaffUser(request: Record<string, unknown>) {
  const userId = argNumber(request, 'user_id', 'userId')
  if (!userId) throw new Error('userId is required')

  const { data: existing, error: findError } = await supabase
    .from('users_backup')
    .select('id, username, name, role, is_hidden')
    .eq('id', userId)
    .maybeSingle()
  if (findError) throw new Error(findError.message)
  if (!existing) throw new Error('Staff member not found')
  if ((existing as any).is_hidden === true) {
    throw new Error('This account cannot be deleted from staff management')
  }
  if (String(existing.role) === 'SuperAdmin') {
    throw new Error('SuperAdmin accounts cannot be deleted. Deactivate instead.')
  }

  const { error } = await supabase.from('users_backup').delete().eq('id', userId)
  if (error) throw new Error(error.message)
  return { id: userId, deleted: true, username: existing.username }
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

  const rawCategory = String(request.category || 'BAR').toUpperCase()
  const category = rawCategory === 'SPORTS' ? 'SPORTS' : 'BAR'

  const payload = {
    id: Date.now(),
    business_id: businessId,
    name: String(request.name || ''),
    description: request.description ? String(request.description) : null,
    category,
    packaging: request.packaging ? String(request.packaging) : null,
    price: Number(request.price || 0),
    cost_price: Number(request.cost_price ?? request.costPrice ?? 0),
    stock_quantity: Number(request.stock_quantity ?? request.stockQuantity ?? 0),
    min_stock_level: Number(request.min_stock_level ?? request.minStockLevel ?? 0),
    fridge_stock: Number(request.fridge_stock ?? request.fridgeStock ?? 0),
    show_stock: Number(request.show_stock ?? request.showStock ?? 0),
    store_stock: Number(request.store_stock ?? request.storeStock ?? 0),
    sports_stock: Number(request.sports_stock ?? request.sportsStock ?? 0),
    duration_value:
      request.duration_value != null || request.durationValue != null
        ? Number(request.duration_value ?? request.durationValue)
        : null,
    duration_unit: request.duration_unit
      ? String(request.duration_unit)
      : request.durationUnit
        ? String(request.durationUnit)
        : null,
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

  if (error) {
    // Columns may not exist yet — retry without newer fields
    if (/sports_stock|duration_/i.test(error.message)) {
      const {
        sports_stock: _s,
        duration_value: _d,
        duration_unit: _u,
        ...fallback
      } = payload as any
      const retry = await supabase.from('products_backup').insert(fallback).select('id').single()
      if (retry.error) throw new Error(retry.error.message)
      return retry.data?.id ?? payload.id
    }
    throw new Error(error.message)
  }
  return data?.id ?? payload.id
}

async function updateProduct(request: Record<string, unknown>) {
  const id = argNumber(request, 'id', 'productId')
  const businessId = argNumber(request, 'business_id', 'businessId')
  if (!id) throw new Error('Invalid product id')
  if (!businessId) throw new Error('Invalid business_id')

  const rawCategory = String(request.category || 'BAR').toUpperCase()
  const category = rawCategory === 'SPORTS' ? 'SPORTS' : 'BAR'

  const payload: Record<string, unknown> = {
    name: String(request.name || ''),
    description: request.description ? String(request.description) : null,
    category,
    packaging: request.packaging ? String(request.packaging) : null,
    price: Number(request.price || 0),
    cost_price: Number(request.cost_price ?? request.costPrice ?? 0),
    min_stock_level: Number(request.min_stock_level ?? request.minStockLevel ?? 0),
    fridge_stock: Number(request.fridge_stock ?? request.fridgeStock ?? 0),
    show_stock: Number(request.show_stock ?? request.showStock ?? 0),
    store_stock: Number(request.store_stock ?? request.storeStock ?? 0),
    sports_stock: Number(request.sports_stock ?? request.sportsStock ?? 0),
    duration_value:
      request.duration_value != null || request.durationValue != null
        ? Number(request.duration_value ?? request.durationValue)
        : null,
    duration_unit: request.duration_unit
      ? String(request.duration_unit)
      : request.durationUnit
        ? String(request.durationUnit)
        : null,
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

  if (error) {
    if (/sports_stock|duration_/i.test(error.message)) {
      const {
        sports_stock: _s,
        duration_value: _d,
        duration_unit: _u,
        ...fallback
      } = payload
      const retry = await supabase
        .from('products_backup')
        .update(fallback)
        .eq('id', id)
        .eq('business_id', businessId)
      if (retry.error) throw new Error(retry.error.message)
      return id
    }
    throw new Error(error.message)
  }
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
        : stockType === 'sports'
          ? 'sports_stock'
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
    type === 'fridge'
      ? 'fridge_stock'
      : type === 'show'
        ? 'show_stock'
        : type === 'sports'
          ? 'sports_stock'
          : 'store_stock'

  const fromCol = col(from)
  const toCol = col(to)

  const { data: product, error: readError } = await supabase
    .from('products_backup')
    .select('id, fridge_stock, show_stock, store_stock, sports_stock')
    .eq('id', productId)
    .single()

  if (readError) {
    // Fallback without sports_stock column
    const fallback = await supabase
      .from('products_backup')
      .select('id, fridge_stock, show_stock, store_stock')
      .eq('id', productId)
      .single()
    if (fallback.error) throw new Error(fallback.error.message)
    if (fromCol === 'sports_stock' || toCol === 'sports_stock') {
      throw new Error('Run supabase/sports_location.sql to enable Sports stock')
    }
    const fromVal = Number((fallback.data as any)?.[fromCol] || 0)
    if (fromVal < quantity) throw new Error(`Not enough stock in ${from}`)
    const { error } = await supabase
      .from('products_backup')
      .update({
        [fromCol]: fromVal - quantity,
        [toCol]: Number((fallback.data as any)?.[toCol] || 0) + quantity,
        synced_at: new Date().toISOString(),
      })
      .eq('id', productId)
    if (error) throw new Error(error.message)
    return true
  }
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
  kind?: string | null
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
    kind: request.kind ? String(request.kind) : 'packaging',
    is_active: true,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('product_categories_backup')
    .insert({ ...payload, synced_at: new Date().toISOString() })
    .select('*')
    .single()

  if (error) {
    if (/kind/i.test(error.message)) {
      const { kind: _omit, ...withoutKind } = payload as any
      const retry = await supabase
        .from('product_categories_backup')
        .insert({ ...withoutKind, synced_at: new Date().toISOString() })
        .select('*')
        .single()
      if (!retry.error && retry.data) return retry.data as ProductCategory
    }
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
      case 'get_sale_receipt': {
        const saleId = argNumber(args, 'saleId', 'sale_id')
        if (!saleId) throw new Error('saleId is required')
        const businessId = argNumber(args, 'businessId', 'business_id')
        return (await getSaleReceipt(saleId, businessId)) as T
      }
      case 'update_sale_date': {
        const saleId = argNumber(args, 'saleId', 'sale_id')
        const businessId = argNumber(args, 'businessId', 'business_id')
        const saleDate = String(
          (args as any)?.saleDate ?? (args as any)?.sale_date ?? ''
        ).trim()
        if (!saleId) throw new Error('saleId is required')
        if (!businessId) throw new Error('businessId is required')
        if (!saleDate) throw new Error('saleDate is required')
        return (await updateSaleDate({ saleId, businessId, saleDate })) as T
      }
      case 'get_debt_sales': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        return (await getDebtSales(businessId)) as T
      }
      case 'get_debtors': {
        const businessId = argNumber(args, 'businessId', 'business_id')
        if (!businessId) throw new Error('businessId is required')
        const openOnly = (args as any)?.openOnly ?? (args as any)?.open_only
        const staffId = argNumber(args, 'staffId', 'staff_id')
        return (await getDebtors(businessId, {
          openOnly: openOnly === undefined ? true : Boolean(openOnly),
          staffId,
        })) as T
      }
      case 'add_manual_debt': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await addManualDebt(request)) as T
      }
      case 'record_debt_payment': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await recordDebtPayment(request)) as T
      }
      case 'mark_debt_paid': {
        const saleId = argNumber(args, 'saleId', 'sale_id')
        if (!saleId) throw new Error('saleId is required')
        return (await markDebtPaid(saleId)) as T
      }
      case 'reset_staff_password': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await resetStaffPassword(request)) as T
      }
      case 'set_staff_active': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await setStaffActive(request)) as T
      }
      case 'delete_staff_user': {
        const request =
          args && typeof args === 'object' && 'request' in args
            ? (args.request as Record<string, unknown>)
            : ((args || {}) as Record<string, unknown>)
        return (await deleteStaffUser(request)) as T
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
