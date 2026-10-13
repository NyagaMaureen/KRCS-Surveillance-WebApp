import { Fragment, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { Navigation, Share2, MessageCircle, AlertTriangle } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const PILOT_CENTER = [0.0512, 40.3129]
const PILOT_ZOOM = 11

const SEVERITY_BADGE = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  medium: 'bg-blue-500',
  low: 'bg-emerald-500',
}

const PULSE_CSS = `
@keyframes map-critical-pulse { 0% { transform: scale(0.6); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } }
.leaflet-container, .leaflet-popup-content-wrapper, .leaflet-popup-content { font-family: inherit; }
.leaflet-popup-content-wrapper { border-radius: 16px; padding: 0; box-shadow: 0 10px 30px rgba(17,24,39,0.18); }
.leaflet-popup-content { margin: 0; line-height: 1.4; }
.leaflet-popup-content p { margin: 0; }
.leaflet-popup-close-button { top: 10px !important; right: 10px !important; }
.map-pulse-ring { border-radius: 9999px; border: 2px solid #DC2626; background: rgba(220,38,38,0.25); animation: map-critical-pulse 1.8s ease-out infinite; pointer-events: none; }
`

function radiusFor(affected, min, max) {
  const n = Number(affected) || 0
  const range = max - min
  return Math.round(min + Math.min(1, Math.log10(n + 1) / 3) * range)
}

function pulseIcon(radius) {
  const size = radius * 2 + 12
  return L.divIcon({
    html: `<div class="map-pulse-ring" style="width:${size}px;height:${size}px"></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function whyFlagged(sources) {
  const list = Array.isArray(sources) ? sources : sources ? [sources] : []
  const reasons = []
  for (const s of list) {
    const key = String(s).toLowerCase()
    let text = null
    if (key.includes('threshold')) text = 'Reached alert threshold'
    else if (key.includes('baseline')) text = 'Well above the usual level'
    else if (key.startsWith('ears') || key.includes('ears_') || key === 'c2' || key === 'c3') text = 'Statistical methods: unusual rise'
    if (text && !reasons.includes(text)) reasons.push(text)
  }
  return reasons
}

function periodText(a) {
  const weeks = Number(a.weeks) || 0
  const range = [a.startDate, a.date].filter(Boolean).join(' – ')
  return `${range}${weeks ? ` · ${weeks} week${weeks === 1 ? '' : 's'}` : ''}`
}

function PopupCard({ alert: a, onToast }) {
  const reasons = whyFlagged(a.sources)
  const mapsLink = `https://www.google.com/maps?q=${a.lat},${a.lng}`
  const shareText = `${a.title} – ${a.location}`

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: a.title, text: shareText, url: mapsLink })
      } catch {
        // user cancelled
      }
      return
    }
    try {
      await navigator.clipboard.writeText(mapsLink)
      onToast?.('Location link copied')
    } catch {
      onToast?.('Could not copy link', true)
    }
  }

  const actionCls = 'border border-gray-200 rounded-lg px-3 py-2 text-xs font-medium !text-gray-900 no-underline flex items-center justify-center gap-1.5 hover:bg-gray-50'

  return (
    <div className="w-[290px] p-4">
      <div className="flex items-start gap-2 mb-3 pr-5">
        <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: a.color }} />
        <span className="text-sm font-semibold text-gray-900 leading-snug">{a.title}</span>
      </div>
      <div className="flex items-center flex-wrap gap-2 mb-4">
        <span className={['text-[10px] font-semibold text-white px-2 py-1 rounded-md uppercase tracking-wide', SEVERITY_BADGE[a.severity] || 'bg-gray-400'].join(' ')}>
          {a.severity}
        </span>
        {a.status && <span className="text-xs font-medium bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">{a.status}</span>}
        <span className={['text-xs font-medium rounded-full px-2.5 py-1', a.ongoing ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'].join(' ')}>
          {a.ongoing ? 'Ongoing' : 'Ended'}
        </span>
      </div>
      <div className="space-y-1.5 mb-4">
        {a.location && <div className="text-sm font-medium text-gray-900">{a.location}</div>}
        <div className="text-xs text-gray-500">{periodText(a)}</div>
        <div className="text-xs text-gray-500">
          <span className="font-semibold text-gray-900">{a.affected ?? 0} cases</span>
          {a.peak != null && ` · peak ${a.peak}/week`}
        </div>
      </div>
      {reasons.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5 mb-3">
          <div className="font-medium text-gray-900 mb-0.5">Why flagged</div>
          {reasons.join(', ')}
        </div>
      )}
      {a.surge && (
        <div className="flex items-center gap-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Check reporting
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link to={`/alerts-signals/${a.id}`} className="bg-red-600 !text-white rounded-lg px-3 py-2 text-xs font-medium text-center no-underline hover:bg-red-700">
          View alert
        </Link>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className={actionCls}
        >
          <Navigation className="w-3.5 h-3.5" /> Directions
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={share} className={actionCls}>
          <Share2 className="w-3.5 h-3.5" /> Share location
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${mapsLink}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={actionCls}
        >
          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
        </a>
      </div>
      <div className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-100">
        {Number(a.lat).toFixed(5)}, {Number(a.lng).toFixed(5)}
      </div>
    </div>
  )
}

function FitBounds({ markers }) {
  const map = useMap()

  useEffect(() => {
    if (!markers.length) {
      map.setView(PILOT_CENTER, PILOT_ZOOM)
      return
    }
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]))
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
  }, [markers, map])

  return null
}

function FocusController({ focus, markerRefs }) {
  const map = useMap()

  useEffect(() => {
    if (!focus) return
    const ref = markerRefs.current[focus.id]
    if (!ref) return
    const { lat, lng } = ref.getLatLng()
    map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.8 })
    map.once('moveend', () => ref.openPopup())
  }, [focus, map, markerRefs])

  return null
}

export default function MapView({ alerts = [], hoveredId = null, focus = null, onToast }) {
  const markerRefs = useRef({})

  const sorted = [...alerts].sort(
    (a, b) => (a.severity === 'critical' ? 1 : 0) - (b.severity === 'critical' ? 1 : 0)
  )

  return (
    <>
      <style>{PULSE_CSS}</style>
      <MapContainer center={PILOT_CENTER} zoom={PILOT_ZOOM} zoomControl={false} className="w-full h-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ZoomControl position="bottomright" />
        <FitBounds markers={alerts} />
        <FocusController focus={focus} markerRefs={markerRefs} />
        {sorted.map((a) => {
          const color = a.color
          const radius = radiusFor(a.affected, 8, 18)
          const hovered = hoveredId === a.id
          const opacity = a.ongoing === false ? 0.5 : 1
          return (
            <Fragment key={a.id}>
              {a.severity === 'critical' && a.ongoing !== false && (
                <Marker position={[a.lat, a.lng]} icon={pulseIcon(radius)} interactive={false} keyboard={false} zIndexOffset={-100} />
              )}
              <CircleMarker
                ref={(el) => {
                  if (el) markerRefs.current[a.id] = el
                  else delete markerRefs.current[a.id]
                }}
                center={[a.lat, a.lng]}
                radius={hovered ? radius + 3 : radius}
                pathOptions={{
                  color: hovered ? '#111827' : '#fff',
                  weight: hovered ? 3 : 2,
                  fillColor: color,
                  fillOpacity: 0.9 * opacity,
                  opacity,
                }}
              >
                <Popup>
                  <PopupCard alert={a} onToast={onToast} />
                </Popup>
              </CircleMarker>
            </Fragment>
          )
        })}
      </MapContainer>
    </>
  )
}
