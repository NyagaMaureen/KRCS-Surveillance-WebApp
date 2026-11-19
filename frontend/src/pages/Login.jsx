import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { login, requestPasswordReset } from '../api/frappe'
import { AuthLayout, PasswordField, AUTH_INPUT, AUTH_BUTTON, nextPath } from '../components/auth/AuthLayout'

// Login, and "Forgot password?" on the same page (KRCS 18 Nov 2026): the reset email links to the app's own
// "Choose a new password" page. An expired password is changed right here, then the person is signed in.
export default function Login() {
  const [mode, setMode] = useState('login')   // login | forgot
  const [usr, setUsr] = useState('')
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const [loading, setLoading] = useState(false)
  const justReset = new URLSearchParams(window.location.search).get('reset') === '1'   // back from "Choose a new password"

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await login(usr, pwd)
      if (r.ok) {
        // Full page load: the CSRF token and capabilities come with the page, and the guest ones are now stale.
        window.location.assign(nextPath())
      } else if (r.expiredKey) {
        const next = new URLSearchParams(window.location.search).get('next')
        window.location.assign(`/surveillance/reset-password?key=${encodeURIComponent(r.expiredKey)}&expired=1${next ? `&next=${encodeURIComponent(next)}` : ''}`)
      } else {
        setError(r.message)
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await requestPasswordReset(usr.trim())
      setSent(r?.message || 'If this email is linked to an account, a password reset link is on its way. It can take a few minutes to arrive, so check your spam folder too.')
    } catch (err) {
      setError(err.message || 'Could not send the email. Try again in a few minutes.')
    } finally {
      setLoading(false)
    }
  }

  function switchTo(m) {
    setMode(m)
    setError('')
    setSent('')
  }

  if (mode === 'forgot') {
    return (
      <AuthLayout title="Reset your password" subtitle="Enter the email you use to log in. We'll send you a link to reset your password.">
        {sent ? (
          <div>
            <p className="text-sm text-gray-900 mb-6">{sent}</p>
            <button type="button" onClick={() => switchTo('login')} className={AUTH_BUTTON}>Back to login</button>
          </div>
        ) : (
          <form onSubmit={handleForgot}>
            <label className="block text-sm font-semibold text-gray-800 mb-1">Email</label>
            <input value={usr} onChange={(e) => setUsr(e.target.value)} type="email" required autoFocus autoComplete="email"
              className={`${AUTH_INPUT} mb-6`} placeholder="Enter the email you sign in with" />
            {error && <p className="text-red-700 text-sm mb-4">{error}</p>}
            <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mb-4`}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <p className="text-center text-sm text-gray-600">
              Remembered it? <button type="button" onClick={() => switchTo('login')} className="text-red-700 font-medium hover:underline">Back to login</button>
            </p>
          </form>
        )}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Welcome Back!" subtitle="Login to your account">
      <form onSubmit={handleLogin}>
        {justReset && !error && <p className="mb-5 text-sm font-semibold text-green-800">Your password has been changed. Log in with your new password.</p>}
        <label className="block text-sm font-semibold text-gray-800 mb-1">Username or Email</label>
        <input value={usr} onChange={(e) => setUsr(e.target.value)} type="text" required autoComplete="username"
          className={`${AUTH_INPUT} mb-5`} placeholder="Enter your username or email" />
        <PasswordField label="Password" value={pwd} onChange={setPwd} placeholder="Enter your password" autoComplete="current-password" />
        {error && <p className="text-red-700 text-sm mb-4">{error}</p>}
        <button type="submit" disabled={loading} className={`${AUTH_BUTTON} mb-4`}>
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? 'Logging in...' : 'Login'}
        </button>
        <p className="text-center text-sm text-gray-600">
          Forgot Password? <button type="button" onClick={() => switchTo('forgot')} className="text-red-700 font-medium hover:underline">Reset</button>
        </p>
      </form>
    </AuthLayout>
  )
}
