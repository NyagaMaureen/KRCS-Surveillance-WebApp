import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const SEVERITY_BADGE = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  medium: 'bg-blue-500',
  low: 'bg-emerald-500',
}

function pinMarkup() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2ZM12 11.5C10.62 11.5 9.5 10.38 9.5 9C9.5 7.62 10.62 6.5 12 6.5C13.38 6.5 14.5 7.62 14.5 9C14.5 10.38 13.38 11.5 12 11.5Z" fill="white"/>
  </svg>`
}

function buildDivIcon(color, size) {
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">${pinMarkup()}</div>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

function PopupCard({ marker }) {
  const popup = marker.popup || {}
  const link = marker.kind === 'report' ? `/reports/${marker.id}` : `/alerts-signals/${marker.id}`

  return (
    <div className="min-w-[190px]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-gray-900">{popup.title}</span>
        {popup.severity && (
          <span className={['text-[8px] font-medium text-white px-1.5 py-0.5 rounded uppercase shrink-0', SEVERITY_BADGE[popup.severity] || 'bg-gray-400'].join(' ')}>
            {popup.severity}
          </span>
        )}
      </div>
      {popup.location && <div className="text-xs text-gray-400 mb-0.5">{popup.location}</div>}
      {popup.affected != null && <div className="text-[10px] text-gray-400 mb-2">{popup.affected} affected</div>}
      <Link to={link} className="text-xs font-medium text-red-600 hover:underline">View</Link>
    </div>
  )
}

function FitBounds({ markers }) {
  const map = useMap()

  useEffect(() => {
    if (!markers.length) return
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [markers, map])

  return null
}

export default function MapView({ markers = [], center = [1.5, 37.5], zoom = 6 }) {
  const iconedMarkers = useMemo(
    () => markers.map((m) => ({ ...m, icon: buildDivIcon(m.color, m.kind === 'report' ? 24 : 36) })),
    [markers]
  )

  return (
    <MapContainer center={center} zoom={zoom} zoomControl={false} className="w-full h-full">
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <ZoomControl position="bottomright" />
      {markers.length > 0 && <FitBounds markers={markers} />}
      {iconedMarkers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={m.icon}>
          <Popup>
            <PopupCard marker={m} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
