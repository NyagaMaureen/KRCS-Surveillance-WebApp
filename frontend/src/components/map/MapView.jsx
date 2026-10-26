import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { Navigation, Share2, MessageCircle, AlertTriangle } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
export const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const PILOT_CENTER = [0.0512, 40.3129]
const PILOT_ZOOM = 11

const SEVERITY_BADGE = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  standard: 'bg-blue-500',
}
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', standard: 'Standard' }

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

function relTime(v) {
  const t = new Date(String(v || '').replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)} days ago`
}

function PopupCard({ event: a, onToast }) {
  const mapsLink = `https://www.google.com/maps?q=${a.lat},${a.lng}`
  const place = [a.area, a.subCounty].filter(Boolean).join(', ')
  const shareText = `${a.title}${place ? ` – ${place}` : ''}`
  const waiting = a.status === 'New' && Number(a.openHours) > 24
  const sources = Array.isArray(a.sources) ? a.sources.join(', ') : a.sources

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
          {SEVERITY_LABEL[a.severity] || a.severity}
        </span>
        {a.status && <span className="text-xs font-medium bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">{a.status}</span>}
      </div>
      <div className="space-y-1.5 mb-4">
        <div className="text-xs text-gray-500">
          <span className="font-semibold text-gray-900">{a.people ?? 0} people</span>
          {` · ${a.reports ?? 0} reports`}
          {sources && ` · ${sources}`}
          {Number(a.deaths) > 0 && <span className="font-semibold text-red-600">{` · ${a.deaths} ${Number(a.deaths) === 1 ? 'death' : 'deaths'}`}</span>}
        </div>
        {place && <div className="text-sm font-medium text-gray-900">{place}</div>}
        <div className="flex items-center flex-wrap gap-2 text-xs text-gray-500">
          <span>First reported {relTime(a.firstSeen)}</span>
          {waiting && (
            <span className="font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
              {Number(a.openHours) < 48 ? `Waiting ${a.openHours}h` : `Waiting ${Math.floor(a.openHours / 24)} days`}
            </span>
          )}
        </div>
      </div>
      {a.dataWarning && (
        <div className="flex items-center gap-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {a.dataWarning}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link to={`/alerts-signals/${a.id}`} className="bg-red-600 !text-white rounded-lg px-3 py-2 text-xs font-medium text-center no-underline hover:bg-red-700">
          Open in Review Queue
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
      {a.linkedAlert && (
        <div className="mt-3 text-xs">
          <Link to={`/epi-trends/${a.linkedAlert.id}`} className="font-medium !text-red-600 hover:underline">
            Outbreak alert
          </Link>
        </div>
      )}
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

const GROUP_METRES = 30
const SPREAD_PX = 25

function groupEvents(events) {
  const groups = []
  events.forEach((e) => {
    const ll = L.latLng(Number(e.lat), Number(e.lng))
    const g = groups.find((x) => x.center.distanceTo(ll) <= GROUP_METRES)
    if (g) {
      g.items.push(e)
      const n = g.items.length
      g.center = L.latLng(
        g.items.reduce((sum, it) => sum + Number(it.lat), 0) / n,
        g.items.reduce((sum, it) => sum + Number(it.lng), 0) / n
      )
    } else {
      groups.push({ center: ll, items: [e] })
    }
  })
  return groups
}

function FocusController({ focus, markerRefs, centersRef }) {
  const map = useMap()

  useEffect(() => {
    if (!focus) return
    const ref = markerRefs.current[focus.id]
    const center = centersRef.current[focus.id]
    if (!ref || !center) return
    map.flyTo(center, Math.max(map.getZoom(), 13), { duration: 0.8 })
    map.once('moveend', () => setTimeout(() => ref.openPopup(), 50))
  }, [focus, map, markerRefs, centersRef])

  return null
}

function Markers({ events, hoveredId, onToast, markerRefs, centersRef }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })

  const groups = useMemo(() => groupEvents(events), [events])

  const placed = []
  const centers = {}
  groups.forEach((g) => {
    const n = g.items.length
    const base = map.project(g.center, zoom)
    g.items.forEach((a, i) => {
      centers[a.id] = g.center
      if (n === 1) {
        placed.push({ a, pos: g.center, center: null })
        return
      }
      const angle = (2 * Math.PI * i) / n - Math.PI / 2
      const pt = L.point(base.x + SPREAD_PX * Math.cos(angle), base.y + SPREAD_PX * Math.sin(angle))
      placed.push({ a, pos: map.unproject(pt, zoom), center: g.center })
    })
  })
  centersRef.current = centers

  const sorted = placed.sort(
    (x, y) => (x.a.severity === 'critical' ? 1 : 0) - (y.a.severity === 'critical' ? 1 : 0)
  )

  return (
    <>
      {sorted.filter((p) => p.center).map(({ a, pos, center }) => (
        <Polyline
          key={`line-${a.id}`}
          positions={[center, pos]}
          interactive={false}
          pathOptions={{ color: '#9CA3AF', weight: 1, opacity: 0.9 }}
        />
      ))}
      {sorted.map(({ a, pos }) => {
        const radius = radiusFor(a.people, 8, 18)
        const hovered = hoveredId === a.id
        const escalated = a.status === 'Escalated'
        return (
          <Fragment key={a.id}>
            {a.severity === 'critical' && a.status === 'New' && (
              <Marker position={pos} icon={pulseIcon(radius)} interactive={false} keyboard={false} zIndexOffset={-100} />
            )}
            <CircleMarker
              ref={(el) => {
                if (el) markerRefs.current[a.id] = el
                else delete markerRefs.current[a.id]
              }}
              center={pos}
              radius={hovered ? radius + 3 : radius}
              pathOptions={{
                color: hovered || escalated ? '#111827' : '#fff',
                weight: escalated ? (hovered ? 5 : 4) : hovered ? 3 : 2,
                fillColor: a.color,
                fillOpacity: 0.9,
                opacity: 1,
              }}
            >
              <Popup>
                <PopupCard event={a} onToast={onToast} />
              </Popup>
            </CircleMarker>
          </Fragment>
        )
      })}
    </>
  )
}

export default function MapView({ events = [], hoveredId = null, focus = null, onToast }) {
  const markerRefs = useRef({})
  const centersRef = useRef({})

  return (
    <>
      <style>{PULSE_CSS}</style>
      <MapContainer center={PILOT_CENTER} zoom={PILOT_ZOOM} zoomControl={false} className="w-full h-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ZoomControl position="bottomright" />
        <FitBounds markers={events} />
        <Markers events={events} hoveredId={hoveredId} onToast={onToast} markerRefs={markerRefs} centersRef={centersRef} />
        <FocusController focus={focus} markerRefs={markerRefs} centersRef={centersRef} />
      </MapContainer>
    </>
  )
}
