/** Background swimming session timers — does not block the UI. */

export type SwimmingTimer = {
  id: string
  saleId?: number | string
  customerName: string
  hours: number
  startedAt: number
  endsAt: number
}

type Listener = (timers: SwimmingTimer[]) => void

const STORAGE_KEY = 'pos_swimming_timers'
const DEFAULT_HOURS = 2
const listeners = new Set<Listener>()
let timers: SwimmingTimer[] = load()
let tickHandle: ReturnType<typeof setInterval> | null = null
const notified = new Set<string>()

function load(): SwimmingTimer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
  } catch {
    // ignore
  }
}

function emit() {
  const snapshot = [...timers]
  listeners.forEach((fn) => {
    try {
      fn(snapshot)
    } catch {
      // ignore
    }
  })
}

function ensureTicking() {
  if (tickHandle != null) return
  tickHandle = setInterval(() => {
    const now = Date.now()
    let changed = false
    for (const t of timers) {
      if (now >= t.endsAt && !notified.has(t.id)) {
        notified.add(t.id)
        changed = true
        try {
          window.dispatchEvent(
            new CustomEvent('pos-swimming-time-up', {
              detail: {
                id: t.id,
                customerName: t.customerName,
                saleId: t.saleId,
                hours: t.hours,
              },
            })
          )
        } catch {
          // ignore
        }
      }
    }
    const before = timers.length
    timers = timers.filter((t) => now < t.endsAt + 60_000)
    if (timers.length !== before) {
      save()
      changed = true
    }
    if (changed) emit()
    if (timers.length === 0 && tickHandle != null) {
      clearInterval(tickHandle)
      tickHandle = null
    } else {
      emit()
    }
  }, 1000)
}

export function subscribeSwimmingTimers(listener: Listener) {
  listeners.add(listener)
  listener([...timers])
  if (timers.length) ensureTicking()
  return () => {
    listeners.delete(listener)
  }
}

export function getSwimmingTimers() {
  return [...timers]
}

export function startSwimmingTimer(opts: {
  saleId?: number | string
  customerName?: string | null
  hours?: number | null
}) {
  const hours = Math.max(0.25, Number(opts.hours) || DEFAULT_HOURS)
  const id = `swim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const startedAt = Date.now()
  const timer: SwimmingTimer = {
    id,
    saleId: opts.saleId,
    customerName: String(opts.customerName || 'Walk-in customer').trim() || 'Walk-in customer',
    hours,
    startedAt,
    endsAt: startedAt + hours * 60 * 60 * 1000,
  }
  timers = [timer, ...timers]
  save()
  ensureTicking()
  emit()
  return timer
}

export function dismissSwimmingTimer(id: string) {
  timers = timers.filter((t) => t.id !== id)
  notified.delete(id)
  save()
  emit()
}

export function formatRemaining(endsAt: number, now = Date.now()) {
  const ms = Math.max(0, endsAt - now)
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
