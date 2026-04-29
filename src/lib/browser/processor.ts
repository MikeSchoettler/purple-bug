'use client'
import { zipSync } from 'fflate'
import type { VideoFormat, Language, CampaignType, TextVersion } from '../types'
import {
  LAYOUT, LOGOSHOT_TIMING, LOGOSHOT_FILES, LOGOSHOT_AUDIO,
  FORMAT_KEYWORDS, plateName,
} from '../constants-browser'
import {
  ensureFonts, renderOfferText, renderWatchNowText, renderCtaButton, fitLogo,
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
    return ff
  })()

  return ffmpegLoading
}

export async function detectFormat(
  name: string, width: number, height: number
): Promise<VideoFormat | null> {
  const lower = name.toLowerCase()
  for (const { keywords, format } of FORMAT_KEYWORDS) {
    if (keywords.some(k => lower.includes(k))) return format
  }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOneJob(
  ff: any,
  taskConfig: BrowserTaskConfig,
  videoFile: BrowserVideoFile,
  outputFormat: VideoFormat,
  lang: Language,
  version: TextVersion,
  onLog: (msg: string) => void
): Promise<Uint8Array> {
  const layout    = LAYOUT[outputFormat]
  const langLayout = layout[lang]
  const { x: logoX, y: logoY, w: logoW, h: logoH } = langLayout.titleLogo
  const { x: offerX, y: offerY, w: offerW, h: offerH } = langLayout.offerText
  const { x: watchX, y: watchY } = layout.logoshotCta.watchNow
  const { x: ctaX, y: ctaY }    = layout.logoshotCta.button
  const frameW = layout.frame.w

  const text    = lang === 'EN' ? version.mainTextEN : version.mainTextAR
  const ctaText = lang === 'EN' ? version.ctaEN      : version.ctaAR
  const logoFile = lang === 'EN' ? taskConfig.logoEN : taskConfig.logoAR

  onLog('  Rendering PNGs...')
  const [logoPng, offerPng, watchNowPng, ctaPng] = await Promise.all([
    fitLogo(logoFile, logoW, logoH),
    renderOfferText(text, lang, offerW, offerH),
    renderWatchNowText(lang, frameW),
    renderCtaButton(ctaText, lang, frameW),
  ])

  const dur = videoFile.duration
  const t = dur <= LOGOSHOT_TIMING.shortVideoThreshold
    ? LOGOSHOT_TIMING.shortVideoOffset
    : dur - LOGOSHOT_TIMING.longVideoPreroll
  const fadeD = LOGOSHOT_TIMING.fadeInDuration

  const plate  = await fetchAsset(plateName(outputFormat, taskConfig.campaign, lang))
  const lsVid  = await fetchAsset(`/assets/logoshots/${LOGOSHOT_FILES[outputFormat]}`)
  const lsAud  = await fetchAsset(`/assets/logoshots/${LOGOSHOT_AUDIO[lang]}`)

  // Write files to FFmpeg virtual FS
  const prefix = `job_${outputFormat}_${lang}_v${version.id}`
  await ff.writeFile(`${prefix}_trailer.mp4`,   videoFile.data)
  await ff.writeFile(`${prefix}_plate.png`,      plate)
  await ff.writeFile(`${prefix}_logo.png`,       logoPng)
  await ff.writeFile(`${prefix}_offer.png`,      offerPng)
  await ff.writeFile(`${prefix}_ls.mp4`,         lsVid)
  await ff.writeFile(`${prefix}_lsaud.mp3`,      lsAud)
  await ff.writeFile(`${prefix}_watchnow.png`,   watchNowPng)
  await ff.writeFile(`${prefix}_cta.png`,        ctaPng)

  // Build filter_complex
  const iTrailer = 0
  const iPlate   = 1
  const iLogo    = 2
  const iOffer   = 3
  const iLsVid   = 4
  const iLsAud   = 5
  const iWatch   = 6
  const iCta     = 7

  // For FEED: pad SQ video to 1080x1350
  const padFilter = outputFormat === 'FEED'
    ? `[${iTrailer}:v]pad=1080:1350:0:0[base];[base]`
    : `[${iTrailer}:v]`

  const vf =
    padFilter +
    `[${iPlate}:v]overlay=0:0[vp];[vp]` +
    `[${iLogo}:v]overlay=${logoX}:${logoY}[vl];[vl]` +
    `[${iOffer}:v]overlay=${offerX}:${offerY}[vo];` +
    `[${iLsVid}:v]setpts=PTS-STARTPTS+${t}/TB[ls];` +
    `[vo][ls]overlay=0:0:shortest=1[vlsbase];` +
    `[${iWatch}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fw];` +
    `[vlsbase][fw]overlay=${watchX}:${watchY}:shortest=1[vw];` +
    `[${iCta}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fc];` +
    `[vw][fc]overlay=${ctaX}:${ctaY}:shortest=1[vfinal]`

  const af =
    `[${iTrailer}:a]atrim=0:${t},asetpts=PTS-STARTPTS[atrl];` +
    `[${iLsAud}:a]atrim=0:${dur - t},asetpts=PTS-STARTPTS[als];` +
    `[atrl][als]concat=n=2:v=0:a=1[afinal]`

  const outFile = `${prefix}_out.mp4`
  onLog('  Running FFmpeg...')

  const code = await ff.exec([
    '-i', `${prefix}_trailer.mp4`,
    '-i', `${prefix}_plate.png`,
    '-i', `${prefix}_logo.png`,
    '-i', `${prefix}_offer.png`,
    '-i', `${prefix}_ls.mp4`,
    '-i', `${prefix}_lsaud.mp3`,
    '-i', `${prefix}_watchnow.png`,
    '-i', `${prefix}_cta.png`,
    '-filter_complex', `${vf};${af}`,
    '-map', '[vfinal]',
    '-map', '[afinal]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    outFile,
  ])

  if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)

  const output = await ff.readFile(outFile) as Uint8Array

  // Clean up FS
  for (const f of [
    `${prefix}_trailer.mp4`, `${prefix}_plate.png`, `${prefix}_logo.png`,
    `${prefix}_offer.png`, `${prefix}_ls.mp4`, `${prefix}_lsaud.mp3`,
    `${prefix}_watchnow.png`, `${prefix}_cta.png`, outFile,
  ]) { try { await ff.deleteFile(f) } catch { /* ignore */ } }

  return output
}

export async function runBrowserPipeline(
  taskConfig: BrowserTaskConfig,
  videos: BrowserVideoFile[],
  onLog: (msg: string) => void,
  onFFmpegProgress: (pct: number) => void
): Promise<Uint8Array> {
  await ensureFonts()
  const ff = await loadFFmpeg(onFFmpegProgress)

  const byVersion = new Map<number, Map<VideoFormat, BrowserVideoFile>>()
  for (const v of videos) {
    if (!byVersion.has(v.version)) byVersion.set(v.version, new Map())
    byVersion.get(v.version)!.set(v.format, v)
  }

  const langs: Language[] = ['EN', 'AR']
  const outputs: Record<string, Uint8Array> = {}

  for (const version of taskConfig.versions) {
    const vVideos = byVersion.get(version.id) ?? byVersion.get(1)
    if (!vVideos) { onLog(`No videos for version ${version.id}, skipping`); continue }

    for (const [vFormat, videoFile] of vVideos) {
      const formatsToProcess: VideoFormat[] = vFormat === 'SQ' ? ['SQ', 'FEED'] : [vFormat]

      for (const outputFormat of formatsToProcess) {
        for (const lang of langs) {
          const label = `${taskConfig.campaign}/${lang}/${outputFormat}/v${version.id}`
          onLog(`Processing: ${label}`)
          try {
            const data = await processOneJob(ff, taskConfig, videoFile, outputFormat, lang, version, onLog)
            const filename = `${taskConfig.titleName}_${taskConfig.campaign}_${outputFormat}_${lang}_v${version.id}.mp4`
            outputs[filename] = data
            onLog(`  ✓ ${filename}`)
          } catch (err) {
            onLog(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    }
  }

  onLog('Packing ZIP...')
  const zip = zipSync(outputs as Record<string, Uint8Array>, { level: 1 })
  return zip
}
