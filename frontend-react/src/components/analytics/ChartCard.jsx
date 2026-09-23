export default function ChartCard({ title, height = 'h-64 sm:h-80', legend, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm sm:text-base font-medium text-gray-900">{title}</h3>
        {legend}
      </div>
      <div className={['relative w-full', height].join(' ')}>
        {children}
      </div>
    </div>
  )
}
