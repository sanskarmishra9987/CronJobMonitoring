import { useEffect, useState } from 'react'
import { useAlertSocket, type AlertEvent } from '../hooks/useAlertSocket'

export default function AlertToastStack() {
  const alerts = useAlertSocket()
  const [toasts, setToasts] = useState<AlertEvent[]>([])

  useEffect(() => {
    if (alerts.length === 0) return
    const latest = alerts[0]
    setToasts(prev => [latest, ...prev].slice(0, 5))

    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t !== latest))
    }, 6000)
    return () => clearTimeout(timer)
  }, [alerts])

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t, i) => {
        const isDown = t.new_status === 'down'
        const isUp = t.new_status === 'up'
        return (
          <div
            key={`${t.monitor_id}-${t.timestamp}-${i}`}
            className={`rounded-lg border p-3 shadow-md text-sm ${
              isDown
                ? 'bg-red-50 border-red-200 text-red-700'
                : isUp
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t.name}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x !== t))}
                className="text-xs opacity-60 hover:opacity-100 ml-2"
              >
                ✕
              </button>
            </div>
            <p className="text-xs mt-0.5">
              {t.old_status.toUpperCase()} → {t.new_status.toUpperCase()}
            </p>
            {t.error && <p className="text-xs mt-1 truncate opacity-80">{t.error}</p>}
          </div>
        )
      })}
    </div>
  )
}