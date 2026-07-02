import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'
import * as XLSX from 'xlsx'

type MonitorType = 'ping' | 'tcp' | 'http' | 'postgres' | 'heartbeat' | 'script' | 'docker' | 'zabbix' | 'custom'

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'password' | 'url'
  placeholder?: string
  required?: boolean
}

const TYPE_FIELDS: Record<MonitorType, FieldDef[]> = {
  ping: [
    { key: 'host',       label: 'Host / IP',      type: 'text',   required: true,  placeholder: '192.168.1.1' },
    { key: 'count',      label: 'Ping Count',      type: 'number', placeholder: '3' },
    { key: 'timeout_ms', label: 'Timeout (ms)',    type: 'number', placeholder: '1000' },
  ],
  tcp: [
    { key: 'host', label: 'Host / IP', type: 'text',   required: true },
    { key: 'port', label: 'Port',      type: 'number', required: true, placeholder: '22' },
  ],
  http: [
    { key: 'url',             label: 'URL',                   type: 'url',    required: true, placeholder: 'https://example.com' },
    { key: 'method',          label: 'Method',                type: 'text',   placeholder: 'GET' },
    { key: 'expected_status', label: 'Expected Status Code',  type: 'number', placeholder: '200' },
    { key: 'body_pattern',    label: 'Body Pattern (regex)',   type: 'text',   placeholder: 'optional' },
  ],
  postgres: [
    { key: 'host',       label: 'Host',                            type: 'text',     required: true },
    { key: 'port',       label: 'Port',                            type: 'number',   placeholder: '5432' },
    { key: 'database',   label: 'Database',                        type: 'text',     required: true },
    { key: 'user',       label: 'User',                            type: 'text',     required: true },
    { key: 'password',   label: 'Password',                        type: 'password' },
    { key: 'vault_path', label: 'Vault Path (overrides password)', type: 'text',     placeholder: 'monitors/my-db' },
    { key: 'query',      label: 'Probe Query',                     type: 'text',     placeholder: 'SELECT 1' },
  ],
  heartbeat: [
    { key: 'max_age_secs', label: 'Max time without a check-in (sec)', type: 'number', required: true, placeholder: '120' },
  ],
  script: [
    { key: 'interpreter',  label: 'Interpreter',             type: 'text', placeholder: 'python3' },
    { key: 'script_path',  label: 'Script Path (on server)', type: 'text', required: true, placeholder: '/opt/scripts/check.py' },
  ],
  docker: [
    { key: 'container', label: 'Container Name or ID', type: 'text', required: true, placeholder: 'my-container' },
  ],
  zabbix: [
    { key: 'url',       label: 'Zabbix URL',                    type: 'url',      required: true, placeholder: 'http://localhost:8081' },
    { key: 'username',  label: 'Username',                       type: 'text',     required: true, placeholder: 'Admin' },
    { key: 'password',  label: 'Password',                       type: 'password', required: true },
    { key: 'host_name', label: 'Host Name (as shown in Zabbix)', type: 'text',     required: true, placeholder: 'Zabbix server' },
  ],
  custom: [],
}

// Template data for each type
const TYPE_TEMPLATES: Record<MonitorType, Record<string, string | number>[]> = {
  ping: [
    { name: 'Localhost Ping', monitor_type: 'ping', description: 'Ping local machine', interval_secs: 60, timeout_secs: 10, host: '127.0.0.1', count: 3, timeout_ms: 1000 },
    { name: 'Google DNS Ping', monitor_type: 'ping', description: 'Ping Google DNS', interval_secs: 60, timeout_secs: 10, host: '8.8.8.8', count: 3, timeout_ms: 1000 },
  ],
  tcp: [
    { name: 'Google TCP', monitor_type: 'tcp', description: 'TCP to Google port 80', interval_secs: 60, timeout_secs: 10, host: 'google.com', port: 80 },
    { name: 'Bad Port Test', monitor_type: 'tcp', description: 'Dead port - always DOWN', interval_secs: 60, timeout_secs: 10, host: '127.0.0.1', port: 9999 },
  ],
  http: [
    { name: 'Google HTTP', monitor_type: 'http', description: 'Check Google is up', interval_secs: 60, timeout_secs: 10, url: 'https://www.google.com', method: 'GET', expected_status: 200 },
    { name: 'Broken HTTP', monitor_type: 'http', description: '404 - always DOWN', interval_secs: 60, timeout_secs: 10, url: 'https://httpstat.us/404', method: 'GET', expected_status: 200 },
  ],
  postgres: [
    { name: 'Local DB Check', monitor_type: 'postgres', description: 'Local postgres health', interval_secs: 60, timeout_secs: 10, host: 'localhost', port: 5432, database: 'cronjobs', user: 'postgres', password: 'firefox', query: 'SELECT 1' },
  ],
  heartbeat: [
    { name: 'App Heartbeat', monitor_type: 'heartbeat', description: 'App heartbeat check', interval_secs: 60, timeout_secs: 10, max_age_secs: 120 },
  ],
  script: [
    { name: 'Ok Script', monitor_type: 'script', description: 'Script that passes', interval_secs: 60, timeout_secs: 10, interpreter: 'python3', script_path: 'check_ok.py' },
    { name: 'Fail Script', monitor_type: 'script', description: 'Script that fails', interval_secs: 60, timeout_secs: 10, interpreter: 'python3', script_path: 'check_fail.py' },
  ],
  docker: [
    { name: 'Docker Missing', monitor_type: 'docker', description: 'Non-existent container', interval_secs: 60, timeout_secs: 10, container: 'doesnotexist' },
    { name: 'Docker Running', monitor_type: 'docker', description: 'Stopped container', interval_secs: 60, timeout_secs: 10, container: 'my-stopped-container' },
  ],
  zabbix: [
    { name: 'Zabbix Test', monitor_type: 'zabbix', description: 'Zabbix host check', interval_secs: 60, timeout_secs: 10, zabbix_url: 'http://zabbix.example.com', zabbix_username: 'Admin', zabbix_password: 'zabbix', zabbix_host_name: 'testhost' },
  ],
  custom: [
    { name: 'Custom Health Check', monitor_type: 'custom', description: 'Generic freeform check', interval_secs: 60, timeout_secs: 10 },
  ],
}

const TYPE_COLORS: Record<MonitorType, string> = {
  ping:      'bg-blue-100 text-blue-700 border-blue-300',
  tcp:       'bg-purple-100 text-purple-700 border-purple-300',
  http:      'bg-green-100 text-green-700 border-green-300',
  postgres:  'bg-yellow-100 text-yellow-700 border-yellow-300',
  heartbeat: 'bg-pink-100 text-pink-700 border-pink-300',
  script:    'bg-orange-100 text-orange-700 border-orange-300',
  docker:    'bg-cyan-100 text-cyan-700 border-cyan-300',
  zabbix:    'bg-red-100 text-red-700 border-red-300',
  custom:    'bg-indigo-100 text-indigo-700 border-indigo-300',
}

const MONITOR_TYPES: MonitorType[] = ['ping', 'tcp', 'http', 'postgres', 'heartbeat', 'script', 'docker', 'zabbix', 'custom']

type ConfigValue = string | number

interface ImportedRow {
  [key: string]: string | number | undefined
}

export default function MonitorForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id

  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [monitorType, setMonitorType] = useState<MonitorType>('ping')
  const [intervalSecs, setInterval]   = useState(60)
  const [timeoutSecs, setTimeout_]    = useState(10)
  const [config, setConfig]           = useState<Record<string, ConfigValue>>({})
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([
    { key: 'url', value: '' },
    { key: 'method', value: 'GET' },
    { key: 'expected_status', value: '200' },
  ])
  const [inlineScript, setInlineScript]         = useState('')
  const [scriptInterpreter, setScriptInterpreter] = useState('python')
  const [scriptRunning, setScriptRunning]       = useState(false)
  const [scriptOutput, setScriptOutput]         = useState<{ status: string; stdout?: string; stderr?: string; exit_code?: number; error?: string } | null>(null)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [importing, setImporting]     = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; failed: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tabFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    api.getMonitor(id).then(m => {
      setName(m.name)
      setDescription(m.description)
      setMonitorType(m.monitor_type as MonitorType)
      setInterval(m.interval_secs)
      setTimeout_(m.timeout_secs)
      setConfig(m.config as Record<string, ConfigValue>)
      if (m.monitor_type === 'custom') {
        const flat = (m.config as Record<string, unknown>) ?? {}
        // Pull out script fields first, then build the freeform rows from the rest
        if (flat['script']) setInlineScript(String(flat['script']))
        if (flat['interpreter']) setScriptInterpreter(String(flat['interpreter']))
        const rows = Object.entries(flat)
          .filter(([key]) => key !== 'script' && key !== 'interpreter')
          .map(([key, value]) => ({ key, value: String(value ?? '') }))
        setCustomFields(rows.length > 0 ? rows : [{ key: 'url', value: '' }])
      }
    }).catch(e => setError((e as Error).message))
  }, [id])

  function handleConfigChange(key: string, value: string, fieldType: string) {
    setConfig(prev => ({
      ...prev,
      [key]: fieldType === 'number' && value !== '' ? Number(value) : value,
    }))
  }

  async function runScriptNow() {
    if (!inlineScript.trim()) return
    setScriptRunning(true)
    setScriptOutput(null)
    try {
      // Build a flat config with script + interpreter first, then any extra freeform fields
      const finalConfig: Record<string, string> = {
        interpreter: scriptInterpreter,
        script: inlineScript,
      }
      for (const row of customFields) {
        if (row.key.trim() && row.key.trim() !== 'url' && row.key.trim() !== 'method' && row.key.trim() !== 'expected_status') {
          finalConfig[row.key.trim()] = row.value
        }
      }

      let monitorId = id
      let createdTemp = false

      if (!monitorId) {
        const tempName = '__temp_script_test__' + Date.now()
        const m = await api.createMonitor({
          name: tempName,
          description: '',
          monitor_type: 'custom',
          interval_secs: 3600,
          timeout_secs: timeoutSecs || 30,
          config: finalConfig as unknown as Record<string, unknown>,
        })
        monitorId = m.id
        createdTemp = true
      } else {
        await api.updateMonitor(monitorId, {
          name,
          description,
          monitor_type: 'custom',
          interval_secs: intervalSecs,
          timeout_secs: timeoutSecs,
          config: finalConfig as unknown as Record<string, unknown>,
        })
      }

      const result = await api.checkNow(monitorId)
      const detail = result.detail as Record<string, unknown> | undefined
      setScriptOutput({
        status: result.status,
        stdout: detail?.stdout as string | undefined,
        stderr: detail?.stderr as string | undefined,
        exit_code: detail?.exit_code as number | undefined,
        error: result.error_message,
      })

      if (createdTemp) await api.deleteMonitor(monitorId)
    } catch (e) {
      setScriptOutput({ status: 'unknown', error: (e as Error).message })
    } finally {
      setScriptRunning(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const finalConfig: Record<string, unknown> = monitorType === 'custom' ? {} : { ...config }
      if (monitorType === 'custom') {
        for (const row of customFields) {
          if (row.key.trim()) finalConfig[row.key.trim()] = row.value
        }
        if (inlineScript.trim()) {
          finalConfig['script'] = inlineScript
          finalConfig['interpreter'] = scriptInterpreter
        }
      }
      const payload = { name, description, monitor_type: monitorType, interval_secs: intervalSecs, timeout_secs: timeoutSecs, config: finalConfig }
      if (isEdit) {
        await api.updateMonitor(id!, payload)
      } else {
        await api.createMonitor(payload)
      }
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function buildConfig(row: ImportedRow, type: string): Record<string, unknown> {
    const cfg: Record<string, unknown> = {}
    const fieldMap: Record<string, string[]> = {
      ping:      ['host', 'count', 'timeout_ms'],
      tcp:       ['host', 'port'],
      http:      ['url', 'method', 'expected_status', 'body_pattern'],
      postgres:  ['host', 'port', 'database', 'user', 'password', 'query', 'vault_path'],
      heartbeat: ['max_age_secs'],
      script:    ['interpreter', 'script_path'],
      docker:    ['container'],
      zabbix:    ['zabbix_url', 'zabbix_username', 'zabbix_password', 'zabbix_host_name'],
    }
    const keyRemap: Record<string, string> = {
      zabbix_url: 'url', zabbix_username: 'username',
      zabbix_password: 'password', zabbix_host_name: 'host_name',
    }

    // "custom" has no fixed fields — every column named "field_<name>" in
    // the sheet becomes a field of that exact name in the monitor's config.
    // This mirrors the freeform key/value rows in the UI.
    if (type === 'custom') {
      for (const colName of Object.keys(row)) {
        if (colName.startsWith('field_') && row[colName] !== '' && row[colName] !== undefined) {
          cfg[colName.slice('field_'.length)] = String(row[colName])
        }
      }
      return cfg
    }

    for (const field of (fieldMap[type] ?? [])) {
      const val = row[field]
      if (val !== undefined && val !== null && val !== '') {
        cfg[keyRemap[field] ?? field] = val
      }
    }
    return cfg
  }

  async function processImport(file: File, filterType?: MonitorType) {
    setImporting(true)
    setImportResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<ImportedRow>(ws, { defval: '' })

      let success = 0
      const failed: string[] = []

      for (const row of rows) {
        const rowName = String(row['name *'] ?? row['name'] ?? '').trim()
        const rowType = String(row['monitor_type *'] ?? row['monitor_type'] ?? '').trim().toLowerCase()

        if (!rowName || !rowType) { failed.push('Row missing name or monitor_type'); continue }

        // If filterType set, only import that type
        if (filterType && rowType !== filterType) continue

        try {
          await api.createMonitor({
            name: rowName,
            monitor_type: rowType,
            description: String(row.description ?? ''),
            interval_secs: Number(row.interval_secs) || 60,
            timeout_secs: Number(row.timeout_secs) || 10,
            config: buildConfig({ ...row }, rowType),
          })
          success++
        } catch (err) {
          failed.push(`"${rowName}": ${(err as Error).message}`)
        }
      }
      setImportResult({ success, failed })
      if (success > 0) setTimeout(() => navigate('/'), 2000)
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (tabFileInputRef.current) tabFileInputRef.current.value = ''
    }
  }

  function downloadTypeTemplate(type: MonitorType) {
    const typeColsMap: Record<MonitorType, string[]> = {
      ping:      ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'host', 'count', 'timeout_ms'],
      tcp:       ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'host', 'port'],
      http:      ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'url', 'method', 'expected_status', 'body_pattern'],
      postgres:  ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'host', 'port', 'database', 'user', 'password', 'query'],
      heartbeat: ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'max_age_secs'],
      script:    ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'interpreter', 'script_path'],
      docker:    ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'container'],
      zabbix:    ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs', 'zabbix_url', 'zabbix_username', 'zabbix_password', 'zabbix_host_name'],
      custom:    ['name *', 'monitor_type *', 'description', 'interval_secs', 'timeout_secs'],
    };
    let cols = typeColsMap[type];
    let examples = TYPE_TEMPLATES[type].map((row: Record<string, string | number>) => cols.map((col: string) => row[col] ?? ''));

    // "custom" has no fixed fields at all — the template's extra columns
    // are built entirely from whatever field names the user has currently
    // typed into the Custom Fields editor, each prefixed "field_".
    if (type === 'custom') {
      const userCols = customFields.filter(f => f.key.trim()).map(f => 'field_' + f.key.trim())
      const userVals = customFields.filter(f => f.key.trim()).map(f => f.value)
      cols = [...cols, ...userCols]
      examples = examples.map(row => [...row, ...userVals])
    }

    const wbOut = XLSX.utils.book_new();
    const wsOut = XLSX.utils.aoa_to_sheet([cols, ...examples]);
    XLSX.utils.book_append_sheet(wbOut, wsOut, type.toUpperCase() + ' Monitors');
    XLSX.writeFile(wbOut, 'template_' + type + '.xlsx');
  }

  const fields = TYPE_FIELDS[monitorType] ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Back</Link>
        <h1 className="text-xl font-semibold text-gray-900">
          {isEdit ? 'Edit Monitor' : 'New Monitor'}
        </h1>
      </header>

      <div className="p-6 max-w-xl mx-auto">

        {!isEdit && (
          <>
            {/* TOP: General Import (all types) */}
            <div className="bg-white rounded-xl border p-5 mb-4">
              <h2 className="font-medium text-gray-900 mb-1">📥 Bulk Import from Excel</h2>
              <p className="text-sm text-gray-500 mb-3">
                Upload any Excel file — all monitor types will be imported together.
              </p>
              <div className="flex gap-2">
                <label className={`cursor-pointer bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                  {importing ? 'Importing…' : '⬆ Import Excel (All Types)'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) processImport(f) }}
                  />
                </label>
              </div>

              {importResult && (
                <div className={`mt-3 rounded-lg p-3 text-sm border ${importResult.failed.length === 0 ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-200 text-yellow-800'}`}>
                  <div className="font-medium">✅ {importResult.success} imported{importResult.failed.length > 0 ? ` · ⚠️ ${importResult.failed.length} failed` : ' — redirecting…'}</div>
                  {importResult.failed.map((f, i) => <div key={i} className="text-xs mt-1">{f}</div>)}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border p-4 mb-4 text-center">
              <p className="text-sm text-gray-400">— or add / import by monitor type below —</p>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-medium text-gray-900">Basic Info</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} required
                placeholder="My server ping"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text" value={description} onChange={e => setDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check every (sec)</label>
                <input
                  type="number" value={intervalSecs} min={10}
                  onChange={e => setInterval(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (sec)</label>
                <input
                  type="number" value={timeoutSecs} min={1}
                  onChange={e => setTimeout_(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-medium text-gray-900">Monitor Type</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MONITOR_TYPES.map(t => (
                <button
                  key={t} type="button"
                  onClick={() => { setMonitorType(t); setConfig({}); setCustomFields(t === 'custom' ? [{ key: 'url', value: '' }, { key: 'method', value: 'GET' }, { key: 'expected_status', value: '200' }] : [{ key: '', value: '' }]); setInlineScript(''); setScriptOutput(null) }}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    monitorType === t
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Per-tab Import Excel + Download Template */}
            {!isEdit && (
              <div className={`rounded-lg border p-3 ${TYPE_COLORS[monitorType]}`}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2">
                  {monitorType.toUpperCase()} — Import or Download Template
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => downloadTypeTemplate(monitorType)}
                    className="text-xs border border-current px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity font-medium"
                  >
                    ↓ {monitorType.toUpperCase()} Template
                  </button>
                  <label className={`cursor-pointer text-xs px-3 py-1.5 rounded-lg font-medium border border-current hover:opacity-80 transition-opacity ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                    {importing ? 'Importing…' : `⬆ Import ${monitorType.toUpperCase()} Excel`}
                    <input
                      ref={tabFileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) processImport(f, monitorType) }}
                    />
                  </label>
                </div>
                <p className="text-xs mt-1.5 opacity-70">
                  Only {monitorType.toUpperCase()} rows will be imported from your Excel file.
                </p>
              </div>
            )}

            {fields.length > 0 && (
              <div className="space-y-3 pt-2 border-t">
                {fields.map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {f.label}{f.required ? ' *' : ''}
                    </label>
                    <input
                      type={f.type}
                      value={(config[f.key] as string | number | undefined) ?? ''}
                      onChange={e => handleConfigChange(f.key, e.target.value, f.type)}
                      required={f.required}
                      placeholder={f.placeholder}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            )}

            {monitorType === 'custom' && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">
                    Fields <span className="text-gray-400 font-normal">(add whatever you need)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomFields(rows => [...rows, { key: '', value: '' }])}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    + Add field
                  </button>
                </div>
                {customFields.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={e => setCustomFields(rows => rows.map((r, idx) => idx === i ? { ...r, key: e.target.value } : r))}
                      placeholder="Field name (e.g. X-Api-Key)"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={e => setCustomFields(rows => rows.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                      placeholder="Value"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setCustomFields(rows => rows.length > 1 ? rows.filter((_, idx) => idx !== i) : [{ key: '', value: '' }])}
                      className="text-gray-400 hover:text-red-500 px-2"
                      title="Remove field"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-400">
                  Add fields named <code className="bg-gray-100 px-1 rounded">url</code>, <code className="bg-gray-100 px-1 rounded">method</code>, <code className="bg-gray-100 px-1 rounded">expected_status</code>, and optionally <code className="bg-gray-100 px-1 rounded">body_pattern</code> / <code className="bg-gray-100 px-1 rounded">body</code> to control the check. Any other field name you add is sent as an HTTP header (great for API keys, auth tokens, tenant IDs, etc).
                </p>
              </div>
            )}

            {/* ── Inline Script Section ── */}
            {monitorType === 'custom' && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Inline Script <span className="text-gray-400 font-normal">(optional — runs instead of HTTP check)</span>
                    </label>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Write your script directly here. Exit 0 = UP, exit 1 = DEGRADED, anything else = DOWN.
                    </p>
                  </div>
                  <select
                    value={scriptInterpreter}
                    onChange={e => setScriptInterpreter(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ml-4"
                  >
                    <option value="python3">Python 3 (Linux/Mac)</option>
                    <option value="python">Python (Windows)</option>
                    <option value="python2">Python 2</option>
                    <option value="bash">Bash</option>
                    <option value="sh">sh</option>
                    <option value="node">Node.js</option>
                    <option value="ruby">Ruby</option>
                  </select>
                </div>

                <textarea
                  value={inlineScript}
                  onChange={e => { setInlineScript(e.target.value); setScriptOutput(null) }}
                  rows={10}
                  spellCheck={false}
                  placeholder={scriptInterpreter.startsWith('python')
                    ? '# Example: check if a file exists\nimport os, sys\nif os.path.exists(\'/tmp/healthy\'):\n    print("File found — service is up")\n    sys.exit(0)\nelse:\n    print("File missing — service is down")\n    sys.exit(2)'
                    : (scriptInterpreter.includes('bash') || scriptInterpreter === 'sh')
                    ? '#!/bin/bash\n# Example: check disk usage\nUSAGE=$(df / | tail -1 | awk \'{print $5}\' | tr -d \'%\')\nif [ "$USAGE" -lt 90 ]; then\n  echo "Disk OK"\n  exit 0\nelse\n  echo "Disk CRITICAL"\n  exit 2\nfi'
                    : '// Write your script here\n// exit 0 = UP, exit 1 = DEGRADED, anything else = DOWN'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 resize-y"
                />

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={runScriptNow}
                    disabled={scriptRunning || !inlineScript.trim()}
                    className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {scriptRunning ? (
                      <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Running…</>
                    ) : (
                      <>▶ Run Script Now</>
                    )}
                  </button>
                  {scriptOutput && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      scriptOutput.status === 'up' ? 'bg-green-100 text-green-700' :
                      scriptOutput.status === 'degraded' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {scriptOutput.status.toUpperCase()}
                      {scriptOutput.exit_code !== undefined && ` (exit ${scriptOutput.exit_code})`}
                    </span>
                  )}
                </div>

                {scriptOutput && (
                  <div className="rounded-lg border border-gray-200 overflow-hidden text-xs font-mono">
                    {scriptOutput.stdout && (
                      <div className="bg-gray-900 text-green-400 p-3">
                        <div className="text-gray-500 mb-1">stdout</div>
                        <pre className="whitespace-pre-wrap">{scriptOutput.stdout}</pre>
                      </div>
                    )}
                    {scriptOutput.stderr && (
                      <div className="bg-gray-900 text-red-400 p-3 border-t border-gray-700">
                        <div className="text-gray-500 mb-1">stderr</div>
                        <pre className="whitespace-pre-wrap">{scriptOutput.stderr}</pre>
                      </div>
                    )}
                    {scriptOutput.error && !scriptOutput.stdout && !scriptOutput.stderr && (
                      <div className="bg-red-50 text-red-700 p-3">
                        <div className="text-gray-500 mb-1">error</div>
                        <pre className="whitespace-pre-wrap">{scriptOutput.error}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 text-sm">{error}</div>
          )}

          <div className="flex gap-3">
            <button
              type="submit" disabled={saving}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Update Monitor' : 'Create Monitor'}
            </button>
            <Link to="/" className="px-5 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-center text-sm">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}