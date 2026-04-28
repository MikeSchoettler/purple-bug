import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { parseTaskFile } from '@/lib/parser'
import { runPipeline, zipOutputs } from '@/lib/processor'
import { downloadDiskFolder } from '@/lib/disk-downloader'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const formData = await req.formData()

  const taskFile   = formData.get('taskFile')   as File | null
  const logoEN     = formData.get('logoEN')     as File | null
  const logoAR     = formData.get('logoAR')     as File | null
  const videoFiles = formData.getAll('videos')  as File[]
  const diskUrl    = formData.get('diskUrl')    as string | null

  if (!taskFile) return NextResponse.json({ error: 'Task file is required' }, { status: 400 })
  if (!logoEN)   return NextResponse.json({ error: 'Title logo EN is required' }, { status: 400 })
  if (!logoAR)   return NextResponse.json({ error: 'Title logo AR is required' }, { status: 400 })
  if (videoFiles.length === 0 && !diskUrl)
    return NextResponse.json({ error: 'Provide video files or a Yandex Disk URL' }, { status: 400 })

  // Write uploaded files to tmp
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-job-'))
  const videosDir = path.join(tmpDir, 'videos')
  fs.mkdirSync(videosDir)

  try {
    const logs: string[] = []
    const taskContent = await taskFile.text()
    const logoENPath  = await saveFile(logoEN, tmpDir, 'logo_en.png')
    const logoARPath  = await saveFile(logoAR, tmpDir, 'logo_ar.png')

    // Save uploaded video files (if any)
    for (const video of videoFiles) {
      await saveFile(video, videosDir, video.name)
    }

    // Download videos from Yandex Disk if URL provided
    if (diskUrl) {
      await downloadDiskFolder(diskUrl, videosDir, msg => logs.push(msg))
    }

    // Check for custom overlay PNGs (optional)
    const customOverlays: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('overlay_') && value instanceof File) {
        const format = key.replace('overlay_', '').toUpperCase()
        customOverlays[format] = await saveFile(value as File, tmpDir, `overlay_${format}.png`)
      }
    }

    const taskConfig = parseTaskFile(taskContent, {
      titleLogoEN: logoENPath,
      titleLogoAR: logoARPath,
      videosLocalDir: videosDir,
      videosDiskUrl: diskUrl ?? undefined,
      customOverlays: Object.keys(customOverlays).length > 0 ? customOverlays : undefined,
    })

    const outputDir = path.join(tmpDir, 'output')
    const result = await runPipeline(taskConfig, videosDir, outputDir, msg => logs.push(msg))

    if (result.outputs.length === 0) {
      return NextResponse.json({ error: 'No outputs generated', logs, errors: result.errors }, { status: 500 })
    }

    // Zip and return
    const zipPath = path.join(tmpDir, `${taskConfig.titleName}_creatives.zip`)
    await zipOutputs(result.outputs, zipPath)

    const zipBuffer = fs.readFileSync(zipPath)
    fs.rmSync(tmpDir, { recursive: true, force: true })

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${taskConfig.titleName}_creatives.zip"`,
        'X-Processing-Log': JSON.stringify(logs),
      },
    })
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function saveFile(file: File, dir: string, name: string): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer())
  const p = path.join(dir, name)
  fs.writeFileSync(p, buf)
  return p
}
