import React, { useEffect, useState } from 'react'
import {
  adminTemplatePreviewUrl,
  adminTemplateProcessingUrl,
  createAdminTemplate,
  deleteAdminTemplate,
  getAdminTemplates,
  removeAdminTemplatePreview,
  replaceAdminTemplateImage,
  replaceAdminTemplatePreview,
  updateAdminTemplate,
} from '../../api.js'
import { ApiError } from '../../api.js'

const EMPTY = { id: '', name: '', description: '', enabled: true, sort_order: 0 }

function errorMessage(error) {
  if (error instanceof ApiError) return error.message || 'Request failed'
  return error?.message || 'Request failed'
}

function Field({ label, hint, children }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Button({ children, className = '', ...props }) {
  return <button className={className} {...props}>{children}</button>
}

function PreviewTile({ label, description, src, missing }) {
  return <div className="admin-template-asset">
    <div className="admin-template-asset-heading"><strong>{label}</strong><span className={missing ? 'is-missing' : ''}>{missing ? 'MISSING' : 'READY'}</span></div>
    <div className={`admin-template-asset-preview ${missing ? 'is-missing' : ''}`}>
      {src && !missing ? <img src={src} alt={`${label} preview`} /> : <div><strong>Preview unavailable</strong><small>Upload a customer-safe image</small></div>}
    </div>
    <p>{description}</p>
  </div>
}

function Editor({ editor, onCancel, onSaved }) {
  const [data, setData] = useState(editor.data)
  const [processingFile, setProcessingFile] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [removePreview, setRemovePreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = {
        name: data.name,
        description: data.description,
        enabled: data.enabled,
        sort_order: Number(data.sort_order),
      }
      const saved = editor.isNew
        ? await createAdminTemplate({ id: data.id, ...body })
        : await updateAdminTemplate(data.id, body)
      if (processingFile) await replaceAdminTemplateImage(saved.id, processingFile)
      if (previewFile) await replaceAdminTemplatePreview(saved.id, previewFile)
      if (removePreview && !previewFile && !editor.isNew) await removeAdminTemplatePreview(saved.id)
      onSaved()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <form className="admin-card admin-template-editor" onSubmit={save}>
    <div className="admin-section-head"><div><h3>{editor.isNew ? 'Add' : 'Edit'} Basic Template</h3><p className="admin-muted">Keep the processing asset and customer-facing preview separate.</p></div><Button type="button" onClick={onCancel}>Cancel</Button></div>
    {error && <div className="admin-error">{error}</div>}
    <div className="admin-form-grid">
      <Field label="ID"><input value={data.id} disabled={!editor.isNew} required onChange={(event) => setData({ ...data, id: event.target.value })} /></Field>
      <Field label="Name"><input value={data.name} required onChange={(event) => setData({ ...data, name: event.target.value })} /></Field>
      <Field label="Sort order"><input type="number" value={data.sort_order} onChange={(event) => setData({ ...data, sort_order: event.target.value })} /></Field>
      <Field label="Template status"><select value={String(data.enabled)} onChange={(event) => setData({ ...data, enabled: event.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></Field>
    </div>
    <Field label="Description"><textarea rows="3" value={data.description} onChange={(event) => setData({ ...data, description: event.target.value })} /></Field>
    <div className="admin-template-asset-edit-grid">
      <div className="admin-asset-control">
        <div><h4>Processing Asset</h4><p>Used by the Basic generation engine. This image is never used as the customer marketing preview.</p></div>
        {editor.data.processing_asset_present && <img src={adminTemplateProcessingUrl(data.id, editor.data.updated_at)} alt="Current processing asset" />}
        <Field label="Upload processing asset"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProcessingFile(event.target.files?.[0] || null)} /></Field>
      </div>
      <div className="admin-asset-control">
        <div><h4>Customer Marketing Preview</h4><p>Shown in the Basic customer gallery. Upload a deliberate, customer-safe preview.</p></div>
        {!editor.data.preview_missing && <img src={adminTemplatePreviewUrl(data.id, editor.data.updated_at)} alt="Current customer marketing preview" />}
        <Field label="Upload marketing preview"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setPreviewFile(event.target.files?.[0] || null); setRemovePreview(false) }} /></Field>
        {!editor.isNew && !editor.data.preview_missing && <label className="admin-check"><input type="checkbox" checked={removePreview} onChange={(event) => setRemovePreview(event.target.checked)} /> Remove current preview</label>}
      </div>
    </div>
    <div className="admin-actions"><Button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save template'}</Button><Button type="button" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>
}

export default function BasicTemplatePanel() {
  const [items, setItems] = useState([])
  const [editor, setEditor] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => getAdminTemplates().then(setItems).catch((requestError) => setError(errorMessage(requestError)))
  useEffect(() => { load() }, [])

  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.name}?`)) return
    setError('')
    try {
      await deleteAdminTemplate(item.id)
      setNotice('Template deleted.')
      load()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  return <section>
    <div className="admin-section-head"><div><h2>Basic Templates</h2><p className="admin-muted">Manage the deterministic processing asset separately from the customer marketing preview.</p></div><Button className="primary" onClick={() => setEditor({ isNew: true, data: { ...EMPTY, processing_asset_present: false, preview_missing: true } })}>Add</Button></div>
    {error && <div className="admin-error">{error}</div>}{notice && <div className="admin-notice">{notice}</div>}
    {editor && <Editor editor={editor} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice('Template saved.'); load() }} />}
    {items.length ? <div className="admin-template-list">{items.map((item) => <article className="admin-card admin-template-admin-card" key={item.id}>
      <div className="admin-template-admin-heading"><div><h3>{item.name}</h3><code>{item.id}</code></div><span className={`admin-badge ${item.enabled ? 'ok' : 'warn'}`}>{item.enabled ? 'enabled' : 'disabled'}</span></div>
      <p className="admin-muted">{item.description || 'No description.'}</p>
      <p className="admin-muted">{item.framed ? 'Framed Basic Template · ' : ''}{item.canvas_width && item.canvas_height ? `${item.canvas_width} × ${item.canvas_height} · ${item.aspect_ratio}` : 'Canvas unavailable'} · {item.enabled ? 'Published' : 'Disabled'}</p>
      <div className="admin-template-asset-grid">
        <PreviewTile label="Processing Asset" description="Used by Basic generation engine" src={adminTemplateProcessingUrl(item.id, item.updated_at)} missing={!item.processing_asset_present} />
        <PreviewTile label="Marketing Preview" description="Shown to customers in the Basic gallery" src={adminTemplatePreviewUrl(item.id, item.updated_at)} missing={item.preview_missing} />
      </div>
      <div className="admin-template-admin-footer"><span className={`admin-preview-status ${item.preview_missing ? 'is-missing' : 'is-ready'}`}>Preview {item.preview_missing ? 'missing' : 'ready'}</span><span>Sort {item.sort_order}</span><div className="admin-actions"><Button onClick={() => setEditor({ isNew: false, data: { ...item } })}>Edit</Button><Button onClick={async () => { try { await updateAdminTemplate(item.id, { enabled: !item.enabled }); setNotice(`Template ${item.enabled ? 'disabled' : 'enabled'}.`); load() } catch (requestError) { setError(errorMessage(requestError)) } }}>{item.enabled ? 'Disable' : 'Enable'}</Button><Button className="danger" onClick={() => remove(item)}>Delete</Button></div></div>
    </article>)}</div> : <div className="admin-empty">No Basic templates found.</div>}
  </section>
}
