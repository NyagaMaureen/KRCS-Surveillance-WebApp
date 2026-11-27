import { Navigate, useLocation } from 'react-router-dom'

// The Help Center is now one page per menu item (KRCS 27 Nov 2026): /help-faqs, /help-contact, /help-guides and
// /help-videos (HelpPages.jsx). Old links such as /help-center#contact still land on the right page.
const PAGES = { faqs: '/help-faqs', contact: '/help-contact', guides: '/help-guides', videos: '/help-videos' }

export default function HelpCenter() {
  const { hash } = useLocation()
  return <Navigate to={PAGES[hash.slice(1)] || PAGES.faqs} replace />
}
