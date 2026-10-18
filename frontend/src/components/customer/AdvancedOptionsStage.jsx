import React, { useState } from 'react'
import FrameStylePreview from './FrameStylePreview.jsx'
import { useT } from '../../i18n.js'

export default function AdvancedOptionsStage({ experience, frameStyles, ornaments, frameStyleId, ornamentIds, onFrameStyle, onOrnaments, onBack, onContinue }) {
  const t = useT()
  const [optionStep, setOptionStep] = useState('frames')
  const compatibleFrames = experience?.compatible_frame_style_ids
  const compatibleOrnaments = experience?.compatible_ornament_ids
  const visibleFrames = frameStyles.filter((item) => !compatibleFrames || compatibleFrames.includes(item.id))
  const visibleOrnaments = ornaments.filter((item) => !compatibleOrnaments || compatibleOrnaments.includes(item.id))
  const maximum = experience?.max_ornaments ?? 3
  const validSelection = visibleFrames.some((item) => item.id === frameStyleId) && ornamentIds.length <= maximum && ornamentIds.every((id) => visibleOrnaments.some((item) => item.id === id))
  const chosenFrame = visibleFrames.find((item) => item.id === frameStyleId)
  const chosenOrnaments = visibleOrnaments.filter((item) => ornamentIds.includes(item.id))
  const toggle = (id) => {
    if (ornamentIds.includes(id)) onOrnaments(ornamentIds.filter((item) => item !== id))
    else if (ornamentIds.length < maximum) onOrnaments([...ornamentIds, id])
  }
  return (
    <section className="gallery-page advanced-options customer-stage-enter">
      <nav className="capture-navigation" aria-label={t('Navigasi gaya', 'Style navigation')}><button className="customer-inline-button" onClick={onBack}>← {t('Ganti pengalaman', 'Change experience')}</button></nav>
      <header className="gallery-heading"><p className="customer-kicker">{t('Arahan seni untuk', 'Art direction for')} {experience?.name}</p><h1>{t('Pilih gaya bingkai.', 'Choose a frame style.')}</h1><p>{t('Lihat arah visualnya. Bingkai akhir menyesuaikan dunia yang Anda pilih.', 'Preview the visual direction. Your final frame adapts to the world you choose.')}</p></header>
      <div className="advanced-layout">
        <div className="advanced-choices">
          <nav className="advanced-option-tabs" aria-label={t('Opsi arahan seni', 'Art direction options')}><button aria-pressed={optionStep === 'frames'} onClick={() => setOptionStep('frames')}>{t('Gaya bingkai', 'Frame style')}</button><button title={chosenOrnaments.map(item => item.name).join(', ') || t('Tidak ada', 'None')} aria-pressed={optionStep === 'ornaments'} onClick={() => setOptionStep('ornaments')}>{t('Ornamen', 'Ornaments')} · {ornamentIds.length}</button></nav>
          {optionStep === 'frames' && <div className="advanced-style-grid" role="group" aria-label={t('Gaya bingkai', 'Frame style')}>
            {visibleFrames.map((item) => <button key={item.id} className={`advanced-style-card ${frameStyleId === item.id ? 'is-selected' : ''}`} aria-pressed={frameStyleId === item.id} onClick={() => onFrameStyle(item.id)}><FrameStylePreview style={item} experience={experience} /><strong>{item.name}</strong><small>{item.description}</small></button>)}
          </div>}
          {optionStep === 'ornaments' && <section className="advanced-ornaments"><h2>{t('Ornamen opsional', 'Optional ornaments')}</h2><p>{t(`Pilih hingga ${maximum}.`, `Choose up to ${maximum}.`)}</p><div role="group" aria-label={t('Ornamen', 'Ornaments')}><button className={ornamentIds.length ? '' : 'is-selected'} aria-pressed={!ornamentIds.length} onClick={() => onOrnaments([])}>{t('Tidak ada', 'None')}</button>{visibleOrnaments.map((item) => <button key={item.id} className={ornamentIds.includes(item.id) ? 'is-selected' : ''} aria-pressed={ornamentIds.includes(item.id)} onClick={() => toggle(item.id)}>{item.name}</button>)}</div></section>}
        </div>
        <aside className="selection-dock">
          <span><small>{t('Bingkai terpilih', 'Selected frame')}</small><strong>{chosenFrame?.name || t('Pilih gaya', 'Choose a style')}</strong></span>
          <span><small>{t('Ornamen', 'Ornaments')}</small><strong>{chosenOrnaments.length ? chosenOrnaments.map(item => item.name).join(', ') : t('Tidak ada', 'None')}</strong></span>
          <button className="customer-solid-button" onClick={onContinue} disabled={!validSelection}>{t('Lanjut ke foto', 'Continue to photo')} <b>→</b></button>
        </aside>
      </div>
    </section>
  )
}
