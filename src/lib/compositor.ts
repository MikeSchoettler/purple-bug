import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import path from 'path'
import fs from 'fs'
import os from 'os'
import type { ProcessingJob } from './types'
import { LAYOUT, LOGOSHOT_FILES, LOGOSHOT_AUDIO, LOGOSHOT_TIMING, platePath } from './constants'
import { renderOfferText, renderWatchNowText, renderCtaButton, fitLogo } from './text-renderer'

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic)

export async function processJob(job: ProcessingJob): Promise<string> {
  const { taskConfig, videoFile, language, version, outputFormat, outputPath } = job
  const layout = LAYOUT[outputFormat]
  const langLayout = layout[language]
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'))

  try {
    const text    = language === 'EN' ? version.mainTextEN : version.mainTextAR
    const ctaText = language === 'EN' ? version.ctaEN      : version.ctaAR
    const logoPath = language === 'EN' ? taskConfig.titleLogoEN : taskConfig.titleLogoAR

    // Render all overlay PNGs in parallel
    const [offerPng, watchNowPng, ctaPng, titleLogoPng] = await Promise.all([
      renderOfferText(text, language, langLayout.offerText.w, langLayout.offerText.h)
        .then(buf => writeTmp(tmpDir, 'offer.png', buf)),
      renderWatchNowText(language, layout.frame.w)
        .then(buf => writeTmp(tmpDir, 'watchnow.png', buf)),
      renderCtaButton(ctaText, language, layout.frame.w)
        .then(buf => writeTmp(tmpDir, 'cta.png', buf)),
      fitLogo(logoPath, langLayout.titleLogo.w, langLayout.titleLogo.h)
        .then(buf => writeTmp(tmpDir, 'title_logo.png', buf)),
    ])

    // Resolve plate (custom override or standard)
    const plateFile = taskConfig.customOverlays?.[outputFormat]
      ?? platePath(outputFormat, taskConfig.campaign, language)
    const hasPlate = fs.existsSync(plateFile)

    // Resolve logoshot assets
    const logoshotVideo = path.join(process.cwd(), 'public', 'assets', 'logoshots', LOGOSHOT_FILES[outputFormat])
    const logoshotAudio = path.join(process.cwd(), 'public', 'assets', 'logoshots', LOGOSHOT_AUDIO[language])

    const dur = videoFile.duration
    const logoshotStart = dur <= LOGOSHOT_TIMING.shortVideoThreshold
      ? LOGOSHOT_TIMING.shortVideoOffset
      : dur - LOGOSHOT_TIMING.longVideoPreroll
    const fadeD = LOGOSHOT_TIMING.fadeInDuration
    const t = logoshotStart

    // Build input list and track indices
    // [0] trailer, then conditionally plate, then fixed overlays
    let idx = 1
    const plateIdx      = hasPlate ? idx++ : -1
    const logoIdx       = idx++
    const offerIdx      = idx++
    const logoshotVidIdx = idx++
    const logoshotAudIdx = idx++
    const watchIdx      = idx++
    const ctaIdx        = idx++

    const { x: logoX, y: logoY } = langLayout.titleLogo
    const { x: offerX, y: offerY } = langLayout.offerText
    const { x: watchX, y: watchY } = layout.logoshotCta.watchNow
    const { x: ctaX, y: ctaY }    = layout.logoshotCta.button

    // Build filter_complex as a string
    let v = '[0:v]'

    if (hasPlate) {
      v += `[${plateIdx}:v]overlay=0:0[vp];[vp]`
    }

    v +=
      `[${logoIdx}:v]overlay=${logoX}:${logoY}[vl];[vl]` +
      `[${offerIdx}:v]overlay=${offerX}:${offerY}[vo];` +

      // Logoshot overlay: reset PTS to 0, show starting at t via enable
      `[${logoshotVidIdx}:v]setpts=PTS-STARTPTS[ls];` +
      `[vo][ls]overlay=0:0:enable='gte(t,${t})'[vlsbase];` +

      // Fade-in "Watch now on" (PNG looped via -loop 1 input option)
      `[${watchIdx}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fw];` +
      `[vlsbase][fw]overlay=${watchX}:${watchY}[vw];` +

      // Fade-in CTA button (PNG looped via -loop 1 input option)
      `[${ctaIdx}:v]fade=t=in:st=${t}:d=${fadeD}:alpha=1[fc];` +
      `[vw][fc]overlay=${ctaX}:${ctaY}[vfinal]`

    const audioFilter =
      `[0:a]atrim=0:${t},asetpts=PTS-STARTPTS[atrl];` +
      `[${logoshotAudIdx}:a]atrim=0:${dur - t},asetpts=PTS-STARTPTS[als];` +
      `[atrl][als]concat=n=2:v=0:a=1[afinal]`

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg().input(videoFile.path)

      if (hasPlate) cmd.input(plateFile).inputOptions('-loop 1')
      cmd
        .input(titleLogoPng).inputOptions('-loop 1')
        .input(offerPng).inputOptions('-loop 1')
        .input(logoshotVideo)
        .input(logoshotAudio)
        .input(watchNowPng).inputOptions('-loop 1')
        .input(ctaPng).inputOptions('-loop 1')

      cmd
        .complexFilter(`${v};${audioFilter}`)
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
        .on('error', (err, _stdout, stderr) => reject(new Error(`${err.message}\n${stderr}`)))
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
