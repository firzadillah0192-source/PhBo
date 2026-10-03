import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearGoogleIdentityHandler,
  initializeGoogleIdentity,
  loadGoogleIdentity,
} from './googleIdentity.js'

test('loads Google Identity Services and dispatches the verified credential callback', async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  let injectedScript
  let initializeCount = 0
  let googleCallback
  const identity = {
    initialize(options) {
      initializeCount += 1
      googleCallback = options.callback
    },
  }

  globalThis.window = {}
  globalThis.document = {
    createElement: () => ({}),
    head: {
      appendChild(script) {
        injectedScript = script
        globalThis.window.google = { accounts: { id: identity } }
        script.onload()
      },
    },
  }

  try {
    assert.equal(await loadGoogleIdentity(), identity)
    assert.equal(injectedScript.src, 'https://accounts.google.com/gsi/client')
    assert.equal(injectedScript.async, true)
    assert.equal(injectedScript.referrerPolicy, 'strict-origin-when-cross-origin')

    const received = []
    const onCredential = (credential) => received.push(credential)
    initializeGoogleIdentity(identity, 'web-client-id', onCredential)
    googleCallback({ credential: 'signed-google-id-token' })
    assert.deepEqual(received, ['signed-google-id-token'])

    initializeGoogleIdentity(identity, 'web-client-id', onCredential)
    assert.equal(initializeCount, 1)
    clearGoogleIdentityHandler(onCredential)
    googleCallback({ credential: 'ignored-after-unmount' })
    assert.deepEqual(received, ['signed-google-id-token'])
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})
