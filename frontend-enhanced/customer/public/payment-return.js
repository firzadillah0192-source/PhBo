const order = new URLSearchParams(location.search).get('order_id')
const status = document.getElementById('status'), details = document.getElementById('details'), button = document.getElementById('check'), error = document.getElementById('error')
async function api(path, method = 'GET') {
  const response = await fetch('/api/account/topups' + path, { method, credentials: 'same-origin', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok) throw new Error(response.status === 401 ? 'Silakan sign in di NXBooth, kemudian buka kembali halaman ini.' : body.detail?.message || 'Status pembayaran belum tersedia.')
  return body
}
function show(row) {
  status.textContent = row.status === 'PAID' ? 'Pembayaran Sandbox terverifikasi. Kredit uji tercatat.' : 'Status server: ' + row.status
  details.replaceChildren()
  for (const [key, value] of [['Pesanan', row.merchant_order_id], ['Nominal uji', new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(row.amount_rupiah)], ['Kredit uji', row.credits], ['Referensi', row.reference || 'Belum tersedia']]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = String(value); details.append(dt, dd)
  }
  button.hidden = row.status === 'PAID'
}
button.addEventListener('click', async () => {
  button.disabled = true; error.textContent = ''
  try { show(await api('/' + order + '/refresh', 'POST')) } catch (e) { error.textContent = e.message }
  finally { button.disabled = false }
})
if (!/^[a-f0-9]{32}$/.test(order || '')) status.textContent = 'ID pesanan tidak valid.'
else {
  try { show(await api('/' + order)) } catch (e) { status.textContent = 'Status belum tersedia.'; error.textContent = e.message }
}
