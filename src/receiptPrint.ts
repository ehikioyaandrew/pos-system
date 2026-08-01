export type ReceiptItem = {
  name: string
  quantity: number
  unit_price: number
  total_price: number
}

export type ReceiptData = {
  id: number | string
  created_at?: string | null
  total_amount: number
  payment_method?: string | null
  payment_status?: string | null
  staff_name?: string | null
  customer_name?: string | null
  location?: string | null
  business_name?: string | null
  business_address?: string | null
  business_phone?: string | null
  items: ReceiptItem[]
}

function money(n: number) {
  return `₦${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function buildReceiptHtml(data: ReceiptData) {
  const itemsHtml =
    data.items.length > 0
      ? data.items
          .map(
            (item) => `
      <tr>
        <td class="item">
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="meta">${escapeHtml(item.quantity)} × ${escapeHtml(money(item.unit_price))}</div>
        </td>
        <td class="amount">${escapeHtml(money(item.total_price))}</td>
      </tr>`
          )
          .join('')
      : `<tr><td class="item"><div class="name">Sale total</div></td><td class="amount">${escapeHtml(money(data.total_amount))}</td></tr>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt #${escapeHtml(data.id)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: #fff;
      color: #111;
      font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
    }
    body { padding: 8px; }
    .ticket {
      width: 72mm;
      max-width: 100%;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .biz {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.02em;
      margin-bottom: 4px;
    }
    .muted { color: #333; font-size: 11px; }
    .title {
      margin: 10px 0 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .rule {
      border: none;
      border-top: 1px dashed #222;
      margin: 8px 0;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
    }
    .meta-row span:first-child { color: #444; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 2px;
    }
    td { vertical-align: top; padding: 4px 0; }
    td.amount { text-align: right; white-space: nowrap; font-weight: 600; }
    .name { font-weight: 600; }
    .meta { color: #444; font-size: 11px; margin-top: 1px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 14px;
      font-weight: 700;
      margin-top: 2px;
    }
    .thanks {
      margin-top: 12px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
    }
    .thanks-sub {
      margin-top: 3px;
      text-align: center;
      font-size: 11px;
      color: #333;
    }
    @media print {
      @page { margin: 4mm; size: auto; }
      html, body { background: #fff; }
      body { padding: 0; }
      .ticket { width: 72mm; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center biz">${escapeHtml(data.business_name || 'POS System')}</div>
    ${data.business_address ? `<div class="center muted">${escapeHtml(data.business_address)}</div>` : ''}
    ${data.business_phone ? `<div class="center muted">${escapeHtml(data.business_phone)}</div>` : ''}
    <div class="center title">Sales receipt</div>
    <hr class="rule" />
    <div class="meta-row"><span>Sale</span><strong>#${escapeHtml(data.id)}</strong></div>
    <div class="meta-row"><span>Date</span><span>${escapeHtml(formatWhen(data.created_at))}</span></div>
    <div class="meta-row"><span>Customer</span><span>${escapeHtml(String(data.customer_name || '').trim() || 'Walk-in customer')}</span></div>
    <div class="meta-row"><span>Staff</span><span>${escapeHtml(data.staff_name || '—')}</span></div>
    <div class="meta-row"><span>Payment</span><span>${escapeHtml(data.payment_method || '—')}</span></div>
    <div class="meta-row"><span>Status</span><span>${escapeHtml(data.payment_status || '—')}</span></div>
    ${data.location ? `<div class="meta-row"><span>Location</span><span>${escapeHtml(data.location)}</span></div>` : ''}
    <hr class="rule" />
    <table>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <hr class="rule" />
    <div class="total-row">
      <span>TOTAL</span>
      <span>${escapeHtml(money(data.total_amount))}</span>
    </div>
    <div class="thanks">Thanks for coming!</div>
    <div class="thanks-sub">We hope to see you again.</div>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 50);
    };
  </script>
</body>
</html>`
}

/** Opens a dedicated print document so the SPA page does not print blank. */
export function printReceipt(data: ReceiptData) {
  const html = buildReceiptHtml(data)
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=420,height=720')

  if (printWindow) {
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    return
  }

  // Popup blocked: fall back to a hidden iframe
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    throw new Error('Unable to open print dialog. Allow popups and try again.')
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1000)
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      cleanup()
    }
  }
}
