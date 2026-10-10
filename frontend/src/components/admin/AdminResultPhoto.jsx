import React, { useState } from 'react'
import { deleteAdminResultPhoto } from '../../api.js'
import './result-photo.css'

export default function AdminResultPhoto({ generation, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleted, setDeleted] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const remove = async () => {
    if (busy || !window.confirm('Hapus hasil foto ini secara permanen? Link download dan link berbagi akan dinonaktifkan. Kredit tidak dikembalikan.')) return
    setBusy(true)
    setError('')
    try {
      await deleteAdminResultPhoto(generation.job_id)
      setDeleted(true)
      await onDeleted()
    } catch (caught) { setError(caught.message || 'Foto gagal dihapus.') } finally { setBusy(false) }
  }
  return <section className="admin-result-photo"><h4>Hasil foto</h4>{deleted || generation.result_deleted_at ? <p role="status">Foto sudah dihapus. Catatan job dan token tetap tersimpan.</p> : <>
    {generation.result_image_url && !imageFailed ? <a href={generation.result_image_url} target="_blank" rel="noreferrer"><img src={generation.result_image_url} alt="Hasil foto generasi" onError={() => setImageFailed(true)} /></a> : <p>Foto hasil belum tersedia atau file sudah kedaluwarsa.</p>}
    <div className="admin-actions">{generation.result_download_url && <a href={generation.result_download_url}>Download foto</a>}{generation.result_id && <button disabled={busy} onClick={remove}>{busy ? 'Menghapus…' : 'Hapus foto'}</button>}</div>
  </>}{error && <p className="admin-error" role="alert">{error}</p>}</section>
}
