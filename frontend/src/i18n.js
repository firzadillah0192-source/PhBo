import { useCallback, useSyncExternalStore } from 'react'

// Customer UI language. Indonesian is the default; the choice is a per-device preference
// (like the other Personalization settings) and never touches the account or the API.
export const LANGUAGES = [['id', 'Bahasa Indonesia'], ['en', 'English']]
export const DEFAULT_LANGUAGE = 'id'
const STORAGE_KEY = 'nxbooth.lang'
const listeners = new Set()

export function normalizeLanguage(value) {
  return LANGUAGES.some(([code]) => code === value) ? value : DEFAULT_LANGUAGE
}

function readStored() {
  try { return normalizeLanguage(globalThis.localStorage?.getItem(STORAGE_KEY)) } catch { return DEFAULT_LANGUAGE }
}

let current = readStored()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function getLanguage() { return current }

export function setLanguage(next) {
  const language = normalizeLanguage(next)
  if (language === current) return
  current = language
  try { globalThis.localStorage?.setItem(STORAGE_KEY, language) } catch { /* private mode: keep it for this tab */ }
  if (typeof document !== 'undefined') document.documentElement.lang = language
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// tr(id, en): the Indonesian copy is the source text, the English copy is its translation.
export function tr(id, en, language = current) {
  return language === 'en' ? en : id
}

export function localeFor(language = current) { return language === 'en' ? 'en-US' : 'id-ID' }

export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage)
}

// const t = useT(); t('Tambah kredit', 'Add credits')
export function useT() {
  const language = useLanguage()
  return useCallback((id, en) => tr(id, en, language), [language])
}

export function useLocale() { return localeFor(useLanguage()) }
