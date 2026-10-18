import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LANGUAGE, getLanguage, localeFor, normalizeLanguage, setLanguage, tr } from './i18n.js'

test('Indonesian is the default customer language', () => {
  assert.equal(DEFAULT_LANGUAGE, 'id')
  assert.equal(getLanguage(), 'id')
  assert.equal(tr('Tambah kredit', 'Add credits'), 'Tambah kredit')
})

test('only supported languages are accepted', () => {
  assert.equal(normalizeLanguage('en'), 'en')
  assert.equal(normalizeLanguage('id'), 'id')
  assert.equal(normalizeLanguage('fr'), 'id')
  assert.equal(normalizeLanguage(null), 'id')
})

test('switching language changes copy and locale, and unknown codes fall back to Indonesian', () => {
  setLanguage('en')
  assert.equal(getLanguage(), 'en')
  assert.equal(tr('Tambah kredit', 'Add credits'), 'Add credits')
  assert.equal(localeFor(), 'en-US')
  setLanguage('zz')
  assert.equal(getLanguage(), 'id')
  assert.equal(localeFor(), 'id-ID')
})
