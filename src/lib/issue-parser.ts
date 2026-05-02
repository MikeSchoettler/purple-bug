import type { CampaignType } from './types'

// Yandex Forms choice IDs → campaign type
const CAMPAIGN_CHOICE_IDS: Record<string, CampaignType> = {
  '1777550925809': 'YangoPlay',          // Yango Play
  '1777550936244': 'YangoPlay_talabat',  // Yango Play + Talabat
  '1777550945991': 'YangoPlay_noon',     // Yango Play + noon
  '1777550958520': 'YangoPlay',          // Custom (own PNGs, same base campaign)
}

const CAMPAIGN_LABEL_MAP: Record<string, CampaignType> = {
  'yango play':           'YangoPlay',
  'yango play + noon':    'YangoPlay_noon',
  'yango play + talabat': 'YangoPlay_talabat',
  'yango play+noon':      'YangoPlay_noon',
  'yango play+talabat':   'YangoPlay_talabat',
  'yango play noon':      'YangoPlay_noon',
  'yango play talabat':   'YangoPlay_talabat',
}

// Exact form question labels as they appear in the Tracker description
const FIELD_LABELS = {
  titleName:  'Title Name',
  campaign:   'Campaign type',
  link:       'Link',
  logoshot:   'Logoshot needed?',
  hasLogos:   "Do you have a Title's logos?",
  hasCopy:    'Do you have a Copy?',
  copy:       'Copy',  // renamed from Copyright in the form
} as const

export interface FormAnswers {
  titleName?: string       // from "Title Name" form field
  campaign?: CampaignType
  isCustom?: boolean       // Campaign type = Custom (has own PNGs)
  diskUrl?: string
  rawTexts?: string
  hasLogoshot?: boolean
  hasLogos?: boolean       // user says they have logo files attached
}

// Parse Yandex Forms answers from Tracker issue description.
// Forms writes answers as: "Question label:\nAnswer\n\n"
export function parseFormDescription(description: string): FormAnswers {
  if (!description) return {}

  const result: FormAnswers = {}

  // Extract answer text after an exact label.
  // Handles both Yandex Forms markdown format: **Label**\n```\nValue\n```
  // and plain format: Label:\nValue
  function extract(label: string): string | undefined {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Markdown code block format (Yandex Forms → Tracker integration)
    const mdMatch = description.match(
      new RegExp(`\\*\\*${escaped}[^*]*\\*\\*[^\\n]*\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``, 'i')
    )
    if (mdMatch) return mdMatch[1].trim() || undefined
    // Plain format fallback
    const plainMatch = description.match(
      new RegExp(`${escaped}[:\\s]*\\n([\\s\\S]*?)(?=\\n\\S[^\\n]{2,}[:\\n?]|$)`, 'i')
    )
    return plainMatch?.[1]?.trim() || undefined
  }

  function parseBool(s: string): boolean {
    return /^(да|yes|true|1)$/i.test(s.trim())
  }

  // Title name from dedicated form field
  const titleNameRaw = extract(FIELD_LABELS.titleName)
  if (titleNameRaw) result.titleName = titleNameRaw

  // Campaign type: try to match by choice ID first, then by label text
  const campaignRaw = extract(FIELD_LABELS.campaign)
  if (campaignRaw) {
    // Check if the answer contains a choice ID
    const idMatch = campaignRaw.match(/\b(\d{13})\b/)
    if (idMatch) {
      result.campaign = CAMPAIGN_CHOICE_IDS[idMatch[1]] ?? 'YangoPlay'
      result.isCustom = idMatch[1] === '1777550958520'
    } else {
      // Match by label text
      const key = campaignRaw.toLowerCase().trim()
      result.isCustom = key === 'custom'
      result.campaign = CAMPAIGN_LABEL_MAP[key] ?? 'YangoPlay'
    }
  }

  // Disk URL — exact label first, then scan anywhere in description
  const linkRaw = extract(FIELD_LABELS.link)
  if (linkRaw) {
    const urlMatch = linkRaw.match(/https?:\/\/\S+/i)
    if (urlMatch) result.diskUrl = urlMatch[0]
  }
  if (!result.diskUrl) {
    const anywhere = description.match(/https?:\/\/disk\.yandex(?:-team)?\.(?:ru|com|net)\/[^\s"')]+/i)
    if (anywhere) result.diskUrl = anywhere[0]
  }

  // Logoshot
  const logoshotRaw = extract(FIELD_LABELS.logoshot)
  if (logoshotRaw) result.hasLogoshot = parseBool(logoshotRaw)

  // Has logos
  const hasLogosRaw = extract(FIELD_LABELS.hasLogos)
  if (hasLogosRaw) result.hasLogos = parseBool(hasLogosRaw)

  // Copy / texts — use if present regardless of hasCopy toggle
  const copyRaw = extract(FIELD_LABELS.copy)
  if (copyRaw) result.rawTexts = copyRaw

  return result
}

// Count text versions from the Copyright / Copy field.
// Expected format: "**Version 1**\nMain text\nEN copy\nAR copy\nCTA"
export function countTextVersions(rawTexts: string): number {
  if (!rawTexts) return 0
  const versionMatches = rawTexts.match(/\*?\*?version\s*\d+\*?\*?/gi)
  if (versionMatches?.length) return versionMatches.length
  // Fallback: blank-line-separated blocks
  const blocks = rawTexts.split(/\n\s*\n/).filter(b => b.trim().length > 5)
  return Math.max(1, Math.min(blocks.length, 5))
}

// Sanitise issue summary into a filename-safe title
export function extractTitleName(summary: string): string {
  return summary
    .replace(/^SPARKCREATIVE[-\s]*/i, '')
    .replace(/^\[.*?\]\s*/, '')
    .replace(/[^a-zA-Z0-9А-Яа-яёЁ؀-ۿ\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80)
}
