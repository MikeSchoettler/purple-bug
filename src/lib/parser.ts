import type { CampaignType, TaskConfig, TextVersion } from './types'

const CAMPAIGN_MAP: Record<string, CampaignType> = {
  'yango play':         'YangoPlay',
  'yangoplay':          'YangoPlay',
  'yango play + noon':  'YangoPlay_noon',
  'yango play+noon':    'YangoPlay_noon',
  'yango play noon':    'YangoPlay_noon',
  'yango play + talabat': 'YangoPlay_talabat',
  'yango play+talabat': 'YangoPlay_talabat',
  'yango play talabat': 'YangoPlay_talabat',
}

export function parseTaskFile(content: string, opts: {
  titleLogoEN: string
  titleLogoAR: string
  videosLocalDir?: string
  videosDiskUrl?: string
  customOverlays?: Record<string, string>
}): TaskConfig {
  const lines = content.split('\n').map(l => l.trim())

  let campaign: CampaignType = 'YangoPlay'
  let titleName = 'Unknown'
  const versions: TextVersion[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // # Campaign
    if (line.match(/^#\s*campaign/i)) {
      const next = lines[i + 1]
      if (next) {
        const key = next.toLowerCase()
        campaign = CAMPAIGN_MAP[key] ?? 'YangoPlay'
        titleName = next
      }
      i += 2
      continue
    }

    // # Version N  (or "# Version" alone = version 1)
    const versionMatch = line.match(/^#\s*version\s*(\d*)/i)
    if (versionMatch) {
      const vId = parseInt(versionMatch[1] || '1', 10)
      const version = parseVersion(lines, i + 1, vId)
      versions.push(version)
      i += version._linesConsumed + 1
      continue
    }

    i++
  }

  // Fallback: single-version file with no "# Version" header
  if (versions.length === 0) {
    const v = parseVersion(lines, 0, 1)
    if (v.mainTextEN || v.mainTextAR) versions.push(v)
  }

  return {
    titleName: sanitizeFilename(titleName),
    campaign,
    versions,
    titleLogoEN: opts.titleLogoEN,
    titleLogoAR: opts.titleLogoAR,
    videosLocalDir: opts.videosLocalDir,
    videosDiskUrl: opts.videosDiskUrl,
    customOverlays: opts.customOverlays as TaskConfig['customOverlays'],
  }
}

function parseVersion(lines: string[], startIdx: number, id: number): TextVersion & { _linesConsumed: number } {
  let mainTextEN = ''
  let mainTextAR = ''
  let ctaEN = ''
  let ctaAR = ''
  let inSection: 'main' | 'cta' | null = null
  let linesConsumed = 0

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    linesConsumed++

    // Stop at next version header or end-of-file
    if (i > startIdx && line.match(/^#\s*version\s*\d+/i)) {
      linesConsumed--
      break
    }

    if (line.match(/^##\s*main\s*text/i)) { inSection = 'main'; continue }
    if (line.match(/^##\s*cta/i))         { inSection = 'cta';  continue }

    if (!line || line.startsWith('#')) continue

    const isArabic = /[؀-ۿ]/.test(line)

    if (inSection === 'main') {
      if (isArabic) mainTextAR = line
      else          mainTextEN = line
    } else if (inSection === 'cta') {
      if (isArabic) ctaAR = line
      else          ctaEN = line
    }
  }

  return { id, mainTextEN, mainTextAR, ctaEN, ctaAR, _linesConsumed: linesConsumed }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9؀-ۿ\s_-]/g, '').trim().replace(/\s+/g, '_')
}
