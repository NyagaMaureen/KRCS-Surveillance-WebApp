import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getPasswordRules, resetPassword } from '../api/frappe'
import { AuthLayout, PasswordField, AUTH_BUTTON } from '../components/auth/AuthLayout'

// "Choose a new password" (KRCS 18 Nov 2026): opened from the reset email, or straight after login when the password
// has expired. After saving, the person logs in with the new password. The Security Settings (password rules,
// strength, sign out other sessions) are applied by the server.
export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search)
  const key = params.get('key') || ''
  const expired = params.get('expired') === '1'
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [rules, setRules] = useState(null)
  const [error, setError] = useState('')
  const [linkBad, setLinkBad] = useState(!key)
  const [loading, setLoading] = useState(false)

  useEffect(() => { getPasswordRules().then(setRules).catch(() => {}) }, [])

  async function save(e) {
    e.preventDefault()
    setError('')
    if (pwd !== confirm) return setError('The two passwords do not match.')
    setLoading(true)
    try {
      await resetPassword(key, pwd)
      const next = new URLSearchParams(window.location.search).get('next')
      window.location.assign(`/surveillance/login?reset=1${next ? `&next=${encodeURIComponent(next)}` : ''}`)
    } catch (err) {
      if (err.linkInvalid) setLinkBad(true)
      setError(err.message || 'Could not save the new password.')
      setLoading(false)
    }
  }

  if (linkBad) {
    return (
      <AuthLayout title="Link not valid" subtitle="This password link has expired or was already used.">
        {error && <p className="text-sm text-gray-900 mb-6">{error}</p>}
        <a href="/surveillance/login" className={AUTH_BUTTON}>Back to login</a>
        <p className="mt-4 text-center text-sm text-gray-600">On the login page, choose Forgot Password? Reset to get a new link.</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={expired ? 'Your password has expired' : 'Choose a new password'}
      subtitle={expired ? 'Choose a new password, then log in with it.' : 'Type your new password twice, then log in with it.'}>
      <form onSubmit={save}>
        <PasswordField label="New password" value={pwd} onChange={setPwd} placeholder="Enter a new password" autoComplete="new-password" autoFocus />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="Enter it again" autoComplete="new-password" />
        {rules && <p className="-mt-2 mb-5 text-sm text-gray-700">{rules.hint}</p>}
        {error && <p className="text-red-700 text-sm mb-4">{error}</p>}
        <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mb-4`}>
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? 'Saving...' : 'Save password'}
        </button>
        <p className="text-center text-sm text-gray-600"><a href="/surveillance/login" className="text-red-700 font-medium hover:underline">Back to login</a></p>
      </form>
    </AuthLayout>
  )
}
