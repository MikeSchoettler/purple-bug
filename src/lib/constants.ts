import type { CampaignType, FormatLayout, VideoFormat } from './types'
import path from 'path'

export const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets')
export const FONTS_DIR = path.join(ASSETS_DIR, 'fonts')
export const PLATES_DIR = path.join(ASSETS_DIR, 'plates')
export const LOGOSHOTS_DIR = path.join(ASSETS_DIR, 'logoshots')

export const FONT_HEADLINE = path.join(FONTS_DIR, 'YangoGroupHeadline-ExtraBold.ttf')
export const FONT_HEADLINE_AR = path.join(FONTS_DIR, 'YangoGroupHeadline-ExtraBold-AR.otf')
export const FONT_TEXT = path.join(FONTS_DIR, 'YangoGroupText-Medium.ttf')

// Gradient for offer text: white (top) → gold (bottom)
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

export const LEGAL_TEXT = {
  EN: 'T&C apply: clck.ly/3LcHDj',
  AR: 'تطبق الشروط والأحكام: clck.ly/3LcHDj',
  fontSize: 28,
  color: 'rgba(255,255,255,0.3)',
}

// Logoshot timing rules
export const LOGOSHOT_TIMING = {
  shortVideoThreshold: 6,   // seconds
  shortVideoOffset: 4,      // logoshot starts at t=4s for ≤6s videos
  longVideoPreroll: 3,      // logoshot covers last 3s for >6s videos
  fadeInDuration: 0.75,     // seconds for fade-in of text/button
}

// Layout coordinates per format (verified from Figma)
// All values in pixels at 1x scale
export const LAYOUT: Record<VideoFormat, FormatLayout> = {
  SQ: {
    frame: { w: 1080, h: 1080 },
    plate:     { x: 0,   y: 852,  w: 1080, h: 228 },
    logoBlock: { x: 32,  y: 870,  w: 480,  h: 120 },
    titleLogo: { x: 32,  y: 32,   w: 350,  h: 130 },
    offerText: { x: 32,  y: 740,  w: 1016, h: 100 },
    legalText: { x: 32,  y: 1040, w: 1016, h: 36  },
    logoshotCta: {
      watchNow: { x: 0, y: 580, w: 1080, h: 60  },
      button:   { x: 0, y: 660, w: 1080, h: 120 },
    },
  },
  FEED: {
    frame: { w: 1080, h: 1350 },
    plate:     { x: 0,   y: 1036, w: 1080, h: 314 },
    logoBlock: { x: 32,  y: 1055, w: 480,  h: 120 },
    titleLogo: { x: 32,  y: 32,   w: 350,  h: 130 },
    offerText: { x: 32,  y: 1170, w: 1016, h: 100 },
    legalText: { x: 32,  y: 1305, w: 1016, h: 36  },
    logoshotCta: {
      watchNow: { x: 0, y: 720, w: 1080, h: 60  },
      button:   { x: 0, y: 800, w: 1080, h: 120 },
    },
  },
  V: {
    frame: { w: 1080, h: 1920 },
    plate:     { x: 0,   y: 1172, w: 1080, h: 748 },
    logoBlock: { x: 32,  y: 1200, w: 480,  h: 120 },
    titleLogo: { x: 32,  y: 32,   w: 350,  h: 130 },
    offerText: { x: 32,  y: 1330, w: 1016, h: 100 },
    legalText: { x: 32,  y: 1860, w: 1016, h: 36  },
    logoshotCta: {
      watchNow: { x: 0, y: 1070, w: 1080, h: 60  },
      button:   { x: 0, y: 1150, w: 1080, h: 120 },
    },
  },
  WIDE: {
    frame: { w: 1920, h: 1080 },
    plate:     { x: 0,   y: 820,  w: 1920, h: 260 },
    logoBlock: { x: 64,  y: 845,  w: 600,  h: 140 },
    titleLogo: { x: 64,  y: 32,   w: 450,  h: 150 },
    offerText: { x: 64,  y: 730,  w: 1800, h: 80  },
    legalText: { x: 64,  y: 1040, w: 1800, h: 36  },
    logoshotCta: {
      watchNow: { x: 0, y: 600, w: 1920, h: 60  },
      button:   { x: 0, y: 690, w: 1920, h: 120 },
    },
  },
}

// Plate PNG filenames: plates/plate_{FORMAT}_{CAMPAIGN}.png
export function platePath(format: VideoFormat, campaign: CampaignType): string {
  return path.join(PLATES_DIR, `plate_${format}_${campaign}.png`)
}

// Logoshot MP4 filename mapping
export const LOGOSHOT_FILES: Record<VideoFormat, string> = {
  SQ:   'Logoshot 1080x1080.mp4',
  FEED: 'Logoshot 1080x1350.mp4',
  V:    'Logoshot 1080x1920.mp4',
  WIDE: 'Logoshot 1920x1080.mp4',
}

export const LOGOSHOT_AUDIO: Record<'EN' | 'AR', string> = {
  EN: 'Logoshot Audio EN.mp3',
  AR: 'Logoshot Audio AR.mp3',
}

// Video format detection: keyword → format
export const FORMAT_KEYWORDS: Array<{ keywords: string[]; format: VideoFormat }> = [
  { keywords: ['wide', 'landscape', '1920x1080', '1920_1080'], format: 'WIDE' },
  { keywords: ['vertical', 'story', 'stories', '1080x1920', '1080_1920'], format: 'V' },
  { keywords: ['square', 'sq', '1080x1080', '1080_1080'], format: 'SQ' },
]
// FEED is derived from SQ — no dedicated video file
