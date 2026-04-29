'use client'
import { zipSync } from 'fflate'
export { zipSync }
import type { VideoFormat, Language, CampaignType, TextVersion } from '../types'
import {
  LAYOUT, LOGOSHOT_TIMING, LOGOSHOT_FILES, LOGOSHOT_AUDIO,
  plateName,
} from '../constants-browser'
import {
  ensureFonts, renderOfferText, renderWatchNowText, renderCtaButton, fitLogo,
  compositeMainOverlay, compositeLogoshotOverlay,
} from './text-renderer'

export interface BrowserTaskConfig {
  titleName: string
  campaign: CampaignType
  versions: TextVersion[]
  logoEN: File
  logoAR: File
}

export interface BrowserVideoFile {
  name: string
  format: VideoFormat
  width: number
  height: number
  duration: number
  version: number
  data: Uint8Array
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegInstance: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegLoading: Promise<any> | null = null

// Tracks which asset keys are already written to the FFmpeg virtual FS so we
// don't re-fetch and re-write the same plates / logoshots / audio every job.
const ffAssetKeys = new Set<string>()

// Caches raw asset bytes (plates, etc.) so we don't re-fetch across jobs.
const assetBytesCache = new Map<string, Uint8Array>()

async function getAssetBytes(url: string): Promise<Uint8Array> {
  if (assetBytesCache.has(url)) return assetBytesCache.get(url)!
  const bytes = await fetchAsset(url)
  assetBytesCache.set(url, bytes)
  return bytes
}

export async function loadFFmpeg(onProgress?: (pct: number) => void) {
  if (ffmpegInstance) return ffmpegInstance
  if (ffmpegLoading) return ffmpegLoading

  ffmpegLoading = (async () => {
    // new Function bypasses webpack/turbopack static analysis entirely;
    // packages are loaded from CDN at runtime so the bundler never sees them.
    // eslint-disable-next-line no-new-func
    const dynImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>

    const [ffmpegMod, utilMod] = await Promise.all([
      dynImport('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js'),
      dynImport('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js'),
    ])

    const { FFmpeg }    = ffmpegMod
    const { toBlobURL } = utilMod

    const ff = new FFmpeg()
    ff.on('progress', ({ progress }: { progress: number }) =>
      onProgress?.(Math.round(progress * 100))
    )

    // Prefer local cache (/ffmpeg-cache/) for speed; fall back to jsDelivr CDN.
    const localWasm = '/ffmpeg-cache/ffmpeg-core.wasm'
    const useLocal  = (await fetch(localWasm, { method: 'HEAD' })).ok
    const coreBase  = useLocal ? '/ffmpeg-cache' : 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/esm'
    // Worker deps (const.js, errors.js) must be absolute CDN URLs even in local mode
    // because the worker blob can't resolve relative paths.
    const ffCdn     = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm'
    const ffBase    = useLocal ? '/ffmpeg-cache' : ffCdn

    // Patch worker.js: replace "./foo.js" imports with absolute CDN URLs so they
    // resolve correctly when the script is loaded from a blob: URL.
    const workerSrc     = await fetch(`${ffBase}/worker.js`).then(r => r.text())
    const workerPatched = workerSrc.replace(/from ["'](\.\/[^"']+)["']/g, `from "${ffCdn}/$1"`)
    const classWorkerURL = URL.createObjectURL(new Blob([workerPatched], { type: 'text/javascript' }))

    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${coreBase}/ffmpeg-core.js`,   'text/javascript'),
      toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
    ])
    await ff.load({ coreURL, wasmURL, classWorkerURL })
    onProgress?.(100)

    ffmpegInstance = ff
    ffAssetKeys.clear()
    return ff
  })()

  return ffmpegLoading
}

export function detectFormat(width: number, height: number): VideoFormat | null {
  if (width === 1920 && height === 1080) return 'WIDE'
  if (width === 1080 && height === 1920) return 'V'
  if (width === 1080 && height === 1080) return 'SQ'
  return null
}

export async function getVideoMeta(
  file: File
): Promise<{ width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = url
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = reject
  })
  URL.revokeObjectURL(url)
  return { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
}

async function fetchAsset(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// Write asset to FFmpeg FS only on first use; subsequent calls are no-ops.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureFFAsset(ff: any, url: string, key: string): Promise<void> {
  if (ffAssetKeys.has(key)) return
  await ff.writeFile(key, await fetchAsset(url))
  ffAssetKeys.add(key)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOneJob(
  ff: any,
  taskConfig: BrowserTaskConfig,
  videoFile: BrowserVideoFile,
  trailerKey: string,
  outputFormat: VideoFormat,
  lang: Language,
  version: TextVersion,
  onLog: (msg: string) => void
): Promise<Uint8Array> {
  const layout     = LAYOUT[outputFormat]
  const langLayout = layout[lang]
  const { x: logoX, y: logoY, w: logoW, h: logoH } = langLayout.titleLogo
  const { x: offerX, y: offerY, w: offerW, h: offerH } = langLayout.offerText
  const { x: watchX, y: watchY } = layout.logoshotCta.watchNow
  const { x: ctaX, y: ctaY }     = layout.logoshotCta.button
  const { w: frameW, h: frameH } = layout.frame

  const text     = lang === 'EN' ? version.mainTextEN : version.mainTextAR
  const ctaText  = lang === 'EN' ? version.ctaEN      : version.ctaAR
  const logoFile = lang === 'EN' ? taskConfig.logoEN  : taskConfig.logoAR

  onLog('  Rendering PNGs...')

  // Fetch plate bytes from cache (avoid re-fetch across jobs)
  const platePng = await getAssetBytes(plateName(outputFormat, taskConfig.campaign, lang))

  const [logoPng, offerPng, watchNowPng, ctaPng] = await Promise.all([
    fitLogo(logoFile, logoW, logoH),
    renderOfferText(text, lang, offerW, offerH, outputFormat),
    renderWatchNowText(lang, frameW),
    renderCtaButton(ctaText, lang, frameW),
  ])

  // Pre-composite browser-side: plate+logo+offer → one PNG; watchnow+cta → one PNG.
  // Reduces FFmpeg overlays from 5 to 2.
  const [mainOverlayPng, lsOverlayPng] = await Promise.all([
    compositeMainOverlay(frameW, frameH, platePng, logoPng, logoX, logoY, offerPng, offerX, offerY),
    compositeLogoshotOverlay(frameW, frameH, watchNowPng, watchX, watchY, ctaPng, ctaX, ctaY),
  ])

  const dur = videoFile.duration
  const tRaw = dur <= LOGOSHOT_TIMING.shortVideoThreshold
    ? LOGOSHOT_TIMING.shortVideoOffset
    : dur - LOGOSHOT_TIMING.longVideoPreroll
  // Clamp: logoshot must start at least 0.5s before video ends,
  // otherwise atrim gets a zero/negative duration and FFmpeg hangs.
  const t = Math.min(tRaw, dur - 0.5)

  // Ensure shared assets are in FFmpeg FS (written only once per session)
  const lsVidKey = `asset_ls_${outputFormat}.mp4`
  const lsAudKey = `asset_lsaud_${lang}.mp3`
  await ensureFFAsset(ff, `/assets/logoshots/${LOGOSHOT_FILES[outputFormat]}`, lsVidKey)
  await ensureFFAsset(ff, `/assets/logoshots/${LOGOSHOT_AUDIO[lang]}`, lsAudKey)

  // Write job-specific composites (unique per lang/version)
  const prefix = `job_${outputFormat}_${lang}_v${version.id}`
  await ff.writeFile(`${prefix}_main.png`,      mainOverlayPng)
  await ff.writeFile(`${prefix}_lsoverlay.png`, lsOverlayPng)

  // Input indices: trailer=0, mainOverlay=1, lsVid=2, lsAud=3, lsOverlay=4
  const padFilter = outputFormat === 'FEED'
    ? `[0:v]pad=1080:1350:0:0[padded];[padded]`
    : `[0:v]`

  const vf =
    padFilter +
    `[1:v]overlay=0:0[vm];` +
    `[2:v]setpts=PTS-STARTPTS+${t}/TB[ls];` +
    `[vm][ls]overlay=0:0:shortest=1[vlsbase];` +
    `[vlsbase][4:v]overlay=0:0:enable='gte(t,${t})'[vfinal]`

  const af =
    `[0:a]atrim=0:${t},asetpts=PTS-STARTPTS[atrl];` +
    `[3:a]atrim=0:${dur - t},asetpts=PTS-STARTPTS[als];` +
    `[atrl][als]concat=n=2:v=0:a=1[afinal]`

  const outFile = `${prefix}_out.mp4`
  onLog('  Running FFmpeg...')

  const code = await ff.exec([
    '-i', trailerKey,
    '-i', `${prefix}_main.png`,
    '-i', lsVidKey,
    '-i', lsAudKey,
    '-i', `${prefix}_lsoverlay.png`,
    '-filter_complex', `${vf};${af}`,
    '-map', '[vfinal]',
    '-map', '[afinal]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    outFile,
  ])

  if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)

  const output = await ff.readFile(outFile) as Uint8Array

  for (const f of [`${prefix}_main.png`, `${prefix}_lsoverlay.png`, outFile]) {
    try { await ff.deleteFile(f) } catch { /* ignore */ }
  }

  return output
}

// Process one video file for the given text versions. Returns partial outputs
// (filename → data). Call for each video sequentially to keep memory low.
export async function processVideoFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ff: any,
  taskConfig: BrowserTaskConfig,
  videoFile: BrowserVideoFile,
  textVersions: TextVersion[],
  onLog: (msg: string) => void,
): Promise<Record<string, Uint8Array>> {
  await ensureFonts()
  const langs: Language[] = ['EN', 'AR']
  const formatsToProcess: VideoFormat[] = videoFile.format === 'SQ' ? ['SQ', 'FEED'] : [videoFile.format]
  const outputs: Record<string, Uint8Array> = {}

  // Write the trailer once and reuse it for all variants of this video
  const trailerKey = `trailer_${videoFile.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.mp4`
  await ff.writeFile(trailerKey, videoFile.data.slice())

  try {
    for (const version of textVersions) {
      for (const outputFormat of formatsToProcess) {
        for (const lang of langs) {
          const label = `${taskConfig.campaign}/${lang}/${outputFormat}/v${version.id}`
          onLog(`Processing: ${label}`)
          try {
            const data = await processOneJob(ff, taskConfig, videoFile, trailerKey, outputFormat, lang, version, onLog)
            const outVer   = Math.max(videoFile.version, version.id)
            const baseName = `${taskConfig.titleName}_${taskConfig.campaign}_${outputFormat}_${lang}_v${outVer}.mp4`
            const filePath = `${taskConfig.titleName}/${taskConfig.campaign}/v${outVer}/${lang}/${baseName}`
            outputs[filePath] = data
            onLog(`  ✓ ${baseName}`)
          } catch (err) {
            onLog(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    }
  } finally {
    try { await ff.deleteFile(trailerKey) } catch { /* ignore */ }
  }

  return outputs
}

// Given the set of available video version numbers and the text versions in the
// task config, compute which text versions each video version should serve.
export function mapVideoVersionsToText(
  availableVideoVersions: number[],
  textVersions: TextVersion[],
): Map<number, TextVersion[]> {
  const available = new Set(availableVideoVersions)
  // Use the lowest available video version as fallback (not necessarily 1)
  const fallback = availableVideoVersions.length > 0
    ? Math.min(...availableVideoVersions)
    : 1
  const mapping = new Map<number, TextVersion[]>()
  for (const tv of textVersions) {
    const vid = available.has(tv.id) ? tv.id : fallback
    if (!mapping.has(vid)) mapping.set(vid, [])
    mapping.get(vid)!.push(tv)
  }
  return mapping
}

export async function runBrowserPipeline(
  taskConfig: BrowserTaskConfig,
  videos: BrowserVideoFile[],
  onLog: (msg: string) => void,
  onFFmpegProgress: (pct: number) => void
): Promise<Uint8Array> {
  const ff = await loadFFmpeg(onFFmpegProgress)
  const versionMap = mapVideoVersionsToText(
    videos.map(v => v.version),
    taskConfig.versions,
  )
  const outputs: Record<string, Uint8Array> = {}
  for (const video of videos) {
    const textVersions = versionMap.get(video.version) ?? []
    if (textVersions.length === 0) continue
    Object.assign(outputs, await processVideoFile(ff, taskConfig, video, textVersions, onLog))
  }
  onLog('Packing ZIP...')
  return zipSync(outputs as Record<string, Uint8Array>, { level: 1 })
}
