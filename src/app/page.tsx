'use client'

import { useState, useRef, useCallback } from 'react'
import type { BrowserTaskConfig, BrowserVideoFile } from '@/lib/browser/processor'
import { detectFormat, getVideoMeta } from '@/lib/browser/processor'

type Stage = 'idle' | 'loadingWasm' | 'scanning' | 'processing' | 'done' | 'error'

interface Op {
  id: string
  label: string
  status: 'waiting' | 'running' | 'done' | 'error'
}

export default function Home() {
  const [stage, setStage]         = useState<Stage>('idle')
  const [ops, setOps]             = useState<Op[]>([])
  const [log, setLog]             = useState<string[]>([])
  const [wasmPct, setWasmPct]     = useState(0)
  const [showLog, setShowLog]     = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [zipName, setZipName]     = useState('')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [logoENName, setLogoENName] = useState('')
  const [logoARName, setLogoARName] = useState('')
  const [videoNames, setVideoNames] = useState<string[]>([])
  const formRef = useRef<HTMLFormElement>(null)

  const addLog = useCallback((msg: string) => setLog(p => [...p, msg]), [])

  const upsertOp = useCallback((id: string, label: string, status: Op['status']) => {
    setOps(prev => {
      const exists = prev.find(o => o.id === id)
      if (exists) return prev.map(o => o.id === id ? { ...o, label, status } : o)
      return [...prev, { id, label, status }]
    })
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStage('idle')
    setLog([])
    setOps([])
    setDownloadUrl(null)
    setErrorMsg(null)
    setWasmPct(0)

    const fd = new FormData(e.currentTarget)
    const titleName   = (fd.get('titleName')  as string).trim()
    const taskText    = (fd.get('taskText')   as string).trim()
    const campaignVal = fd.get('campaign')    as string
    const logoEN      = fd.get('logoEN')      as File | null
    const logoAR      = fd.get('logoAR')      as File | null
    const diskUrl     = (fd.get('diskUrl')    as string).trim()
    const videoFiles  = (fd.getAll('videos')  as File[]).filter(f => f.size > 0)

    const fail = (msg: string) => { setErrorMsg(msg); setStage('error') }
    if (!titleName)  return fail('Show / film title is required')
    if (!taskText)   return fail('Task text is required')
    if (!logoEN?.size) return fail('Logo EN is required')
    if (!logoAR?.size) return fail('Logo AR is required')
    if (!diskUrl && videoFiles.length === 0)
      return fail('Provide a Yandex Disk URL or upload video files')

    try {
      const { parseTaskFile }                                                    = await import('@/lib/parser')
      const { processVideoFile, loadFFmpeg: loadFF,
              zipSync: zipSyncFn }                                               = await import('@/lib/browser/processor')

      const taskConfig = parseTaskFile(taskText, {
        titleLogoEN: '__browser__',
        titleLogoAR: '__browser__',
        titleName,
        campaign: campaignVal as 'YangoPlay' | 'YangoPlay_noon' | 'YangoPlay_talabat',
      })
      if (taskConfig.versions.length === 0)
        return fail('Could not find any text in the task. Paste English and Arabic lines, or use ## Main text / ## CTA headers.')
      const browserConfig: BrowserTaskConfig = {
        titleName: taskConfig.titleName,
        campaign:  taskConfig.campaign,
        versions:  taskConfig.versions,
        logoEN: logoEN!,
        logoAR: logoAR!,
      }

      const onMsg = (msg: string) => {
        addLog(msg)
        const jobMatch  = msg.match(/Processing:\s*(.+)/)
        if (jobMatch)  upsertOp('job', jobMatch[1], 'running')
        const doneMatch = msg.match(/✓\s*(.+\.mp4)/)
        if (doneMatch) upsertOp('job', doneMatch[1], 'done')
      }

      // 1. Load FFmpeg
      setStage('loadingWasm')
      upsertOp('wasm', 'Loading FFmpeg…', 'running')
      const ff = await loadFF(pct => {
        setWasmPct(pct)
        if (pct === 100) upsertOp('wasm', 'FFmpeg ready', 'done')
      })

      const outputs: Record<string, Uint8Array> = {}
      let totalProcessed = 0
      let totalBadFormat = 0

      // Helper: download + detect format by metadata + process for all text versions
      const processOneFile = async (
        name: string, data: Uint8Array, i: number, total: number
      ) => {
        const fake = new File([data.buffer as ArrayBuffer], name, { type: 'video/mp4' })
        const meta = await getVideoMeta(fake)
        const fmt  = detectFormat(meta.width, meta.height)
        if (!fmt) {
          addLog(`  ✗ ${name}: unsupported resolution ${meta.width}×${meta.height}`)
          totalBadFormat++
          return
        }
        // Extract version number from filename ("Version 01" → 1, "Version 02" → 2 …)
        const vMatch = name.match(/version\s*0*(\d+)/i)
        const vNum   = vMatch ? parseInt(vMatch[1], 10) : 1
        addLog(`  ${i}/${total} ${meta.width}×${meta.height} → ${fmt} v${vNum} (${meta.duration.toFixed(1)}s)`)
        const video: BrowserVideoFile = { name, format: fmt, version: vNum, data, ...meta }
        // Only process the text version that matches this video version; fall back to
        // first version if no exact match (e.g. single-version task with versioned clips).
        const textVersions = taskConfig.versions.filter(v => v.id === vNum)
        const partial = await processVideoFile(
          ff, browserConfig, video,
          textVersions.length > 0 ? textVersions : [taskConfig.versions[0]],
          onMsg
        )
        Object.assign(outputs, partial)
        totalProcessed++
      }

      // 2a. Disk videos — fetch list, then download + process one at a time
      if (diskUrl) {
        setStage('scanning')
        upsertOp('disk', 'Fetching file list from Yandex Disk…', 'running')
        addLog('Fetching file list from Yandex Disk...')
        const res  = await fetch(`/api/disk-proxy?diskUrl=${encodeURIComponent(diskUrl)}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Disk proxy error')

        const files = json.files as { name: string; downloadUrl: string }[]
        upsertOp('disk', `${files.length} file(s) found`, 'done')
        setStage('processing')

        for (let i = 0; i < files.length; i++) {
          const { name, downloadUrl: dlUrl } = files[i]
          upsertOp('disk', `↓ ${i + 1}/${files.length}: ${name}`, 'running')
          addLog(`↓ ${name}`)
          const data = new Uint8Array(await (await fetch(dlUrl)).arrayBuffer())
          await processOneFile(name, data, i + 1, files.length)
        }
        upsertOp('disk', 'All disk videos done', 'done')
      }

      // 2b. Locally uploaded files — process one at a time
      if (videoFiles.length > 0) {
        setStage('processing')
        for (let i = 0; i < videoFiles.length; i++) {
          const file = videoFiles[i]
          addLog(`↑ ${file.name}`)
          const data = new Uint8Array(await file.arrayBuffer())
          await processOneFile(file.name, data, i + 1, videoFiles.length)
        }
      }

      if (totalProcessed === 0) {
        if (totalBadFormat > 0)
          throw new Error(`No videos matched supported resolutions (1080×1080, 1920×1080, 1080×1920). Got: see log.`)
        throw new Error('No video files found or fetched')
      }

      upsertOp('zip', 'Packing ZIP…', 'running')
      const zip = zipSyncFn(outputs as Record<string, Uint8Array>, { level: 1 })
      upsertOp('zip', 'ZIP ready', 'done')

      const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
      setDownloadUrl(URL.createObjectURL(blob))
      setZipName(`${browserConfig.titleName}_creatives.zip`)
      setStage('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  const busy = stage === 'loadingWasm' || stage === 'scanning' || stage === 'processing'

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-xl font-semibold tracking-tight">Purple Bug</h1>
          <p className="text-zinc-500 text-sm mt-1">Yango Play creative assembly — runs in your browser</p>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">

          {/* Section 1: Project */}
          <Section n={1} title="Project">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Show title</Label>
                <Input name="titleName" type="text" placeholder="Ein Sehrya" />
              </div>
              <div>
                <Label>Campaign</Label>
                <select
                  name="campaign"
                  className="w-full text-sm bg-zinc-900 border border-zinc-800 hover:border-zinc-600 focus:border-purple-500 focus:outline-none rounded-lg px-3 py-2 text-zinc-200 transition-colors"
                >
                  <option value="YangoPlay">Yango Play</option>
                  <option value="YangoPlay_noon">Yango Play + noon</option>
                  <option value="YangoPlay_talabat">Yango Play + Talabat</option>
                </select>
              </div>
            </div>
          </Section>

          {/* Section 2: Logos */}
          <Section n={2} title="Logos">
            <div className="grid grid-cols-2 gap-3">
              <FileZone
                name="logoEN" label="English logo" accept="image/png"
                hint=".png with transparency"
                fileName={logoENName}
                onChange={f => setLogoENName(f?.name ?? '')}
              />
              <FileZone
                name="logoAR" label="Arabic logo" accept="image/png"
                hint=".png with transparency"
                fileName={logoARName}
                onChange={f => setLogoARName(f?.name ?? '')}
              />
            </div>
          </Section>

          {/* Section 3: Videos */}
          <Section n={3} title="Trailer cuts">
            <div>
              <Label>Yandex Disk folder URL</Label>
              <input
                name="diskUrl"
                type="url"
                placeholder="https://disk.yandex.com/d/…"
                className="w-full text-sm bg-zinc-900 border border-zinc-800 hover:border-zinc-600 focus:border-purple-500 focus:outline-none rounded-lg px-3 py-2 text-zinc-200 placeholder:text-zinc-700 transition-colors"
              />
            </div>
            <div className="mt-3">
              <Label hint="Optional if Disk URL is filled">Upload .mp4 files directly</Label>
              <FileZone
                name="videos" label="Drop MP4 files" accept="video/mp4,video/quicktime" multiple
                hint="SQ + WIDE + V at once"
                fileName={videoNames.length > 0 ? `${videoNames.length} file(s)` : ''}
                onChange={(_, files) => setVideoNames(files ? Array.from(files).map(f => f.name) : [])}
              />
            </div>
          </Section>

          {/* Section 4: Task */}
          <Section n={4} title="Task text">
            <textarea
              name="taskText"
              rows={7}
              placeholder={'# Version 1\n## Main text\nText here\nنص هنا\n## CTA\nWatch now\nشاهد الآن'}
              className="w-full text-sm bg-zinc-900 border border-zinc-800 hover:border-zinc-600 focus:border-purple-500 focus:outline-none rounded-lg px-3 py-2.5 text-zinc-200 placeholder:text-zinc-700 font-mono resize-y transition-colors"
            />
            <button
              type="button"
              className="mt-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'; input.accept = '.md,.txt'
                input.onchange = async () => {
                  const f = input.files?.[0]; if (!f) return
                  const ta = formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name=taskText]')
                  if (ta) ta.value = await f.text()
                }
                input.click()
              }}
            >
              Upload .md file instead ↑
            </button>
          </Section>

          {/* Submit */}
          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 py-3 px-6 bg-purple-600 hover:bg-purple-500 active:scale-[0.99] disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed rounded-xl font-medium text-sm transition-all"
          >
            {busy ? <BusyLabel stage={stage} pct={wasmPct} /> : 'Generate creatives →'}
          </button>
        </form>

        {/* Progress */}
        {ops.length > 0 && (
          <div className="mt-6 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Progress</span>
              <button
                onClick={() => setShowLog(s => !s)}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {showLog ? 'Hide log' : 'Show log'}
              </button>
            </div>
            <div className="divide-y divide-zinc-900">
              {ops.map(op => (
                <div key={op.id} className="flex items-center gap-3 px-4 py-2.5">
                  <OpIcon status={op.status} pct={op.status === 'running' && op.id === 'wasm' ? wasmPct : undefined} />
                  <span className={`text-sm ${op.status === 'running' ? 'text-zinc-100' : op.status === 'done' ? 'text-zinc-400' : op.status === 'error' ? 'text-red-400' : 'text-zinc-600'}`}>
                    {op.label}
                  </span>
                </div>
              ))}
            </div>
            {showLog && log.length > 0 && (
              <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-xs text-zinc-500 space-y-0.5 max-h-48 overflow-y-auto">
                {log.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {stage === 'error' && errorMsg && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Done */}
        {stage === 'done' && downloadUrl && (
          <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-100">Ready to download</p>
              <p className="text-xs text-zinc-500 mt-0.5">{zipName}</p>
            </div>
            <a
              href={downloadUrl}
              download={zipName}
              className="py-2 px-5 bg-purple-600 hover:bg-purple-500 active:scale-[0.99] rounded-lg text-sm font-medium transition-all"
            >
              Download ZIP
            </a>
          </div>
        )}
      </div>
    </main>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 text-xs font-medium tabular-nums">
          {n}
        </span>
        <span className="text-sm font-medium text-zinc-300">{title}</span>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <span className="text-xs font-medium text-zinc-400">{children}</span>
      {hint && <span className="text-xs text-zinc-600">{hint}</span>}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full text-sm bg-zinc-950 border border-zinc-800 hover:border-zinc-600 focus:border-purple-500 focus:outline-none rounded-lg px-3 py-2 text-zinc-200 placeholder:text-zinc-700 transition-colors"
    />
  )
}

interface FileZoneProps {
  name: string
  label: string
  accept: string
  hint?: string
  multiple?: boolean
  fileName: string
  onChange: (file: File | null, files?: FileList) => void
}

function FileZone({ name, label, accept, hint, multiple, fileName, onChange }: FileZoneProps) {
  return (
    <label className="group relative flex flex-col items-center justify-center gap-1 w-full h-20 border border-dashed border-zinc-800 hover:border-zinc-600 rounded-xl cursor-pointer transition-colors">
      <input
        type="file" name={name} accept={accept} multiple={multiple} className="sr-only"
        onChange={e => onChange(e.target.files?.[0] ?? null, e.target.files ?? undefined)}
      />
      {fileName ? (
        <span className="text-xs text-purple-400 px-2 text-center leading-tight">{fileName}</span>
      ) : (
        <>
          <UploadIcon />
          <span className="text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors">{label}</span>
          {hint && <span className="text-[10px] text-zinc-700">{hint}</span>}
        </>
      )}
    </label>
  )
}

function OpIcon({ status, pct }: { status: Op['status']; pct?: number }) {
  if (status === 'done')    return <span className="text-zinc-500 w-4 text-center text-xs">✓</span>
  if (status === 'error')   return <span className="text-red-500 w-4 text-center text-xs">✗</span>
  if (status === 'waiting') return <span className="w-4 h-4 rounded-full border border-zinc-800 flex-shrink-0" />
  // running
  return (
    <span className="relative flex-shrink-0 w-4 h-4">
      <span className="absolute inset-0 rounded-full border-2 border-zinc-800" />
      <span
        className="absolute inset-0 rounded-full border-2 border-t-purple-500 animate-spin"
        style={pct != null && pct < 100 ? {
          background: `conic-gradient(rgb(147 51 234) ${pct * 3.6}deg, transparent 0deg)`,
          borderRadius: '50%', border: 'none',
        } : undefined}
      />
    </span>
  )
}

function BusyLabel({ stage, pct }: { stage: Stage; pct: number }) {
  if (stage === 'loadingWasm') return <>{pct > 0 && pct < 100 ? `Loading FFmpeg ${pct}%` : 'Loading FFmpeg…'}</>
  if (stage === 'scanning')    return <>Downloading videos…</>
  if (stage === 'processing')  return <>Processing…</>
  return <>…</>
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-600 group-hover:text-zinc-400 transition-colors">
      <path d="M8 10V3M8 3L5 6M8 3l3 3M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
