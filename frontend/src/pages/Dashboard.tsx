import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, clearToken } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import type { MonitorStatus } from '../types'

export default function Dashboard() {
  const [statuses, setStatuses]     = useState<MonitorStatus[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const navigate = useNavigate()

  async function load() {
    try {
      setStatuses(await api.getStatus())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  const up      = statuses.filter(s => s.last_result?.status === 'up').length
  const down    = statuses.filter(s => s.last_result?.status === 'down').length
  const unknown = statuses.filter(s => !s.last_result || s.last_result.status === 'unknown').length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Monitoring</h1>
        <div className="flex gap-3 items-center">
          <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Settings</Link>
          <button
            onClick={() => { clearToken(); navigate('/login') }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
          >
            Sign out
          </button>

          <Link
            to="/monitors/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add Monitor
          </Link>
        </div>
      </header>

      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex gap-3 mb-6">
          {[
            { label: 'UP',      count: up,      color: 'text-green-600' },
            { label: 'DOWN',    count: down,    color: 'text-red-600'   },
            { label: 'UNKNOWN', count: unknown, color: 'text-gray-400'  },
          ].map(({ label, count, color }) => (
            <div key={label} className="bg-white rounded-xl border px-5 py-3 text-center min-w-[80px]">
              <div className={`text-2xl font-bold ${color}`}>{count}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 mb-4 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-gray-400 text-center py-16">Loading…</div>
        ) : statuses.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg mb-2">No monitors yet</p>
            <p className="text-sm mb-1">
              <Link to="/monitors/new" className="text-blue-600 hover:underline">Add your first monitor →</Link>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {statuses.map(s => (
              <div
                key={s.monitor_id}
                onClick={() => navigate(`/monitors/${s.monitor_id}`)}
                className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <h3 className="font-medium text-gray-900 truncate">{s.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wide">{s.monitor_type}</p>
                  </div>
                  <StatusBadge status={s.last_result?.status ?? 'unknown'} />
                </div>

                {s.last_result ? (
                  <div className="flex gap-3 text-xs text-gray-500">
                    {s.last_result.latency_ms != null && (
                      <span className="font-mono">{s.last_result.latency_ms.toFixed(1)} ms</span>
                    )}
                    <span>{new Date(s.last_result.checked_at).toLocaleTimeString()}</span>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Not checked yet</p>
                )}

                {!s.enabled && (
                  <div className="mt-2">
                    <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded">Disabled</span>
                  </div>
                )}

                {s.last_result?.error_message && (
                  <p className="text-xs text-red-500 mt-2 truncate">{s.last_result.error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}