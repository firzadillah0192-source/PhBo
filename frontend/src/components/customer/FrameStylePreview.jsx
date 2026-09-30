import React from 'react'
import { CatalogImage } from '../home/ModeCards.jsx'

const STYLES = new Set(['natural', 'modern', 'minimal', 'luxury', 'retro', 'film', 'cute', 'editorial', 'futuristic', 'artistic'])

/** Selection illustrations only; these frames are never applied to results. */
export default function FrameStylePreview({ style, experience }) {
  const kind = STYLES.has(style.slug || style.id) ? style.slug || style.id : 'modern'
  return <span className={`frame-style-preview frame-preview-${kind}`} aria-hidden="true">
    <span className="frame-preview-art"><CatalogImage key={experience?.thumbnail} src={experience?.thumbnail} alt="" fallback="Your world" /></span>
    <svg viewBox="0 0 120 180" fill="none" preserveAspectRatio="none">
      {kind === 'natural' && <g stroke="#80926f" strokeWidth="2"><path d="M8 72Q26 55 12 20M8 60Q24 48 20 31M110 107Q94 135 110 166M108 130Q97 139 96 153" /><path d="M9 44Q-2 34 6 25Q19 27 9 44M108 148Q120 148 115 163Q105 163 108 148" fill="#80926f" /></g>}
      {kind === 'modern' && <g stroke="#ecb99a" strokeWidth="3"><path d="M12 40V12H54M68 168H108V140" /><path d="M12 158H48M72 22H108" strokeWidth="1" /></g>}
      {kind === 'minimal' && <rect x="10" y="10" width="100" height="160" stroke="#b0a99c" strokeWidth=".6" />}
      {kind === 'luxury' && <g stroke="#d4b570"><rect x="6" y="6" width="108" height="168" /><rect x="10" y="10" width="100" height="160" strokeWidth=".6" /><path d="M50 9L60 4L70 9L60 14ZM50 171L60 166L70 171L60 176Z" fill="#d4b570" /></g>}
      {kind === 'retro' && <g stroke="#9e623c" strokeWidth="2"><rect x="7" y="7" width="106" height="166" rx="10" /><path d="M20 154H100M20 159H70" /></g>}
      {kind === 'film' && <g fill="#eee7da">{Array.from({ length: 8 }, (_, index) => <React.Fragment key={index}><rect x="3" y={9 + index * 21} width="5" height="9" rx="1" /><rect x="112" y={9 + index * 21} width="5" height="9" rx="1" /></React.Fragment>)}</g>}
      {kind === 'cute' && <g fill="#dda7b1"><path d="M12 20C-3 9 9 0 12 9C20-3 30 12 12 20ZM106 170C90 159 103 148 106 159C114 147 124 161 106 170Z" /><circle cx="15" cy="161" r="4" fill="#e3c98e" /><circle cx="105" cy="19" r="4" fill="#e3c98e" /></g>}
      {kind === 'editorial' && <g stroke="#252420"><path d="M9 20H111M9 151H111" /><path d="M9 11H42" strokeWidth="4" /><path d="M9 163H46M83 163H111" strokeWidth="2" /></g>}
      {kind === 'futuristic' && <g stroke="#98e8df" strokeWidth="1.5"><path d="M7 49V17L17 7H49M71 173H103L113 163V131M7 142V164H29M91 7H113V29" /><path d="M4 79V102M116 79V102" strokeWidth="3" /></g>}
      {kind === 'artistic' && <g stroke="#c18170" strokeWidth="5" opacity=".85"><path d="M7 47Q17 32 9 8Q26 16 45 7M77 173Q98 162 112 170Q102 150 115 129" /><path d="M6 158L20 165M101 14L114 23" stroke="#a6bba0" strokeWidth="7" /></g>}
    </svg>
  </span>
}
