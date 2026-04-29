'use client'
import type { VideoFormat, Language, TextVersion } from '../types'
import type { BrowserTaskConfig, BrowserVideoFile } from './processor'
import {
  LAYOUT, LOGOSHOT_TIMING, LOGOSHOT_FILES, LOGOSHOT_AUDIO, plateName,
} from '../constants-browser'
import {
  ensureFonts, renderOfferText, renderWatchNowText, renderCtaButton, fitLogo,
  compositeMainOverlay, compositeLogoshotOverlay,
} from './text-renderer'
import { createFile, DataStream } from 'mp4box'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// ── Asset cache (shared with FFmpeg processor) ──────────────────────────────
const _assetCache = new Map<string, Uint8Array>()
async function fetchBytes(url: string): Promise<Uint8Array> {
  if (_assetCache.has(url)) return _assetCache.get(url)!
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch ${url}: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  _assetCache.set(url, bytes)
  return bytes
}

export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined'
  )
}

// ── MP4 demux ───────────────────────────────────────────────────────────────

interface Mp4Sample {
  data: Uint8Array
  timestamp: number   // microseconds (composition time)
  duration: number    // microseconds
  isKey: boolean
}

interface DemuxResult {
  videoSamples: Mp4Sample[]
  audioRaw: Uint8Array       // full MP4 data for decodeAudioData (simpler than AAC demux)
  codec: string              // e.g. "avc1.640028"
  description: Uint8Array    // AVCDecoderConfigurationRecord
  width: number
  height: number
  fps: number
  duration: number           // seconds
}

function demuxMp4(data: Uint8Array): Promise<DemuxResult> {
  return new Promise((resolve, reject) => {
    const mp4 = createFile()
    let info: any = null
    let vidId = -1
    const raw: Mp4Sample[] = []

    mp4.onReady = (movie: any) => {
      info = movie
      const vt = movie.videoTracks?.[0]
      if (!vt) { reject(new Error('No video track')); return }
      vidId = vt.id
      mp4.setExtractionOptions(vidId, null, { nbSamples: Infinity })
      mp4.start()
    }

    mp4.onSamples = (_id: number, _u: unknown, samples: any[]) => {
      for (const s of samples) {
        raw.push({
          data: s.data as Uint8Array,
          timestamp: Math.round(s.cts * 1_000_000 / s.timescale),
          duration: Math.round(s.duration * 1_000_000 / s.timescale),
          isKey: s.is_sync,
        })
      }
    }

    mp4.onError = (e: unknown) => reject(new Error(String(e)))

    // mp4box.js requires an ArrayBuffer with a fileStart property
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    ;(ab as any).fileStart = 0
    mp4.appendBuffer(ab as any)
    mp4.flush()

    // For non-faststart files, give one event-loop tick so callbacks can fire
    Promise.resolve().then(() => {
      if (!info) { reject(new Error('mp4box: moov box not found')); return }

      const vt = info.videoTracks[0]

      // Extract AVCDecoderConfigurationRecord from the stsd entry
      let description: Uint8Array
      try {
        const trak = (mp4 as any).getTrackById(vidId)
        const entry = trak.mdia.minf.stbl.stsd.entries[0]
        const configBox = entry.avcC ?? entry.hvcC ?? entry.vp09
        if (!configBox) throw new Error('No avcC/hvcC/vp09 box found')
        const ds = new DataStream(undefined, 0, (DataStream as any).BIG_ENDIAN)
        configBox.write(ds)
        // Skip 4-byte size + 4-byte box type
        description = new Uint8Array(ds.buffer, 8)
      } catch (e) {
        reject(new Error(`Failed to extract codec description: ${e}`))
        return
      }

      const nbSamples = vt.nb_samples || raw.length
      const fps = vt.timescale
        ? Math.round((vt.samples_duration ? nbSamples / (vt.samples_duration / vt.timescale) : 25))
        : 25

      resolve({
        videoSamples: raw,
        audioRaw: data,
        codec: vt.codec,
        description,
        width: vt.track_width,
        height: vt.track_height,
        fps: fps || 25,
        duration: info.duration / info.timescale,
      })
    })
  })
}

// ── Audio processing (PCM trim + concat via OfflineAudioContext) ─────────────

async function buildAudioBuffer(
  trailerData: Uint8Array,
  logoshotAudioData: Uint8Array,
  t: number,
  dur: number,
): Promise<AudioBuffer> {
  const sampleRate = 44100
  const channels = 2
  const totalFrames = Math.ceil(dur * sampleRate)

  // Decode both tracks to PCM
  const [trailerPcm, lsPcm] = await Promise.all([
    new AudioContext().decodeAudioData(
      trailerData.buffer.slice(trailerData.byteOffset, trailerData.byteOffset + trailerData.byteLength) as ArrayBuffer
    ),
    new AudioContext().decodeAudioData(
      logoshotAudioData.buffer.slice(logoshotAudioData.byteOffset, logoshotAudioData.byteOffset + logoshotAudioData.byteLength) as ArrayBuffer
    ),
  ])

  const offline = new OfflineAudioContext(channels, totalFrames, sampleRate)

  // Trailer audio: play from 0 to t
  const src1 = offline.createBufferSource()
  src1.buffer = trailerPcm
  src1.connect(offline.destination)
  src1.start(0, 0, t)

  // Logoshot audio: play from t to end
  const src2 = offline.createBufferSource()
  src2.buffer = lsPcm
  src2.connect(offline.destination)
  src2.start(t, 0, dur - t)

  return offline.startRendering()
}

// Trailer-only audio path used when withLogoshot === false
async function buildAudioBufferFull(
  trailerData: Uint8Array,
  dur: number,
): Promise<AudioBuffer> {
  const sampleRate = 44100
  const channels = 2
  const totalFrames = Math.ceil(dur * sampleRate)
  const trailerPcm = await new AudioContext().decodeAudioData(
    trailerData.buffer.slice(trailerData.byteOffset, trailerData.byteOffset + trailerData.byteLength) as ArrayBuffer
  )
  const offline = new OfflineAudioContext(channels, totalFrames, sampleRate)
  const src = offline.createBufferSource()
  src.buffer = trailerPcm
  src.connect(offline.destination)
  src.start(0)
  return offline.startRendering()
}

async function encodeAudio(
  pcm: AudioBuffer,
  onChunk: (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata | undefined) => void,
): Promise<void> {
  const FRAME = 1024
  const { numberOfChannels: ch, sampleRate, length } = pcm

  const enc = new AudioEncoder({
    output: (chunk, meta) => onChunk(chunk, meta),
    error: (e) => { throw e },
  })
  enc.configure({ codec: 'mp4a.40.2', numberOfChannels: ch, sampleRate, bitrate: 128_000 })

  for (let i = 0; i < length; i += FRAME) {
    const frames = Math.min(FRAME, length - i)
    const interleaved = new Float32Array(frames * ch)
    for (let c = 0; c < ch; c++) {
      const src = pcm.getChannelData(c)
      for (let j = 0; j < frames; j++) interleaved[j * ch + c] = src[i + j]
    }
    const ad = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: ch,
      timestamp: Math.round(i * 1_000_000 / sampleRate),
      data: interleaved,
    })
    enc.encode(ad)
    ad.close()
  }
  await enc.flush()
  enc.close()
}

// ── Video processing ─────────────────────────────────────────────────────────

async function decodeSegment(
  samples: Mp4Sample[],
  codec: string,
  description: Uint8Array,
  codedW: number,
  codedH: number,
  maxTimestamp: number,  // microseconds — don't include frames beyond this
): Promise<VideoFrame[]> {
  const frames: VideoFrame[] = []

  const dec = new VideoDecoder({
    output: (f) => {
      if (f.timestamp <= maxTimestamp) {
        frames.push(f)
      } else {
        f.close()
      }
    },
    error: (e) => { throw e },
  })

  dec.configure({
    codec,
    codedWidth: codedW,
    codedHeight: codedH,
    description,
    optimizeForLatency: false,
  })

  for (const s of samples) {
    dec.decode(new EncodedVideoChunk({
      type: s.isKey ? 'key' : 'delta',
      timestamp: s.timestamp,
      duration: s.duration,
      data: s.data,
    }))
  }
  await dec.flush()
  dec.close()

  // Sort into display order (CTS) — B-frames arrive in decode order but have
  // non-monotonic CTS values; muxer requires monotonically increasing timestamps.
  frames.sort((a, b) => a.timestamp - b.timestamp)
  return frames
}

async function encodeFrames(
  frames: VideoFrame[],
  overlayBitmap: ImageBitmap,
  outputW: number,
  outputH: number,
  srcH: number,       // source frame height (may differ from outputH for FEED)
  timestampOffset: number,  // microseconds to add to each frame's timestamp
  fps: number,
  encoder: VideoEncoder,
  frameCounter: { n: number },
): Promise<void> {
  const offscreen = new OffscreenCanvas(outputW, outputH)
  const ctx = offscreen.getContext('2d')!

  const frameDuration = Math.round(1_000_000 / fps)

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const dw = frame.displayWidth
    const dh = frame.displayHeight

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, outputW, outputH)
    // For FEED, source is 1080×1080 drawn in the top portion of a 1080×1350 canvas
    ctx.drawImage(frame, 0, 0, dw, dh, 0, 0, outputW, srcH)
    ctx.drawImage(overlayBitmap, 0, 0)
    frame.close()

    // Index-based timestamps — guaranteed monotonically increasing regardless of
    // source CTS order (B-frames would otherwise cause muxer to throw and silently
    // drop the decoderConfig, leaving it null and crashing finalize()).
    const outTs = timestampOffset + i * frameDuration
    const vf = new VideoFrame(offscreen, { timestamp: outTs, duration: frameDuration })
    const keyFrame = frameCounter.n % (fps * 2) === 0  // keyframe every 2s
    encoder.encode(vf, { keyFrame })
    vf.close()
    frameCounter.n++
  }
}

// ── One job (one format × lang × version) ────────────────────────────────────

async function processOneJobWebCodecs(
  taskConfig: BrowserTaskConfig,
  videoFile: BrowserVideoFile,
  outputFormat: VideoFormat,
  lang: Language,
  version: TextVersion,
  trailerDemux: DemuxResult,
  logoshotDemux: DemuxResult | null,
  logoshotAudioData: Uint8Array | null,
  onLog: (msg: string) => void,
): Promise<Uint8Array> {
  const layout     = LAYOUT[outputFormat]
  const langLayout = layout[lang]
  const { x: logoX, y: logoY, w: logoW, h: logoH } = langLayout.titleLogo
  const { x: offerX, y: offerY, w: offerW, h: offerH } = langLayout.offerText
  const { w: frameW, h: frameH } = layout.frame

  const text     = lang === 'EN' ? version.mainTextEN : version.mainTextAR
  const ctaText  = lang === 'EN' ? version.ctaEN      : version.ctaAR
  const logoFile = lang === 'EN' ? taskConfig.logoEN  : taskConfig.logoAR

  onLog('  Rendering overlays...')
  const platePng = await fetchBytes(plateName(outputFormat, taskConfig.campaign, lang))
  const [logoPng, offerPng] = await Promise.all([
    fitLogo(logoFile, logoW, logoH),
    renderOfferText(text, lang, offerW, offerH, outputFormat),
  ])

  const dur = videoFile.duration
  const fps = trailerDemux.fps || 25
  const srcH = outputFormat === 'FEED' ? trailerDemux.height : frameH

  // ── Set up mp4-muxer ──
  const target = new ArrayBufferTarget()
  const muxer  = new Muxer({
    target,
    video: { codec: 'avc', width: frameW, height: frameH },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 44100 },
    fastStart: 'in-memory',
  })

  // ── Set up video encoder ──
  const frameCounter = { n: 0 }
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  encoder.configure({
    codec: 'avc1.4d4028',   // H.264 High profile
    width: frameW,
    height: frameH,
    bitrate: frameW >= 1920 ? 8_000_000 : 4_000_000,
    framerate: fps,
    latencyMode: 'quality',
  })

  const audioChunks: { chunk: EncodedAudioChunk; meta: EncodedAudioChunkMetadata | undefined }[] = []

  if (!taskConfig.withLogoshot) {
    // No logoshot: apply main overlay for all trailer frames, keep original audio
    const mainOverlayPng = await compositeMainOverlay(
      frameW, frameH, platePng, logoPng, logoX, logoY, offerPng, offerX, offerY
    )
    const mainBitmap = await createImageBitmap(
      new Blob([mainOverlayPng.buffer as ArrayBuffer], { type: 'image/png' })
    )

    onLog('  Decoding trailer...')
    const allFrames = await decodeSegment(
      trailerDemux.videoSamples, trailerDemux.codec, trailerDemux.description,
      trailerDemux.width, trailerDemux.height, Math.round(dur * 1_000_000),
    )
    onLog(`  Encoding ${allFrames.length} frames...`)
    await encodeFrames(allFrames, mainBitmap, frameW, frameH, srcH, 0, fps, encoder, frameCounter)
    mainBitmap.close()

    await encoder.flush()
    encoder.close()

    onLog('  Processing audio...')
    const pcm = await buildAudioBufferFull(trailerDemux.audioRaw, dur)
    await encodeAudio(pcm, (chunk, meta) => audioChunks.push({ chunk, meta }))
  } else {
    // With logoshot: trailer (0…t) then logoshot (t…end)
    const { x: watchX, y: watchY } = layout.logoshotCta.watchNow
    const { x: ctaX, y: ctaY }     = layout.logoshotCta.button

    const [watchNowPng, ctaPng] = await Promise.all([
      renderWatchNowText(lang, frameW),
      renderCtaButton(ctaText, lang, frameW),
    ])
    const [mainOverlayPng, lsOverlayPng] = await Promise.all([
      compositeMainOverlay(frameW, frameH, platePng, logoPng, logoX, logoY, offerPng, offerX, offerY),
      compositeLogoshotOverlay(frameW, frameH, watchNowPng, watchX, watchY, ctaPng, ctaX, ctaY),
    ])

    const [mainBitmap, lsBitmap] = await Promise.all([
      createImageBitmap(new Blob([mainOverlayPng.buffer as ArrayBuffer], { type: 'image/png' })),
      createImageBitmap(new Blob([lsOverlayPng.buffer as ArrayBuffer], { type: 'image/png' })),
    ])

    const tRaw = dur <= LOGOSHOT_TIMING.shortVideoThreshold
      ? LOGOSHOT_TIMING.shortVideoOffset
      : dur - LOGOSHOT_TIMING.longVideoPreroll
    const t   = Math.min(tRaw, dur - 0.5)
    const tUs = Math.round(t * 1_000_000)

    onLog('  Decoding trailer...')
    const trailerFrames = await decodeSegment(
      trailerDemux.videoSamples, trailerDemux.codec, trailerDemux.description,
      trailerDemux.width, trailerDemux.height, tUs,
    )
    onLog(`  Encoding ${trailerFrames.length} trailer frames...`)
    await encodeFrames(trailerFrames, mainBitmap, frameW, frameH, srcH, 0, fps, encoder, frameCounter)

    onLog('  Decoding logoshot...')
    const lsDurUs = Math.round((dur - t) * 1_000_000)
    const lsFrames = await decodeSegment(
      logoshotDemux!.videoSamples, logoshotDemux!.codec, logoshotDemux!.description,
      logoshotDemux!.width, logoshotDemux!.height, lsDurUs,
    )
    onLog(`  Encoding ${lsFrames.length} logoshot frames...`)
    await encodeFrames(lsFrames, lsBitmap, frameW, frameH, frameH, tUs, fps, encoder, frameCounter)

    mainBitmap.close()
    lsBitmap.close()

    await encoder.flush()
    encoder.close()

    onLog('  Processing audio...')
    const pcm = await buildAudioBuffer(trailerDemux.audioRaw, logoshotAudioData!, t, dur)
    await encodeAudio(pcm, (chunk, meta) => audioChunks.push({ chunk, meta }))
  }

  for (const { chunk, meta } of audioChunks) muxer.addAudioChunk(chunk, meta)
  muxer.finalize()
  return new Uint8Array(target.buffer)
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function processVideoFileWebCodecs(
  taskConfig: BrowserTaskConfig,
  videoFile: BrowserVideoFile,
  textVersions: TextVersion[],
  onLog: (msg: string) => void,
): Promise<Record<string, Uint8Array>> {
  await ensureFonts()

  const formatsToProcess: VideoFormat[] = videoFile.format === 'SQ' ? ['SQ', 'FEED'] : [videoFile.format]
  const langs: Language[] = ['EN', 'AR']
  const outputs: Record<string, Uint8Array> = {}

  // Demux trailer once (shared across all variants)
  onLog('  Demuxing trailer...')
  const trailerDemux = await demuxMp4(videoFile.data)

  for (const outputFormat of formatsToProcess) {
    // Fetch + demux logoshot video only when needed (cached after first use)
    let logoshotDemux: DemuxResult | null = null
    if (taskConfig.withLogoshot) {
      const lsVidData = await fetchBytes(`/assets/logoshots/${LOGOSHOT_FILES[outputFormat]}`)
      logoshotDemux = await demuxMp4(lsVidData)
    }

    for (const lang of langs) {
      for (const version of textVersions) {
        const label = `${outputFormat}/${lang}/v${version.id}`
        onLog(`Processing: ${taskConfig.campaign}/${label}`)
        try {
          const lsAudData = taskConfig.withLogoshot
            ? await fetchBytes(`/assets/logoshots/${LOGOSHOT_AUDIO[lang]}`)
            : null

          const data = await processOneJobWebCodecs(
            taskConfig, videoFile, outputFormat, lang, version,
            trailerDemux, logoshotDemux, lsAudData, onLog,
          )

          const outVer   = Math.max(videoFile.version, version.id)
          const durSec   = Math.round(videoFile.duration)
          const baseName = `${taskConfig.titleName}_${taskConfig.campaign}_${outputFormat}_${lang}_v${outVer}_${durSec}s.mp4`
          const filePath = `${taskConfig.titleName}/${taskConfig.campaign}/v${outVer}/${lang}/${baseName}`
          outputs[filePath] = data
          onLog(`  ✓ ${baseName}`)
        } catch (err) {
          onLog(`  ✗ Failed ${label}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  return outputs
}
