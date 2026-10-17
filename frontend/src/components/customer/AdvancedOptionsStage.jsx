import React, { useState } from 'react'
import FrameStylePreview from './FrameStylePreview.jsx'

export default function AdvancedOptionsStage({ experience, frameStyles, ornaments, frameStyleId, ornamentIds, onFrameStyle, onOrnaments, onBack, onContinue }) {
  const [framePage, setFramePage] = useState(0)
  const [ornamentPage, setOrnamentPage] = useState(0)
  const [optionStep, setOptionStep] = useState('frames')
  const compatibleFrames = experience?.compatible_frame_style_ids
  const compatibleOrnaments = experience?.compatible_ornament_ids
  const visibleFrames = frameStyles.filter((item) => !compatibleFrames || compatibleFrames.includes(item.id))
  const visibleOrnaments = ornaments.filter((item) => !compatibleOrnaments || compatibleOrnaments.includes(item.id))
  const framePages = Math.max(1, Math.ceil(visibleFrames.length / 2))
  const ornamentPages = Math.max(1, Math.ceil(visibleOrnaments.length / 4))
  const maximum = experience?.max_ornaments ?? 3
  const validSelection = visibleFrames.some((item) => item.id === frameStyleId) && ornamentIds.length <= maximum && ornamentIds.every((id) => visibleOrnaments.some((item) => item.id === id))
  const toggle = (id) => {
    if (ornamentIds.includes(id)) onOrnaments(ornamentIds.filter((item) => item !== id))
    else if (ornamentIds.length < maximum) onOrnaments([...ornamentIds, id])
  }
  return (
    <section className="gallery-page advanced-options customer-stage-enter">
      <nav className="capture-navigation" aria-label="Style navigation"><button className="customer-inline-button" onClick={onBack}>← Change experience</button></nav>
      <header className="gallery-heading"><p className="customer-kicker">Art direction for {experience?.name}</p><h1>Choose a frame style.</h1><p>Preview the visual direction. Your final frame adapts to the world you choose.</p></header>
      <nav className="advanced-option-tabs" aria-label="Art direction options"><button aria-pressed={optionStep === 'frames'} onClick={() => setOptionStep('frames')}>Frame style</button><button title={visibleOrnaments.filter(item => ornamentIds.includes(item.id)).map(item => item.name).join(', ') || 'None'} aria-pressed={optionStep === 'ornaments'} onClick={() => setOptionStep('ornaments')}>Ornaments · {ornamentIds.length}</button></nav>
      {optionStep === 'frames' && <><div className="advanced-style-grid" role="group" aria-label="Frame style">
        {visibleFrames.slice(framePage * 2, (framePage + 1) * 2).map((item) => <button key={item.id} className={`advanced-style-card ${frameStyleId === item.id ? 'is-selected' : ''}`} aria-pressed={frameStyleId === item.id} onClick={() => onFrameStyle(item.id)}><FrameStylePreview style={item} experience={experience} /><strong>{item.name}</strong><small>{item.description}</small></button>)}
      </div>
      {framePages > 1 && <nav className="studio-picker-pages" aria-label="Frame style pages"><button disabled={framePage === 0} onClick={() => setFramePage(framePage - 1)}>← Previous</button><span>{framePage + 1} / {framePages}</span><button disabled={framePage + 1 === framePages} onClick={() => setFramePage(framePage + 1)}>Next →</button></nav>}</>}
      {optionStep === 'ornaments' && <section className="advanced-ornaments"><h2>Optional ornaments</h2><p>Choose up to {maximum}.</p><div role="group" aria-label="Ornaments"><button className={ornamentIds.length ? '' : 'is-selected'} aria-pressed={!ornamentIds.length} onClick={() => onOrnaments([])}>None</button>{visibleOrnaments.slice(ornamentPage * 4, (ornamentPage + 1) * 4).map((item) => <button key={item.id} className={ornamentIds.includes(item.id) ? 'is-selected' : ''} aria-pressed={ornamentIds.includes(item.id)} onClick={() => toggle(item.id)}>{item.name}</button>)}</div>{ornamentPages > 1 && <nav className="studio-picker-pages" aria-label="Ornament pages"><button disabled={ornamentPage === 0} onClick={() => setOrnamentPage(ornamentPage - 1)}>← Previous</button><span>{ornamentPage + 1} / {ornamentPages}</span><button disabled={ornamentPage + 1 === ornamentPages} onClick={() => setOrnamentPage(ornamentPage + 1)}>Next →</button></nav>}</section>}
      <div className="selection-dock"><span><small>Selected frame</small><strong>{visibleFrames.find((item) => item.id === frameStyleId)?.name || 'Choose a style'}</strong></span><button className="customer-solid-button" onClick={onContinue} disabled={!validSelection}>Continue to photo <b>→</b></button></div>
    </section>
  )
}
