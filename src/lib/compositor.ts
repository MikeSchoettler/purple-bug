import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import path from 'path'
import fs from 'fs'
import os from 'os'
import type { ProcessingJob, VideoFormat } from './types'
import { LAYOUT, LOGOSHOT_FILES, LOGOSHOT_AUDIO, LOGOSHOT_TIMING, platePath } from './constants'
import {
  renderOfferText, renderWatchNowText, renderCtaButton, fitLogo
} from './text-renderer'

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic)

export async function processJob(job: ProcessingJob): Promise<string> {
  const { taskConfig, videoFile, language, version, outputPath } = job
  const { format } = videoFile
  const layout = LAYOUT[format]
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purple-bug-'))

  try {
    // Determine actual format for FEED (uses SQ video but different frame/plate)
    const outputFormat: VideoFormat = format === 'SQ' && outputPath.includes('FEED') ? 'FEED' : format
    const outLayout = LAYOUT[outputFormat]

    // --- Step 1: Prepare overlay PNGs ---
    const text = language === 'EN' ? version.mainTextEN : version.mainTextAR
    const ctaText = language === 'EN' ? version.ctaEN : version.ctaAR

    const [offerPng, watchNowPng, ctaPng, titleLogoPng] = await Promise.all([
      renderOfferText(text, language, outLayout.offerText.w, outLayout.offerText.h)
        .then(buf => writeTmp(tmpDir, 'offer.png', buf)),

      renderWatchNowText(language, outLayout.frame.w)
        .then(buf => writeTmp(tmpDir, 'watchnow.png', buf)),

      renderCtaButton(ctaText, language, outLayout.frame.w)
        .then(buf => writeTmp(tmpDir, 'cta.png', buf)),

      fitLogo(
        language === 'EN' ? taskConfig.titleLogoEN : taskConfig.titleLogoAR,
        outLayout.titleLogo.w, outLayout.titleLogo.h
      ).then(buf => writeTmp(tmpDir, 'title_logo.png', buf)),
    ])

    // --- Step 2: Resolve plate (standard or custom override) ---
    const plateFile = taskConfig.customOverlays?.[outputFormat]
      ?? platePath(outputFormat, taskConfig.campaign)
    const hasPlate = fs.existsSync(plateFile)

    // --- Step 3: Resolve logoshot ---
    const logoshotVideo = path.join(process.cwd(), 'public', 'assets', 'logoshots', LOGOSHOT_FILES[outputFormat])
    const logoshotAudio = path.join(process.cwd(), 'public', 'assets', 'logoshots', LOGOSHOT_AUDIO[language])

    const dur = videoFile.duration
    const logoshotStart = dur <= LOGOSHOT_TIMING.shortVideoThreshold
      ? LOGOSHOT_TIMING.shortVideoOffset
      : dur - LOGOSHOT_TIMING.longVideoPreroll

    // --- Step 4: Build FFmpeg filter complex ---
    const { x: ctaX, y: ctaY } = outLayout.logoshotCta.button
    const { x: watchX, y: watchY } = outLayout.logoshotCta.watchNow
    const { x: offerX, y: offerY } = outLayout.offerText
    const { x: logoX, y: logoY } = outLayout.titleLogo
    const fadeD = LOGOSHOT_TIMING.fadeInDuration
    const t = logoshotStart

    // Input indices
    let inputIdx = 1 // [0] = trailer
    const plateIdx  = hasPlate ? inputIdx++ : -1
    const logoIdx   = inputIdx++
    const offerIdx  = inputIdx++
    const logoshotVideoIdx = inputIdx++
    const logoshotAudioIdx = inputIdx++
    const watchIdx  = inputIdx++
    const ctaIdx    = inputIdx++

    let filterChain = '[0:v]'

    // Plate overlay (full frame transparent PNG)
    if (hasPlate) {
      filterChain += `[${plateIdx}:v]overlay=0:0[vp];[vp]`
    }

    // Title logo overlay
    filterChain += `[${logoIdx}:v]overlay=${logoX}:${logoY}[vl];[vl]`

    // Offer text overlay
    filterChain += `[${offerIdx}:v]overlay=${offerX}:${offerY}[vo];[vo]`

    // Logoshot video overlay starting at logoshotStart
    filterChain +=
      `[${logoshotVideoIdx}:v]setpts=PTS-STARTPTS+${t}/TB[ls];` +
      `[vo][ls]overlay=0:0:shortest=1[vlsbase];[vlsbase]`

    // "Watch now on" with fade-in
    filterChain +=
      `[${watchIdx}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fw];` +
      `[fw]overlay=${watchX}:${watchY}:shortest=1[vwatch];[vwatch]`

    // CTA button with fade-in
    filterChain +=
      `[${ctaIdx}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fcta];` +
      `[fcta]overlay=${ctaX}:${ctaY}:shortest=1[vfinal]`

    // Audio: trailer until logoshotStart, then logoshot audio
    const audioFilter =
      `[0:a]atrim=0:${t},asetpts=PTS-STARTPTS[atrl];` +
      `[${logoshotAudioIdx}:a]atrim=0:${dur - t},asetpts=PTS-STARTPTS[als];` +
      `[atrl][als]concat=n=2:v=0:a=1[afinal]`

    const fullFilter = [filterChain, audioFilter].join(';')

    // --- Step 5: Run FFmpeg ---
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg()
        .input(videoFile.path)                                          // [0] trailer
        .inputOptions(['-loop', '1'])

      if (hasPlate) cmd.input(plateFile)                               // plate
      cmd
        .input(titleLogoPng)                                           // title logo
        .input(offerPng)                                               // offer text
        .input(logoshotVideo)                                          // logoshot video
        .input(logoshotAudio)                                          // logoshot audio
        .input(watchNowPng)                                            // watch now text
        .input(ctaPng)                                                 // CTA button

      cmd
        .complexFilter(fullFilter)
        .outputOptions([
          '-map [vfinal]',
          '-map [afinal]',
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 192k',
          '-movflags +faststart',
          '-pix_fmt yuv420p',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })

    return outputPath
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function writeTmp(dir: string, name: string, buf: Buffer): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, buf)
  return p
}
