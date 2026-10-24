import React, { useEffect, useState } from 'react'
import { clearAdminReadCache, getAdminPayments, getAdminPaymentConfig, getAdminPayment, refreshAdminPayment } from '../../api.js'
import { formatRupiah } from '../../creditCatalog.js'
const date = value => value ? new Date(value).toLocaleString('id-ID') : '—'
export default function PaymentsPanel() {
  const [config, setConfig] = useState(null), [data, setData] = useState(null), [detail, setDetail] = useState(null)
  const [status, setStatus] = useState(''), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; getAdminPaymentConfig().then(value => { if (active) setConfig(value) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [])
  useEffect(() => {
    if (!config?.enabled) return
    let active = true; setError(''); setData(null)
    getAdminPayments({ status, search: query, page, page_size: 25 }).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [config, status, query, page, revision])
  const check = async () => {
    setBusy(true); setError('')
    try { const value = await refreshAdminPayment(detail.id); setDetail(value); setRevision(v => v + 1) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <section>
    <div className="admin-section-head"><div><h2>Payments</h2><p className="admin-muted">Duitku Sandbox · transaksi uji, bukan pendapatan. Saldo uji tidak masuk ke kredit produksi.</p></div><button type="button" onClick={() => { clearAdminReadCache(); setRevision(v => v + 1) }}>Muat ulang</button></div>
    {config && !config.enabled && <p role="status" className="admin-notice">Integrasi Sandbox belum diaktifkan. Kredensial tetap di server dan tidak ditampilkan di Admin Console.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    {config?.enabled && <>
      <form className="admin-filter-row" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); clearAdminReadCache(); setRevision(v => v + 1) }}>
        <label>Cari pesanan, referensi, atau email<input value={search} maxLength={128} onChange={e => setSearch(e.target.value)} /></label>
        <label>Status<select aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">Semua</option>{['CREATING', 'PENDING', 'PAID', 'FAILED', 'EXPIRED'].map(v => <option key={v}>{v}</option>)}</select></label>
        <button type="submit">Cari</button>
      </form>
      {!data ? <p role="status">Memuat transaksi…</p> : <>
        <p>{data.total} transaksi Sandbox</p>
        <div className="admin-table-wrap"><table><thead><tr><th>Pesanan</th><th>Pelanggan</th><th>Nominal</th><th>Produk uji</th><th>Status</th><th>Dibuat</th><th>Detail</th></tr></thead><tbody>
          {data.transactions.map(row => <tr key={row.id}><td><code>{row.merchant_order_id}</code><br /><small>{row.reference || 'Belum ada referensi'}</small></td><td>{row.user_email}</td><td>{formatRupiah(row.amount_rupiah)}</td><td>{row.product_kind === 'subscription' ? `Paket ${row.product_code}` : `${row.credits} kredit${row.policy_version === 2 ? ' AI' : ' legacy'}`}</td><td>{row.status}</td><td>{date(row.created_at)}</td><td><button type="button" onClick={async () => { try { setDetail(await getAdminPayment(row.id)) } catch (e) { setError(e.message) } }}>Lihat</button></td></tr>)}
          {!data.transactions.length && <tr><td colSpan={7}>Tidak ada transaksi yang sesuai.</td></tr>}
        </tbody></table></div>
        <div className="admin-actions"><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Sebelumnya</button><span>Halaman {page}</span><button type="button" disabled={page * 25 >= data.total} onClick={() => setPage(v => v + 1)}>Berikutnya</button></div>
      </>}
    </>}
    {detail && <article className="admin-card" aria-label="Detail transaksi">
      <div className="admin-section-head"><h3>Detail transaksi Sandbox</h3><button type="button" onClick={() => setDetail(null)}>Tutup</button></div>
      <dl className="admin-dl">{[['Pesanan', detail.merchant_order_id], ['Referensi', detail.reference], ['Status', detail.status], ['Nominal', formatRupiah(detail.amount_rupiah)], ['Produk', detail.product_kind === 'subscription' ? `Paket ${detail.product_code}` : 'Top-up AI'], ['Versi harga', detail.policy_version ?? 1], ['Kredit uji', detail.credits], ['Dibuat', date(detail.created_at)], ['Berlaku sampai', date(detail.expires_at)], ['Dibayar', date(detail.paid_at)], ['Saldo uji dicatat', date(detail.sandbox_credited_at)], ['Callback terverifikasi', date(detail.callback_received_at)], ['Terakhir dicek', date(detail.last_checked_at)], ['Kode kendala', detail.error_code]].map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></React.Fragment>)}</dl>
      <p className="admin-muted">Cek ulang meminta status ke Duitku. Tidak ada tombol untuk menyatakan lunas secara manual. Tunggu 30 detik antar pengecekan.</p>
      <button type="button" disabled={busy || detail.status === 'PAID'} onClick={check}>{busy ? 'Memeriksa…' : 'Cek ulang ke Duitku'}</button>
    </article>}
  </section>
}
