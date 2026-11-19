import { useState } from 'react'

// Shared by the login and "Choose a new password" pages (KRCS 18 Nov 2026): logo, title, form on the left, crest on the right.

export const AUTH_INPUT = 'w-full bg-gray-100 rounded-lg px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400'
export const AUTH_BUTTON = 'w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 transition-colors'

/** Where to go after signing in: the page they opened (an alert email link) when it is one of ours, else the dashboard. */
export function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next') || ''
  const ok = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.startsWith('/login') && !next.startsWith('/reset-password')
  return ok ? `/surveillance${next}` : '/surveillance/dashboard'
}

export function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="bg-white min-h-screen w-full flex items-center justify-center">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-[1fr_1.5px_1fr] overflow-hidden">
        <div className="p-10 md:p-14 flex flex-col justify-center">
          <div className="mb-10">
            <img src="/assets/surveillance/images/newlogo.svg" alt="Kenya Red Cross" className="h-10 w-auto object-contain" />
          </div>
          <h1 className="text-3xl font-extrabold text-brand-navy mb-1">{title}</h1>
          <p className="text-gray-600 mb-8">{subtitle}</p>
          {children}
        </div>
        <div className="hidden md:block bg-gray-300"></div>
        <div className="hidden md:flex items-center justify-center bg-white p-10">
          <img src="/assets/surveillance/images/crest.svg" alt="" className="w-80 h-80 object-contain" />
        </div>
      </div>
    </div>
  )
}

/** Password box with the eye toggle used on the login page. */
export function PasswordField({ label, value, onChange, placeholder, autoComplete, autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <>
      <label className="block text-sm font-semibold text-gray-800 mb-1">{label}</label>
      <div className="relative mb-5">
        <input value={value} onChange={(e) => onChange(e.target.value)} type={show ? 'text' : 'password'} required
          autoComplete={autoComplete} autoFocus={autoFocus} className={`${AUTH_INPUT} pr-12`} placeholder={placeholder} />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer transition-colors">
          {!show ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12c2.2 2.7 5.2 4 9 4s6.8-1.3 9-4" />
              <path strokeLinecap="round" d="M7 10.5 5.5 9" />
              <path strokeLinecap="round" d="M12 9.5V8" />
              <path strokeLinecap="round" d="M17 10.5 18.5 9" />
              <path strokeLinecap="round" strokeWidth="2" d="M4 4l16 16" />
            </svg>
          )}
        </button>
      </div>
    </>
  )
}
