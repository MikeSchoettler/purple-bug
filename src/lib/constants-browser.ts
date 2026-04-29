// Browser-safe constants — no Node.js path/fs imports
import type { CampaignType, FormatLayout, VideoFormat, Language } from './types'

export const OFFER_TEXT_GRADIENT = {
  stops: [
    { offset: 0.12, color: '#FFFFFF' },
    { offset: 1.0,  color: '#FFC44D' },
  ],
}

export const CTA_BUTTON_GRADIENT = {
  stops: [
    { offset: 0,    color: '#7300E5' },
    { offset: 0.55, color: '#EE33FF' },
    { offset: 1.0,  color: '#FF77CC' },
  ],
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
  shortVideoThreshold: 6,
  shortVideoOffset: 4,
  longVideoPreroll: 3,
  fadeInDuration: 0.75,
}

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
      watchNow: { x: 0, y: 358, w: 1080, h: 60  },
      button:   { x: 0, y: 648, w: 1080, h: 130 },
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
      watchNow: { x: 0, y: 498, w: 1080, h: 60  },
      button:   { x: 0, y: 790, w: 1080, h: 130 },
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
      watchNow: { x: 0, y: 785,  w: 1080, h: 60  },
      button:   { x: 0, y: 1075, w: 1080, h: 130 },
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
      watchNow: { x: 0, y: 350, w: 1920, h: 60  },
      button:   { x: 0, y: 640, w: 1920, h: 130 },
    },
  },
}

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

export const FORMAT_KEYWORDS: Array<{ keywords: string[]; format: VideoFormat }> = [
  { keywords: ['wide', 'landscape', '1920x1080', '1920_1080'], format: 'WIDE' },
  { keywords: ['vertical', 'story', 'stories', '1080x1920', '1080_1920'], format: 'V'    },
  { keywords: ['square', 'sq', '1080x1080', '1080_1080'],                format: 'SQ'   },
]

export function plateName(format: VideoFormat, campaign: CampaignType, lang: Language): string {
  const filename = `${CAMPAIGN_NAMES[campaign]} ${lang} ${FORMAT_DIMS[format]}.png`
  return `/assets/plates/${encodeURIComponent(filename)}`
}
