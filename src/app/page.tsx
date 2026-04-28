'use client'

import { useState, useRef } from 'react'

type Status = 'idle' | 'processing' | 'done' | 'error'

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('processing')
    setLog([])
    setDownloadUrl(null)
    setErrorMsg(null)

    const formData = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/process', { method: 'POST', body: formData })

      if (!res.ok) {
        const json = await res.json()
        setErrorMsg(json.error ?? 'Unknown error')
        setStatus('error')
        return
      }

      const logHeader = res.headers.get('X-Processing-Log')
      if (logHeader) setLog(JSON.parse(logHeader))

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Purple Bug</h1>
        <p className="text-gray-400 mb-8 text-sm">Yango Play creative assembly pipeline</p>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          <Field label="Task file (.md)">
            <input name="taskFile" type="file" accept=".md,.txt" required className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Title Logo EN (.png)">
              <input name="logoEN" type="file" accept="image/png" required className={inputCls} />
            </Field>
            <Field label="Title Logo AR (.png)">
              <input name="logoAR" type="file" accept="image/png" required className={inputCls} />
            </Field>
          </div>

          <Field label="Yandex Disk URL" hint="Public folder link with trailer cuts — or upload files below">
            <input
              name="diskUrl"
              type="url"
              placeholder="https://disk.yandex.com/d/…"
              className={inputCls + ' placeholder:text-gray-600'}
            />
          </Field>

          <Field label="Trailer cuts (.mp4)" hint="Upload files directly (leave empty if using Disk URL above)">
            <input name="videos" type="file" accept="video/mp4,video/quicktime" multiple className={inputCls} />
          </Field>

          <details className="border border-gray-700 rounded-lg p-4">
            <summary className="cursor-pointer text-sm text-gray-400 hover:text-white">
              Custom PNG overlays (optional — overrides standard plate + logos + text)
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {(['SQ', 'FEED', 'V', 'WIDE'] as const).map(fmt => (
                <Field key={fmt} label={`Overlay ${fmt}`}>
                  <input name={`overlay_${fmt.toLowerCase()}`} type="file" accept="image/png" className={inputCls} />
                </Field>
              ))}
            </div>
          </details>

          <button
            type="submit"
            disabled={status === 'processing'}
            className="w-full py-3 px-6 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
          >
            {status === 'processing' ? 'Processing…' : 'Generate creatives'}
          </button>
        </form>

        {log.length > 0 && (
          <div className="mt-6 bg-gray-900 rounded-lg p-4 font-mono text-xs text-gray-300 space-y-1 max-h-48 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div className="mt-6 bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        {status === 'done' && downloadUrl && (
          <div className="mt-6 bg-green-900/40 border border-green-700 rounded-lg p-4">
            <p className="text-green-300 text-sm mb-3">Done! All creatives are ready.</p>
            <a
              href={downloadUrl}
              download="creatives.zip"
              className="inline-block py-2 px-6 bg-green-600 hover:bg-green-500 rounded-lg font-semibold text-sm transition-colors"
            >
              Download ZIP
            </a>
          </div>
        )}
      </div>
    </main>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full text-sm text-gray-300 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-purple-700 file:text-white file:text-xs cursor-pointer'
