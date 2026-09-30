import React from 'react'

const STAGES = ['Studio', 'Photo', 'Create', 'Result']
const INDEX = { gallery: 0, 'art-direction': 0, photo: 1, review: 2, processing: 2, failed: 2, result: 3 }

export default function ProgressRail({ stage }) {
  const active = INDEX[stage] ?? 0
  return (
    <nav className="customer-progress" aria-label="Creation progress">
      <span>{String(active + 1).padStart(2, '0')} / 04</span>
      <ol>{STAGES.map((label, index) => <li key={label} data-label={label} className={index === active ? 'is-active' : index < active ? 'is-done' : ''}>{label}</li>)}</ol>
      <i aria-hidden="true"><b style={{ transform: `scaleX(${active / 3})` }} /></i>
    </nav>
  )
}
