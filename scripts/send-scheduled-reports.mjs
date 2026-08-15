#!/usr/bin/env node
/**
 * Daily (8:00 Africa/Lagos) and weekly sales emails via Resend (free tier).
 *
 * Usage:
 *   node scripts/send-scheduled-reports.mjs daily
 *   node scripts/send-scheduled-reports.mjs weekly
 *
 * Env:
 *   VITE_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM   e.g. POS Reports <onboarding@resend.dev>
 */
import { Resend } from 'resend'
import { buildSalesReportHtml, buildStockAlertHtml, isStaffPricedLine } from './lib/report-email.mjs'

const MODE = (process.argv[2] || 'daily').toLowerCase()
const TZ = 'Africa/Lagos'

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const RESEND_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM = process.env.RESEND_FROM || 'POS Reports <onboarding@resend.dev>'
let testOnlyTo = (process.env.RESEND_TEST_TO || '').trim().toLowerCase()

function lagosYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function boundsMs(startYmd, endYmdExclusive) {
  return {
    start: Date.parse(`${startYmd}T00:00:00+01:00`),
    end: Date.parse(`${endYmdExclusive}T00:00:00+01:00`),
  }
}

async function rest(path, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...extraHeaders,
    },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`${path} ${res.status}: ${t.slice(0, 400)}`)
  }
  return res.json()
}

async function fetchAll(table, query) {
  const rows = []
  let from = 0
  const size = 1000
  for (;;) {
    const path = query ? `${table}?${query}` : table
    const chunk = await rest(path, { Range: `${from}-${from + size - 1}` })
    if (!Array.isArray(chunk) || !chunk.length) break
    rows.push(...chunk)
    if (chunk.length < size) break
    from += size
  }
  return rows
}

function inRange(createdAt, start, end) {
  const t = Date.parse(String(createdAt || ''))
  return Number.isFinite(t) && t >= start && t < end
}

function remainingOf(p) {
  return (
    Number(p?.fridge_stock || 0) +
    Number(p?.show_stock || 0) +
    Number(p?.store_stock || 0) +
    Number(p?.sports_stock || 0)
  )
}

function rollupLines(items) {
  const map = new Map()
  for (const it of items) {
    const name = it.name || `Product ${it.product_id}`
    const cur = map.get(name) || { name, qty: 0, amount: 0 }
    cur.qty += Number(it.quantity || 0)
    cur.amount += Number(it.total_price ?? it.unit_price * it.quantity ?? 0)
    map.set(name, cur)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

function ownEmailFromResendError(message) {
  const m = String(message || '').match(/your own email address \(([^)]+)\)/i)
  return m ? m[1].trim() : ''
}

async function sendResend({ to, subject, html }) {
  const resend = new Resend(RESEND_KEY)
  const sendTo = testOnlyTo ? [testOnlyTo] : to
  const { error } = await resend.emails.send({
    from: RESEND_FROM,
    to: sendTo,
    subject,
    html,
  })
  if (!error) return sendTo

  const msg = error.message || JSON.stringify(error)
  const own = ownEmailFromResendError(msg)
  if (own) {
    testOnlyTo = own.toLowerCase()
    console.warn(
      `Resend test mode: can only deliver to ${testOnlyTo} until a domain is verified. Sending reports there.`
    )
    const retry = await resend.emails.send({
      from: RESEND_FROM,
      to: [testOnlyTo],
      subject,
      html,
    })
    if (retry.error) {
      throw new Error(`Resend: ${retry.error.message || JSON.stringify(retry.error)}`)
    }
    return [testOnlyTo]
  }
  throw new Error(`Resend: ${msg}`)
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }
  if (!RESEND_KEY) {
    throw new Error('Missing RESEND_API_KEY (free at https://resend.com)')
  }
  if (MODE !== 'daily' && MODE !== 'weekly') {
    throw new Error('Usage: node scripts/send-scheduled-reports.mjs daily|weekly')
  }

  const today = lagosYmd()
  const yesterday = addDaysYmd(today, -1)
  const weekStart = addDaysYmd(today, -7)
  const startYmd = MODE === 'daily' ? yesterday : weekStart
  const { start, end } = boundsMs(startYmd, today)
  const periodLabel =
    MODE === 'daily'
      ? yesterday
      : `${weekStart} → ${yesterday}`

  const businesses = await fetchAll(
    'businesses_backup',
    'select=id,name,address,email,primary_color,is_active&is_active=eq.true'
  )
  const users = await fetchAll(
    'users_backup',
    'select=id,business_id,email,role,is_active,is_hidden'
  )
  const products = await fetchAll(
    'products_backup',
    'select=id,business_id,name,price,staff_price,fridge_stock,show_stock,store_stock,sports_stock,min_stock_level,is_active'
  )
  const sales = await fetchAll('sales_backup', 'select=id,user_id,total_amount,created_at,payment_method')
  const items = await fetchAll(
    'sale_items_backup',
    'select=id,sale_id,product_id,quantity,unit_price,total_price'
  )

  const productById = new Map(products.map((p) => [Number(p.id), p]))
  const userById = new Map(users.map((u) => [Number(u.id), u]))
  const salesInRange = sales.filter((s) => inRange(s.created_at, start, end))
  const saleIds = new Set(salesInRange.map((s) => Number(s.id)))
  const itemsInRange = items.filter((i) => saleIds.has(Number(i.sale_id)))

  let sent = 0
  for (const biz of businesses) {
    const bid = Number(biz.id)
    const staffUsers = users.filter((u) => {
      if (Number(u.business_id) !== bid) return false
      if (u.is_active === false) return false
      if (u.is_hidden) return false
      return String(u.email || '').includes('@')
    })
    const recipients = [
      ...new Set(
        [biz.email, ...staffUsers.map((u) => String(u.email).trim().toLowerCase())]
          .filter(Boolean)
          .map((e) => String(e).trim().toLowerCase())
      ),
    ]
    if (!recipients.length) {
      console.log(`Skip ${biz.name}: no emails`)
      continue
    }

    const bizUserIds = new Set(
      users.filter((u) => Number(u.business_id) === bid).map((u) => Number(u.id))
    )
    const bizSales = salesInRange.filter((s) => {
      const u = userById.get(Number(s.user_id))
      if (u && Number(u.business_id) === bid) return true
      const p = productById.get(
        Number(itemsInRange.find((i) => Number(i.sale_id) === Number(s.id))?.product_id)
      )
      return p && Number(p.business_id) === bid
    })
    const bizSaleIds = new Set(bizSales.map((s) => Number(s.id)))
    const bizItems = itemsInRange.filter((i) => bizSaleIds.has(Number(i.sale_id)))

    const normalItems = []
    const staffItems = []
    for (const it of bizItems) {
      const p = productById.get(Number(it.product_id))
      const row = {
        name: p?.name || `Product ${it.product_id}`,
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        total_price: Number(it.total_price ?? it.unit_price * it.quantity ?? 0),
        product_id: it.product_id,
      }
      if (isStaffPricedLine(row.unit_price, Number(p?.price || 0), Number(p?.staff_price || 0))) {
        staffItems.push(row)
      } else {
        normalItems.push(row)
      }
    }

    const payload = {
      businessName: biz.name || `Business ${bid}`,
      businessAddress: biz.address || '',
      primaryColor: biz.primary_color || '#121c19',
      periodLabel,
      kind: MODE,
      reminder: MODE === 'daily',
      salesCount: bizSales.length,
      normal: {
        total: normalItems.reduce((s, i) => s + i.total_price, 0),
        lines: rollupLines(normalItems),
      },
      staff: {
        total: staffItems.reduce((s, i) => s + i.total_price, 0),
        lines: rollupLines(staffItems),
      },
      sold: (() => {
        const byId = new Map()
        for (const it of bizItems) {
          const id = Number(it.product_id)
          const cur = byId.get(id) || { qty: 0 }
          cur.qty += Number(it.quantity || 0)
          byId.set(id, cur)
        }
        return [...byId.entries()]
          .map(([id, v]) => {
            const p = productById.get(id)
            return {
              name: p?.name || `Product ${id}`,
              sold: v.qty,
              left: remainingOf(p),
              before: remainingOf(p) + v.qty,
            }
          })
          .sort((a, b) => b.sold - a.sold)
      })(),
      outOfStock: products
        .filter((p) => Number(p.business_id) === bid && p.is_active !== false && remainingOf(p) <= 0)
        .map((p) => ({ name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lowStock: products
        .filter((p) => {
          if (Number(p.business_id) !== bid || p.is_active === false) return false
          const left = remainingOf(p)
          const min = Number(p.min_stock_level || 0)
          return left > 0 && left <= min
        })
        .map((p) => ({ name: p.name, left: remainingOf(p), min: Number(p.min_stock_level || 0) }))
        .sort((a, b) => a.left - b.left),
    }

    const html = buildSalesReportHtml(payload)
    const subject =
      MODE === 'daily'
        ? `${payload.businessName} — yesterday’s sales (${yesterday}) · please sync`
        : `${payload.businessName} — weekly sales (${periodLabel})`

    const delivered = await sendResend({ to: recipients, subject, html })
    sent += 1
    console.log(`Sent ${MODE} sales for ${payload.businessName} → ${delivered.join(', ')}`)

    if (MODE === 'daily') {
      const stockHtml = buildStockAlertHtml({
        businessName: payload.businessName,
        businessAddress: payload.businessAddress,
        primaryColor: payload.primaryColor,
        periodLabel: yesterday,
        outOfStock: payload.outOfStock,
        lowStock: payload.lowStock,
      })
      const stockTo = await sendResend({
        to: recipients,
        subject: `${payload.businessName} — out of stock (${yesterday})`,
        html: stockHtml,
      })
      sent += 1
      console.log(`Sent stock alert for ${payload.businessName} → ${stockTo.join(', ')}`)
    }
    void bizUserIds
  }

  console.log(`Done. ${sent} business email(s).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
