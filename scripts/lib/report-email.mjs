function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function linesTable(title, lines, total, accent) {
  const rows =
    !lines.length
      ? `<tr><td colspan="3" style="padding:10px 12px;color:#6b7280;border-bottom:1px solid #e8ecea;">No ${escapeHtml(title.toLowerCase())} in this period.</td></tr>`
      : lines
          .map(
            (l) => `<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e8ecea;">${escapeHtml(l.name)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e8ecea;text-align:right;">${l.qty}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e8ecea;text-align:right;font-weight:600;">${naira(l.amount)}</td>
            </tr>`
          )
          .join('')
  return `
    <h3 style="margin:24px 0 8px;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">${escapeHtml(title)}</h3>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e8ecea;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f4f6f5;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#2a3d36;">Product</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#2a3d36;">Qty</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#2a3d36;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td style="padding:12px;font-weight:700;" colspan="2">${escapeHtml(title)} total</td>
          <td style="padding:12px;text-align:right;font-weight:700;">${naira(total)}</td>
        </tr>
      </tfoot>
    </table>`
}

export function isStaffPricedLine(unitPrice, normalPrice, staffPrice) {
  const unit = Number(unitPrice || 0)
  const staff = Number(staffPrice || 0)
  const normal = Number(normalPrice || 0)
  if (!(staff > 0)) return false
  if (Math.abs(staff - normal) < 0.009) return false
  return Math.abs(unit - staff) <= 0.05
}

export function buildSalesReportHtml(p) {
  const color =
    p.primaryColor && /^#?[0-9a-fA-F]{3,8}$/.test(p.primaryColor)
      ? p.primaryColor.startsWith('#')
        ? p.primaryColor
        : `#${p.primaryColor}`
      : '#121c19'
  const grand = p.normal.total + p.staff.total
  const reminder = p.reminder
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;padding:14px 16px;border-radius:8px;margin:0 0 20px;">
        <p style="margin:0;font-size:14px;color:#9a3412;font-weight:700;">Sync the desktop till</p>
        <p style="margin:6px 0 0;font-size:13px;color:#9a3412;">Open POS on the shop PC → <strong>Sync now</strong> so yesterday’s offline sales are in this report.</p>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:Georgia,Times,serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:${color};color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;">
      <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.75;">POS report</p>
      <h1 style="margin:8px 0 0;font-size:22px;">${escapeHtml(p.businessName)}</h1>
      ${p.businessAddress ? `<p style="margin:6px 0 0;font-size:13px;opacity:0.85;">${escapeHtml(p.businessAddress)}</p>` : ''}
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e8ecea;border-top:0;border-radius:0 0 12px 12px;">
      ${reminder}
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#c4783a;">${p.kind === 'weekly' ? 'Weekly sales' : 'Yesterday’s sales'}</p>
      <p style="margin:0 0 20px;font-size:16px;color:#121c19;">${escapeHtml(p.periodLabel)}</p>
      <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin-bottom:8px;">
        <tr>
          <td style="background:#f4f6f5;padding:14px;border-radius:8px;width:25%;">
            <p style="margin:0;font-size:11px;color:#6b7280;">Sales</p>
            <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#121c19;">${p.salesCount}</p>
          </td>
          <td style="background:#f4f6f5;padding:14px;border-radius:8px;width:25%;">
            <p style="margin:0;font-size:11px;color:#6b7280;">Normal</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#121c19;">${naira(p.normal.total)}</p>
          </td>
          <td style="background:#fff7ed;padding:14px;border-radius:8px;width:25%;">
            <p style="margin:0;font-size:11px;color:#c4783a;">Staff price</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#9a3412;">${naira(p.staff.total)}</p>
          </td>
          <td style="background:${color};padding:14px;border-radius:8px;width:25%;color:#fff;">
            <p style="margin:0;font-size:11px;opacity:0.8;">Grand total</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;">${naira(grand)}</p>
          </td>
        </tr>
      </table>
      ${linesTable('Normal price', p.normal.lines, p.normal.total, color)}
      ${linesTable('Staff price', p.staff.lines, p.staff.total, '#c4783a')}
      <p style="margin:28px 0 0;font-size:11px;color:#9aa5a0;">Automated from your POS. Staff price is a separate line so it does not mix with walk-in totals.</p>
    </div>
  </div>
</body>
</html>`
}
