import type { Language, VideoFormat } from '../types'
import {
  OFFER_TEXT_GRADIENT, CTA_BUTTON_GRADIENT, CTA_BUTTON, WATCH_NOW_TEXT,
} from '../constants-browser'

const NBSP = ' '

function insertCurrencyNBSP(text: string, lang: Language): string {
  if (lang === 'EN')
    return text.replace(/(\d) (EGP|AED|KWD|QAR)\b/g, `$1${NBSP}$2`)
  // Arabic: number before or after currency name
  return text
    .replace(/(\d) (جنيه|درهم|دينار|ريال)/g, `$1${NBSP}$2`)
    .replace(/(جنيه|درهم|دينار|ريال) (\d)/g, `$1${NBSP}$2`)
}

function offerFontSize(text: string, isWide: boolean): number {
  const len = text.length
  if (len < 13) return isWide ? 120 : 100
  if (len < 30) return isWide ? 90  : 80
  return isWide ? 72 : 64
}

let fontsLoaded = false

export async function ensureFonts(): Promise<void> {
  if (fontsLoaded) return
  const load = (family: string, url: string) => {
    const f = new FontFace(family, `url(${url})`)
    return f.load().then(f => { document.fonts.add(f) })
  }
  await Promise.all([
    load('YangoHeadline',   '/assets/fonts/YangoGroupHeadline-ExtraBold.ttf'),
    load('YangoHeadlineAR', '/assets/fonts/YangoGroupHeadline-ExtraBold-AR.otf'),
    load('YangoText',       '/assets/fonts/YangoGroupText-Medium.ttf'),
  ])
  fontsLoaded = true
}

export async function renderOfferText(
  text: string, lang: Language, maxW: number, maxH: number, format: VideoFormat
): Promise<Uint8Array> {
  await ensureFonts()
  const isAR    = lang === 'AR'
  const isWide  = format === 'WIDE'
  const isV     = format === 'V'
  const fontFamily = isAR ? 'YangoHeadlineAR' : 'YangoHeadline'

  const normalized = insertCurrencyNBSP(text, lang)
  const fontSize   = offerFontSize(normalized, isWide)
  const lineH      = fontSize  // 100% line height

  const canvas = document.createElement('canvas')
  canvas.width  = maxW
  canvas.height = maxH
  const ctx = canvas.getContext('2d')!

  ctx.font      = `${fontSize}px "${fontFamily}"`
  ctx.direction = isAR ? 'rtl' : 'ltr'

  // V format: center alignment; others: side-pinned to match logo position
  const align: CanvasTextAlign = isV ? 'center' : (isAR ? 'right' : 'left')
  ctx.textAlign    = align
  ctx.textBaseline = 'alphabetic'

  const padding = isV ? 0 : 32
  const wrapW   = maxW - padding * 2
  const lines   = wrapText(ctx, normalized, wrapW)

  // Vertical center of the text block within the zone
  const blockH  = lines.length * lineH
  const startY  = Math.max(lineH, (maxH - blockH) / 2 + lineH)

  const grad = ctx.createLinearGradient(0, startY - lineH, 0, startY - lineH + blockH)
  for (const s of OFFER_TEXT_GRADIENT.stops) grad.addColorStop(s.offset, s.color)
  ctx.fillStyle = grad

  const x = isV ? maxW / 2 : (isAR ? maxW - padding : padding)
  lines.forEach((line, i) => ctx.fillText(line, x, startY + i * lineH))

  return toPng(canvas)
}

export async function renderWatchNowText(lang: Language, frameW: number): Promise<Uint8Array> {
  await ensureFonts()
  const text     = WATCH_NOW_TEXT[lang]
  const fontSize = WATCH_NOW_TEXT.fontSize
  const h        = fontSize * 2

  const canvas = document.createElement('canvas')
  canvas.width  = frameW
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.font          = `${fontSize}px "YangoText"`
  ctx.fillStyle     = WATCH_NOW_TEXT.color
  ctx.textAlign     = 'center'
  ctx.textBaseline  = 'alphabetic'
  ctx.direction     = lang === 'AR' ? 'rtl' : 'ltr'
  ctx.fillText(text, frameW / 2, fontSize)

  return toPng(canvas)
}

export async function renderCtaButton(text: string, lang: Language, frameW: number): Promise<Uint8Array> {
  await ensureFonts()
  const { fontSize, paddingV, paddingH, borderRadius, color } = CTA_BUTTON

  const canvas = document.createElement('canvas')
  canvas.width  = frameW
  canvas.height = fontSize + paddingV * 2 + 20

  const ctx = canvas.getContext('2d')!
  ctx.font = `${fontSize}px "YangoText"`

  const textW = ctx.measureText(text).width
  const btnW  = Math.ceil(textW + paddingH * 2)
  const btnH  = Math.ceil(fontSize + paddingV * 2)
  const bx    = (frameW - btnW) / 2
  const by    = 10

  const grad = ctx.createLinearGradient(bx, 0, bx + btnW, 0)
  for (const s of CTA_BUTTON_GRADIENT.stops) grad.addColorStop(s.offset, s.color)

  ctx.fillStyle = grad
  roundRect(ctx, bx, by, btnW, btnH, borderRadius)
  ctx.fill()

  ctx.fillStyle    = color
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.direction    = lang === 'AR' ? 'rtl' : 'ltr'
  ctx.fillText(text, frameW / 2, by + btnH / 2 + fontSize * 0.35)

  return toPng(canvas)
}

export async function fitLogo(
  logoFile: File, containerW: number, containerH: number
): Promise<Uint8Array> {
  const url = URL.createObjectURL(logoFile)
  const img = new Image()
  img.src = url
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject })
  URL.revokeObjectURL(url)

  const ratio = img.naturalWidth / img.naturalHeight
  let targetW: number, targetH: number
  if (ratio * containerH <= containerW) {
    targetH = containerH; targetW = Math.round(ratio * containerH)
  } else {
    targetW = containerW; targetH = Math.round(containerW / ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width  = containerW
  canvas.height = containerH
  const ctx = canvas.getContext('2d')!
  const dx = Math.round((containerW - targetW) / 2)
  const dy = Math.round((containerH - targetH) / 2)
  ctx.drawImage(img, dx, dy, targetW, targetH)

  return toPng(canvas)
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words   = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current); current = word
    } else { current = test }
  }
  if (current) lines.push(current)
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const clamp = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + clamp, y)
  ctx.lineTo(x + w - clamp, y)
  ctx.arcTo(x + w, y,     x + w, y + clamp,     clamp)
  ctx.lineTo(x + w, y + h - clamp)
  ctx.arcTo(x + w, y + h, x + w - clamp, y + h, clamp)
  ctx.lineTo(x + clamp, y + h)
  ctx.arcTo(x,     y + h, x,     y + h - clamp, clamp)
  ctx.lineTo(x,     y + clamp)
  ctx.arcTo(x,     y,     x + clamp, y,          clamp)
  ctx.closePath()
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Canvas toBlob failed')); return }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject)
    }, 'image/png')
  })
}
