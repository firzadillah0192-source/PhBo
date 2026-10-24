import React from 'react'
import { useT } from '../../i18n.js'

const INDEX = { gallery: 0, 'art-direction': 0, photo: 1, review: 2, processing: 2, failed: 2, 'billing-pending': 2, result: 3 }

// Left rail of the create flow: where the customer is, what they picked, and what it costs.
// On narrow screens the CSS collapses it to a compact progress strip and hides the summary.
export default function StudioRail({ stage, modeName, selectionName, frameStyleName, ornamentCount = 0, hasPhoto = false, credit, folderSlot = null }) {
  const t = useT()
  const steps = [t('Studio', 'Studio'), t('Foto', 'Photo'), t('Buat', 'Create'), t('Hasil', 'Result')]
  const active = INDEX[stage] ?? 0
  const rows = [
    modeName && [t('Studio', 'Studio'), modeName],
    selectionName && [t('Pilihan', 'Selection'), selectionName],
    frameStyleName && [t('Gaya bingkai', 'Frame style'), frameStyleName],
    ornamentCount > 0 && [t('Ornamen', 'Ornaments'), String(ornamentCount)],
    stage !== 'gallery' && [t('Foto', 'Photo'), hasPhoto ? t('Siap', 'Ready') : t('Belum ada', 'Not yet')],
  ].filter(Boolean)
  return (
    <aside className="studio-rail" aria-label={t('Ringkasan studio', 'Studio summary')}>
      <nav className="customer-progress" aria-label={t('Progres pembuatan', 'Creation progress')}>
        <span>{t('Langkah', 'Step')} {active + 1} / 4</span>
        <ol>{steps.map((label, index) => <li key={label} aria-current={index === active ? 'step' : undefined} className={index === active ? 'is-active' : index < active ? 'is-done' : ''}><b aria-hidden="true">{index < active ? '✓' : index + 1}</b>{label}</li>)}</ol>
        <i aria-hidden="true"><b style={{ transform: `scaleX(${active / 3})` }} /></i>
      </nav>
      {rows.length > 0 && <dl className="studio-rail-summary">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>}
      {folderSlot && <div className="studio-rail-folder">{folderSlot}</div>}
      {credit && <div className="studio-rail-credit"><small>{credit.label}</small><strong>{credit.value}</strong>{credit.note && <span>{credit.note}</span>}</div>}
    </aside>
  )
}
