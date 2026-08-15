/** Shared HTML for daily/weekly sales emails (web preview + GitHub sender). */

export type ReportLine = {
  name: string
  qty: number
  amount: number
}

export type StockLine = {
  name: string
  sold?: number
  left?: number
  before?: number
  min?: number
}

export type SalesEmailPayload = {
  businessName: string
  businessAddress?: string | null
  primaryColor?: string | null
  periodLabel: string
  kind: 'daily' | 'weekly'
  reminder?: boolean
  salesCount: number
  normal: { total: number; lines: ReportLine[] }
  staff: { total: number; lines: ReportLine[] }
  sold?: StockLine[]
  outOfStock?: StockLine[]
  lowStock?: StockLine[]
}

function naira(n: number) {
  return `₦${Number(n || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function brandColor(raw?: string | null) {
  if (raw && /^#?[0-9a-fA-F]{3,8}$/.test(raw)) {
    return raw.startsWith('#') ? raw : `#${raw}`
  }
  return '#1a3a34'
}

function linesTable(title: string, lines: ReportLine[], total: number) {
  const rows =
    lines.length === 0
      ? `<tr><td colspan="3" class="muted" style="padding:16px 0;">None in this period</td></tr>`
      : lines
          .map(
            (l) => `<tr>
              <td class="cell-name" style="padding:14px 12px 14px 0;border-bottom:1px solid #e7e2d9;">${escapeHtml(l.name)}</td>
              <td class="cell-qty" style="padding:14px 12px;border-bottom:1px solid #e7e2d9;text-align:right;white-space:nowrap;">${l.qty}</td>
              <td class="cell-amt" style="padding:14px 0 14px 12px;border-bottom:1px solid #e7e2d9;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${naira(l.amount)}</td>
            </tr>`
          )
          .join('')
  return `
    <p class="section-label" style="margin:36px 0 12px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6f7c76;">${escapeHtml(title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr>
          <th align="left" style="padding:0 12px 10px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a938e;border-bottom:2px solid #1a3a34;">Product</th>
          <th align="right" style="padding:0 12px 10px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a938e;border-bottom:2px solid #1a3a34;">Qty</th>
          <th align="right" style="padding:0 0 10px 12px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a938e;border-bottom:2px solid #1a3a34;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:16px 12px 0 0;font-weight:700;color:#1c1917;">${escapeHtml(title)} total</td>
          <td style="padding:16px 0 0 12px;text-align:right;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;color:#1c1917;">${naira(total)}</td>
        </tr>
      </tfoot>
    </table>`
}

function simpleTable(title: string, headers: string[], rows: string[][]) {
  const head = headers
    .map(
      (h, i) =>
        `<th align="${i === 0 ? 'left' : 'right'}" style="padding:0 ${i === headers.length - 1 ? '0' : '12px'} 10px ${i === 0 ? '0' : '12px'};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a938e;border-bottom:2px solid #1a3a34;">${escapeHtml(h)}</th>`
    )
    .join('')
  const body =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="muted" style="padding:16px 0;">None</td></tr>`
      : rows
          .map(
            (cols) =>
              `<tr>${cols
                .map(
                  (c, i) =>
                    `<td class="cell-name" style="padding:14px ${i === cols.length - 1 ? '0' : '12px'} 14px ${i === 0 ? '0' : '12px'};border-bottom:1px solid #e7e2d9;${i ? 'text-align:right;white-space:nowrap;' : ''}">${c}</td>`
                )
                .join('')}</tr>`
          )
          .join('')
  return `
    <p class="section-label" style="margin:36px 0 12px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6f7c76;">${escapeHtml(title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

export function buildSalesReportHtml(p: SalesEmailPayload): string {
  const color = brandColor(p.primaryColor)
  const grand = p.normal.total + p.staff.total
  const kindLabel = p.kind === 'weekly' ? 'Weekly sales' : 'Yesterday’s sales'
  const reminder = p.reminder
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        <tr>
          <td class="reminder" style="padding:16px 0 16px 16px;border-left:3px solid ${color};">
            <p style="margin:0;font-size:13px;line-height:1.55;color:#3f4a46;">
              <strong style="color:#1c1917;">Sync the till before you rely on these numbers.</strong><br>
              On the shop PC open POS → <strong>Sync now</strong> so yesterday’s offline sales are included.
            </p>
          </td>
        </tr>
      </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      .page { background: #0e1412 !important; }
      .card { background: #161d1b !important; border-color: #2a3531 !important; }
      .ink, .kpi-val, .foot-note, tfoot td { color: #f3eee8 !important; }
      .muted, .section-label, th { color: #9aa8a2 !important; }
      .reminder { border-left-color: #c4b5a0 !important; }
      .reminder p, .reminder strong { color: #d7ddd9 !important; }
      .cell-name, .cell-qty, .cell-amt { color: #ece7e1 !important; border-bottom-color: #2a3531 !important; }
      .rule { border-color: #2a3531 !important; }
    }
  </style>
</head>
<body class="page" style="margin:0;padding:0;background:#efece6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#fffcf8;border:1px solid #e4ddd3;border-radius:4px;">
      <tr>
        <td style="background:${color};padding:28px 28px 24px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#ffffff;opacity:0.7;">POS report</p>
          <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:600;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(p.businessName)}</h1>
          ${p.businessAddress ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:#ffffff;opacity:0.78;">${escapeHtml(p.businessAddress)}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 32px;">
          ${reminder}
          <p class="section-label" style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6f7c76;">${kindLabel}</p>
          <p class="ink" style="margin:8px 0 0;font-size:20px;color:#1c1917;">${escapeHtml(p.periodLabel)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;border-collapse:collapse;">
            <tr>
              <td class="muted" style="padding:14px 16px 14px 0;border-bottom:1px solid #e7e2d9;font-size:14px;color:#5c6662;">Sales</td>
              <td class="kpi-val" style="padding:14px 0;border-bottom:1px solid #e7e2d9;text-align:right;font-size:18px;font-weight:650;color:#1c1917;white-space:nowrap;font-variant-numeric:tabular-nums;">${p.salesCount}</td>
            </tr>
            <tr>
              <td class="muted" style="padding:14px 16px 14px 0;border-bottom:1px solid #e7e2d9;font-size:14px;color:#5c6662;">Normal price</td>
              <td class="kpi-val" style="padding:14px 0;border-bottom:1px solid #e7e2d9;text-align:right;font-size:18px;font-weight:650;color:#1c1917;white-space:nowrap;font-variant-numeric:tabular-nums;">${naira(p.normal.total)}</td>
            </tr>
            <tr>
              <td class="muted" style="padding:14px 16px 14px 0;border-bottom:1px solid #e7e2d9;font-size:14px;color:#5c6662;">Staff price</td>
              <td class="kpi-val" style="padding:14px 0;border-bottom:1px solid #e7e2d9;text-align:right;font-size:18px;font-weight:650;color:#1c1917;white-space:nowrap;font-variant-numeric:tabular-nums;">${naira(p.staff.total)}</td>
            </tr>
            <tr>
              <td class="ink" style="padding:18px 16px 6px 0;font-size:15px;font-weight:700;color:#1c1917;">Grand total</td>
              <td class="kpi-val" style="padding:18px 0 6px;text-align:right;font-size:26px;font-weight:700;color:#1c1917;white-space:nowrap;font-variant-numeric:tabular-nums;">${naira(grand)}</td>
            </tr>
          </table>

          ${linesTable('Normal price', p.normal.lines, p.normal.total)}
          ${linesTable('Staff price', p.staff.lines, p.staff.total)}
          ${simpleTable(
            'Items sold',
            ['Product', 'Before', 'Sold', 'Left'],
            (p.sold || []).map((r) => {
              const sold = Number(r.sold ?? 0)
              const left = Number(r.left ?? 0)
              const before = Number(r.before ?? left + sold)
              return [escapeHtml(r.name), String(before), String(sold), String(left)]
            })
          )}

          <p class="foot-note muted" style="margin:36px 0 0;font-size:12px;line-height:1.5;color:#8a938e;">Before = stock at start of the day (left now + sold). Staff price is listed separately. Automated POS report.</p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`
}

export function isStaffPricedLine(
  unitPrice: number,
  normalPrice: number,
  staffPrice: number
): boolean {
  const unit = Number(unitPrice || 0)
  const staff = Number(staffPrice || 0)
  const normal = Number(normalPrice || 0)
  if (!(staff > 0)) return false
  if (Math.abs(staff - normal) < 0.009) return false
  return Math.abs(unit - staff) <= 0.05
}

export function buildStockAlertHtml(p: {
  businessName: string
  businessAddress?: string | null
  primaryColor?: string | null
  periodLabel: string
  outOfStock?: StockLine[]
  lowStock?: StockLine[]
}): string {
  const color = brandColor(p.primaryColor)
  const out = p.outOfStock || []
  const low = p.lowStock || []
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      .page { background: #0e1412 !important; }
      .card { background: #161d1b !important; border-color: #2a3531 !important; }
      .ink, tfoot td { color: #f3eee8 !important; }
      .muted, .section-label, th { color: #9aa8a2 !important; }
      .cell-name { color: #ece7e1 !important; border-bottom-color: #2a3531 !important; }
    }
  </style>
</head>
<body class="page" style="margin:0;padding:0;background:#efece6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#fffcf8;border:1px solid #e4ddd3;border-radius:4px;">
      <tr>
        <td style="background:${color};padding:28px 28px 24px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#ffffff;opacity:0.7;">Stock alert</p>
          <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:600;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(p.businessName)}</h1>
          ${p.businessAddress ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:#ffffff;opacity:0.78;">${escapeHtml(p.businessAddress)}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 32px;">
          <p class="section-label" style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6f7c76;">Out of stock today</p>
          <p class="ink" style="margin:8px 0 0;font-size:20px;color:#1c1917;">${escapeHtml(p.periodLabel)}</p>
          <p class="muted" style="margin:12px 0 0;font-size:14px;color:#5c6662;">${out.length} product${out.length === 1 ? '' : 's'} with zero fridge + show + store.</p>
          ${simpleTable(
            'Out of stock',
            ['Product'],
            out.map((r) => [escapeHtml(r.name)])
          )}
          ${simpleTable(
            'Low stock (still some left)',
            ['Product', 'Left', 'Min'],
            low.map((r) => [escapeHtml(r.name), String(r.left ?? 0), String(r.min ?? 0)])
          )}
          <p class="muted" style="margin:36px 0 0;font-size:12px;line-height:1.5;color:#8a938e;">Restock these before the next shift. Automated POS alert.</p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`
}
