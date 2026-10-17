import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Chip, TextField } from '../components/ui'
import { Logo } from '../components/AdminShell'
import { homeFor, useRole } from '../lib/role'

export function Login() {
  const navigate = useNavigate()
  const { role } = useRole()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return setError('Enter the admin access token.')
    setError(undefined)
    setBusy(true)
    // Production calls POST /api/admin/login; the mock accepts any non-empty token.
    window.setTimeout(() => navigate(homeFor(role), { replace: true }), 500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="flex w-full max-w-[420px] flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-e2" noValidate>
        <div className="flex items-center gap-2">
          <Logo />
          <Chip>Admin</Chip>
        </div>
        <div>
          <h1 className="t-h2">Admin console</h1>
          <p className="t-body-s mt-1 text-text-muted">Enter the admin access token to continue.</p>
        </div>
        <TextField
          label="Admin access token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          error={error}
          helper="One shared token. Your session uses the default role."
        />
        <Button type="submit" loading={busy} className="!h-12 !rounded-md !text-base">
          Sign in
        </Button>
      </form>
    </div>
  )
}
