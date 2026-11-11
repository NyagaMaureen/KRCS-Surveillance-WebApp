import { Mic } from 'lucide-react'

// What was picked out of a voice note's transcript (surveillance/voice_extract.py): symptoms, age, people, deaths,
// animal contact. A suggestion for the officer to check against the recording; nothing is added to the report.
// Symptoms the reporter did not tick are highlighted, since they can change the suspected disease.
export default function VoicePicked({ picked }) {
  if (!picked) return null
  if (picked.empty) {
    return <p className="mt-2 text-xs text-gray-500">Nothing to pick out of this voice note (no symptoms, age or numbers heard).</p>
  }
  const extra = (picked.symptoms || []).filter((s) => !s.onReport)
  const facts = [
    picked.ageGroup && `Age: ${picked.ageYears != null ? `${picked.ageYears} years, ` : ''}${picked.ageGroup}`,
    picked.people && `People sick: ${picked.people}`,
    picked.death && 'A death is mentioned',
    picked.animal && `Animal contact: ${picked.animal}`,
  ].filter(Boolean)
  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
        <Mic className="w-3.5 h-3.5" aria-hidden="true" />
        Picked from the voice note
      </div>
      {(picked.symptoms || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.symptoms.map((s) => (
            <span
              key={s.name}
              className={s.onReport
                ? 'rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-700'
                : 'rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900'}
              title={s.onReport ? 'Also ticked by the reporter' : 'Not ticked by the reporter'}
            >
              {s.name}{s.onReport ? '' : ' · not ticked'}
            </span>
          ))}
        </div>
      )}
      {facts.length > 0 && <p className="mt-2 text-xs leading-5 text-gray-800">{facts.join(' · ')}</p>}
      <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
        Picked automatically from the transcript{extra.length ? `; ${extra.length === 1 ? '1 sign was' : `${extra.length} signs were`} not ticked by the reporter` : ''}. Listen to the recording before using it.
      </p>
    </div>
  )
}
