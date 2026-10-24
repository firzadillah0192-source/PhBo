import React from 'react'
import ModeCards from './ModeCards.jsx'
import { modePreviews } from './landingCatalog.js'
import { MODE_NAMES } from '../../creditCatalog.js'
import { modeRoute } from '../../customerRoute.js'
import { useT } from '../../i18n.js'
import './landing.css'
import { DuetEntryLink } from '../customer/NXDuet.jsx'

export default function CreationChooser({ templates, experiences, layouts, onSelect, savedFlow }) {
  const t = useT()
  const canResume = ['CLASSIC', 'BASIC', 'ADVANCED'].includes(savedFlow?.mode) && savedFlow?.uploadId
  return <main id="studio-main" className="creation-chooser landing-container" tabIndex="-1">
    <div className="studio-breadcrumb"><a className="studio-back" href="/"><span aria-hidden="true">←</span> {t('Kembali ke beranda', 'Back to home')}</a><span>{t('Studio / pilih mode Anda', 'Studio / choose your mode')}</span></div>
    <header>
      <p className="landing-eyebrow">{t('Momen Anda dimulai di sini', 'Your moment starts here')}</p>
      <h1>{t('Pilih cara Anda berkreasi.', 'Choose how you want to create.')}</h1>
      <p>{t('Strip foto klasik, dunia pilihan, atau sesuatu yang benar-benar baru.', 'A classic photo strip, a curated world, or something entirely new.')}</p>
    </header>
    {canResume && <p className="creation-resume">{t('Sudah mulai?', 'Already started?')} <a href={modeRoute(savedFlow.mode)}>{t(`Lanjutkan kreasi ${MODE_NAMES[savedFlow.mode]} Anda`, `Resume your ${MODE_NAMES[savedFlow.mode]} creation`)} <span aria-hidden="true">→</span></a></p>}
    <ModeCards previews={modePreviews({ templates, experiences, layouts })} onSelect={onSelect} chooser />
    <DuetEntryLink />
    <p className="creation-footnote">{t('Pilih mode untuk menjelajah. Tidak perlu masuk untuk memulai.', 'Choose a mode to explore. No sign-in needed to get started.')}</p>
  </main>
}
