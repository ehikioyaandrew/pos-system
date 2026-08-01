import { useEffect, useState } from 'react'
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
    const existing = cart.find(
      (i) =>
        i.product.id === product.id &&
        (i.location || 'fridge') === location &&
        (i.priceMode || 'normal') === priceMode
    )
    if (existing) {
      if (existing.quantity + 1 > stock) {
        toast.error(`Only ${stock} left in ${locationLabel(location)}`)
        return
      }
      setCart(
        cart.map((i) =>
          i.product.id === product.id &&
          (i.location || 'fridge') === location &&
          (i.priceMode || 'normal') === priceMode
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      )
    } else {
      setCart([
        ...cart,
        {
          product,
          quantity: 1,
          unitPrice: sellPrice,
          location,
          priceMode,
        },
      ])
    }
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
    for (const item of cart) {
      const loc = (item.location || saleLocation) as SaleLocation
      const available = stockOf(item.product, loc)
      if (item.quantity > available) {
        toast.error(
          `${item.product.name}: only ${available} in ${locationLabel(loc)}. Adjust cart.`
        )
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
      await loadProducts()
    } catch (error) {
      toast.error(`Payment failed: ${error}`)
    } finally {
      setProcessingPayment(false)
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
              Read-only view of fridge, show, and store levels.
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
            ]}
            data={filtered}
            rowKey={(p) => p.id}
            emptyMessage="No products found"
          />
        </div>
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
  const [printingId, setPrintingId] = useState<number | null>(null)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [viewReceipt, setViewReceipt] = useState<any | null>(null)
  const [editSale, setEditSale] = useState<any | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editItems, setEditItems] = useState<any[]>([])
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const businessId = currentUser?.business_id || businessInfo?.id
  const canEditSaleDate = ['Secretary', 'SuperAdmin', 'Manager'].includes(
    String(currentUser?.role || '')
  )

  useEffect(() => {
    if (businessId) void load()
    else setLoading(false)
  }, [businessId, ownOnly, currentUser?.id])

  const load = async () => {
    try {
      setLoading(true)
      const data = (await invoke('get_sales_log', {
        businessId,
        staffId: ownOnly ? currentUser?.id : null,
      })) as any[]
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(`Failed to load sales log: ${error}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const openEditDate = async (sale: any) => {
    setEditSale(sale)
    setEditDate(toDateInputValue(sale?.created_at))
    setEditItems([])
    try {
      setLoadingEdit(true)
      const receipt = (await invoke('get_sale_receipt', {
        saleId: sale.id,
        businessId,
      })) as any
      setEditItems(
        (Array.isArray(receipt?.items) ? receipt.items : []).map((item: any) => {
          const normal = Number(item.normal_price || 0)
          const staff = Number(item.staff_price || 0) || normal
          const unit = Number(item.unit_price || 0)
          const priceMode: PriceMode =
            staff > 0 && Math.abs(unit - staff) < 0.001 && Math.abs(unit - normal) > 0.001
              ? 'staff'
              : 'normal'
          return {
            product_id: Number(item.product_id),
            name: item.name || `Product #${item.product_id}`,
            quantity: Number(item.quantity || 0),
            unit_price: unit,
            normal_price: normal,
            staff_price: staff,
            priceMode,
          }
        })
      )
    } catch (error) {
      toast.error(`Failed to load sale items: ${error}`)
    } finally {
      setLoadingEdit(false)
    }
  }

  const editItemsTotal = editItems.reduce(
    (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
    0
  )

  const handleSaveSaleDate = async () => {
    if (!editSale?.id || !editDate) return
    const today = toDateInputValue()
    if (editDate > today) {
      toast.error('Sale date cannot be in the future')
      return
    }
    for (const item of editItems) {
      if (!(Number(item.unit_price) >= 0)) {
        toast.error(`Enter a valid staff price for ${item.name}`)
        return
      }
    }
    try {
      setSavingDate(true)
      await invoke('update_sale_details', {
        saleId: editSale.id,
        businessId,
        saleDate: editDate,
        items: editItems.map((item) => ({
          product_id: item.product_id,
          unit_price: Number(item.unit_price),
          quantity: Number(item.quantity),
        })),
      })
      toast.success('Sale date and prices updated')
      setEditSale(null)
      setEditItems([])
      await load()
    } catch (error) {
      toast.error(`Failed to update sale: ${error}`)
    } finally {
      setSavingDate(false)
    }
  }

  const handleView = async (sale: any) => {
    if (!sale?.id) return
    try {
      setViewingId(Number(sale.id))
      const receipt = (await invoke('get_sale_receipt', {
        saleId: sale.id,
        businessId,
      })) as any
      setViewReceipt({
        ...receipt,
        staff_name: receipt.staff_name || sale.staff_name,
        customer_name:
          receipt.customer_name || sale.customer_name || 'Walk-in customer',
      })
    } catch (error) {
      toast.error(`Failed to load sale: ${error}`)
      setViewReceipt(null)
    } finally {
      setViewingId(null)
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

  const filtered = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      String(r.staff_name || '').toLowerCase().includes(q) ||
      String(r.payment_method || '').toLowerCase().includes(q) ||
      String(r.payment_status || '').toLowerCase().includes(q) ||
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
              {ownOnly ? 'Your recent sales.' : 'Recent sales for this business.'}
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

        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by customer, staff, method, status, id…"
          className="w-full mb-4 px-4 py-2.5 rounded-lg border border-[#d4dcd8] bg-white text-sm"
        />

        <div className="md:hidden space-y-3">
          {filtered.map((sale) => (
            <article key={sale.id} className="rounded-xl border border-[#d4dcd8] bg-white p-4">
              <div className="flex justify-between gap-3">
                <p className="font-semibold text-[#121c19]">#{sale.id}</p>
                <p className="font-bold text-[#121c19]">{money(sale.total_amount)}</p>
              </div>
              <p className="text-sm text-[#121c19] mt-1">{saleCustomerName(sale)}</p>
              <p className="text-sm text-[#2a3d36]/60 mt-0.5">{sale.staff_name}</p>
              <p className="text-xs text-[#2a3d36]/45 mt-2">{formatWhen(sale.created_at)}</p>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold px-2 py-1 rounded-md border border-[#d4dcd8] bg-[#f4f6f5]">
                  {sale.payment_method}
                </span>
                <span className="text-xs font-semibold px-2 py-1 rounded-md border border-[#d4dcd8] bg-[#f4f6f5]">
                  {sale.payment_status}
                </span>
                <div className="ml-auto flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => void handleView(sale)}
                    disabled={viewingId === Number(sale.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                  >
                    {viewingId === Number(sale.id) ? 'Loading…' : 'View'}
                  </button>
                  {canEditSaleDate && (
                    <button
                      type="button"
                      onClick={() => openEditDate(sale)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5]"
                    >
                      Edit
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
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="hidden md:block rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
          <table className="min-w-full text-left">
            <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
              <tr>
                <th className="px-5 py-3 font-semibold">Sale</th>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Staff</th>
                <th className="px-5 py-3 font-semibold">Method</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Amount</th>
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ecea]">
              {filtered.map((sale) => (
                <tr key={sale.id} className="hover:bg-[#f4f6f5]/70">
                  <td className="px-5 py-4 font-semibold text-[#121c19]">#{sale.id}</td>
                  <td className="px-5 py-4 text-[#121c19]">{saleCustomerName(sale)}</td>
                  <td className="px-5 py-4 text-[#2a3d36]/70">{sale.staff_name}</td>
                  <td className="px-5 py-4">{sale.payment_method}</td>
                  <td className="px-5 py-4">{sale.payment_status}</td>
                  <td className="px-5 py-4 text-right font-semibold">{money(sale.total_amount)}</td>
                  <td className="px-5 py-4 text-sm text-[#2a3d36]/60 whitespace-nowrap">
                    {formatWhen(sale.created_at)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => void handleView(sale)}
                        disabled={viewingId === Number(sale.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                      >
                        {viewingId === Number(sale.id) ? 'Loading…' : 'View'}
                      </button>
                      {canEditSaleDate && (
                        <button
                          type="button"
                          onClick={() => openEditDate(sale)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5]"
                        >
                          Edit
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-5 py-10 text-center text-[#2a3d36]/50">No sales found</p>
          )}
        </div>
      </div>

      {viewReceipt && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#121c19]/55"
            onClick={() => setViewReceipt(null)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl border border-[#d4dcd8] shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-[#121c19]">
                  Sale #{viewReceipt.id}
                </h2>
                <p className="mt-1 text-sm text-[#2a3d36]/70">
                  {formatWhen(viewReceipt.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewReceipt(null)}
                className="text-sm font-semibold px-3 py-1.5 rounded-md border border-[#d4dcd8] hover:bg-[#f4f6f5]"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                  Customer
                </p>
                <p className="mt-1 font-semibold text-[#121c19]">
                  {saleCustomerName(viewReceipt)}
                </p>
              </div>
              <div className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                  Staff
                </p>
                <p className="mt-1 font-semibold text-[#121c19]">
                  {viewReceipt.staff_name || '—'}
                </p>
              </div>
              <div className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                  Method
                </p>
                <p className="mt-1 font-semibold text-[#121c19]">
                  {viewReceipt.payment_method || '—'}
                </p>
              </div>
              <div className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">
                  Status
                </p>
                <p className="mt-1 font-semibold text-[#121c19]">
                  {viewReceipt.payment_status || '—'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
                Items sold
              </p>
              <div className="rounded-xl border border-[#d4dcd8] overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#f4f6f5] text-[11px] uppercase tracking-wide text-[#2a3d36]/50">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Item</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8ecea]">
                    {(Array.isArray(viewReceipt.items) ? viewReceipt.items : []).map(
                      (item: any, idx: number) => (
                        <tr key={`${item.product_id || idx}-${idx}`}>
                          <td className="px-3 py-3 font-medium text-[#121c19]">
                            {item.name || `Product #${item.product_id || '—'}`}
                          </td>
                          <td className="px-3 py-3 text-right text-[#2a3d36]/80">
                            {Number(item.quantity || 0)}
                          </td>
                          <td className="px-3 py-3 text-right text-[#2a3d36]/80">
                            {money(item.unit_price)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-[#121c19]">
                            {money(item.total_price)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
                {(!viewReceipt.items || viewReceipt.items.length === 0) && (
                  <p className="px-3 py-8 text-center text-[#2a3d36]/50">
                    No line items found for this sale
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#e8ecea] pt-4">
              <p className="text-sm font-semibold text-[#2a3d36]/60">Sale total</p>
              <p className="font-display text-2xl font-bold text-[#121c19]">
                {money(viewReceipt.total_amount)}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setViewReceipt(null)}
                className="flex-1 border border-[#d4dcd8] py-3 rounded-lg font-semibold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handlePrint(viewReceipt)}
                disabled={printingId === Number(viewReceipt.id)}
                className="flex-1 bg-[#121c19] text-white py-3 rounded-lg font-semibold disabled:opacity-50"
              >
                {printingId === Number(viewReceipt.id) ? 'Printing…' : 'Print'}
              </button>
            </div>
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
                className="mt-2 w-full px-4 py-3 rounded-lg border border-[#d4dcd8]"
              />
              <p className="mt-2 text-xs text-[#2a3d36]/50">
                Current: {formatWhen(editSale.created_at)}. Future dates are not allowed.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
                Price type per item
              </p>
              {loadingEdit ? (
                <p className="text-sm text-[#2a3d36]/50 py-4 text-center">Loading items…</p>
              ) : editItems.length === 0 ? (
                <p className="text-sm text-[#2a3d36]/50 py-4 text-center">
                  No line items found for this sale
                </p>
              ) : (
                <div className="space-y-3">
                  {editItems.map((item, idx) => (
                    <div
                      key={`${item.product_id}-${idx}`}
                      className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3"
                    >
                      <div className="flex justify-between gap-2">
                        <p className="font-semibold text-[#121c19] text-sm">{item.name}</p>
                        <p className="text-xs text-[#2a3d36]/50">Qty {item.quantity}</p>
                      </div>
                      <div className="mt-2 inline-flex rounded-md border border-[#d4dcd8] bg-white p-0.5 w-full">
                        {([
                          {
                            id: 'normal' as const,
                            label: 'Normal',
                            amount: Number(item.normal_price || 0),
                          },
                          {
                            id: 'staff' as const,
                            label: 'Staff',
                            amount: Number(item.staff_price || item.normal_price || 0),
                          },
                        ]).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={!(opt.amount > 0)}
                            onClick={() =>
                              setEditItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {
                                        ...row,
                                        priceMode: opt.id,
                                        unit_price: opt.amount,
                                      }
                                    : row
                                )
                              )
                            }
                            className={`flex-1 px-2 py-2 rounded text-xs font-semibold disabled:opacity-40 ${
                              item.priceMode === opt.id
                                ? 'bg-[#121c19] text-white'
                                : 'text-[#2a3d36]/70'
                            }`}
                          >
                            {opt.label}
                            <span className="block mt-0.5 font-bold">
                              {opt.amount > 0 ? money(opt.amount) : '—'}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-[#2a3d36]/50 text-right">
                        Line total{' '}
                        {money(Number(item.unit_price || 0) * Number(item.quantity || 0))}
                      </p>
                    </div>
                  ))}
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
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddDebt, setShowAddDebt] = useState(false)
  const [payTarget, setPayTarget] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) void load()
    else setLoading(false)
  }, [businessId, ownOnly, currentUser?.id])

  const load = async () => {
    try {
      setLoading(true)
      const data = (await invoke('get_debtors', {
        businessId,
        openOnly: true,
        staffId: ownOnly ? currentUser?.id : null,
      })) as any[]
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
    try {
      setSaving(true)
      const updated = (await invoke('record_debt_payment', {
        request: {
          business_id: businessId,
          debt_id: payTarget.id,
          amount: Number(amount),
          staff_id: currentUser?.id,
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
                ? 'Your debt customers and balances from sales you charged on credit.'
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
            <button
              type="button"
              onClick={() => setShowAddDebt(true)}
              className="bg-[#121c19] hover:bg-[#1a2924] text-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              + Add old debt
            </button>
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
              {filtered.map((debt) => (
                <article key={debt.id} className="rounded-xl border border-[#d4dcd8] bg-white p-4">
                  <p className="font-semibold text-[#121c19]">{debt.customer_name}</p>
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
                  <button
                    type="button"
                    onClick={() => setPayTarget(debt)}
                    className="mt-4 w-full bg-[#121c19] text-white py-2.5 rounded-md text-sm font-semibold"
                  >
                    Record payment
                  </button>
                </article>
              ))}
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
                  {filtered.map((debt) => (
                    <tr key={debt.id} className="hover:bg-[#f4f6f5]/70">
                      <td className="px-5 py-4 font-semibold text-[#121c19]">
                        {debt.customer_name}
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
                        <button
                          type="button"
                          onClick={() => setPayTarget(debt)}
                          className="bg-[#121c19] hover:bg-[#1a2924] text-white px-3 py-2 rounded-md text-sm font-semibold"
                        >
                          Record payment
                        </button>
                      </td>
                    </tr>
                  ))}
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

