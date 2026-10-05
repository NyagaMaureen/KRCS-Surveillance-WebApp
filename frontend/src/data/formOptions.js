export const STATUSES = ['Submitted', 'Reviewed', 'Investigating', 'Linked', 'Closed']
export const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'Critical']
export const AGE_BANDS = ['Under 5', '5-17', '18-59', '60+']
export const CATEGORIES = ['Human Disease', 'Animal Disease', 'All Diseases']
export const SEXES = ['Male', 'Female', 'Mixed']
export const NATIONALITIES = ['Kenyan', 'Non-Kenyan', 'Refugee', 'Prefer not to say']
export const CHANNELS = ['Web', 'Mobile', 'SMS', 'USSD', 'WhatsApp']

export const AGE_GROUPS = [
  { value: 'Under 1', label: 'Under 1' },
  { value: '1-4 years', label: '1\u20134 years' },
  { value: '5-14 years', label: '5\u201314 years' },
  { value: '15+ years', label: '15+ years' },
]

export const ANIMAL_EXPOSURE_OPTIONS = [
  { value: 'None', label: 'No' },
  { value: 'Bite or scratch', label: 'Bitten or scratched' },
  { value: 'Handled sick or dead animal', label: 'Handled a sick or dead animal' },
]

export const STATUS_COLORS = {
  Submitted: 'bg-amber-50 text-amber-600',
  Reviewed: 'bg-green-50 text-green-600',
  Linked: 'bg-red-50 text-red-600',
  Investigating: 'bg-blue-50 text-blue-600',
  Closed: 'bg-gray-100 text-gray-500',
}
export const CHANNEL_COLORS = {
  Web: 'bg-indigo-50 text-indigo-600',
  Mobile: 'bg-purple-50 text-purple-600',
  SMS: 'bg-green-50 text-green-600',
  USSD: 'bg-amber-50 text-amber-600',
  WhatsApp: 'bg-gray-100 text-gray-600',
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
