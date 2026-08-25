import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { invoke } from './api'
import { Table } from './components/Table'
import { printReceipt } from './receiptPrint'
import {
  dismissSwimmingTimer,
  formatRemaining,
  startSwimmingTimer,
  subscribeSwimmingTimers,
  type SwimmingTimer,
} from './swimmingTimer'

export type SaleLocation = 'fridge' | 'show' | 'sports'
export type PriceMode = 'normal' | 'staff'

const DRINK_PACKAGING_DEFAULTS = ['Can', 'Plastic Bottle', 'Bottle', 'Glass']
const SPORTS_AMENITY_DEFAULTS = [
  'Table Tennis',
  'Pool',
  'Snooker',
  'Swimming',
  'Shisha',
]

function locationLabel(loc: SaleLocation) {
  if (loc === 'sports') return 'Sports'
  return loc
}

function isSwimmingProduct(product: any) {
  const pack = String(product?.packaging || '').toLowerCase()
  const name = String(product?.name || '').toLowerCase()
  return pack.includes('swimming') || name.includes('swimming')
}

function isShishaProduct(product: any) {
  const pack = String(product?.packaging || '').toLowerCase()
  const name = String(product?.name || '').toLowerCase()
  return pack.includes('shisha') || name.includes('shisha')
}

function money(n: number) {
  return `₦${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function auditDetail(row: any): string {
  const raw = row?.after_json || row?.after
  if (!raw) return ''
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!obj || typeof obj !== 'object') return ''
    if (obj.from && obj.to) {
      return `${obj.quantity ?? ''} ${obj.product || ''} · ${obj.from} → ${obj.to}`.trim()
    }
    if (obj.total_amount != null && obj.payment_method) {
      return `${obj.payment_method} · ${obj.total_amount}${obj.location ? ` · ${obj.location}` : ''}`
    }
    if (obj.location && obj.quantity_change != null) {
      const n = Number(obj.quantity_change)
      return `${n >= 0 ? '+' : ''}${n} on ${obj.location}${obj.product ? ` · ${obj.product}` : ''}`
    }
    const bits = [
      obj.product && `Item: ${obj.product}`,
      obj.name && `Name: ${obj.name}`,
      obj.price != null && `Price: ${obj.price}`,
      obj.role && `Role: ${obj.role}`,
      obj.username && `User: ${obj.username}`,
    ].filter(Boolean)
    return bits.join(' · ')
  } catch {
    return ''
  }
}

function formatWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function saleCustomerName(sale: any) {
  const name = String(sale?.customer_name || '').trim()
  return name || 'Walk-in customer'
}

function toDateInputValue(value?: string | null) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10)
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function SaleStatusBadge({
  status,
  method,
}: {
  status?: string | null
  method?: string | null
}) {
  const methodValue = String(method || '').toUpperCase()
  // Pending is only meaningful for DEBT. Paid methods always show Completed.
  let value = String(status || 'UNKNOWN').toUpperCase()
  if (methodValue && methodValue !== 'DEBT' && value === 'PENDING') {
    value = 'COMPLETED'
  }
  const styles =
    value === 'COMPLETED' || value === 'PAID'
      ? 'bg-teal-50 text-teal-800 border-teal-200'
      : value === 'PENDING'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : value === 'CANCELLED'
          ? 'bg-rose-50 text-rose-800 border-rose-200'
          : 'bg-[#f4f6f5] text-[#2a3d36] border-[#d4dcd8]'
  const label =
    value === 'COMPLETED' || value === 'PAID'
      ? 'Completed'
      : value === 'PENDING'
        ? 'Pending'
        : value === 'CANCELLED'
          ? 'Cancelled'
          : value
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border ${styles}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          value === 'COMPLETED' || value === 'PAID'
            ? 'bg-teal-600'
            : value === 'PENDING'
              ? 'bg-amber-500'
              : value === 'CANCELLED'
                ? 'bg-rose-500'
                : 'bg-[#2a3d36]/40'
        }`}
      />
      {label}
    </span>
  )
}

function PaymentMethodBadge({ method }: { method?: string | null }) {
  const value = String(method || '—').toUpperCase()
  const styles =
    value === 'DEBT'
      ? 'bg-orange-50 text-orange-800 border-orange-200'
      : value === 'CASH'
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : value === 'EXTERNAL_POS'
          ? 'bg-sky-50 text-sky-800 border-sky-200'
          : 'bg-[#f4f6f5] text-[#2a3d36] border-[#d4dcd8]'
  return (
    <span className={`inline-flex text-xs font-semibold px-2.5 py-1 rounded-md border ${styles}`}>
      {value === 'EXTERNAL_POS' ? 'External POS' : value}
    </span>
  )
}

function PriceMixBadge({ mix }: { mix?: string | null }) {
  const value = String(mix || '').toLowerCase()
  if (!value || value === 'none') return null
  const styles =
    value === 'mixed'
      ? 'bg-violet-50 text-violet-900 border-violet-200'
      : value === 'staff'
        ? 'bg-indigo-50 text-indigo-900 border-indigo-200'
        : 'bg-[#f4f6f5] text-[#2a3d36] border-[#d4dcd8]'
  const label =
    value === 'mixed' ? 'Mixed' : value === 'staff' ? 'Staff price' : 'Normal'
  return (
    <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${styles}`}>
      {label}
    </span>
  )
}

function SaleItemsCell({ sale }: { sale: any }) {
  const items = Array.isArray(sale?.items) ? sale.items : []
  if (items.length) {
    return (
      <div className="space-y-1 max-w-[16rem]">
        <PriceMixBadge mix={sale.price_mix} />
        {items.map((it: any, idx: number) => {
          const kind = String(it.price_kind || 'normal').toLowerCase()
          return (
            <p key={`${it.name}-${idx}`} className="text-sm text-[#2a3d36]/80 leading-snug">
              <span className="font-medium text-[#121c19]">
                {Number(it.quantity || 0)}×{it.name || 'Item'}
              </span>{' '}
              <span
                className={
                  kind === 'staff' ? 'text-indigo-800 font-semibold' : 'text-[#2a3d36]/55'
                }
              >
                ({kind === 'staff' ? 'staff' : 'normal'})
              </span>
            </p>
          )
        })}
      </div>
    )
  }
  return (
    <div className="space-y-1 max-w-[16rem]">
      <PriceMixBadge mix={sale.price_mix} />
      <span className="text-sm text-[#2a3d36]/75 line-clamp-3" title={sale.items_summary || ''}>
        {sale.items_summary || '—'}
      </span>
    </div>
  )
}

function DebtProgressBlock({ sale }: { sale: any }) {
  const isDebt = String(sale?.payment_method || '').toUpperCase() === 'DEBT'
  if (!isDebt) {
    return (
      <p className="font-semibold text-[#121c19]">{money(sale.total_amount)}</p>
    )
  }
  const total = Number(sale.total_amount || 0)
  const paid = Number(sale.debt_paid ?? 0)
  const left = Number(
    sale.debt_remaining != null ? sale.debt_remaining : Math.max(0, total - paid)
  )
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  return (
    <div className="min-w-[9.5rem]">
      <p className="font-semibold text-[#121c19] text-right">{money(total)}</p>
      <div className="mt-1.5 h-1.5 rounded-full bg-[#e8ecea] overflow-hidden">
        <div
          className={`h-full rounded-full ${left <= 0.0001 ? 'bg-teal-600' : 'bg-amber-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[11px] font-semibold">
        <span className="text-teal-700">Paid {money(paid)}</span>
        <span className={left <= 0.0001 ? 'text-teal-700' : 'text-amber-700'}>
          Left {money(left)}
        </span>
      </div>
    </div>
  )
}

export function StaffPOSInterface({
  currentUser,
  businessInfo,
}: {
  currentUser: any
  businessInfo: any
}) {
  const [products, setProducts] = useState<any[]>([])
  const [packagingTypes, setPackagingTypes] = useState<string[]>([])
  const [amenityTypes, setAmenityTypes] = useState<string[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [saleLocation, setSaleLocation] = useState<SaleLocation>('fridge')
  const [priceMode, setPriceMode] = useState<PriceMode>('normal')
  const [packagingFilter, setPackagingFilter] = useState('ALL')
  const [swimTimers, setSwimTimers] = useState<SwimmingTimer[]>([])
  const [nowTick, setNowTick] = useState(Date.now())
  const businessId = currentUser?.business_id || businessInfo?.id
  const addToCartLockRef = useRef(false)
  const paymentLockRef = useRef(false)

  useEffect(() => {
    if (businessId) void loadProducts()
    else setLoading(false)
  }, [businessId])

  useEffect(() => subscribeSwimmingTimers(setSwimTimers), [])

  useEffect(() => {
    const onTimeUp = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      toast.error(
        `Swimming time up${detail.customerName ? ` · ${detail.customerName}` : ''}`,
        { duration: 12000, id: `swim-up-${detail.id}` }
      )
    }
    window.addEventListener('pos-swimming-time-up', onTimeUp)
    return () => window.removeEventListener('pos-swimming-time-up', onTimeUp)
  }, [])

  useEffect(() => {
    if (!swimTimers.length) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [swimTimers.length])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const [rows, categories] = await Promise.all([
        invoke('get_products_for_business', { businessId }) as Promise<any[]>,
        invoke('get_product_categories', { businessId }) as Promise<any[]>,
      ])
      setProducts(Array.isArray(rows) ? rows : [])
      const cats = Array.isArray(categories) ? categories : []

      // Seed amenity types in the background (idempotent)
      const existing = new Set(cats.map((c) => String(c.name || '').toLowerCase()))
      for (const name of SPORTS_AMENITY_DEFAULTS) {
        if (!existing.has(name.toLowerCase())) {
          try {
            await invoke('create_product_category', {
              request: { business_id: businessId, name, kind: 'amenity' },
            })
            existing.add(name.toLowerCase())
          } catch {
            // ignore
          }
        }
      }

      const refreshed =
        existing.size > cats.length
          ? ((await invoke('get_product_categories', { businessId })) as any[])
          : cats

      const amenitySet = new Set(SPORTS_AMENITY_DEFAULTS.map((n) => n.toLowerCase()))
      const names = (Array.isArray(refreshed) ? refreshed : [])
        .map((c) => ({
          name: String(c.name || '').trim(),
          kind: String(c.kind || '').toLowerCase(),
        }))
        .filter((c) => c.name)

      const amenities = names
        .filter((c) => c.kind === 'amenity' || amenitySet.has(c.name.toLowerCase()))
        .map((c) => c.name)
      const packaging = names
        .filter((c) => c.kind !== 'amenity' && !amenitySet.has(c.name.toLowerCase()))
        .map((c) => c.name)

      const fromSportsProducts = (Array.isArray(rows) ? rows : [])
        .filter((p) => String(p.category || '').toUpperCase() === 'SPORTS')
        .map((p) => String(p.packaging || '').trim())
        .filter(Boolean)

      setAmenityTypes(
        Array.from(new Set([...amenities, ...fromSportsProducts, ...SPORTS_AMENITY_DEFAULTS])).sort(
          (a, b) => a.localeCompare(b)
        )
      )
      setPackagingTypes(
        Array.from(new Set([...packaging, ...DRINK_PACKAGING_DEFAULTS])).sort((a, b) =>
          a.localeCompare(b)
        )
      )
    } catch (error) {
      toast.error(`Failed to load products: ${error}`)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const stockOf = (product: any, location: SaleLocation = saleLocation) => {
    // Sports amenities are services (price + duration), always sellable when active
    if (location === 'sports' || String(product.category || '').toUpperCase() === 'SPORTS') {
      return 999
    }
    if (location === 'show') return Number(product.show_stock || 0)
    return Number(product.fridge_stock || 0)
  }

  const durationLabel = (product: any) => {
    if (isShishaProduct(product)) return 'per coal'
    const value = Number(product.duration_value || 0)
    const unit = String(product.duration_unit || '').toLowerCase()
    if (!(value > 0)) return null
    if (unit === 'hours' || unit === 'hour') {
      return `${value} hour${value === 1 ? '' : 's'}`
    }
    if (unit === 'coals' || unit === 'coal') return 'per coal'
    return `${value} day${value === 1 ? '' : 's'}`
  }

  const lowThreshold = (product: any) => Math.max(1, Number(product.min_stock_level || 5))

  const notifyLowStock = (list: any[], location: SaleLocation) => {
    const low = list.filter((p) => {
      const stock = stockOf(p, location)
      return stock > 0 && stock <= lowThreshold(p)
    })
    if (low.length === 0) return
    const names = low
      .slice(0, 4)
      .map((p) => p.name)
      .join(', ')
    const extra = low.length > 4 ? ` +${low.length - 4} more` : ''
    toast.error(`Low ${locationLabel(location)} stock: ${names}${extra}`, {
      duration: 6000,
      id: `low-stock-${location}`,
    })
  }

  const switchLocation = (loc: SaleLocation) => {
    if (loc === saleLocation) return
    setSaleLocation(loc)
    setPackagingFilter('ALL')
    // Keep cart — staff can mix Fridge, Show, and Sports in one charge
    notifyLowStock(products, loc)
  }

  const productNormalPrice = (product: any) => {
    const n = Number(product?.price)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const productStaffPrice = (product: any) => {
    const staff = Number(product?.staff_price)
    if (Number.isFinite(staff) && staff > 0) return staff
    return productNormalPrice(product)
  }

  const productPriceForMode = (product: any, mode: PriceMode = priceMode) =>
    mode === 'staff' ? productStaffPrice(product) : productNormalPrice(product)

  const addToCart = (product: any) => {
    // Block rapid double-taps so one click cannot enqueue the same add twice
    if (addToCartLockRef.current) return
    addToCartLockRef.current = true
    window.setTimeout(() => {
      addToCartLockRef.current = false
    }, 450)

    const location = saleLocation
    const stock = stockOf(product, location)
    if (stock <= 0) {
      toast.error(`${product.name} is out of stock in ${locationLabel(location)}`)
      return
    }
    const sellPrice = productPriceForMode(product, priceMode)
    if (!(sellPrice > 0)) {
      toast.error(
        `${product.name} has no ${priceMode === 'staff' ? 'staff' : 'normal'} price. Edit the product.`
      )
      return
    }
    const otherMode = cart.find(
      (i) =>
        i.product.id === product.id &&
        (i.location || 'fridge') === location &&
        (i.priceMode || 'normal') !== priceMode
    )
    const sameMode = cart.find(
      (i) =>
        i.product.id === product.id &&
        (i.location || 'fridge') === location &&
        (i.priceMode || 'normal') === priceMode
    )
    if (otherMode && !sameMode) {
      const otherLabel = (otherMode.priceMode || 'normal') === 'staff' ? 'Staff' : 'Normal'
      const thisLabel = priceMode === 'staff' ? 'Staff' : 'Normal'
      toast(
        (t) => (
          <div className="min-w-[240px]">
            <p className="text-sm font-semibold text-white">
              {product.name} is already in the cart at {otherLabel} price
            </p>
            <p className="mt-1 text-xs text-white/70">
              Add a separate {thisLabel} line, or leave the cart as it is.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-white text-[#121c19] text-xs font-semibold py-1.5"
                onClick={() => {
                  toast.dismiss(t.id)
                  addToCartLine(product, location, stock, sellPrice)
                }}
              >
                Add {thisLabel} line
              </button>
              <button
                type="button"
                className="flex-1 rounded-md border border-white/25 text-white text-xs font-semibold py-1.5"
                onClick={() => toast.dismiss(t.id)}
              >
                Keep cart
              </button>
            </div>
          </div>
        ),
        { duration: 8000, id: `cart-mode-${product.id}-${location}` }
      )
      return
    }

    addToCartLine(product, location, stock, sellPrice)
  }

  const addToCartLine = (
    product: any,
    location: SaleLocation,
    stock: number,
    sellPrice: number
  ) => {
    setCart((prev) => {
      const existing = prev.find(
        (i) =>
          i.product.id === product.id &&
          (i.location || 'fridge') === location &&
          (i.priceMode || 'normal') === priceMode
      )
      if (existing) {
        if (existing.quantity + 1 > stock) {
          toast.error(`Only ${stock} left in ${locationLabel(location)}`)
          return prev
        }
        return prev.map((i) =>
          i.product.id === product.id &&
          (i.location || 'fridge') === location &&
          (i.priceMode || 'normal') === priceMode
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unitPrice: sellPrice,
          location,
          priceMode,
        },
      ]
    })
  }

  const setCartLinePriceMode = (
    productId: number,
    location: SaleLocation,
    mode: PriceMode,
    currentMode: PriceMode
  ) => {
    setCart(
      cart.map((i) => {
        if (
          i.product.id !== productId ||
          (i.location || 'fridge') !== location ||
          (i.priceMode || 'normal') !== currentMode
        ) {
          return i
        }
        return {
          ...i,
          priceMode: mode,
          unitPrice: productPriceForMode(i.product, mode),
        }
      })
    )
  }

  const updateQuantity = (
    productId: number,
    quantity: number,
    location: SaleLocation,
    mode: PriceMode = 'normal'
  ) => {
    if (quantity <= 0) {
      setCart(
        cart.filter(
          (i) =>
            !(
              i.product.id === productId &&
              (i.location || 'fridge') === location &&
              (i.priceMode || 'normal') === mode
            )
        )
      )
      return
    }
    const line = cart.find(
      (i) =>
        i.product.id === productId &&
        (i.location || 'fridge') === location &&
        (i.priceMode || 'normal') === mode
    )
    if (line) {
      const available = stockOf(line.product, location)
      if (quantity > available) {
        toast.error(`Only ${available} left in ${locationLabel(location)}`)
        return
      }
    }
    setCart(
      cart.map((i) =>
        i.product.id === productId &&
        (i.location || 'fridge') === location &&
        (i.priceMode || 'normal') === mode
          ? { ...i, quantity }
          : i
      )
    )
  }

  const getTotal = () => cart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  const processPayment = async (
    paymentMethod: string,
    customerName?: string,
    saleDate?: string
  ) => {
    if (paymentLockRef.current || processingPayment) return
    paymentLockRef.current = true

    for (const item of cart) {
      const loc = (item.location || saleLocation) as SaleLocation
      const available = stockOf(item.product, loc)
      if (item.quantity > available) {
        toast.error(
          `${item.product.name}: only ${available} in ${locationLabel(loc)}. Adjust cart.`
        )
        paymentLockRef.current = false
        return
      }
    }

    setProcessingPayment(true)
    try {
      // Charge per location so stock deducts from the correct source
      const byLocation = new Map<SaleLocation, typeof cart>()
      for (const item of cart) {
        const loc = (item.location || 'fridge') as SaleLocation
        const list = byLocation.get(loc) || []
        list.push(item)
        byLocation.set(loc, list)
      }

      const results: any[] = []
      for (const [location, items] of byLocation) {
        const result = (await invoke('process_sale', {
          request: {
            items: items.map((item) => ({
              product_id: item.product.id,
              quantity: item.quantity,
              unit_price: item.unitPrice,
            })),
            payment_method: paymentMethod,
            staff_id: currentUser?.id,
            business_id: businessId,
            location,
            customer_name: customerName?.trim() || null,
            sale_date: saleDate || null,
          },
        })) as any
        results.push({ ...result, location })
      }

      const soldItems = [...cart]
      const primary = results[0]
      setCart([])
      setShowPaymentModal(false)

      const soldSwimItems = soldItems.filter((item) => isSwimmingProduct(item.product))
      for (const item of soldSwimItems) {
        const hours =
          Number(item.product.duration_value) ||
          (String(item.product.duration_unit || '').toLowerCase() === 'hours'
            ? Number(item.product.duration_value)
            : 0) ||
          2
        startSwimmingTimer({
          saleId: primary?.sale_id,
          customerName: primary?.customer_name || customerName,
          hours: Number(item.product.duration_value) > 0 ? Number(item.product.duration_value) : hours,
        })
      }
      if (soldSwimItems.length) {
        const h = Number(soldSwimItems[0].product.duration_value) || 2
        toast.success(`Swimming timer started · ${h} hour${h === 1 ? '' : 's'}`, {
          duration: 5000,
        })
      }

      const dayServices = soldItems.filter(
        (item) =>
          String(item.product.category || '').toUpperCase() === 'SPORTS' &&
          !isSwimmingProduct(item.product) &&
          !isShishaProduct(item.product)
      )
      if (dayServices.length) {
        const bits = dayServices.map((i) => {
          const d = Number(i.product.duration_value) || 1
          return `${i.product.name} (${d} day${d === 1 ? '' : 's'})`
        })
        toast.success(`Sports session: ${bits.join(', ')}`, { duration: 6000 })
      }

      const totalAmount = results.reduce((s, r) => s + Number(r.total_amount || 0), 0)
      const locs = results.map((r) => locationLabel(r.location)).join(' + ')
      toast.success(
        `${results.length > 1 ? `${results.length} sales` : `Sale #${primary?.sale_id}`} · ${money(totalAmount)} · ${paymentMethod}${
          primary?.customer_name ? ` · ${primary.customer_name}` : ''
        } · ${locs}`,
        { duration: 5000 }
      )
      for (const r of results) {
        if (!r?.sale_id) continue
        try {
          const receipt = (await invoke('get_sale_receipt', {
            saleId: r.sale_id,
            businessId,
          })) as any
          printReceipt({
            ...receipt,
            business_name: receipt.business_name || businessInfo?.name || 'POS System',
            business_address: receipt.business_address || businessInfo?.address || null,
            business_phone: receipt.business_phone || businessInfo?.phone || null,
            location: receipt.location || r.location,
          })
        } catch (printErr) {
          console.warn('Receipt print skipped:', printErr)
        }
      }
      await loadProducts()
    } catch (error) {
      toast.error(`Payment failed: ${error}`)
    } finally {
      setProcessingPayment(false)
      // Keep lock briefly so a second Confirm click cannot create a duplicate sale
      window.setTimeout(() => {
        paymentLockRef.current = false
      }, 1200)
    }
  }

  useEffect(() => {
    if (!loading && products.length > 0) {
      notifyLowStock(products, saleLocation)
    }
  }, [loading, products, saleLocation])

  const typeOptions =
    saleLocation === 'sports'
      ? amenityTypes.length > 0
        ? amenityTypes
        : SPORTS_AMENITY_DEFAULTS
      : packagingTypes.length > 0
        ? packagingTypes
        : DRINK_PACKAGING_DEFAULTS

  // Fridge/Show = BAR drinks; Sports = SPORTS amenities (services, always listed when active)
  const filtered = products.filter((p) => {
    const q = searchQuery.trim().toLowerCase()
    const matchesQ =
      !q ||
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.packaging || '').toLowerCase().includes(q)
    const matchesPack =
      packagingFilter === 'ALL' ||
      String(p.packaging || '').toLowerCase() === packagingFilter.toLowerCase()
    const cat = String(p.category || 'BAR').toUpperCase()
    const matchesModule =
      saleLocation === 'sports' ? cat === 'SPORTS' : cat === 'BAR' || cat === ''
    const inStock = saleLocation === 'sports' ? p.is_active !== false : stockOf(p) > 0
    return matchesQ && matchesPack && matchesModule && inStock
  })

  const outHiddenCount =
    saleLocation === 'sports'
      ? 0
      : products.filter((p) => {
          const cat = String(p.category || 'BAR').toUpperCase()
          const matchesModule = cat === 'BAR' || cat === ''
          return matchesModule && stockOf(p) <= 0
        }).length

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24">
        <p className="font-display text-lg font-semibold text-[#121c19]">Loading POS…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-6 xl:px-8 py-5 sm:py-6 max-w-[1800px]">
        {swimTimers.length > 0 && (
          <div className="mb-4 space-y-2">
            {swimTimers.map((t) => {
              const ended = nowTick >= t.endsAt
              return (
                <div
                  key={t.id}
                  className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
                    ended
                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                      : 'border-[#d4dcd8] bg-white text-[#121c19]'
                  }`}
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Swimming session
                    </p>
                    <p className="font-semibold">
                      {t.customerName}
                      {t.saleId ? ` · Sale #${t.saleId}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-display text-xl font-bold tabular-nums">
                      {ended ? 'Time up' : formatRemaining(t.endsAt, nowTick)}
                    </p>
                    <button
                      type="button"
                      onClick={() => dismissSwimmingTimer(t.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-current/20"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-1">
              Floor
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Point of sale
            </h1>
            <p className="mt-1 text-sm text-[#2a3d36]/60">
              Selling from{' '}
              <span className="font-semibold text-[#121c19]">
                {locationLabel(saleLocation)}
              </span>
              {outHiddenCount > 0
                ? ` · ${outHiddenCount} out-of-stock hidden`
                : ' · only in-stock items shown'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="inline-flex rounded-lg border border-[#d4dcd8] bg-white p-1">
              {([
                { id: 'normal' as const, label: 'Normal price' },
                { id: 'staff' as const, label: 'Staff price' },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPriceMode(opt.id)}
                  className={`px-4 py-2 rounded-md text-sm font-semibold ${
                    priceMode === opt.id
                      ? 'bg-[#c4783a] text-white'
                      : 'text-[#2a3d36]/70 hover:text-[#121c19]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-[#d4dcd8] bg-white p-1">
              {([
                { id: 'fridge', label: 'Fridge' },
                { id: 'show', label: 'Show' },
                { id: 'sports', label: 'Sports' },
              ] as const).map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => switchLocation(loc.id)}
                  className={`px-4 py-2 rounded-md text-sm font-semibold ${
                    saleLocation === loc.id
                      ? 'bg-[#121c19] text-white'
                      : 'text-[#2a3d36]/70 hover:text-[#121c19]'
                  }`}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-8 space-y-4">
            <div className="rounded-xl border border-[#d4dcd8] bg-white p-3 sm:p-4 flex flex-col sm:flex-row gap-3">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products…"
                className="flex-1 px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4783a]/35"
              />
              <select
                value={packagingFilter}
                onChange={(e) => setPackagingFilter(e.target.value)}
                aria-label="Filter by packaging type"
                className="px-3 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm font-medium min-w-[11rem]"
              >
                <option value="ALL">
                  {saleLocation === 'sports' ? 'All amenities' : 'All types'}
                </option>
                {typeOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
                <p className="font-display text-xl font-bold text-[#121c19]">
                  {saleLocation === 'sports'
                    ? 'No Sports amenities yet'
                    : `No stock in ${locationLabel(saleLocation)}`}
                </p>
                <p className="mt-1 text-sm text-[#2a3d36]/55">
                  {saleLocation === 'sports'
                    ? 'Add a Sports product (price + duration) in Product Catalog.'
                    : 'Switch to Fridge, Show, or Sports — or restock this location.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-3">
                {filtered.map((product) => {
                  const stock = stockOf(product)
                  const low = stock > 0 && stock <= lowThreshold(product)
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className="text-left rounded-xl border border-[#d4dcd8] bg-white p-4 hover:border-[#c4783a]/50 hover:shadow-sm transition"
                    >
                      <p className="font-semibold text-[#121c19] line-clamp-2 min-h-[2.5rem]">
                        {product.name}
                      </p>
                      <p className="text-xs text-[#2a3d36]/45 mt-1">
                        {product.packaging || '—'}
                        {durationLabel(product) ? ` · ${durationLabel(product)}` : ''}
                      </p>
                      <div className="mt-3 flex items-end justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/40">
                            {priceMode === 'staff' ? 'Staff price' : 'Normal price'}
                          </p>
                          <p className="font-display text-lg font-bold text-[#121c19]">
                            {money(productPriceForMode(product))}
                          </p>
                          {productNormalPrice(product) !== productStaffPrice(product) && (
                            <p className="text-[10px] text-[#2a3d36]/45 mt-0.5">
                              {priceMode === 'staff'
                                ? `Normal ${money(productNormalPrice(product))}`
                                : `Staff ${money(productStaffPrice(product))}`}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-md border ${
                            saleLocation === 'sports'
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : low
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-teal-50 text-teal-800 border-teal-200'
                          }`}
                        >
                          {saleLocation === 'sports'
                            ? durationLabel(product) || 'Service'
                            : `${stock} in ${locationLabel(saleLocation)}`}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <aside className="xl:col-span-4">
            <div className="rounded-xl border border-[#d4dcd8] bg-white p-5 xl:sticky xl:top-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-xl font-bold text-[#121c19]">Cart</h2>
                <span className="text-xs font-semibold text-[#2a3d36]/50">
                  {cart.length} line{cart.length === 1 ? '' : 's'}
                </span>
              </div>

              {cart.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#d4dcd8] bg-[#f4f6f5] px-4 py-10 text-center">
                  <p className="font-medium text-[#121c19]">Cart is empty</p>
                  <p className="text-sm text-[#2a3d36]/50 mt-1">
                    Tap products from Fridge, Show, or Sports — cart keeps all
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {cart.map((item) => {
                    const loc = (item.location || 'fridge') as SaleLocation
                    const mode = (item.priceMode || 'normal') as PriceMode
                    return (
                      <div
                        key={`${item.product.id}-${loc}-${mode}`}
                        className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3"
                      >
                        <div className="flex justify-between gap-2">
                          <p className="font-semibold text-[#121c19] text-sm">
                            {item.product.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.product.id, 0, loc, mode)}
                            className="text-[#2a3d36]/40 hover:text-rose-600 text-lg leading-none"
                          >
                            ×
                          </button>
                        </div>
                        <p className="text-xs text-[#2a3d36]/50 mt-0.5">
                          {isShishaProduct(item.product)
                            ? `${locationLabel(loc)} · per coal`
                            : `${locationLabel(loc)}${
                                durationLabel(item.product)
                                  ? ` · ${durationLabel(item.product)}`
                                  : ''
                              }`}
                        </p>
                        <div className="mt-2 inline-flex rounded-md border border-[#d4dcd8] bg-white p-0.5 w-full">
                          {([
                            { id: 'normal' as const, label: 'Normal' },
                            { id: 'staff' as const, label: 'Staff' },
                          ]).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                setCartLinePriceMode(item.product.id, loc, opt.id, mode)
                              }
                              className={`flex-1 px-2 py-1.5 rounded text-xs font-semibold ${
                                mode === opt.id
                                  ? 'bg-[#121c19] text-white'
                                  : 'text-[#2a3d36]/70'
                              }`}
                            >
                              {opt.label}{' '}
                              {money(
                                opt.id === 'staff'
                                  ? productStaffPrice(item.product)
                                  : productNormalPrice(item.product)
                              )}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="inline-flex items-center rounded-md border border-[#d4dcd8] bg-white">
                            <button
                              type="button"
                              className="px-3 py-1 font-bold"
                              onClick={() =>
                                updateQuantity(
                                  item.product.id,
                                  item.quantity - 1,
                                  loc,
                                  mode
                                )
                              }
                            >
                              −
                            </button>
                            <span className="px-2 text-sm font-semibold min-w-[1.5rem] text-center">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              className="px-3 py-1 font-bold"
                              onClick={() =>
                                updateQuantity(
                                  item.product.id,
                                  item.quantity + 1,
                                  loc,
                                  mode
                                )
                              }
                            >
                              +
                            </button>
                          </div>
                          <p className="font-semibold text-[#121c19]">
                            {money(item.unitPrice * item.quantity)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-[#e8ecea]">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-[#2a3d36]/60">Total</span>
                  <span className="font-display text-2xl font-bold text-[#121c19]">
                    {money(getTotal())}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full bg-[#121c19] hover:bg-[#1a2924] disabled:opacity-40 text-white py-3 rounded-lg font-semibold"
                >
                  Charge
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {showPaymentModal && (
        <PaymentModal
          total={getTotal()}
          businessId={businessId}
          processing={processingPayment}
          onClose={() => setShowPaymentModal(false)}
          onPayment={processPayment}
        />
      )}
    </div>
  )
}

function PaymentModal({
  total,
  businessId,
  onPayment,
  onClose,
  processing,
}: {
  total: number
  businessId?: number | string | null
  onPayment: (method: string, customerName?: string, saleDate?: string) => void
  onClose: () => void
  processing: boolean
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [customerPaid, setCustomerPaid] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [saleDate, setSaleDate] = useState(today)
  const [debtorMode, setDebtorMode] = useState<'existing' | 'new'>('existing')
  const [debtors, setDebtors] = useState<any[]>([])
  const [loadingDebtors, setLoadingDebtors] = useState(false)
  const change = Math.max(0, (parseFloat(customerPaid) || 0) - total)

  const methods = [
    { value: 'CASH', label: 'Cash' },
    { value: 'CARD', label: 'Card' },
    { value: 'EXTERNAL_POS', label: 'External POS' },
    { value: 'DEBT', label: 'Debt / credit' },
  ]

  useEffect(() => {
    if (paymentMethod !== 'DEBT' || !businessId) return
    let cancelled = false
    ;(async () => {
      try {
        setLoadingDebtors(true)
        const rows = (await invoke('get_debtors', {
          businessId,
          openOnly: false,
        })) as any[]
        if (!cancelled) {
          const list = Array.isArray(rows) ? rows : []
          setDebtors(list.filter((d) => Number(d.balance) > 0 || d.status === 'OPEN'))
          if (list.some((d) => Number(d.balance) > 0)) setDebtorMode('existing')
          else setDebtorMode('new')
        }
      } catch {
        if (!cancelled) setDebtors([])
      } finally {
        if (!cancelled) setLoadingDebtors(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paymentMethod, businessId])

  const handlePay = () => {
    if (processing) return
    if (paymentMethod === 'CASH' && (parseFloat(customerPaid) || 0) < total) {
      toast.error('Amount paid is less than total')
      return
    }
    if (paymentMethod === 'DEBT' && !customerName.trim()) {
      toast.error('Select or enter a debtor name')
      return
    }
    if (!saleDate) {
      toast.error('Select a sale date')
      return
    }
    if (saleDate > today) {
      toast.error('Sale date cannot be in the future')
      return
    }
    onPayment(paymentMethod, customerName.trim() || undefined, saleDate)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-[#121c19]/55" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-[#f4f6f5] sm:rounded-2xl border border-[#d4dcd8] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-5 bg-white border-b border-[#d4dcd8] sm:rounded-t-2xl flex justify-between items-start">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[#c4783a]">
              Checkout
            </p>
            <h2 className="font-display text-2xl font-bold text-[#121c19]">Payment</h2>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-[#2a3d36]/40">
            ×
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="rounded-xl bg-[#121c19] text-white px-5 py-6 text-center">
            <p className="text-sm text-white/60">Total</p>
            <p className="font-display text-3xl font-bold mt-1">{money(total)}</p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
              Sale date
            </label>
            <input
              type="date"
              value={saleDate}
              max={today}
              onChange={(e) => setSaleDate(e.target.value)}
              className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
            />
            <p className="mt-1.5 text-xs text-[#2a3d36]/50">
              Use yesterday or an earlier date for backdated sales. Defaults to today.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {methods.map((m) => (
              <button
                key={m.value}
                type="button"
                disabled={processing}
                onClick={() => setPaymentMethod(m.value)}
                className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                  paymentMethod === m.value
                    ? 'border-[#121c19] bg-[#121c19] text-white'
                    : 'border-[#d4dcd8] bg-white text-[#121c19]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {paymentMethod === 'CASH' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Amount paid
              </label>
              <input
                type="number"
                value={customerPaid}
                onChange={(e) => setCustomerPaid(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
                placeholder="0.00"
              />
              <p className="mt-2 text-sm text-[#2a3d36]/60">
                Change: <span className="font-semibold text-[#121c19]">{money(change)}</span>
              </p>
            </div>
          )}

          {paymentMethod !== 'DEBT' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Customer name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
                placeholder="Leave blank for Walk-in customer"
              />
            </div>
          )}

          {paymentMethod === 'DEBT' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={processing || loadingDebtors || debtors.length === 0}
                  onClick={() => {
                    setDebtorMode('existing')
                    setCustomerName('')
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    debtorMode === 'existing'
                      ? 'border-[#121c19] bg-white'
                      : 'border-[#d4dcd8] bg-[#f4f6f5] text-[#2a3d36]/60'
                  }`}
                >
                  Existing debtor
                </button>
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => {
                    setDebtorMode('new')
                    setCustomerName('')
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    debtorMode === 'new'
                      ? 'border-[#121c19] bg-white'
                      : 'border-[#d4dcd8] bg-[#f4f6f5] text-[#2a3d36]/60'
                  }`}
                >
                  New debtor
                </button>
              </div>

              {debtorMode === 'existing' ? (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                    Select debtor *
                  </label>
                  {loadingDebtors ? (
                    <p className="mt-2 text-sm text-[#2a3d36]/55">Loading debtors…</p>
                  ) : debtors.length === 0 ? (
                    <p className="mt-2 text-sm text-[#2a3d36]/55">
                      No debtors yet — switch to New debtor.
                    </p>
                  ) : (
                    <select
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
                    >
                      <option value="">Choose customer…</option>
                      {debtors.map((d) => (
                        <option key={d.id} value={d.customer_name}>
                          {d.customer_name} · owed {money(d.balance)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                    New customer name *
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
                    placeholder="Who owes this?"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={processing}
              className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePay}
              disabled={processing}
              className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
            >
              {processing ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function StaffInventoryCheck({ currentUser }: { currentUser: any }) {
  const [products, setProducts] = useState<any[]>([])
  const [packagingTypes, setPackagingTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [packagingFilter, setPackagingFilter] = useState('ALL')
  const [moveTarget, setMoveTarget] = useState<{ product: any; to: 'fridge' | 'show' } | null>(
    null
  )
  const [moveQty, setMoveQty] = useState(1)
  const [moving, setMoving] = useState(false)
  const businessId = currentUser?.business_id

  useEffect(() => {
    if (businessId) void loadProducts()
    else setLoading(false)
  }, [businessId])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const [rows, categories] = await Promise.all([
        invoke('get_products_for_business', { businessId }) as Promise<any[]>,
        invoke('get_product_categories', { businessId }) as Promise<any[]>,
      ])
      setProducts(Array.isArray(rows) ? rows : [])
      const fromTable = (Array.isArray(categories) ? categories : [])
        .map((c) => String(c.name || '').trim())
        .filter(Boolean)
      const fromProducts = (Array.isArray(rows) ? rows : [])
        .map((p) => String(p.packaging || '').trim())
        .filter(Boolean)
      const defaults = ['Can', 'Plastic Bottle', 'Bottle', 'Glass']
      setPackagingTypes(
        Array.from(new Set([...fromTable, ...fromProducts, ...defaults])).sort((a, b) =>
          a.localeCompare(b)
        )
      )
    } catch {
      toast.error('Failed to load stock')
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const openMove = (product: any, to: 'fridge' | 'show') => {
    const store = Number(product.store_stock || 0)
    if (store <= 0) {
      toast.error('No store stock to move. Ask secretary/admin to receive into store first.')
      return
    }
    setMoveTarget({ product, to })
    setMoveQty(Math.min(1, store) || 1)
  }

  const handleMoveStock = async () => {
    if (!moveTarget) return
    const store = Number(moveTarget.product.store_stock || 0)
    const qty = Math.floor(Number(moveQty) || 0)
    if (qty < 1) {
      toast.error('Enter a quantity')
      return
    }
    if (qty > store) {
      toast.error(`Store only has ${store}`)
      return
    }
    try {
      setMoving(true)
      await invoke('transfer_stock', {
        productId: moveTarget.product.id,
        from: 'store',
        to: moveTarget.to,
        quantity: qty,
        userId: currentUser?.id || 0,
      })
      toast.success(
        `Moved ${qty} ${moveTarget.product.name} to ${moveTarget.to} — ready to sell`
      )
      setMoveTarget(null)
      await loadProducts()
    } catch (error) {
      toast.error(`Move failed: ${error}`)
    } finally {
      setMoving(false)
    }
  }

  const bar = products.filter((p) => String(p.category || 'BAR').toUpperCase() === 'BAR')
  const packagingOptions =
    packagingTypes.length > 0
      ? packagingTypes
      : Array.from(
          new Set(bar.map((p) => String(p.packaging || '').trim()).filter(Boolean))
        ).sort()

  const filtered = bar.filter((p) => {
    const q = searchQuery.trim().toLowerCase()
    const matchesQ = !q || String(p.name || '').toLowerCase().includes(q)
    const matchesPack =
      packagingFilter === 'ALL' ||
      String(p.packaging || '').toLowerCase() === packagingFilter.toLowerCase()
    return matchesQ && matchesPack
  })

  const lowCount = filtered.filter((p) => {
    const total =
      Number(p.fridge_stock || 0) + Number(p.show_stock || 0) + Number(p.store_stock || 0)
    const min = Number(p.min_stock_level || 5)
    return total > 0 && total <= min
  }).length

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24">
        <p className="font-display text-lg font-semibold text-[#121c19]">Loading stock…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Floor
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Stock check
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base">
              Move store stock into fridge or show so you can sell without calling admin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadProducts()}
            className="border border-[#121c19]/15 hover:bg-white text-[#121c19] px-4 py-2.5 rounded-md text-sm font-semibold"
          >
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Products</p>
            <p className="font-display text-3xl font-bold text-[#121c19] mt-1">{filtered.length}</p>
          </div>
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Low stock</p>
            <p className="font-display text-3xl font-bold text-[#c4783a] mt-1">{lowCount}</p>
          </div>
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Out of stock</p>
            <p className="font-display text-3xl font-bold text-rose-600 mt-1">
              {
                filtered.filter(
                  (p) =>
                    Number(p.fridge_stock || 0) +
                      Number(p.show_stock || 0) +
                      Number(p.store_stock || 0) <=
                    0
                ).length
              }
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[#d4dcd8] bg-white p-4 mb-4 flex flex-col sm:flex-row gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search product…"
            className="flex-1 px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm"
          />
          <select
            value={packagingFilter}
            onChange={(e) => setPackagingFilter(e.target.value)}
            aria-label="Filter by packaging type"
            className="px-3 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm min-w-[11rem]"
          >
            <option value="ALL">All types</option>
            {packagingOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:hidden space-y-3">
          {filtered.map((p) => {
            const total =
              Number(p.fridge_stock || 0) +
              Number(p.show_stock || 0) +
              Number(p.store_stock || 0)
            return (
              <article key={p.id} className="rounded-xl border border-[#d4dcd8] bg-white p-4">
                <p className="font-semibold text-[#121c19]">{p.name}</p>
                <p className="text-xs text-[#2a3d36]/45 mt-1">{p.packaging || '—'}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <p className="text-[11px] uppercase text-[#2a3d36]/45">Fridge</p>
                    <p className="font-bold text-[#121c19]">{Number(p.fridge_stock || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-[#2a3d36]/45">Show</p>
                    <p className="font-bold text-[#121c19]">{Number(p.show_stock || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-[#2a3d36]/45">Store</p>
                    <p className="font-bold text-[#121c19]">{Number(p.store_stock || 0)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#2a3d36]/50">Total {total}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Number(p.store_stock || 0) <= 0}
                    onClick={() => openMove(p, 'fridge')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-40"
                  >
                    To fridge
                  </button>
                  <button
                    type="button"
                    disabled={Number(p.store_stock || 0) <= 0}
                    onClick={() => openMove(p, 'show')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-40"
                  >
                    To show
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        <div className="hidden md:block">
          <Table
            columns={[
              {
                key: 'name',
                header: 'Product',
                render: (p: any) => (
                  <>
                    <div className="font-semibold text-[#121c19]">{p.name}</div>
                    <div className="text-xs text-[#2a3d36]/45">{p.packaging || '—'}</div>
                  </>
                ),
              },
              {
                key: 'fridge_stock',
                header: 'Fridge',
                align: 'center',
                render: (p: any) => (
                  <span className="font-semibold">{Number(p.fridge_stock || 0)}</span>
                ),
              },
              {
                key: 'show_stock',
                header: 'Show',
                align: 'center',
                render: (p: any) => (
                  <span className="font-semibold">{Number(p.show_stock || 0)}</span>
                ),
              },
              {
                key: 'store_stock',
                header: 'Store',
                align: 'center',
                render: (p: any) => (
                  <span className="font-semibold">{Number(p.store_stock || 0)}</span>
                ),
              },
              {
                key: 'total',
                header: 'Total',
                align: 'center',
                render: (p: any) => {
                  const total =
                    Number(p.fridge_stock || 0) +
                    Number(p.show_stock || 0) +
                    Number(p.store_stock || 0)
                  return <span className="font-bold text-[#121c19]">{total}</span>
                },
              },
              {
                key: 'move',
                header: 'New stock',
                align: 'right',
                render: (p: any) => {
                  const store = Number(p.store_stock || 0)
                  return (
                    <div className="inline-flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        disabled={store <= 0}
                        onClick={() => openMove(p, 'fridge')}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-40"
                      >
                        To fridge
                      </button>
                      <button
                        type="button"
                        disabled={store <= 0}
                        onClick={() => openMove(p, 'show')}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-40"
                      >
                        To show
                      </button>
                    </div>
                  )
                },
              },
            ]}
            data={filtered}
            rowKey={(p) => p.id}
            emptyMessage="No products found"
          />
        </div>
      </div>

      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#121c19]/55"
            onClick={() => !moving && setMoveTarget(null)}
          />
          <form
            className="relative w-full sm:max-w-md bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleMoveStock()
            }}
          >
            <h2 className="font-display text-xl font-bold text-[#121c19]">
              Move to {moveTarget.to}
            </h2>
            <p className="text-sm text-[#2a3d36]/70">
              {moveTarget.product.name} · store has{' '}
              <span className="font-semibold">{Number(moveTarget.product.store_stock || 0)}</span>
            </p>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Quantity
              </label>
              <input
                type="number"
                min={1}
                max={Number(moveTarget.product.store_stock || 0)}
                value={moveQty}
                onChange={(e) => setMoveQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={moving}
                onClick={() => setMoveTarget(null)}
                className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={moving}
                className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                {moving ? 'Moving…' : 'Move stock'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function DaySalesSummaryBody({
  preview,
  loading,
}: {
  preview: any
  loading?: boolean
}) {
  if (loading) {
    return <p className="text-sm text-[#2a3d36]/60">Loading day summary…</p>
  }
  const normalLines = Array.isArray(preview?.normal?.lines) ? preview.normal.lines : []
  const staffLines = Array.isArray(preview?.staff?.lines) ? preview.staff.lines : []
  const sold = Array.isArray(preview?.sold) ? preview.sold : []
  const byName = new Map<
    string,
    {
      name: string
      normalQty: number
      staffQty: number
      normalAmount: number
      staffAmount: number
      fridgeBefore: number
      fridgeLeft: number
      newStock: number
    }
  >()
  const row = (name: string) => {
    const key = String(name || 'Item')
    if (!byName.has(key)) {
      byName.set(key, {
        name: key,
        normalQty: 0,
        staffQty: 0,
        normalAmount: 0,
        staffAmount: 0,
        fridgeBefore: 0,
        fridgeLeft: 0,
        newStock: 0,
      })
    }
    return byName.get(key)!
  }
  for (const l of normalLines) {
    const r = row(l.name)
    r.normalQty += Number(l.qty || 0)
    r.normalAmount += Number(l.amount || 0)
  }
  for (const l of staffLines) {
    const r = row(l.name)
    r.staffQty += Number(l.qty || 0)
    r.staffAmount += Number(l.amount || 0)
  }
  for (const s of sold) {
    const r = row(s.name)
    r.fridgeBefore = Number(s.fridge_before ?? s.before ?? r.fridgeBefore)
    r.fridgeLeft = Number(s.fridge_left ?? s.left ?? r.fridgeLeft)
    r.newStock = Number(s.new_stock ?? s.newStock ?? r.newStock)
    if (!r.normalQty && !r.staffQty) {
      r.normalQty += Number(s.fridge_sold || s.sold || 0)
    }
  }
  const products = [...byName.values()].sort(
    (a, b) => b.normalQty + b.staffQty - (a.normalQty + a.staffQty) || a.name.localeCompare(b.name)
  )
  const totalItems = products.reduce((s, p) => s + p.normalQty + p.staffQty, 0)
  const normalTotal = Number(preview?.normal?.total || 0)
  const staffTotal = Number(preview?.staff?.total || 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Sales</p>
          <p className="font-display text-xl font-bold">{preview?.salesCount || 0}</p>
        </div>
        <div className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Items</p>
          <p className="font-display text-xl font-bold">{totalItems}</p>
        </div>
        <div className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Normal</p>
          <p className="font-display text-lg font-bold">{money(normalTotal)}</p>
        </div>
        <div className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Staff</p>
          <p className="font-display text-lg font-bold">{money(staffTotal)}</p>
        </div>
      </div>
      <p className="text-xs text-[#2a3d36]/55">
        Check this before syncing. Fridge before / remaining is from today&apos;s till.
      </p>
      <div className="overflow-x-auto rounded-xl border border-[#d4dcd8]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#f4f6f5] text-[10px] uppercase tracking-wide text-[#2a3d36]/50">
            <tr>
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 font-semibold text-right">Normal</th>
              <th className="px-3 py-2 font-semibold text-right">Staff</th>
              <th className="px-3 py-2 font-semibold text-right">Total qty</th>
              <th className="px-3 py-2 font-semibold text-right">Fridge before</th>
              <th className="px-3 py-2 font-semibold text-right">New stock</th>
              <th className="px-3 py-2 font-semibold text-right">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8ecea]">
            {products.map((p) => (
              <tr key={p.name}>
                <td className="px-3 py-2 font-medium text-[#121c19]">{p.name}</td>
                <td className="px-3 py-2 text-right">
                  {p.normalQty}
                  {p.normalQty ? (
                    <span className="block text-[10px] text-[#2a3d36]/45">{money(p.normalAmount)}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.staffQty}
                  {p.staffQty ? (
                    <span className="block text-[10px] text-indigo-800">{money(p.staffAmount)}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-semibold">{p.normalQty + p.staffQty}</td>
                <td className="px-3 py-2 text-right">{p.fridgeBefore}</td>
                <td className="px-3 py-2 text-right">
                  {p.newStock > 0 ? (
                    <span className="font-semibold text-teal-800">+{p.newStock}</span>
                  ) : (
                    <span className="text-[#2a3d36]/40">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{p.fridgeLeft}</td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[#2a3d36]/50">
                  No sales for this day
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {Array.isArray(preview?.stock_moves) && preview.stock_moves.length > 0 && (
        <div className="rounded-xl border border-[#d4dcd8] overflow-hidden">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/50 bg-[#f4f6f5]">
            Who carried new stock
          </p>
          <div className="divide-y divide-[#e8ecea]">
            {preview.stock_moves.map((m: any, idx: number) => (
              <div key={`${m.name}-${idx}`} className="px-3 py-2.5 text-sm flex justify-between gap-3">
                <p>
                  <span className="font-semibold">{m.staff_name || 'Staff'}</span>
                  {` moved ${Number(m.quantity || 0)} ${m.name} to ${m.to || 'fridge'}`}
                </p>
                <p className="text-xs text-[#2a3d36]/45 whitespace-nowrap">
                  {formatWhen(m.created_at)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function DaySummaryDashboard({
  currentUser,
  businessInfo,
}: {
  currentUser: any
  businessInfo: any
}) {
  const [date, setDate] = useState(toDateInputValue())
  const [preview, setPreview] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const businessId = currentUser?.business_id || businessInfo?.id

  const load = async (reportDate = date) => {
    if (!businessId) return
    try {
      setLoading(true)
      const data = (await invoke('get_sales_email_preview', {
        businessId,
        reportDate,
      })) as any
      setPreview(data)
    } catch (error) {
      toast.error(`Failed to load day summary: ${error}`)
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (businessId) void load(date)
  }, [businessId, date])

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1100px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Till
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Day summary
            </h1>
            <p className="mt-2 text-[#2a3d36]/70">
              Items sold at normal vs staff price, fridge before, and remaining — check before you sync.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                Date
              </label>
              <input
                type="date"
                value={date}
                max={toDateInputValue()}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block px-3 py-2 rounded-md border border-[#d4dcd8] bg-white text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="border border-[#121c19]/15 hover:bg-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              Refresh
            </button>
          </div>
        </header>
        <DaySalesSummaryBody preview={preview} loading={loading} />
      </div>
    </div>
  )
}

export function SalesLogDashboard({
  currentUser,
  businessInfo,
  ownOnly = false,
}: {
  currentUser: any
  businessInfo: any
  ownOnly?: boolean
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [printingId, setPrintingId] = useState<number | null>(null)
  const [editSale, setEditSale] = useState<any | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editItems, setEditItems] = useState<any[]>([])
  const [editItemsSnapshot, setEditItemsSnapshot] = useState('')
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const [voidingId, setVoidingId] = useState<number | null>(null)
  const [approvingId, setApprovingId] = useState<number | null>(null)
  const [approvingDay, setApprovingDay] = useState(false)
  const [approveDayOpen, setApproveDayOpen] = useState(false)
  const [expectedAmount, setExpectedAmount] = useState('')
  const [staffDebtorId, setStaffDebtorId] = useState('')
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftPreview, setShiftPreview] = useState<any | null>(null)
  const [summaryDate, setSummaryDate] = useState(toDateInputValue())
  const businessId = currentUser?.business_id || businessInfo?.id
  const role = String(currentUser?.role || '')
  const canApprove = ['Secretary', 'SuperAdmin', 'Manager'].includes(role)
  const canEditSale = ['Secretary', 'SuperAdmin', 'Manager', 'Staff', 'BarStaff'].includes(role)
  const canVoidSale = ['Secretary', 'SuperAdmin', 'Manager', 'Staff', 'BarStaff', 'KitchenStaff'].includes(role)
  const canEditSaleDate = ['Secretary', 'SuperAdmin', 'Manager'].includes(role)
  const today = toDateInputValue()
  const singleDay =
    dateFrom && dateTo && dateFrom === dateTo ? dateFrom : ''
  const pendingReviewCount = rows.filter(
    (r) => String(r.review_status || 'PENDING_REVIEW').toUpperCase() !== 'APPROVED'
  ).length

  useEffect(() => {
    if (businessId) void load()
    else setLoading(false)
  }, [businessId, ownOnly, currentUser?.id, dateFrom, dateTo])

  const load = async () => {
    try {
      setLoading(true)
      const data = (await invoke('get_sales_log', {
        businessId,
        staffId: ownOnly ? currentUser?.id : null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      })) as any[]
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(`Failed to load sales log: ${error}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const setDatePreset = (preset: 'today' | 'yesterday' | 'week' | 'clear') => {
    const now = new Date()
    if (preset === 'clear') {
      setDateFrom('')
      setDateTo('')
      return
    }
    if (preset === 'today') {
      const d = formatLocalDate(now)
      setDateFrom(d)
      setDateTo(d)
      return
    }
    if (preset === 'yesterday') {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      const d = formatLocalDate(y)
      setDateFrom(d)
      setDateTo(d)
      return
    }
    // week: last 7 days including today
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    setDateFrom(formatLocalDate(start))
    setDateTo(formatLocalDate(now))
  }

  const openEditDate = async (sale: any) => {
    if (!canEditSale) return
    const approved =
      String(sale?.review_status || '').toUpperCase() === 'APPROVED'
    if (approved && !canEditSaleDate) {
      toast.error('This sale is approved — ask secretary/admin to edit it')
      return
    }
    setEditSale(sale)
    setEditDate(toDateInputValue(sale?.created_at))
    setEditItems([])
    try {
      setLoadingEdit(true)
      const receipt = (await invoke('get_sale_receipt', {
        saleId: sale.id,
        businessId,
      })) as any
      const grouped = new Map<number, any>()
      for (const item of Array.isArray(receipt?.items) ? receipt.items : []) {
        const pid = Number(item.product_id)
        const normal = Number(item.normal_price || 0)
        const staff = Number(item.staff_price || 0) || normal
        const unit = Number(item.unit_price || 0)
        const qty = Number(item.quantity || 0)
        const isStaff =
          staff > 0 && Math.abs(unit - staff) < 0.001 && Math.abs(unit - normal) > 0.001
        const existing = grouped.get(pid)
        if (existing) {
          existing.quantity += qty
          existing.staffQty += isStaff ? qty : 0
        } else {
          grouped.set(pid, {
            product_id: pid,
            name: item.name || `Product #${pid}`,
            quantity: qty,
            staffQty: isStaff ? qty : 0,
            normal_price: normal,
            staff_price: staff,
          })
        }
      }
      const groupedItems = [...grouped.values()]
      setEditItems(groupedItems)
      setEditItemsSnapshot(
        JSON.stringify(
          groupedItems.map((i) => ({
            product_id: Number(i.product_id),
            quantity: Number(i.quantity || 0),
            staffQty: Number(i.staffQty || 0),
          }))
        )
      )
    } catch (error) {
      toast.error(`Failed to load sale items: ${error}`)
    } finally {
      setLoadingEdit(false)
    }
  }

  const editItemsTotal = editItems.reduce((sum, item) => {
    const qty = Number(item.quantity || 0)
    const staffQty = Math.min(Math.max(0, Number(item.staffQty || 0)), qty)
    const normalQty = qty - staffQty
    const normal = Number(item.normal_price || 0)
    const staff = Number(item.staff_price || item.normal_price || 0)
    return sum + staffQty * staff + normalQty * normal
  }, 0)

  const handleSaveSaleDate = async () => {
    if (!editSale?.id) return
    const dateToSave = canEditSaleDate ? editDate : toDateInputValue(editSale.created_at)
    if (!dateToSave) return
    const today = toDateInputValue()
    if (dateToSave > today) {
      toast.error('Sale date cannot be in the future')
      return
    }
    const expanded: Array<{ product_id: number; quantity: number; unit_price: number }> = []
    for (const item of editItems) {
      const qty = Number(item.quantity || 0)
      const staffQty = Math.min(Math.max(0, Number(item.staffQty || 0)), qty)
      const normalQty = qty - staffQty
      const normal = Number(item.normal_price || 0)
      const staff = Number(item.staff_price || item.normal_price || 0)
      if (staffQty > 0 && !(staff >= 0)) {
        toast.error(`Enter a valid staff price for ${item.name}`)
        return
      }
      if (normalQty > 0 && !(normal >= 0)) {
        toast.error(`Enter a valid normal price for ${item.name}`)
        return
      }
      if (staffQty > 0) {
        expanded.push({
          product_id: item.product_id,
          quantity: staffQty,
          unit_price: staff,
        })
      }
      if (normalQty > 0) {
        expanded.push({
          product_id: item.product_id,
          quantity: normalQty,
          unit_price: normal,
        })
      }
    }
    const currentSnapshot = JSON.stringify(
      editItems.map((i) => ({
        product_id: Number(i.product_id),
        quantity: Number(i.quantity || 0),
        staffQty: Math.min(Math.max(0, Number(i.staffQty || 0)), Number(i.quantity || 0)),
      }))
    )
    const itemsChanged = currentSnapshot !== editItemsSnapshot
    const originalDate = toDateInputValue(editSale.created_at)
    if (!itemsChanged && dateToSave === originalDate) {
      toast.error('Nothing to save')
      return
    }
    try {
      setSavingDate(true)
      await invoke('update_sale_details', {
        saleId: editSale.id,
        businessId,
        saleDate: dateToSave,
        actorUserId: currentUser?.id,
        items: itemsChanged ? expanded : null,
      })
      toast.success(
        itemsChanged
          ? 'Sale updated · debt balance synced if linked'
          : 'Sale date updated'
      )
      setEditSale(null)
      setEditItems([])
      setEditItemsSnapshot('')
      await load()
    } catch (error) {
      toast.error(`Failed to update sale: ${error}`)
    } finally {
      setSavingDate(false)
    }
  }

  const handlePrint = async (sale: any) => {
    if (!sale?.id) return
    try {
      setPrintingId(Number(sale.id))
      const receipt = (await invoke('get_sale_receipt', {
        saleId: sale.id,
        businessId,
      })) as any
      printReceipt({
        ...receipt,
        business_name: receipt.business_name || businessInfo?.name || 'POS System',
        business_address: receipt.business_address || businessInfo?.address || null,
        business_phone: receipt.business_phone || businessInfo?.phone || null,
        staff_name: receipt.staff_name || sale.staff_name,
        customer_name:
          receipt.customer_name || sale.customer_name || 'Walk-in customer',
      })
    } catch (error) {
      toast.error(`Print failed: ${error}`)
    } finally {
      setPrintingId(null)
    }
  }

  const handleVoid = async (sale: any) => {
    if (!sale?.id) return
    if (
      !window.confirm(
        `Void sale #${sale.id}?

Stock goes back to ${sale.location || 'fridge'}. This cannot be undone.`
      )
    ) {
      return
    }
    try {
      setVoidingId(Number(sale.id))
      await invoke('void_sale', {
        saleId: sale.id,
        businessId,
        actorUserId: currentUser?.id,
      })
      toast.success(`Sale #${sale.id} voided · stock returned`)
      await load()
    } catch (error) {
      toast.error(`Void failed: ${error}`)
    } finally {
      setVoidingId(null)
    }
  }

  const handleApprove = async (sale: any) => {
    if (!sale?.id || !canApprove) return
    try {
      setApprovingId(Number(sale.id))
      await invoke('approve_sale', {
        saleId: sale.id,
        businessId,
        actorUserId: currentUser?.id,
      })
      toast.success(`Sale #${sale.id} approved`)
      await load()
    } catch (error) {
      toast.error(`Approve failed: ${error}`)
    } finally {
      setApprovingId(null)
    }
  }

  const daySales = singleDay
    ? rows.filter((r) => toDateInputValue(r.created_at) === singleDay)
    : []
  const systemTotalForDay = daySales.reduce(
    (s, r) => s + Number(r.total_amount || 0),
    0
  )
  const dayStaffOptions = (() => {
    const map = new Map<number, string>()
    for (const s of daySales) {
      const id = Number(s.user_id || 0)
      if (!id) continue
      map.set(id, String(s.staff_name || `User #${id}`))
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  })()
  const expectedNum = Number(String(expectedAmount).replace(/,/g, ''))
  const varianceDiff =
    expectedAmount.trim() && Number.isFinite(expectedNum)
      ? Math.abs(expectedNum - systemTotalForDay)
      : 0

  const openApproveDay = () => {
    if (!canApprove || !singleDay) return
    setExpectedAmount('')
    setStaffDebtorId(
      dayStaffOptions.length === 1 ? String(dayStaffOptions[0].id) : ''
    )
    setApproveDayOpen(true)
  }

  const handleApproveDay = async () => {
    if (!canApprove || !singleDay) return
    const hasExpected = expectedAmount.trim() !== ''
    if (hasExpected && !(expectedNum >= 0)) {
      toast.error('Enter a valid expected (manual) amount')
      return
    }
    if (hasExpected && varianceDiff > 0.5 && !staffDebtorId) {
      toast.error('Pick the staff on duty — the difference will be logged as their debt')
      return
    }
    const confirmMsg = hasExpected && varianceDiff > 0.5
      ? `Approve ${singleDay}?\n\nSales total: ${money(systemTotalForDay)}\nManual: ${money(expectedNum)}\nDifference: ${money(varianceDiff)}\n\nThis difference will be added as debt against the staff on duty (accumulates until paid).`
      : `Approve all pending sales for ${singleDay}?\n\nSales total: ${money(systemTotalForDay)}\n\nConfirm they match the manual check & remaining stock.`
    if (!window.confirm(confirmMsg)) return
    try {
      setApprovingDay(true)
      const result = (await invoke('approve_sales_for_date', {
        businessId,
        reportDate: singleDay,
        actorUserId: currentUser?.id,
        expectedAmount: hasExpected ? expectedNum : null,
        staffDebtorUserId: staffDebtorId ? Number(staffDebtorId) : null,
      })) as {
        count?: number
        variance?: { difference?: number; staff_name?: string; balance?: number }
      }
      const v = result?.variance
      if (v?.difference) {
        toast.success(
          `Approved ${result?.count ?? 0} · ${money(v.difference)} debt → ${v.staff_name || 'staff'}`
        )
      } else {
        toast.success(`Approved ${result?.count ?? 0} sale(s) for ${singleDay}`)
      }
      setApproveDayOpen(false)
      await load()
    } catch (error) {
      toast.error(`Approve day failed: ${error}`)
    } finally {
      setApprovingDay(false)
    }
  }

  const openShiftReport = async (reportDate = summaryDate) => {
    setShiftOpen(true)
    setShiftLoading(true)
    try {
      const preview = (await invoke('get_sales_email_preview', {
        businessId,
        reportDate: reportDate || toDateInputValue(),
      })) as any
      setShiftPreview(preview)
    } catch (error) {
      toast.error(`Day summary failed: ${error}`)
      setShiftPreview(null)
    } finally {
      setShiftLoading(false)
    }
  }

  const filtered = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      String(r.staff_name || '').toLowerCase().includes(q) ||
      String(r.payment_method || '').toLowerCase().includes(q) ||
      String(r.payment_status || '').toLowerCase().includes(q) ||
      String(r.items_summary || '').toLowerCase().includes(q) ||
      String(r.price_mix || '').toLowerCase().includes(q) ||
      String(r.review_status || '').toLowerCase().includes(q) ||
      String(r.id).includes(q) ||
      saleCustomerName(r).toLowerCase().includes(q)
    )
  })

  const totalValue = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0)

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24">
        <p className="font-display text-lg font-semibold text-[#121c19]">Loading sales…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              History
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Sales log
            </h1>
            <p className="mt-2 text-[#2a3d36]/70">
              {ownOnly
                ? 'Your recent sales — items shown in the list. Edit normal/staff split or void if needed.'
                : canApprove
                  ? 'Review pushed sales, match the manual check & remaining stock, then approve the day.'
                  : 'Recent sales for this business.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove && singleDay && (
              <button
                type="button"
                onClick={() => openApproveDay()}
                disabled={approvingDay || pendingReviewCount === 0}
                className="border border-teal-700/30 bg-teal-50 text-teal-900 hover:bg-teal-100 px-4 py-2.5 rounded-md text-sm font-semibold disabled:opacity-50"
              >
                {approvingDay
                  ? 'Approving…'
                  : `Approve day (${pendingReviewCount} pending)`}
              </button>
            )}
            <button
              type="button"
              onClick={() => void openShiftReport()}
              className="border border-[#121c19]/15 hover:bg-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              Day summary
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="border border-[#121c19]/15 hover:bg-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              Refresh
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Sales shown</p>
            <p className="font-display text-3xl font-bold text-[#121c19] mt-1">{filtered.length}</p>
          </div>
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Value</p>
            <p className="font-display text-3xl font-bold text-teal-800 mt-1">{money(totalValue)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-[#d4dcd8] bg-white p-4 mb-4 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Search
              </label>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by customer, staff, method, status, id…"
                className="mt-1.5 w-full px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:min-w-[20rem]">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                  From date
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || today}
                  onChange={(e) => {
                    const v = e.target.value
                    setDateFrom(v)
                    if (dateTo && v && v > dateTo) setDateTo(v)
                  }}
                  className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                  To date
                </label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={today}
                  onChange={(e) => {
                    const v = e.target.value
                    setDateTo(v)
                    if (dateFrom && v && v < dateFrom) setDateFrom(v)
                  }}
                  className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] text-sm"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#2a3d36]/50 mr-1">Quick:</span>
            {(
              [
                { id: 'today' as const, label: 'Today' },
                { id: 'yesterday' as const, label: 'Yesterday' },
                { id: 'week' as const, label: 'Last 7 days' },
                { id: 'clear' as const, label: 'All dates' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDatePreset(p.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/15 hover:bg-[#f4f6f5]"
              >
                {p.label}
              </button>
            ))}
            {(dateFrom || dateTo) && (
              <p className="text-xs text-[#2a3d36]/55 ml-auto">
                Showing {dateFrom || '…'} → {dateTo || '…'}
                {dateFrom && dateTo && dateFrom === dateTo ? ' (single day)' : ''}
              </p>
            )}
          </div>
        </div>

        <div className="md:hidden space-y-3">
          {filtered.map((sale) => {
            const approved =
              String(sale.review_status || '').toUpperCase() === 'APPROVED'
            return (
            <article key={sale.id} className="rounded-xl border border-[#d4dcd8] bg-white p-4">
              <div className="flex justify-between gap-3 items-start">
                <p className="font-semibold text-[#121c19]">#{sale.id}</p>
                <DebtProgressBlock sale={sale} />
              </div>
              <p className="text-sm text-[#121c19] mt-1">{saleCustomerName(sale)}</p>
              <p className="text-sm text-[#2a3d36]/60 mt-0.5">{sale.staff_name}</p>
              <p className="text-xs text-[#2a3d36]/70 mt-2 leading-snug">
                <SaleItemsCell sale={sale} />
              </p>
              <p className="text-xs text-[#2a3d36]/45 mt-2">{formatWhen(sale.created_at)}</p>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <PaymentMethodBadge method={sale.payment_method} />
                <SaleStatusBadge status={sale.payment_status} method={sale.payment_method} />
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md border ${
                    approved
                      ? 'border-teal-200 bg-teal-50 text-teal-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {approved ? 'Approved' : 'Pending review'}
                </span>
                <div className="ml-auto flex flex-wrap gap-2 justify-end">
                  {canEditSale && (
                    <button
                      type="button"
                      onClick={() => openEditDate(sale)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5]"
                    >
                      Edit
                    </button>
                  )}
                  {canApprove && !approved && (
                    <button
                      type="button"
                      onClick={() => void handleApprove(sale)}
                      disabled={approvingId === Number(sale.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-teal-200 text-teal-900 hover:bg-teal-50 disabled:opacity-50"
                    >
                      {approvingId === Number(sale.id) ? '…' : 'Approve'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePrint(sale)}
                    disabled={printingId === Number(sale.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                  >
                    {printingId === Number(sale.id) ? 'Printing…' : 'Print'}
                  </button>
                  {canVoidSale && (
                    <button
                      type="button"
                      onClick={() => void handleVoid(sale)}
                      disabled={voidingId === Number(sale.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-rose-200 text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {voidingId === Number(sale.id) ? 'Voiding…' : 'Void'}
                    </button>
                  )}
                </div>
              </div>
            </article>
            )
          })}
        </div>

        <div className="hidden md:block rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
          <table className="min-w-full text-left">
            <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
              <tr>
                <th className="px-5 py-3 font-semibold">Sale</th>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Items</th>
                <th className="px-5 py-3 font-semibold">Staff</th>
                <th className="px-5 py-3 font-semibold">Method</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Amount / debt</th>
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ecea]">
              {filtered.map((sale) => {
                const approved =
                  String(sale.review_status || '').toUpperCase() === 'APPROVED'
                return (
                <tr key={sale.id} className="hover:bg-[#f4f6f5]/70">
                  <td className="px-5 py-4 font-semibold text-[#121c19]">#{sale.id}</td>
                  <td className="px-5 py-4 text-[#121c19]">{saleCustomerName(sale)}</td>
                  <td className="px-5 py-4">
                    <SaleItemsCell sale={sale} />
                  </td>
                  <td className="px-5 py-4 text-[#2a3d36]/70">{sale.staff_name}</td>
                  <td className="px-5 py-4">
                    <PaymentMethodBadge method={sale.payment_method} />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1.5 items-start">
                      <SaleStatusBadge status={sale.payment_status} method={sale.payment_method} />
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${
                          approved
                            ? 'border-teal-200 bg-teal-50 text-teal-800'
                            : 'border-amber-200 bg-amber-50 text-amber-900'
                        }`}
                      >
                        {approved ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex justify-end">
                      <DebtProgressBlock sale={sale} />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#2a3d36]/60 whitespace-nowrap">
                    {formatWhen(sale.created_at)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex flex-wrap gap-2 justify-end">
                      {canEditSale && (
                        <button
                          type="button"
                          onClick={() => openEditDate(sale)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5]"
                        >
                          Edit
                        </button>
                      )}
                      {canApprove && !approved && (
                        <button
                          type="button"
                          onClick={() => void handleApprove(sale)}
                          disabled={approvingId === Number(sale.id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-teal-200 text-teal-900 hover:bg-teal-50 disabled:opacity-50"
                        >
                          {approvingId === Number(sale.id) ? '…' : 'Approve'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handlePrint(sale)}
                        disabled={printingId === Number(sale.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                      >
                        {printingId === Number(sale.id) ? 'Printing…' : 'Print'}
                      </button>
                      {canVoidSale && (
                        <button
                          type="button"
                          onClick={() => void handleVoid(sale)}
                          disabled={voidingId === Number(sale.id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-rose-200 text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                        >
                          {voidingId === Number(sale.id) ? 'Voiding…' : 'Void'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-5 py-10 text-center text-[#2a3d36]/50">No sales found</p>
          )}
        </div>
      </div>

      {approveDayOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#121c19]/55"
            onClick={() => !approvingDay && setApproveDayOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-[#121c19]">
              Approve day · {singleDay}
            </h2>
            <p className="text-sm text-[#2a3d36]/70">
              Compare POS sales to your manual check. If they differ, enter the manual total —
              the difference is logged as debt against the staff on duty and keeps growing until paid.
            </p>
            <div className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                Sales total (system)
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-[#121c19]">
                {money(systemTotalForDay)}
              </p>
              <p className="mt-1 text-xs text-[#2a3d36]/55">
                {daySales.length} sale(s) · {pendingReviewCount} pending review
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Manual / expected amount
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={expectedAmount}
                onChange={(e) => setExpectedAmount(e.target.value)}
                placeholder="Leave blank if it matches"
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
              />
            </div>
            {varianceDiff > 0.5 && (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-950">
                    Difference {money(varianceDiff)} → staff debt
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                    Staff on duty
                  </label>
                  <select
                    value={staffDebtorId}
                    onChange={(e) => setStaffDebtorId(e.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white"
                  >
                    <option value="">Select staff…</option>
                    {dayStaffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={approvingDay}
                onClick={() => setApproveDayOpen(false)}
                className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={approvingDay}
                onClick={() => void handleApproveDay()}
                className="flex-1 bg-teal-700 hover:bg-teal-800 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                {approvingDay ? 'Approving…' : 'Confirm approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shiftOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#121c19]/55"
            onClick={() => setShiftOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-[#121c19]">Day summary</h2>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                Date
              </label>
              <input
                type="date"
                value={summaryDate}
                max={toDateInputValue()}
                onChange={(e) => {
                  const next = e.target.value
                  setSummaryDate(next)
                  void openShiftReport(next)
                }}
                className="mt-1 w-full px-3 py-2 rounded-md border border-[#d4dcd8] text-sm"
              />
            </div>
            <DaySalesSummaryBody preview={shiftPreview} loading={shiftLoading} />
            <button
              type="button"
              onClick={() => setShiftOpen(false)}
              className="w-full border border-[#d4dcd8] py-3 rounded-lg font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {editSale && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#121c19]/55"
            onClick={() => !savingDate && setEditSale(null)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-[#121c19]">
              Edit sale
            </h2>
            <p className="text-sm text-[#2a3d36]/70">
              Sale #{editSale.id} · {saleCustomerName(editSale)}
            </p>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
                Sale date
              </label>
              <input
                type="date"
                value={editDate}
                max={toDateInputValue()}
                onChange={(e) => setEditDate(e.target.value)}
                disabled={!canEditSaleDate}
                readOnly={!canEditSaleDate}
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8] disabled:bg-[#f4f6f5] disabled:text-[#2a3d36]/60"
              />
              <p className="mt-2 text-xs text-[#2a3d36]/50">
                {canEditSaleDate
                  ? `Current: ${formatWhen(editSale.created_at)}. Future dates are not allowed.`
                  : 'Date locked — change staff vs normal qty below.'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
                Split prices by quantity
              </p>
              <p className="text-xs text-[#2a3d36]/45 mb-3">
                Example: sold 3 water — set Staff qty to 2 and keep 1 at Normal.
              </p>
              {loadingEdit ? (
                <p className="text-sm text-[#2a3d36]/50 py-4 text-center">Loading items…</p>
              ) : editItems.length === 0 ? (
                <p className="text-sm text-[#2a3d36]/50 py-4 text-center">
                  No line items found for this sale
                </p>
              ) : (
                <div className="space-y-3">
                  {editItems.map((item, idx) => {
                    const qty = Number(item.quantity || 0)
                    const staffQty = Math.min(Math.max(0, Number(item.staffQty || 0)), qty)
                    const normalQty = qty - staffQty
                    const normal = Number(item.normal_price || 0)
                    const staff = Number(item.staff_price || item.normal_price || 0)
                    const lineTotal = staffQty * staff + normalQty * normal
                    return (
                      <div
                        key={`${item.product_id}-${idx}`}
                        className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3 space-y-3"
                      >
                        <div className="flex justify-between gap-2">
                          <p className="font-semibold text-[#121c19] text-sm">{item.name}</p>
                          <p className="text-xs text-[#2a3d36]/50">Total qty {qty}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                              Staff qty · {money(staff)}
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={qty}
                              step={1}
                              value={staffQty}
                              onChange={(e) => {
                                const next = Math.min(
                                  qty,
                                  Math.max(0, Math.floor(Number(e.target.value) || 0))
                                )
                                setEditItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, staffQty: next } : row
                                  )
                                )
                              }}
                              className="mt-1 w-full px-3 py-2 rounded-md border border-[#d4dcd8] bg-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                              Normal qty · {money(normal)}
                            </label>
                            <input
                              type="number"
                              readOnly
                              value={normalQty}
                              className="mt-1 w-full px-3 py-2 rounded-md border border-[#d4dcd8] bg-white/70 text-sm text-[#2a3d36]/70"
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEditItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, staffQty: 0 } : row
                                )
                              )
                            }
                            className="text-[11px] font-semibold px-2 py-1 rounded border border-[#d4dcd8] bg-white"
                          >
                            All normal
                          </button>
                          <button
                            type="button"
                            disabled={!(staff > 0)}
                            onClick={() =>
                              setEditItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, staffQty: qty } : row
                                )
                              )
                            }
                            className="text-[11px] font-semibold px-2 py-1 rounded border border-[#d4dcd8] bg-white disabled:opacity-40"
                          >
                            All staff
                          </button>
                        </div>
                        <p className="text-xs text-[#2a3d36]/50 text-right">
                          Line total {money(lineTotal)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-[#e8ecea] pt-3">
                <p className="text-sm font-semibold text-[#2a3d36]/60">New sale total</p>
                <p className="font-display text-xl font-bold text-[#121c19]">
                  {money(editItemsTotal)}
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                disabled={savingDate}
                onClick={() => {
                  setEditSale(null)
                  setEditItems([])
                }}
                className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingDate || loadingEdit || !editDate}
                onClick={() => void handleSaveSaleDate()}
                className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                {savingDate ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DebtManagementDashboard({
  currentUser,
  businessInfo,
  ownOnly = false,
}: {
  currentUser: any
  businessInfo: any
  ownOnly?: boolean
}) {
  const [rows, setRows] = useState<any[]>([])
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddDebt, setShowAddDebt] = useState(false)
  const [payTarget, setPayTarget] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const businessId = currentUser?.business_id || businessInfo?.id
  const role = String(currentUser?.role || '')
  const canManageStaffDebts = ['Secretary', 'SuperAdmin', 'Manager'].includes(role)
  const isFloorStaff = ['Staff', 'BarStaff', 'KitchenStaff'].includes(role)

  const isProtectedStaffDebt = (debt: any) => {
    const name = String(debt?.customer_name || '').trim()
    const lower = name.toLowerCase()
    if (
      lower.startsWith('staff ·') ||
      lower.startsWith('staff -') ||
      lower.startsWith('staff:')
    ) {
      return true
    }
    const key = name.toLowerCase().replace(/\s+/g, ' ')
    return staffNames.some((n) => {
      const sn = n.toLowerCase().replace(/\s+/g, ' ')
      return sn === key || `staff · ${sn}` === key || `staff - ${sn}` === key
    })
  }

  useEffect(() => {
    if (businessId) void load()
    else setLoading(false)
  }, [businessId, ownOnly, currentUser?.id])

  const load = async () => {
    try {
      setLoading(true)
      const [data, users] = await Promise.all([
        invoke('get_debtors', {
          businessId,
          openOnly: true,
          staffId: ownOnly ? currentUser?.id : null,
        }) as Promise<any[]>,
        invoke('get_users_for_business', { businessId }).catch(() => []) as Promise<any[]>,
      ])
      const names = (Array.isArray(users) ? users : [])
        .filter((u) =>
          ['Staff', 'BarStaff', 'KitchenStaff'].includes(String(u.role || ''))
        )
        .map((u) => String(u.name || u.username || '').trim())
        .filter(Boolean)
      setStaffNames(names)
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(`Failed to load debts: ${error}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      String(r.customer_name || '').toLowerCase().includes(q) ||
      String(r.notes || '').toLowerCase().includes(q) ||
      String(r.id).includes(q)
    )
  })

  const outstanding = filtered.reduce((s, r) => s + Number(r.balance || 0), 0)

  const handleAddManual = async (form: {
    customerName: string
    amount: string
    debtDate: string
    notes: string
  }) => {
    try {
      setSaving(true)
      if (isFloorStaff && !canManageStaffDebts) {
        const name = form.customerName.trim()
        if (
          isProtectedStaffDebt({ customer_name: name }) ||
          isProtectedStaffDebt({ customer_name: `Staff · ${name}` })
        ) {
          toast.error(
            'Bar staff cannot add debt against staff names. Ask secretary/admin.'
          )
          return
        }
      }
      await invoke('add_manual_debt', {
        request: {
          business_id: businessId,
          customer_name: form.customerName.trim(),
          amount: Number(form.amount),
          debt_date: form.debtDate
            ? new Date(`${form.debtDate}T12:00:00`).toISOString()
            : new Date().toISOString(),
          notes: form.notes.trim() || null,
          staff_id: currentUser?.id,
        },
      })
      toast.success('Old debt added')
      setShowAddDebt(false)
      await load()
    } catch (error) {
      toast.error(`Failed: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const handleRecordPayment = async (amount: string) => {
    if (!payTarget) return
    if (isFloorStaff && isProtectedStaffDebt(payTarget)) {
      toast.error(
        'Bar staff cannot pay staff shortage debts (own or second). Ask secretary/admin.'
      )
      return
    }
    try {
      setSaving(true)
      const updated = (await invoke('record_debt_payment', {
        request: {
          business_id: businessId,
          debt_id: payTarget.id,
          amount: Number(amount),
          staff_id: currentUser?.id,
          note: 'Payment received',
        },
      })) as any
      toast.success(
        Number(updated?.balance) <= 0
          ? `${payTarget.customer_name} fully settled`
          : `Payment recorded · balance ${money(updated?.balance || 0)}`
      )
      setPayTarget(null)
      await load()
    } catch (error) {
      toast.error(`Failed: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const handleMarkAsPaid = async (debt: any) => {
    const balance = Number(debt.balance || 0)
    if (!(balance > 0)) {
      toast.error('Nothing left to pay')
      return
    }
    if (isFloorStaff && isProtectedStaffDebt(debt)) {
      toast.error(
        'Bar staff cannot clear staff shortage debts. Ask secretary/admin.'
      )
      return
    }
    if (
      !confirm(
        `Mark ${debt.customer_name} as fully paid?\n\nThis clears the full balance of ${money(balance)} in one step.`
      )
    ) {
      return
    }
    try {
      setSaving(true)
      await invoke('record_debt_payment', {
        request: {
          business_id: businessId,
          debt_id: debt.id,
          amount: balance,
          staff_id: currentUser?.id,
          note: 'Marked as paid (full settlement)',
        },
      })
      toast.success(`${debt.customer_name} marked as paid`)
      setPayTarget(null)
      await load()
    } catch (error) {
      toast.error(`Failed: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24">
        <p className="font-display text-lg font-semibold text-[#121c19]">Loading debts…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Credit
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Debt management
            </h1>
            <p className="mt-2 text-[#2a3d36]/70">
              {ownOnly
                ? 'Your debt customers from credit sales. Staff shortage debts can only be cleared by secretary/admin.'
                : canManageStaffDebts
                  ? 'Customer credit and staff till shortages (Staff · name). Shortage balances accumulate until paid.'
                  : 'Track customer balances, add old debts, and record payments.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="border border-[#121c19]/15 hover:bg-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              Refresh
            </button>
            {(canManageStaffDebts || !isFloorStaff || ownOnly) && (
              <button
                type="button"
                onClick={() => setShowAddDebt(true)}
                className="bg-[#121c19] hover:bg-[#1a2924] text-white px-4 py-2.5 rounded-md text-sm font-semibold"
              >
                + Add old debt
              </button>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Open debtors</p>
            <p className="font-display text-3xl font-bold text-[#121c19] mt-1">{filtered.length}</p>
          </div>
          <div className="rounded-xl border border-[#d4dcd8] bg-white p-5">
            <p className="text-sm text-[#2a3d36]/55">Outstanding</p>
            <p className="font-display text-3xl font-bold text-[#c4783a] mt-1">
              {money(outstanding)}
            </p>
          </div>
        </div>

        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search customer…"
          className="w-full mb-4 px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-white text-sm"
        />

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
            <p className="font-display text-2xl font-bold text-[#121c19]">No open debts</p>
            <p className="mt-2 text-[#2a3d36]/55">
              Add an old debt, or charge a customer on credit from POS.
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {filtered.map((debt) => {
                const protectedDebt = isFloorStaff && isProtectedStaffDebt(debt)
                return (
                <article key={debt.id} className="rounded-xl border border-[#d4dcd8] bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#121c19]">{debt.customer_name}</p>
                    {isProtectedStaffDebt(debt) && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                        Staff shortage
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#2a3d36]/45 mt-1">
                    Since {formatWhen(debt.debt_date || debt.created_at)}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase text-[#2a3d36]/45">Charged</p>
                      <p className="text-sm font-semibold">{money(debt.total_charged)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-[#2a3d36]/45">Paid</p>
                      <p className="text-sm font-semibold text-teal-800">{money(debt.total_paid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-[#2a3d36]/45">Balance</p>
                      <p className="text-sm font-bold text-[#c4783a]">{money(debt.balance)}</p>
                    </div>
                  </div>
                  {protectedDebt ? (
                    <p className="mt-4 text-xs text-[#2a3d36]/55 text-center">
                      Only secretary/admin can clear staff shortage debts.
                    </p>
                  ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setPayTarget(debt)}
                      className="border border-[#121c19]/15 hover:bg-[#f4f6f5] text-[#121c19] py-2.5 rounded-md text-sm font-semibold disabled:opacity-50"
                    >
                      Record payment
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleMarkAsPaid(debt)}
                      className="bg-teal-700 hover:bg-teal-800 text-white py-2.5 rounded-md text-sm font-semibold disabled:opacity-50"
                    >
                      Mark as paid
                    </button>
                  </div>
                  )}
                </article>
                )
              })}
            </div>

            <div className="hidden md:block rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
              <table className="min-w-full text-left">
                <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold text-right">Charged</th>
                    <th className="px-5 py-3 font-semibold text-right">Paid</th>
                    <th className="px-5 py-3 font-semibold text-right">Balance</th>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ecea]">
                  {filtered.map((debt) => {
                    const protectedDebt = isFloorStaff && isProtectedStaffDebt(debt)
                    return (
                    <tr key={debt.id} className="hover:bg-[#f4f6f5]/70">
                      <td className="px-5 py-4 font-semibold text-[#121c19]">
                        <div className="flex flex-col gap-1 items-start">
                          <span>{debt.customer_name}</span>
                          {isProtectedStaffDebt(debt) && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
                              Staff shortage
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">{money(debt.total_charged)}</td>
                      <td className="px-5 py-4 text-right text-teal-800 font-semibold">
                        {money(debt.total_paid)}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-[#c4783a]">
                        {money(debt.balance)}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#2a3d36]/60 whitespace-nowrap">
                        {formatWhen(debt.debt_date || debt.created_at)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {protectedDebt ? (
                          <span className="text-xs text-[#2a3d36]/50">Secretary/admin only</span>
                        ) : (
                        <div className="inline-flex flex-wrap gap-2 justify-end">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setPayTarget(debt)}
                            className="border border-[#121c19]/15 hover:bg-[#f4f6f5] text-[#121c19] px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
                          >
                            Record payment
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleMarkAsPaid(debt)}
                            className="bg-teal-700 hover:bg-teal-800 text-white px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
                          >
                            Mark as paid
                          </button>
                        </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showAddDebt && (
        <AddOldDebtModal
          saving={saving}
          onClose={() => setShowAddDebt(false)}
          onSave={handleAddManual}
        />
      )}
      {payTarget && (
        <RecordDebtPaymentModal
          debt={payTarget}
          saving={saving}
          onClose={() => setPayTarget(null)}
          onSave={handleRecordPayment}
        />
      )}
    </div>
  )
}

function AddOldDebtModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean
  onClose: () => void
  onSave: (form: {
    customerName: string
    amount: string
    debtDate: string
    notes: string
  }) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [customerName, setCustomerName] = useState('')
  const [amount, setAmount] = useState('')
  const [debtDate, setDebtDate] = useState(today)
  const [notes, setNotes] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-[#121c19]/55" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
        <h2 className="font-display text-xl font-bold text-[#121c19]">Add old debt</h2>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
            Customer name *
          </label>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
            placeholder="Customer name"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
            Amount owed *
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
            Debt date
          </label>
          <input
            type="date"
            value={debtDate}
            onChange={(e) => setDebtDate(e.target.value)}
            className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
            Notes
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
            placeholder="Optional"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !customerName.trim() || !(Number(amount) > 0)}
            onClick={() => onSave({ customerName, amount, debtDate, notes })}
            className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save debt'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecordDebtPaymentModal({
  debt,
  saving,
  onClose,
  onSave,
}: {
  debt: any
  saving: boolean
  onClose: () => void
  onSave: (amount: string) => void
}) {
  const [amount, setAmount] = useState('')
  const balance = Number(debt.balance || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-[#121c19]/55" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#121c19]">Record payment</h2>
          <p className="mt-1 text-sm text-[#2a3d36]/60">
            {debt.customer_name} · balance {money(balance)}
          </p>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50">
            Amount paid *
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
            placeholder="0.00"
          />
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-teal-800"
            onClick={() => setAmount(String(balance))}
          >
            Pay full balance
          </button>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !(Number(amount) > 0)}
            onClick={() => onSave(amount)}
            className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AuditLogDashboard({
  currentUser,
  businessInfo,
}: {
  currentUser: any
  businessInfo: any
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) void load()
    else setLoading(false)
  }, [businessId])

  const load = async () => {
    try {
      setLoading(true)
      const data = (await invoke('get_activity_logs', {
        businessId,
        limit: 250,
      })) as any[]
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(`Failed to load audit log: ${error}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      String(r.action || '').toLowerCase().includes(q) ||
      String(r.summary || '').toLowerCase().includes(q) ||
      String(r.actor_name || '').toLowerCase().includes(q) ||
      String(r.entity_type || '').toLowerCase().includes(q) ||
      String(r.entity_id || '').includes(q)
    )
  })

  if (loading) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24">
        <p className="font-display text-lg font-semibold text-[#121c19]">Loading audit log…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Security
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Audit log
            </h1>
            <p className="mt-2 text-[#2a3d36]/70">
              Stock moves, sale voids, sale edits, product changes, staff changes, and logins — including work done offline after sync.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="border border-[#121c19]/15 hover:bg-white px-4 py-2.5 rounded-md text-sm font-semibold"
          >
            Refresh
          </button>
        </header>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search action, actor, summary…"
          className="w-full mb-4 px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-white text-sm"
        />

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
            <p className="font-display text-xl font-bold text-[#121c19]">No activity yet</p>
            <p className="mt-2 text-sm text-[#2a3d36]/55">
              Edit a product, move stock, or add staff to see entries here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
            <div className="divide-y divide-[#e8ecea]">
              {filtered.map((row) => (
                <article key={row.id} className="px-5 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#121c19]">
                        {row.summary || row.action}
                      </p>
                      <p className="text-sm text-[#2a3d36]/55 mt-1">
                        By {row.actor_name || 'System'}
                        {row.entity_type ? ` · ${row.entity_type}` : ''}
                      </p>
                      {auditDetail(row) ? (
                        <p className="text-sm text-[#121c19]/80 mt-2 whitespace-pre-wrap">
                          {auditDetail(row)}
                        </p>
                      ) : null}
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#c4783a] mt-2">
                        {String(row.action || '').replace(/_/g, ' ')}
                      </p>
                    </div>
                    <p className="text-xs text-[#2a3d36]/45 whitespace-nowrap">
                      {formatWhen(row.created_at)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

