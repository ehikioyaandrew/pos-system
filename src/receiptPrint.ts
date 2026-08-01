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

function metaRow(label: string, value: string) {
  return `<tr>
    <td class="label">${escapeHtml(label)}</td>
    <td class="value">${escapeHtml(value)}</td>
  </tr>`
}

function buildReceiptHtml(data: ReceiptData) {
  const customer =
    String(data.customer_name || '').trim() || 'Walk-in customer'

  const itemsHtml =
    data.items.length > 0
      ? data.items
          .map(
            (item) => `
      <tr>
        <td class="item">
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="qty">${escapeHtml(item.quantity)} x ${escapeHtml(money(item.unit_price))}</div>
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
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { padding: 6px; }
    .ticket {
      width: 280px;
      max-width: 100%;
      margin: 0 auto;
      color: #000000;
      background: #ffffff;
    }
    .center { text-align: center; }
    .biz {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .muted { font-size: 11px; color: #000000; }
    .title {
      margin: 8px 0 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .rule {
      border: none;
      border-top: 1px dashed #000000;
      margin: 6px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      vertical-align: top;
      padding: 2px 0;
      color: #000000;
    }
    td.label { width: 38%; color: #000000; }
    td.value { text-align: right; font-weight: 700; }
    td.amount { text-align: right; white-space: nowrap; font-weight: 700; width: 34%; }
    .name { font-weight: 700; }
    .qty { font-size: 11px; margin-top: 1px; }
    .total-table td {
      font-size: 14px;
      font-weight: 700;
      padding-top: 4px;
    }
    .thanks {
      margin-top: 10px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }
    .thanks-sub {
      margin-top: 2px;
      text-align: center;
      font-size: 11px;
    }
    @media print {
      @page {
        margin: 0;
        size: auto;
      }
      html, body {
        background: #ffffff !important;
        color: #000000 !important;
      }
      body { padding: 0 !important; margin: 0 !important; }
      .ticket {
        width: 100% !important;
        max-width: 80mm !important;
        margin: 0 !important;
      }
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
    <table>
      <tbody>
        ${metaRow('Sale', `#${data.id}`)}
        ${metaRow('Date', formatWhen(data.created_at))}
        ${metaRow('Customer', customer)}
        ${metaRow('Staff', data.staff_name || '—')}
        ${metaRow('Payment', data.payment_method || '—')}
        ${metaRow('Status', data.payment_status || '—')}
        ${data.location ? metaRow('Location', String(data.location)) : ''}
      </tbody>
    </table>
    <hr class="rule" />
    <table>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <hr class="rule" />
    <table class="total-table">
      <tbody>
        <tr>
          <td>TOTAL</td>
          <td class="amount">${escapeHtml(money(data.total_amount))}</td>
        </tr>
      </tbody>
    </table>
    <div class="thanks">Thanks for coming!</div>
    <div class="thanks-sub">We hope to see you again.</div>
  </div>
  <script>
    function runPrint() {
      try { window.focus(); } catch (e) {}
      window.print();
    }
    window.addEventListener('afterprint', function () {
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 200);
    });
    if (document.readyState === 'complete') {
      setTimeout(runPrint, 250);
    } else {
      window.addEventListener('load', function () {
        setTimeout(runPrint, 250);
      });
    }
  </script>
</body>
</html>`
}

function printViaIframe(html: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Print receipt')
  // Real size off-screen — 0x0 iframes often preview OK but print blank on thermal printers
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '400px'
  iframe.style.height = '800px'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = iframe.contentDocument || win?.document
  if (!win || !doc) {
    document.body.removeChild(iframe)
    throw new Error('Unable to open print dialog. Allow popups and try again.')
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1500)
  }

  const doPrint = () => {
    try {
      win.focus()
      win.print()
    } finally {
      cleanup()
    }
  }

  // document.write may not fire onload reliably — wait briefly then print
  setTimeout(doPrint, 300)
}

/** Opens a dedicated print document so the SPA page does not print blank. */
export function printReceipt(data: ReceiptData) {
  const html = buildReceiptHtml(data)

  // Do NOT use noopener — it makes window.open() return null in Chrome,
  // forcing a tiny iframe path that often prints blank on receipt printers.
  const printWindow = window.open('', '_blank', 'width=420,height=720')

  if (!printWindow) {
    printViaIframe(html)
    return
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}
