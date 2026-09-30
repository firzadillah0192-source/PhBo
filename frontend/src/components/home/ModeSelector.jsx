import React from 'react'

const MODES = [
  { id: 'CLASSIC', name: 'Classic', detail: 'Photo Strips' },
  { id: 'BASIC', name: 'Basic', detail: 'Curated Studio' },
  { id: 'ADVANCED', name: 'Advanced', detail: 'AI Worlds' },
]

export default function ModeSelector({ activeMode, pendingMode, onPreview, onLeave, onSelect }) {
  return (
    <div className="campaign-modes" role="group" aria-label="Choose a studio">
      {MODES.map((mode) => (
        <button
          type="button"
          key={mode.id}
          className={activeMode === mode.id ? 'is-active' : ''}
          disabled={Boolean(pendingMode)}
          onMouseEnter={() => onPreview(mode.id)}
          onMouseLeave={onLeave}
          onFocus={() => onPreview(mode.id)}
          onBlur={onLeave}
          onClick={() => onSelect(mode.id)}
        >
          <span>{mode.name}</span><small>{pendingMode === mode.id ? 'Entering studio…' : mode.detail}</small><b aria-hidden="true">↗</b>
        </button>
      ))}
    </div>
  )
}
