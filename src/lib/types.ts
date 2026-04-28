export type VideoFormat = 'SQ' | 'WIDE' | 'V' | 'FEED'
export type Language = 'EN' | 'AR'
export type CampaignType = 'YangoPlay' | 'YangoPlay_noon' | 'YangoPlay_talabat'

export interface TextVersion {
  id: number
  mainTextEN: string
  mainTextAR: string
  ctaEN: string
  ctaAR: string
}

export interface TaskConfig {
  titleName: string
  campaign: CampaignType
  versions: TextVersion[]
  titleLogoEN: string
  titleLogoAR: string
  videosDiskUrl?: string
  videosLocalDir?: string
  customOverlays?: Partial<Record<VideoFormat, string>>
}

export interface VideoFile {
  path: string
  format: VideoFormat
  width: number
  height: number
  duration: number
  version?: number
}

export interface LayoutRect {
  x: number
  y: number
  w: number
  h: number
}

export interface FormatLayout {
  frame: { w: number; h: number }
  plate: LayoutRect
  logoBlock: LayoutRect
  titleLogo: LayoutRect
  offerText: LayoutRect
  legalText: LayoutRect
  logoshotCta: { watchNow: LayoutRect; button: LayoutRect }
}

export interface ProcessingJob {
  taskConfig: TaskConfig
  videoFile: VideoFile
  language: Language
  version: TextVersion
  outputPath: string
}
