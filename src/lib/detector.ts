import path from 'path'
import fs from 'fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobe = require('ffprobe') as (path: string, opts: { path: string }) => Promise<{ streams: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> }>
import ffprobeStatic from '@ffprobe-installer/ffprobe'
import type { VideoFile, VideoFormat } from './types'
import { FORMAT_KEYWORDS } from './constants'

export async function detectVideoFiles(dir: string): Promise<VideoFile[]> {
  const files = fs.readdirSync(dir).filter(f => f.match(/\.(mp4|mov|webm)$/i))
  const results: VideoFile[] = []

  for (const filename of files) {
    const filepath = path.join(dir, filename)
    try {
      const info = await getVideoInfo(filepath)
      const format = detectFormat(filename, info.width, info.height)
      if (!format) continue

      // Extract version number from filename ("version1", "version_2", "_v3", " v3")
      // Do NOT match bare numbers like "_6 sec" — require explicit "version" or "v" prefix
      const versionMatch = filename.match(/version[\s_]*(\d+)|(?:^|[_\s])v(\d+)/i)
      const version = versionMatch ? parseInt(versionMatch[1] ?? versionMatch[2], 10) : 1

      results.push({ path: filepath, format, version, ...info })
    } catch {
      // skip unreadable files
    }
  }

  return results
}

export async function getVideoInfo(filepath: string): Promise<{ width: number; height: number; duration: number }> {
  const data = await ffprobe(filepath, { path: ffprobeStatic.path })
  const stream = data.streams.find(s => s.codec_type === 'video')
  if (!stream) throw new Error(`No video stream in ${filepath}`)

  const width = stream.width ?? 0
  const height = stream.height ?? 0
  const duration = parseFloat(stream.duration ?? data.streams.find(s => s.duration)?.duration ?? '0')

  return { width, height, duration }
}

export function detectFormat(filename: string, width: number, height: number): VideoFormat | null {
  const lower = filename.toLowerCase()

  // Try filename keywords first
  for (const { keywords, format } of FORMAT_KEYWORDS) {
    if (keywords.some(k => lower.includes(k))) return format
  }

  // Fallback: detect by resolution
  if (width === 1920 && height === 1080) return 'WIDE'
  if (width === 1080 && height === 1920) return 'V'
  if (width === 1080 && height === 1080) return 'SQ'

  return null
}

// Group video files by version. Multiple videos of the same format are assigned
// sequential version numbers so all source videos are processed (not just the last one).
export function groupByVersion(videos: VideoFile[]): Map<number, Map<VideoFormat, VideoFile>> {
  const map = new Map<number, Map<VideoFormat, VideoFile>>()

  // Stable sort by filename so grouping is deterministic
  const sorted = [...videos].sort((a, b) =>
    path.basename(a.path).localeCompare(path.basename(b.path))
  )

  for (const video of sorted) {
    let v = video.version ?? 1
    // If this (version, format) slot is already taken, bump to next free version
    while (map.get(v)?.has(video.format)) v++
    if (!map.has(v)) map.set(v, new Map())
    map.get(v)!.set(video.format, video)
  }

  return map
}
