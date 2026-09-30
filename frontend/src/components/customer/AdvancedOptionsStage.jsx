import React from 'react'

export default function AdvancedOptionsStage({ experience, frameStyles, ornaments, frameStyleId, ornamentIds, onFrameStyle, onOrnaments, onBack, onContinue }) {
  const compatibleFrames = experience?.compatible_frame_style_ids
  const compatibleOrnaments = experience?.compatible_ornament_ids
  const visibleFrames = frameStyles.filter((item) => !compatibleFrames || compatibleFrames.includes(item.id))
  const visibleOrnaments = ornaments.filter((item) => !compatibleOrnaments || compatibleOrnaments.includes(item.id))
  const maximum = experience?.max_ornaments ?? 3
  const validSelection = visibleFrames.some((item) => item.id === frameStyleId) && ornamentIds.length <= maximum && ornamentIds.every((id) => visibleOrnaments.some((item) => item.id === id))
  const toggle = (id) => {
    if (ornamentIds.includes(id)) onOrnaments(ornamentIds.filter((item) => item !== id))
    else if (ornamentIds.length < maximum) onOrnaments([...ornamentIds, id])
  }
  return (
    <section className="gallery-page advanced-options customer-stage-enter">
      <header className="gallery-heading"><button className="customer-inline-button" onClick={onBack}>← Change experience</button><p className="customer-kicker">Art direction for {experience?.name}</p><h1>Choose a frame style.</h1><p>The frame is generated as part of your selected world.</p></header>
      <div className="advanced-style-grid" role="group" aria-label="Frame style">
        {visibleFrames.map((item) => <button key={item.id} className={`advanced-style-card ${frameStyleId === item.id ? 'is-selected' : ''}`} aria-pressed={frameStyleId === item.id} onClick={() => onFrameStyle(item.id)}><strong>{item.name}</strong><small>{item.description}</small></button>)}
      </div>
      <section className="advanced-ornaments"><h2>Optional ornaments</h2><p>Choose up to {maximum}.</p><div role="group" aria-label="Ornaments"><button className={ornamentIds.length ? '' : 'is-selected'} aria-pressed={!ornamentIds.length} onClick={() => onOrnaments([])}>None</button>{visibleOrnaments.map((item) => <button key={item.id} className={ornamentIds.includes(item.id) ? 'is-selected' : ''} aria-pressed={ornamentIds.includes(item.id)} onClick={() => toggle(item.id)}>{item.name}</button>)}</div></section>
      <div className="selection-dock"><span><small>Selected frame</small><strong>{visibleFrames.find((item) => item.id === frameStyleId)?.name || 'Choose a style'}</strong></span><button className="customer-solid-button" onClick={onContinue} disabled={!validSelection}>Continue to photo <b>→</b></button></div>
    </section>
  )
}
