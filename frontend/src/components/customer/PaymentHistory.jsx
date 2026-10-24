import React, { useEffect, useState } from 'react'
import { getTopUpPayments, refreshTopUpPayment } from '../../api.js'
import { formatRupiah } from '../../creditCatalog.js'
import { useT } from '../../i18n.js'

const STATUS = {
  PAID: ['Lunas', 'Paid', 'paid'],
  PENDING: ['Menunggu', 'Pending', 'pending'],
  FAILED: ['Gagal', 'Failed', 'failed'],
  EXPIRED: ['Kedaluwarsa', 'Expired', 'failed'],
  CANCELLED: ['Dibatalkan', 'Cancelled', 'failed'],
}

export default function PaymentHistory() {
  const t = useT()
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(null), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setData(null)
    getTopUpPayments({ page, page_size: 10 }).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e.message || t('Riwayat pembayaran belum dapat dimuat.', 'Payment history could not be loaded.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [page, revision])
  const product = row => row.product_kind === 'subscription' ? t(`Paket ${row.product_code} (simulasi)`, `${row.product_code} plan (simulated)`) : t(`${row.credits} kredit uji${row.policy_version === 2 ? ' AI' : ''}`, `${row.credits} test ${row.policy_version === 2 ? 'AI ' : ''}credits`)
  const status = value => { const [id, en, tone] = STATUS[value] || [value, value, 'pending']; return <span className={`payment-status is-${tone}`}>{t(id, en)}</span> }
  return <section aria-label={t('Riwayat pembayaran Sandbox', 'Sandbox payment history')} aria-busy={loading} className="account-panel payment-history">
    <div className="account-panel-heading"><div><h2>{t('Riwayat pembayaran Sandbox', 'Sandbox payment history')}</h2><p>{t('Pesanan isi kredit Anda dan statusnya.', 'Your credit orders and their status.')}</p></div><button className="account-outline-button" type="button" disabled={loading || !!busy} onClick={() => setRevision(v => v + 1)}>{t('Muat ulang riwayat', 'Reload history')}</button></div>
    {loading && <p role="status">{t('Memuat riwayat pembayaran…', 'Loading payment history…')}</p>}
    {data && data.sandbox_balance != null && !data.transactions.some(row => row.policy_version === 2) && <p><strong>{t(`Saldo uji: ${data.sandbox_balance} kredit`, `Test balance: ${data.sandbox_balance} credits`)}</strong></p>}
    {new URLSearchParams(window.location.search).has('order_id') && <p role="status">{t('Anda kembali dari checkout. Status berikut berasal dari server; jika masih menunggu, tekan Cek pembayaran.', 'You are back from checkout. The status below comes from the server; if it is still pending, press Check payment.')}</p>}
    {error && <p className="payment-error" role="alert">{error}</p>}
    {data && data.transactions.length > 0 && <div className="payment-table-wrap"><table className="payment-table">
      <thead><tr><th scope="col">{t('Pesanan', 'Order')}</th><th scope="col">{t('Produk', 'Product')}</th><th scope="col">{t('Jumlah', 'Amount')}</th><th scope="col">{t('Status', 'Status')}</th><th scope="col"><span className="sr-only">{t('Aksi', 'Action')}</span></th></tr></thead>
      <tbody>{data.transactions.map(row => <tr key={row.id}>
        <td data-label={t('Pesanan', 'Order')}><code>{row.merchant_order_id}</code></td>
        <td data-label={t('Produk', 'Product')}>{product(row)}</td>
        <td data-label={t('Jumlah', 'Amount')}>{formatRupiah(row.amount_rupiah)}</td>
        <td data-label={t('Status', 'Status')}>{status(row.status)}</td>
        <td>{row.status !== 'PAID' && <button type="button" className="account-outline-button" disabled={!!busy} onClick={async () => {
          setBusy(row.id); setError('')
          try { await refreshTopUpPayment(row.id); setRevision(v => v + 1) } catch (e) { setError(e.message) } finally { setBusy(null) }
        }}>{busy === row.id ? t('Memeriksa…', 'Checking…') : t('Cek pembayaran', 'Check payment')}</button>}</td>
      </tr>)}</tbody>
    </table></div>}
    {data && !data.transactions.length && <div className="account-empty"><strong>{t('Belum ada transaksi Sandbox.', 'No Sandbox transactions yet.')}</strong></div>}
    {data && data.total > 10 && <nav className="payment-pages" aria-label={t('Halaman riwayat', 'History pages')}><button type="button" className="account-outline-button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('Sebelumnya', 'Previous')}</button><span>{t('Halaman', 'Page')} {page}</span><button type="button" className="account-outline-button" disabled={page * 10 >= data.total} onClick={() => setPage(p => p + 1)}>{t('Berikutnya', 'Next')}</button></nav>}
  </section>
}
