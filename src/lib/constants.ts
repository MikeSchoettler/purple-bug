import type { CampaignType, FormatLayout, VideoFormat, Language } from './types'
import path from 'path'

export const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets')
export const FONTS_DIR  = path.join(ASSETS_DIR, 'fonts')
export const PLATES_DIR = path.join(ASSETS_DIR, 'plates')
export const LOGOSHOTS_DIR = path.join(ASSETS_DIR, 'logoshots')

export const FONT_HEADLINE    = path.join(FONTS_DIR, 'YangoGroupHeadline-ExtraBold.ttf')
export const FONT_HEADLINE_AR = path.join(FONTS_DIR, 'YangoGroupHeadline-ExtraBold-AR.otf')
export const FONT_TEXT        = path.join(FONTS_DIR, 'YangoGroupText-Medium.ttf')

// Offer text gradient: white (top) → gold (bottom)
export const OFFER_TEXT_GRADIENT = {
  stops: [
    { offset: 0.12, color: '#FFFFFF' },
    { offset: 1.0,  color: '#FFC44D' },
  ]
}

// CTA button gradient: purple → pink → light pink (left → right)
export const CTA_BUTTON_GRADIENT = {
  stops: [
    { offset: 0,    color: '#7300E5' },
    { offset: 0.55, color: '#EE33FF' },
    { offset: 1.0,  color: '#FF77CC' },
  ]
}

export const CTA_BUTTON = {
  borderRadius: 166,
  paddingV: 43,
  paddingH: 60,
  fontSize: 48,
  color: '#FFFFFF',
}

export const WATCH_NOW_TEXT = {
  EN: 'Watch now on',
  AR: 'شــغّــل عــلــى',
  fontSize: 48,
  color: '#FFFFFF',
}

export const LOGOSHOT_TIMING = {
  shortVideoThreshold: 6,  // seconds
  shortVideoOffset: 4,     // logoshot starts at t=4s for ≤6s videos
  longVideoPreroll: 3,     // logoshot covers last 3s for >6s videos
  fadeInDuration: 0.75,    // seconds
}

// Layout coordinates verified from Figma (all values in px at 1x)
// Plates include legal text — no need to render it separately
export const LAYOUT: Record<VideoFormat, FormatLayout> = {
  SQ: {
    frame: { w: 1080, h: 1080 },
    EN: {
      offerText: { x: 30,  y: 852, w: 560, h: 228 },
      titleLogo: { x: 630, y: 752, w: 400, h: 200 },
    },
    AR: {
      offerText: { x: 490, y: 852, w: 560, h: 228 },
      titleLogo: { x: 50,  y: 752, w: 400, h: 200 },
    },
    logoshotCta: {
      watchNow: { x: 0, y: 608, w: 1080, h: 60  },
      button:   { x: 0, y: 688, w: 1080, h: 130 },
    },
  },
  FEED: {
    frame: { w: 1080, h: 1350 },
    EN: {
      offerText: { x: 30,  y: 1036, w: 480, h: 313 },
      titleLogo: { x: 550, y: 916,  w: 480, h: 240 },
    },
    AR: {
      offerText: { x: 570, y: 1036, w: 480, h: 313 },
      titleLogo: { x: 50,  y: 916,  w: 480, h: 240 },
    },
    logoshotCta: {
      watchNow: { x: 0, y: 748, w: 1080, h: 60  },
      button:   { x: 0, y: 830, w: 1080, h: 130 },
    },
  },
  V: {
    frame: { w: 1080, h: 1920 },
    EN: {
      offerText: { x: 185, y: 1252, w: 710, h: 165 },
      titleLogo: { x: 300, y: 1012, w: 480, h: 240 },
    },
    AR: {
      offerText: { x: 185, y: 1252, w: 710, h: 165 },
      titleLogo: { x: 300, y: 1012, w: 480, h: 240 },
    },
    logoshotCta: {
      watchNow: { x: 0, y: 1035, w: 1080, h: 60  },
      button:   { x: 0, y: 1115, w: 1080, h: 130 },
    },
  },
  WIDE: {
    frame: { w: 1920, h: 1080 },
    EN: {
      offerText: { x: 500,  y: 0,  w: 720, h: 260 },
      titleLogo: { x: 1270, y: 50, w: 600, h: 300 },
    },
    AR: {
      offerText: { x: 700, y: 0,  w: 720, h: 260 },
      titleLogo: { x: 50,  y: 50, w: 600, h: 300 },
    },
    logoshotCta: {
      watchNow: { x: 0, y: 630, w: 1920, h: 60  },
      button:   { x: 0, y: 710, w: 1920, h: 130 },
    },
  },
}

// Plate filename: "{Campaign} {Language} {WxH}.png"
const CAMPAIGN_NAMES: Record<CampaignType, string> = {
  YangoPlay:         'Yango Play',
  YangoPlay_noon:    'Yango Play + noon',
  YangoPlay_talabat: 'Yango Play + Talabat',
}

const FORMAT_DIMS: Record<VideoFormat, string> = {
  SQ:   '1080x1080',
  FEED: '1080x1350',
  V:    '1080x1920',
  WIDE: '1920x1080',
}

export function platePath(format: VideoFormat, campaign: CampaignType, lang: Language): string {
  return path.join(PLATES_DIR, `${CAMPAIGN_NAMES[campaign]} ${lang} ${FORMAT_DIMS[format]}.png`)
}

// Logoshot files
export const LOGOSHOT_FILES: Record<VideoFormat, string> = {
  SQ:   'Logoshot 1080x1080.mp4',
  FEED: 'Logoshot 1080x1350.mp4',
  V:    'Logoshot 1080x1920.mp4',
  WIDE: 'Logoshot 1920x1080.mp4',
}

export const LOGOSHOT_AUDIO: Record<Language, string> = {
  EN: 'Logoshot Audio EN.mp3',
  AR: 'Logoshot Audio AR.mp3',
}

// Video format detection: keyword → format
export const FORMAT_KEYWORDS: Array<{ keywords: string[]; format: VideoFormat }> = [
  { keywords: ['wide', 'landscape', '1920x1080', '1920_1080'], format: 'WIDE' },
  { keywords: ['vertical', 'story', 'stories', '1080x1920', '1080_1920'], format: 'V'    },
  { keywords: ['square', 'sq', '1080x1080', '1080_1080'],                format: 'SQ'   },
]
// FEED has no dedicated source video — reuses SQ
