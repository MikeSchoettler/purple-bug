import path from 'path'
import fs from 'fs'
import type { TaskConfig, VideoFormat, Language } from './types'
import { detectVideoFiles, groupByVersion } from './detector'
import { processJob } from './compositor'

export interface ProcessingResult {
  outputs: string[]
  errors: { file: string; error: string }[]
}

export async function runPipeline(
  taskConfig: TaskConfig,
  videosDir: string,
  outputBaseDir: string,
  onProgress?: (msg: string) => void
): Promise<ProcessingResult> {
  const log = onProgress ?? ((m: string) => console.log(m))
  const outputs: string[] = []
  const errors: { file: string; error: string }[] = []

  log('Scanning video files...')
  const videos = await detectVideoFiles(videosDir)
  if (videos.length === 0) throw new Error('No video files found in the provided folder')

  log(`Found ${videos.length} video(s): ${videos.map(v => `${v.format} v${v.version}`).join(', ')}`)

  const byVersion = groupByVersion(videos)
  const languages: Language[] = ['EN', 'AR']

  for (const version of taskConfig.versions) {
    const versionVideos = byVersion.get(version.id) ?? byVersion.get(1)
    if (!versionVideos) {
      log(`Warning: no videos for version ${version.id}, skipping`)
      continue
    }

    for (const [vFormat, videoFile] of versionVideos) {
      const formatsToProcess: VideoFormat[] = vFormat === 'SQ' ? ['SQ', 'FEED'] : [vFormat]

      for (const outputFormat of formatsToProcess) {
        for (const lang of languages) {
          const outputPath = buildOutputPath(
            outputBaseDir, taskConfig.titleName, taskConfig.campaign, lang, outputFormat, version.id
          )

          log(`Processing: ${taskConfig.campaign} / ${lang} / ${outputFormat} / v${version.id}`)
          try {
            const result = await processJob({
              taskConfig,
              videoFile: { ...videoFile, format: vFormat },
              language: lang,
              version,
              outputFormat,
              outputPath,
            })
            outputs.push(result)
            log(`  ✓ ${path.basename(result)}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log(`  ✗ Failed: ${msg}`)
            errors.push({ file: outputPath, error: msg })
          }
        }
      }
    }
  }

  log(`Done. ${outputs.length} file(s) created, ${errors.length} error(s).`)
  return { outputs, errors }
}

function buildOutputPath(
  base: string,
  title: string,
  campaign: string,
  lang: Language,
  format: VideoFormat,
  versionId: number
): string {
  return path.join(
    base,
    title,
    campaign,
    lang,
    `${title}_${campaign}_${format}_${lang}_v${versionId}.mp4`
  )
}

// Zip all output files into a single archive
export async function zipOutputs(outputFiles: string[], zipPath: string): Promise<void> {
  const archiver = (await import('archiver')).default
  fs.mkdirSync(path.dirname(zipPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    for (const file of outputFiles) {
      // Preserve folder structure relative to the output root
      const parts = file.split(path.sep)
      const outputIdx = parts.lastIndexOf('output')
      const relative = outputIdx >= 0
        ? parts.slice(outputIdx + 1).join(path.sep)
        : path.basename(file)
      archive.file(file, { name: relative })
    }

    archive.finalize()
  })
}
