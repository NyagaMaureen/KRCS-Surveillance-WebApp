// Photos and voice notes (Kenya Data Protection Act 2019): is a person shown or recorded, and if so, who agreed.
// value: { peopleShown: true|false, consent: '' | 'Person agreed' | 'Parent or guardian agreed' }
export const consentOk = (v) => !!v && (v.peopleShown === false || ['Person agreed', 'Parent or guardian agreed'].includes(v.consent))
export const consentFields = (v) => ({
  people_shown: v?.peopleShown ? 1 : 0,
  consent: v?.peopleShown ? v.consent : 'No one',
  consent_recorded_on: v?.at || null,
})

export default function ConsentQuestion({ value, onChange }) {
  const v = value || { peopleShown: false, consent: '' }
  const set = (patch) => onChange({ ...v, ...patch, at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
  return (
    <div className="text-sm text-gray-800">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" checked={!!v.peopleShown} onChange={(e) => set({ peopleShown: e.target.checked, consent: '' })}
          className="mt-0.5 w-4 h-4 accent-red-600 shrink-0" />
        <span>A person can be seen or heard in this photo or recording</span>
      </label>
      {v.peopleShown && (
        <fieldset className="mt-2.5 ml-6">
          <legend className="text-xs text-gray-500 mb-1.5">Who agreed to it?</legend>
          {['Person agreed', 'Parent or guardian agreed'].map((c) => (
            <label key={c} className="flex items-center gap-2 py-0.5 cursor-pointer">
              <input type="radio" name="media-consent" checked={v.consent === c} onChange={() => set({ consent: c })} className="w-4 h-4 accent-red-600" />
              {c === 'Person agreed' ? 'The person agreed' : 'Their parent or guardian agreed (children)'}
            </label>
          ))}
          <p className="text-xs text-gray-500 mt-1">If nobody agreed, remove the photo or recording.</p>
        </fieldset>
      )}
    </div>
  )
}
