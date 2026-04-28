'use client'

import { useState, useRef, useCallback } from 'react'
import type { BrowserTaskConfig, BrowserVideoFile } from '@/lib/browser/processor'
import { detectFormat, getVideoMeta } from '@/lib/browser/processor'

type Stage = 'idle' | 'loadingWasm' | 'scanning' | 'processing' | 'done' | 'error'

export default function Home() {
  const [stage, setStage]       = useState<Stage>('idle')
  const [log, setLog]           = useState<string[]>([])
  const [wasmPct, setWasmPct]   = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [zipName, setZipName]   = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const addLog = useCallback((msg: string) => setLog(prev => [...prev, msg]), [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStage('idle')
    setLog([])
    setDownloadUrl(null)
    setErrorMsg(null)
    setWasmPct(0)

    const fd = new FormData(e.currentTarget)
    const titleName  = (fd.get('titleName') as string).trim()
    const taskText   = (fd.get('taskText')  as string).trim()
    const campaignVal = fd.get('campaign') as string
    const logoEN    = fd.get('logoEN')    as File | null
    const logoAR    = fd.get('logoAR')    as File | null
    const diskUrl   = (fd.get('diskUrl')  as string).trim()
    const videoFiles = (fd.getAll('videos') as File[]).filter(f => f.size > 0)

    if (!titleName) { setErrorMsg('Show/film title is required'); return }
    if (!taskText)  { setErrorMsg('Paste the task text first'); return }
    if (!logoEN || logoEN.size === 0) { setErrorMsg('Logo EN is required'); return }
    if (!logoAR || logoAR.size === 0) { setErrorMsg('Logo AR is required'); return }
    if (!diskUrl && videoFiles.length === 0) {
      setErrorMsg('Provide a Yandex Disk URL or upload video files'); return
    }

    try {
      // Import browser modules lazily (avoids SSR issues)
      const { parseTaskFile }      = await import('@/lib/parser')
      const { runBrowserPipeline, loadFFmpeg } = await import('@/lib/browser/processor')
      // Parse task (versions only; title/campaign come from UI)
      const taskConfig = parseTaskFile(taskText, {
        titleLogoEN: '__browser__',
        titleLogoAR: '__browser__',
        titleName,
        campaign: campaignVal as 'YangoPlay' | 'YangoPlay_noon' | 'YangoPlay_talabat',
      })

      const browserConfig: BrowserTaskConfig = {
        titleName: taskConfig.titleName,
        campaign:  taskConfig.campaign,
        versions:  taskConfig.versions,
        logoEN: logoEN!,
        logoAR: logoAR!,
      }

      setStage('loadingWasm')
      addLog('Loading FFmpeg WASM (first time ~20 MB)...')
      await loadFFmpeg(pct => { setWasmPct(pct); if (pct === 100) addLog('FFmpeg ready.') })

      // Collect video files
      setStage('scanning')
      let allVideos: BrowserVideoFile[] = []

      if (diskUrl) {
        addLog(`Fetching file list from Yandex Disk...`)
        const res = await fetch(`/api/disk-proxy?diskUrl=${encodeURIComponent(diskUrl)}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Disk proxy error')

        addLog(`Downloading ${json.files.length} video(s)...`)
        for (const { name, downloadUrl: dlUrl } of json.files as { name: string; downloadUrl: string }[]) {
          addLog(`  ↓ ${name}`)
          const data = new Uint8Array(await (await fetch(dlUrl)).arrayBuffer())
          const fakeFile = new File([data], name, { type: 'video/mp4' })
          const meta = await getVideoMeta(fakeFile)
          const format = await detectFormat(name, meta.width, meta.height)
          if (!format) { addLog(`  ✗ Unknown format: ${name}`); continue }
          const vMatch = name.match(/(?:version\s*|_v?|v)(\d+)/i)
          const version = vMatch ? parseInt(vMatch[1], 10) : 1
          allVideos.push({ name, format, version, data, ...meta })
          addLog(`  ✓ ${name} → ${format} v${version}`)
        }
      }

      for (const file of videoFiles) {
        addLog(`Scanning: ${file.name}`)
        const meta = await getVideoMeta(file)
        const format = await detectFormat(file.name, meta.width, meta.height)
        if (!format) { addLog(`  ✗ Unknown format: ${file.name}`); continue }
        const vMatch = file.name.match(/(?:version\s*|_v?|v)(\d+)/i)
        const version = vMatch ? parseInt(vMatch[1], 10) : 1
        const data = new Uint8Array(await file.arrayBuffer())
        allVideos.push({ name: file.name, format, version, data, ...meta })
        addLog(`  ✓ ${file.name} → ${format} v${version}`)
      }

      if (allVideos.length === 0) throw new Error('No recognisable video files found')

      setStage('processing')
      const zip = await runBrowserPipeline(browserConfig, allVideos, addLog, pct => setWasmPct(pct))

      const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const name = `${browserConfig.titleName}_creatives.zip`
      setDownloadUrl(url)
      setZipName(name)
      setStage('done')
      addLog(`Done! ${(zip.byteLength / 1024 / 1024).toFixed(1)} MB`)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  const busy = stage === 'loadingWasm' || stage === 'scanning' || stage === 'processing'

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Purple Bug</h1>
        <p className="text-gray-500 mb-8 text-sm">Yango Play creative assembly · runs entirely in your browser</p>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">

          <Field label="Show / film title">
            <input
              name="titleName"
              type="text"
              placeholder="Ein Sehrya"
              required
              className={inputCls.replace('cursor-pointer', '')}
            />
          </Field>

          <Field label="Task (paste text or upload .md)">
            <textarea
              name="taskText"
              rows={6}
              placeholder="# Version 1&#10;## Main text&#10;...&#10;## CTA&#10;..."
              className="w-full text-sm text-gray-300 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 font-mono resize-y"
            />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <span>or upload .md file:</span>
              <input
                type="file"
                accept=".md,.txt"
                className="text-xs text-gray-400"
                onChange={async e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const text = await f.text()
                  const ta = formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name=taskText]')
                  if (ta) ta.value = text
                }}
              />
            </label>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Title Logo EN (.png)">
              <input name="logoEN" type="file" accept="image/png" required className={inputCls} />
            </Field>
            <Field label="Title Logo AR (.png)">
              <input name="logoAR" type="file" accept="image/png" required className={inputCls} />
            </Field>
          </div>

          <Field label="Yandex Disk URL" hint="Paste public folder link with trailer cuts">
            <input
              name="diskUrl"
              type="url"
              placeholder="https://disk.yandex.com/d/…"
              className={inputCls + ' placeholder:text-gray-600'}
            />
          </Field>

          <Field label="Upload videos instead" hint="Select .mp4 files directly (optional if Disk URL provided)">
            <input name="videos" type="file" accept="video/mp4,video/quicktime" multiple className={inputCls} />
          </Field>

          <details className="border border-gray-800 rounded-lg p-4">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
              Campaign override (optional)
            </summary>
            <div className="mt-3">
              <Field label="Campaign">
                <select name="campaign" className="w-full text-sm bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-300">
                  <option value="YangoPlay">Yango Play</option>
                  <option value="YangoPlay_noon">Yango Play + noon</option>
                  <option value="YangoPlay_talabat">Yango Play + Talabat</option>
                </select>
              </Field>
            </div>
          </details>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 px-6 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
          >
            {busy ? stageLabel(stage, wasmPct) : 'Generate creatives'}
          </button>
        </form>

        {log.length > 0 && (
          <div className="mt-6 bg-gray-900 rounded-lg p-4 font-mono text-xs text-gray-300 space-y-0.5 max-h-64 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}

        {stage === 'error' && errorMsg && (
          <div className="mt-4 bg-red-950 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        {stage === 'done' && downloadUrl && (
          <div className="mt-4 bg-green-950 border border-green-800 rounded-lg p-4 flex items-center justify-between">
            <p className="text-green-300 text-sm">All creatives ready!</p>
            <a
              href={downloadUrl}
              download={zipName}
              className="py-2 px-5 bg-green-700 hover:bg-green-600 rounded-lg font-semibold text-sm transition-colors"
            >
              Download ZIP
            </a>
          </div>
        )}
      </div>
    </main>
  )
}

function stageLabel(stage: Stage, pct: number): string {
  if (stage === 'loadingWasm') return pct < 100 ? `Loading FFmpeg… ${pct}%` : 'FFmpeg ready, scanning…'
  if (stage === 'scanning')    return 'Scanning videos…'
  if (stage === 'processing')  return 'Processing…'
  return '…'
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

const inputCls = 'w-full text-sm text-gray-300 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-purple-800 file:text-white file:text-xs cursor-pointer'
