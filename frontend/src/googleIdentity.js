let scriptPromise = null
let configuredClientId = ''
let activeCredentialHandler = null

export function loadGoogleIdentity() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google sign-in is only available in a browser.'))
  }

  const identity = window.google?.accounts?.id
  if (identity) return Promise.resolve(identity)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.onload = () => {
      const loadedIdentity = window.google?.accounts?.id
      if (loadedIdentity) resolve(loadedIdentity)
      else reject(new Error('Google Identity Services did not initialize.'))
    }
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded.'))
    document.head.appendChild(script)
  }).catch((error) => {
    scriptPromise = null
    throw error
  })

  return scriptPromise
}

export function initializeGoogleIdentity(identity, clientId, onCredential) {
  activeCredentialHandler = onCredential
  if (configuredClientId === clientId) return

  identity.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response?.credential) activeCredentialHandler?.(response.credential)
    },
  })
  configuredClientId = clientId
}

export function clearGoogleIdentityHandler(onCredential) {
  if (activeCredentialHandler === onCredential) activeCredentialHandler = null
}
