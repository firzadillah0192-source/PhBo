import React from 'react'
import { LANGUAGES, setLanguage, useLanguage, useT } from '../../i18n.js'

// Compact ID / EN toggle for the nav, so guests can switch language without an account.
export function LanguageToggle() {
  const language = useLanguage()
  const t = useT()
  return (
    <div className="language-toggle" role="group" aria-label={t('Bahasa', 'Language')}>
      {LANGUAGES.map(([code]) => <button key={code} type="button" lang={code} aria-pressed={language === code} className={language === code ? 'is-active' : ''} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}
    </div>
  )
}

// Full-name selector for the profile form.
export function LanguageSelect() {
  const language = useLanguage()
  const t = useT()
  return (
    <label className="language-select">
      <span>{t('Bahasa tampilan', 'Display language')}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value)}>
        {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <small>{t('Disimpan di perangkat ini.', 'Saved on this device.')}</small>
    </label>
  )
}
