import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { invoke } from './api'
import { Table } from './components/Table'
import { printReceipt } from './receiptPrint'

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

export function StaffPOSInterface({
  currentUser,
  businessInfo,
}: {
  currentUser: any
  businessInfo: any
}) {
  const [products, setProducts] = useState<any[]>([])
  const [packagingTypes, setPackagingTypes] = useState<string[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [saleLocation, setSaleLocation] = useState<'fridge' | 'show'>('fridge')
  const [packagingFilter, setPackagingFilter] = useState('ALL')
  const businessId = currentUser?.business_id || businessInfo?.id

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
    } catch (error) {
      toast.error(`Failed to load products: ${error}`)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const stockOf = (product: any, location: 'fridge' | 'show' = saleLocation) =>
    location === 'fridge'
      ? Number(product.fridge_stock || 0)
      : Number(product.show_stock || 0)

  const lowThreshold = (product: any) => Math.max(1, Number(product.min_stock_level || 5))

  const notifyLowStock = (list: any[], location: 'fridge' | 'show') => {
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
    toast.error(
      `Low ${location} stock: ${names}${extra}`,
      { duration: 6000, id: `low-stock-${location}` }
    )
  }

  const switchLocation = (loc: 'fridge' | 'show') => {
    if (loc === saleLocation) return
    setSaleLocation(loc)
    // Drop cart lines that can't be fulfilled from the new location
    setCart((prev) => {
      const next = prev
        .map((item) => {
          const available = stockOf(item.product, loc)
          if (available <= 0) return null
          return {
            ...item,
            quantity: Math.min(item.quantity, available),
          }
        })
        .filter(Boolean) as any[]
      if (next.length < prev.length) {
        toast(`Cart updated for ${loc} stock`, { id: 'cart-location-switch' })
      }
      return next
    })
    notifyLowStock(products, loc)
  }

  const addToCart = (product: any) => {
    const stock = stockOf(product)
    if (stock <= 0) {
      toast.error(`${product.name} is out of stock in ${saleLocation}`)
      return
    }
    const existing = cart.find((i) => i.product.id === product.id)
    if (existing) {
      if (existing.quantity + 1 > stock) {
        toast.error(`Only ${stock} left in ${saleLocation}`)
        return
      }
      setCart(
        cart.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      )
    } else {
      setCart([...cart, { product, quantity: 1, unitPrice: Number(product.price || 0) }])
    }
  }

  const updateQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart(cart.filter((i) => i.product.id !== productId))
      return
    }
    const line = cart.find((i) => i.product.id === productId)
    if (line) {
      const available = stockOf(line.product)
      if (quantity > available) {
        toast.error(`Only ${available} left in ${saleLocation}`)
        return
      }
    }
    setCart(cart.map((i) => (i.product.id === productId ? { ...i, quantity } : i)))
  }

  const getTotal = () => cart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  const processPayment = async (paymentMethod: string, customerName?: string) => {
    // Final stock check against selected fridge/show location
    for (const item of cart) {
      const available = stockOf(item.product)
      if (item.quantity > available) {
        toast.error(
          `${item.product.name}: only ${available} in ${saleLocation}. Adjust cart or switch location.`
        )
        return
      }
    }

    setProcessingPayment(true)
    try {
      const result = (await invoke('process_sale', {
        request: {
          items: cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unitPrice,
          })),
          payment_method: paymentMethod,
          staff_id: currentUser?.id,
          business_id: businessId,
          location: saleLocation,
          customer_name: customerName?.trim() || null,
        },
      })) as any

      setCart([])
      setShowPaymentModal(false)
      toast.success(
        `Sale #${result.sale_id} · ${money(result.total_amount)} · ${result.payment_method}${
          result.customer_name ? ` · ${result.customer_name}` : ''
        } · from ${saleLocation}`,
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

  const packagingOptions =
    packagingTypes.length > 0
      ? packagingTypes
      : Array.from(
          new Set(products.map((p) => String(p.packaging || '').trim()).filter(Boolean))
        ).sort()

  // Only sellable items for the active fridge/show location
  const filtered = products.filter((p) => {
    const q = searchQuery.trim().toLowerCase()
    const matchesQ =
      !q ||
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.packaging || '').toLowerCase().includes(q)
    const matchesPack =
      packagingFilter === 'ALL' ||
      String(p.packaging || '').toLowerCase() === packagingFilter.toLowerCase()
    const isBar = String(p.category || 'BAR').toUpperCase() === 'BAR'
    const inStock = stockOf(p) > 0
    return matchesQ && matchesPack && isBar && inStock
  })

  const outHiddenCount = products.filter((p) => {
    const isBar = String(p.category || 'BAR').toUpperCase() === 'BAR'
    return isBar && stockOf(p) <= 0
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
        <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-1">
              Floor
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#121c19]">
              Point of sale
            </h1>
            <p className="mt-1 text-sm text-[#2a3d36]/60">
              Selling from <span className="font-semibold text-[#121c19]">{saleLocation}</span>
              {outHiddenCount > 0
                ? ` · ${outHiddenCount} out-of-stock hidden`
                : ' · only in-stock items shown'}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[#d4dcd8] bg-white p-1">
            {(['fridge', 'show'] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => switchLocation(loc)}
                className={`px-4 py-2 rounded-md text-sm font-semibold capitalize ${
                  saleLocation === loc
                    ? 'bg-[#121c19] text-white'
                    : 'text-[#2a3d36]/70 hover:text-[#121c19]'
                }`}
              >
                {loc}
              </button>
            ))}
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
                <option value="ALL">All types</option>
                {packagingOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
                <p className="font-display text-xl font-bold text-[#121c19]">
                  No stock in {saleLocation}
                </p>
                <p className="mt-1 text-sm text-[#2a3d36]/55">
                  Switch to {saleLocation === 'fridge' ? 'show' : 'fridge'} or restock this location.
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
                      </p>
                      <div className="mt-3 flex items-end justify-between gap-2">
                        <p className="font-display text-lg font-bold text-[#121c19]">
                          {money(product.price)}
                        </p>
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-md border ${
                            low
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-teal-50 text-teal-800 border-teal-200'
                          }`}
                        >
                          {stock} in {saleLocation}
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
                  <p className="text-sm text-[#2a3d36]/50 mt-1">Tap a product to add it</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="rounded-lg border border-[#e8ecea] bg-[#f4f6f5] p-3"
                    >
                      <div className="flex justify-between gap-2">
                        <p className="font-semibold text-[#121c19] text-sm">
                          {item.product.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, 0)}
                          className="text-[#2a3d36]/40 hover:text-rose-600 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                      <p className="text-xs text-[#2a3d36]/50 mt-0.5">
                        {money(item.unitPrice)} each
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="inline-flex items-center rounded-md border border-[#d4dcd8] bg-white">
                          <button
                            type="button"
                            className="px-3 py-1 font-bold"
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                          >
                            −
                          </button>
                          <span className="px-2 text-sm font-semibold min-w-[1.5rem] text-center">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="px-3 py-1 font-bold"
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                        <p className="font-semibold text-[#121c19]">
                          {money(item.unitPrice * item.quantity)}
                        </p>
                      </div>
                    </div>
                  ))}
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
  onPayment: (method: string, customerName?: string) => void
  onClose: () => void
  processing: boolean
}) {
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [customerPaid, setCustomerPaid] = useState('')
  const [customerName, setCustomerName] = useState('')
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
    onPayment(paymentMethod, customerName.trim() || undefined)
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
  const businessId = currentUser?.business_id || businessInfo?.id

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
                <button
                  type="button"
                  onClick={() => void handlePrint(sale)}
                  disabled={printingId === Number(sale.id)}
                  className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                >
                  {printingId === Number(sale.id) ? 'Printing…' : 'Print'}
                </button>
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
                <th className="px-5 py-3 font-semibold text-right">Print</th>
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
                    <button
                      type="button"
                      onClick={() => void handlePrint(sale)}
                      disabled={printingId === Number(sale.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#121c19]/20 hover:bg-[#f4f6f5] disabled:opacity-50"
                    >
                      {printingId === Number(sale.id) ? 'Printing…' : 'Print'}
                    </button>
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

