import { useEffect, useRef, useState } from 'react'
import { User, Mail, Phone, MapPin, Shield, Lock, CalendarDays, Activity, Pencil, Camera, FileText, CheckCircle2, ArrowRightLeft, Clock, Check } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyAccount, updateMyProfile, changeMyPassword, uploadFile } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'
import { CARD, INPUT, BTN_PRIMARY, BTN_SECONDARY, StatCard, Badge, Toast, Skeleton, shortWhen } from '../components/chp/ui'

const STAT_ICONS = { reports: FileText, followups: CheckCircle2, referrals: ArrowRightLeft, onTime: Clock }

function ReadField({ label, icon: Icon, value }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-800 mb-1">{label}</p>
      <div className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 flex items-center gap-2 text-sm text-gray-600">
        <Icon className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
        <span className="truncate">{value || '—'}</span>
      </div>
    </div>
  )
}

export default function ChpSettings() {
  const { workspace } = useCapabilities()
  const [acc, setAcc] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ old: '', next: '', confirm: '' })
  const [toast, setToast] = useState({ text: '' })
  const fileRef = useRef(null)

  useEffect(() => { getMyAccount().then(setAcc).catch((e) => setError(e.message || 'Could not load your account')) }, [])
  const flash = (text, isError = false) => { setToast({ text, error: isError }); setTimeout(() => setToast({ text: '' }), 3000) }

  async function saveProfile() {
    setSaving(true)
    try {
      setAcc(await updateMyProfile({ phone }))
      setEditing(false)
      flash('Profile updated')
    } catch (e) {
      flash(e.message || 'Could not save', true)
    } finally {
      setSaving(false)
    }
  }

  async function changePhoto(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) return flash('Choose an image', true)
    setSaving(true)
    try {
      const url = await uploadFile(file, 0)
      setAcc(await updateMyProfile({ photo: url }))
      flash('Photo updated')
    } catch (e) {
      flash(e.message || 'Could not upload the photo', true)
    } finally {
      setSaving(false)
    }
  }

  async function savePassword() {
    if (pw.next.length < 8) return flash('The new password needs at least 8 characters', true)
    if (pw.next !== pw.confirm) return flash('The new passwords do not match', true)
    setSaving(true)
    try {
      await changeMyPassword(pw.old, pw.next)
      setPw({ old: '', next: '', confirm: '' })
      setPwOpen(false)
      flash('Password changed')
    } catch (e) {
      flash(e.message || 'Could not change the password', true)
    } finally {
      setSaving(false)
    }
  }

  if (error) return <AppShell><div className={`${CARD} p-10 text-center text-sm text-gray-600`}>{error}</div></AppShell>
  if (!acc) return <AppShell><Skeleton rows={4} /></AppShell>

  const place = [acc.subCounty, acc.region].filter(Boolean).join(', ')

  return (
    <AppShell>
      <div className="flex flex-col gap-5 max-w-5xl">
        <section className="rounded-xl bg-red-600 text-white p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={saving} title="Change photo"
              className="relative w-14 h-14 rounded-full bg-white/20 flex items-center justify-center overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {acc.photo ? <img src={acc.photo} alt="" className="w-full h-full object-cover" /> : <User className="w-6 h-6" aria-hidden="true" />}
              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center"><Camera className="w-4 h-4" aria-hidden="true" /></span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => changePhoto(e.target.files?.[0])} />
            <div>
              <p className="text-lg font-semibold flex items-center gap-2">
                {acc.fullName}
                <span className="rounded-full bg-green-500 px-2 py-0.5 text-[11px] font-medium">{acc.status}</span>
              </p>
              <p className="text-sm text-white/85 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" aria-hidden="true" />{acc.role === 'CHP' ? 'Community Health Promoter' : acc.role}</p>
            </div>
          </div>
          {!editing && (
            <button type="button" onClick={() => { setPhone(acc.phone); setEditing(true) }}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-white/70 text-sm font-medium hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <Pencil className="w-4 h-4" aria-hidden="true" /> Edit profile
            </button>
          )}
        </section>

        {workspace === 'chp' && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {acc.stats.map((s) => <StatCard key={s.key} label={s.label} value={s.value} unit={s.unit} icon={STAT_ICONS[s.key]} hint={s.hint} />)}
        </div>}

        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Personal information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReadField label="First name" icon={User} value={acc.firstName} />
            <ReadField label="Last name" icon={User} value={acc.lastName} />
            <ReadField label="Email address" icon={Mail} value={acc.email} />
            {editing ? (
              <div>
                <p className="text-sm font-medium text-gray-800 mb-1">Phone number</p>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} placeholder="+254 7..." />
              </div>
            ) : <ReadField label="Phone number" icon={Phone} value={acc.phone} />}
            <ReadField label="Location" icon={MapPin} value={place} />
            <ReadField label="Role" icon={Shield} value={acc.role === 'CHP' ? 'Community Health Promoter' : acc.role} />
          </div>
          {editing ? (
            <div className="flex items-center gap-2 mt-4">
              <button type="button" onClick={saveProfile} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(false)} className={BTN_SECONDARY}>Cancel</button>
              <p className="text-xs text-gray-400 ml-2">Name, email, location and role are set by your administrator.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-4">You can change your phone number and photo. Ask your administrator to change anything else.</p>
          )}
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Security</h2>
          <div className="rounded-lg bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-gray-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Change password</p>
                  <p className="text-xs text-gray-500">{acc.lastPasswordReset ? `Last changed ${shortWhen(acc.lastPasswordReset)}` : 'Use at least 8 characters'}</p>
                </div>
              </div>
              {!pwOpen && <button type="button" onClick={() => setPwOpen(true)} className={`${BTN_PRIMARY} h-8 text-xs`}>Update</button>}
            </div>
            {pwOpen && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <input type="password" autoComplete="current-password" aria-label="Current password" placeholder="Current password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} className={INPUT} />
                <input type="password" autoComplete="new-password" aria-label="New password" placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={INPUT} />
                <input type="password" autoComplete="new-password" aria-label="Confirm new password" placeholder="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className={INPUT} />
                <div className="md:col-span-3 flex gap-2">
                  <button type="button" onClick={savePassword} disabled={saving || !pw.old || !pw.next} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Change password'}</button>
                  <button type="button" onClick={() => { setPwOpen(false); setPw({ old: '', next: '', confirm: '' }) }} className={BTN_SECONDARY}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Account details</h2>
          <ul className="rounded-lg bg-gray-50 p-4 flex flex-col gap-3 text-sm text-gray-700">
            <li className="flex items-center gap-3"><CalendarDays className="w-4 h-4 text-gray-400" aria-hidden="true" />Joined {new Date(acc.joined).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</li>
            <li className="flex items-center gap-3"><Shield className="w-4 h-4 text-gray-400" aria-hidden="true" />{acc.role === 'CHP' ? 'Community Health Promoter' : acc.role}</li>
            <li className="flex items-center gap-3"><Activity className="w-4 h-4 text-gray-400" aria-hidden="true" />Last login: {acc.lastLogin ? shortWhen(acc.lastLogin) : '—'}</li>
          </ul>
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-semibold text-gray-900">Permissions</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-4">What your account can do. Set by your administrator.</p>
          {acc.permissions.length ? (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {acc.permissions.map((p) => (
                <li key={p.key} className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2.5">
                  <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="block text-sm text-gray-900">{p.name}</span>
                    <span className="block text-xs text-gray-500">{p.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <Badge>No permissions</Badge>}
        </section>
      </div>
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}
