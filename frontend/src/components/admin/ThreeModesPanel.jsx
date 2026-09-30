import React, { useEffect, useState } from 'react'
import {
  createAdminClassicLayout, createAdminFrameStyle, createAdminOrnament,
  getAdminClassicLayouts, getAdminExperiences, getAdminFrameStyles, getAdminOrnaments,
  updateAdminClassicLayout, updateAdminExperience, updateAdminFrameStyle, updateAdminOrnament,
  uploadAdminClassicFrame,
} from '../../api.js'

const emptyLayout = { id: '', slug: '', name: '', canvas_width: 724, canvas_height: 2172, shot_count: 1, slots: [], enabled: false, sort_order: 0 }
const emptyPreset = { id: '', slug: '', name: '', description: '', prompt_fragment: '', enabled: true, sort_order: 0 }

export function ClassicLayoutsPanel() {
  const [rows, setRows] = useState([])
  const [editor, setEditor] = useState(null)
  const [slotsText, setSlotsText] = useState('[]')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const load = () => getAdminClassicLayouts().then(setRows).catch((err) => setError(err.message))
  useEffect(() => { load() }, [])
  const edit = (row, isNew = false) => { setEditor({ ...row, isNew }); setSlotsText(JSON.stringify(row.slots, null, 2)); setFile(null); setError('') }
  const save = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const body = { ...editor, canvas_width: Number(editor.canvas_width), canvas_height: Number(editor.canvas_height), shot_count: Number(editor.shot_count), sort_order: Number(editor.sort_order), slots: JSON.parse(slotsText) }
      delete body.isNew; delete body.preview_url; delete body.frame_asset_present
      const saved = editor.isNew ? await createAdminClassicLayout({ ...body, enabled: false }) : await updateAdminClassicLayout(editor.id, { name: body.name, canvas_width: body.canvas_width, canvas_height: body.canvas_height, shot_count: body.shot_count, slots: body.slots, enabled: body.enabled, sort_order: body.sort_order })
      if (file) await uploadAdminClassicFrame(saved.id, file)
      if (editor.isNew && body.enabled) await updateAdminClassicLayout(saved.id, { enabled: true })
      setEditor(null)
      load()
    } catch (err) { setError(err.message) }
  }
  return <section><div className="admin-section-head"><div><h2>Classic Layouts</h2><p className="admin-muted">Reviewed frame PNGs and structured photo slots.</p></div><button className="primary" onClick={() => edit(emptyLayout, true)}>Add layout</button></div>
    {error && <div className="admin-error">{error}</div>}
    {editor && <form className="admin-card" onSubmit={save}><div className="admin-form-grid">
      <label className="admin-field">ID<input value={editor.id} disabled={!editor.isNew} required onChange={(event) => setEditor({ ...editor, id: event.target.value })} /></label>
      <label className="admin-field">Slug<input value={editor.slug} disabled={!editor.isNew} required onChange={(event) => setEditor({ ...editor, slug: event.target.value })} /></label>
      <label className="admin-field">Name<input value={editor.name} required onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
      <label className="admin-field">Canvas width<input type="number" min="1" value={editor.canvas_width} onChange={(event) => setEditor({ ...editor, canvas_width: event.target.value })} /></label>
      <label className="admin-field">Canvas height<input type="number" min="1" value={editor.canvas_height} onChange={(event) => setEditor({ ...editor, canvas_height: event.target.value })} /></label>
      <label className="admin-field">Shot count<input type="number" min="1" value={editor.shot_count} onChange={(event) => setEditor({ ...editor, shot_count: event.target.value })} /></label>
      <label className="admin-field">Sort order<input type="number" value={editor.sort_order} onChange={(event) => setEditor({ ...editor, sort_order: event.target.value })} /></label>
      <label className="admin-field">Status<select value={String(editor.enabled)} onChange={(event) => setEditor({ ...editor, enabled: event.target.value === 'true' })}><option value="true">Published</option><option value="false">Disabled</option></select></label>
    </div><label className="admin-field">Slots JSON<textarea rows="12" value={slotsText} onChange={(event) => setSlotsText(event.target.value)} /></label><label className="admin-field">Frame PNG<input type="file" accept="image/png" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><div className="admin-actions"><button className="primary" type="submit">Save layout</button><button type="button" onClick={() => setEditor(null)}>Cancel</button></div></form>}
    <div className="admin-content-grid">{rows.map((row) => <article className="admin-card admin-content-card" key={row.id}><div className="admin-content-preview">{row.frame_asset_present && <img src={row.preview_url} alt={`${row.name} frame`} />}</div><h3>{row.name}</h3><p>{row.shot_count} photos · {row.canvas_width} × {row.canvas_height}</p><p>{row.slots.map((slot) => `${slot.x},${slot.y} ${slot.width}×${slot.height}`).join(' · ')}</p><p>{row.enabled ? 'Published' : 'Disabled'} · sort {row.sort_order}</p><button onClick={() => edit(row)}>Edit</button></article>)}</div>
  </section>
}

function PresetEditor({ kind, load, create, update, onChanged }) {
  const [rows, setRows] = useState([])
  const [editor, setEditor] = useState(null)
  const [error, setError] = useState('')
  const refresh = () => load().then(setRows).catch((err) => setError(err.message))
  useEffect(() => { refresh() }, [kind])
  const save = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const body = { ...editor, sort_order: Number(editor.sort_order) }
      delete body.isNew
      if (editor.isNew) await create(body)
      else await update(editor.id, { name: body.name, description: body.description, prompt_fragment: body.prompt_fragment, enabled: body.enabled, sort_order: body.sort_order })
      setEditor(null)
      refresh()
      onChanged?.()
    } catch (err) { setError(err.message) }
  }
  return <section className="admin-card"><div className="admin-section-head"><div><h3>{kind}</h3><p className="admin-muted">Prompt fragments remain private to the server.</p></div><button onClick={() => setEditor({ ...emptyPreset, isNew: true })}>Add</button></div>{error && <div className="admin-error">{error}</div>}
    {editor && <form onSubmit={save}><div className="admin-form-grid"><label className="admin-field">ID<input required disabled={!editor.isNew} value={editor.id} onChange={(event) => setEditor({ ...editor, id: event.target.value })} /></label><label className="admin-field">Slug<input required disabled={!editor.isNew} value={editor.slug} onChange={(event) => setEditor({ ...editor, slug: event.target.value })} /></label><label className="admin-field">Name<input required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><label className="admin-field">Sort order<input type="number" value={editor.sort_order} onChange={(event) => setEditor({ ...editor, sort_order: event.target.value })} /></label><label className="admin-field">Enabled<select value={String(editor.enabled)} onChange={(event) => setEditor({ ...editor, enabled: event.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select></label></div><label className="admin-field">Description<input value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><label className="admin-field">Prompt fragment<textarea rows="6" required value={editor.prompt_fragment} onChange={(event) => setEditor({ ...editor, prompt_fragment: event.target.value })} /></label><div className="admin-actions"><button className="primary" type="submit">Save</button><button type="button" onClick={() => setEditor(null)}>Cancel</button></div></form>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Status</th><th>Sort</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}<br /><code>{row.id}</code></td><td>{row.enabled ? 'Enabled' : 'Disabled'}</td><td>{row.sort_order}</td><td><button onClick={() => setEditor({ ...row, isNew: false })}>Edit</button></td></tr>)}</tbody></table></div>
  </section>
}

export function AdvancedPresetsPanel() {
  const [experiences, setExperiences] = useState([])
  const [selected, setSelected] = useState('')
  const [frames, setFrames] = useState([])
  const [ornaments, setOrnaments] = useState([])
  const [message, setMessage] = useState('')
  const refreshOptions = () => { getAdminFrameStyles().then(setFrames); getAdminOrnaments().then(setOrnaments) }
  useEffect(() => { getAdminExperiences().then(setExperiences); refreshOptions() }, [])
  const experience = experiences.find((item) => item.id === selected)
  const saveCompatibility = async (field, ids) => {
    try {
      await updateAdminExperience(selected, { [field]: ids })
      setExperiences(await getAdminExperiences())
      setMessage('Compatibility saved.')
    } catch (err) { setMessage(err.message) }
  }
  return <section><h2>Advanced Art Direction</h2><PresetEditor kind="Frame Styles" load={getAdminFrameStyles} create={createAdminFrameStyle} update={updateAdminFrameStyle} onChanged={refreshOptions} /><PresetEditor kind="Ornaments" load={getAdminOrnaments} create={createAdminOrnament} update={updateAdminOrnament} onChanged={refreshOptions} />
    <div className="admin-card"><h3>Experience compatibility</h3><p className="admin-muted">Leave a selection unrestricted, or choose the styles and ornaments allowed for one experience.</p><label className="admin-field">Experience<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose experience</option>{experiences.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{experience && <><label className="admin-field">Maximum ornaments<input type="number" min="0" max="10" value={experience.max_ornaments} onChange={async (event) => { const count = Number(event.target.value); setExperiences((rows) => rows.map((item) => item.id === selected ? { ...item, max_ornaments: count } : item)); try { await updateAdminExperience(selected, { max_ornaments: count }) } catch (err) { setMessage(err.message) } }} /></label>{[['compatible_frame_style_ids', frames], ['compatible_ornament_ids', ornaments]].map(([field, options]) => <fieldset key={field}><legend>{field === 'compatible_frame_style_ids' ? 'Allowed frame styles' : 'Allowed ornaments'}</legend><label><input type="checkbox" checked={experience[field] === null} onChange={() => saveCompatibility(field, null)} /> Allow all</label>{options.map((item) => <label key={item.id}><input type="checkbox" checked={experience[field] === null || experience[field].includes(item.id)} onChange={() => { const current = experience[field] || options.map((option) => option.id); saveCompatibility(field, current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]) }} /> {item.name}</label>)}</fieldset>)}</>}{message && <p role="status">{message}</p>}</div>
  </section>
}
