import sharp from 'sharp'
import fs from 'fs'
import type { Language } from './types'
import {
  OFFER_TEXT_GRADIENT, CTA_BUTTON_GRADIENT, CTA_BUTTON, WATCH_NOW_TEXT, FONT_HEADLINE,
  FONT_HEADLINE_AR, FONT_TEXT,
} from './constants'

// Load font as base64 for SVG embedding
function fontBase64(filepath: string): string {
  return fs.readFileSync(filepath).toString('base64')
}

// Generate offer text as PNG (gradient: white top → gold bottom)
export async function renderOfferText(text: string, lang: Language, maxW: number, maxH: number): Promise<Buffer> {
  const isAR = lang === 'AR'
  const fontFamily = 'YangoHeadline'
  const fontFile = isAR ? FONT_HEADLINE_AR : FONT_HEADLINE
  const fontBase = fontBase64(fontFile)
  const fontFormat = fontFile.endsWith('.otf') ? 'opentype' : 'truetype'
  const fontSize = 64
  const lineHeight = 1.15
  const direction = isAR ? 'rtl' : 'ltr'
  const textAnchor = isAR ? 'end' : 'start'
  const textX = isAR ? maxW - 32 : 32
  const [g0, g1] = [OFFER_TEXT_GRADIENT.stops[0], OFFER_TEXT_GRADIENT.stops[1]]

  // Wrap text into lines that fit within maxW
  const lines = wrapText(text, maxW - 64, fontSize)
  const totalH = Math.min(lines.length * fontSize * lineHeight + 20, maxH)

  const linesSVG = lines.map((line, i) => `
    <text
      x="${textX}" y="${(i + 1) * fontSize * lineHeight}"
      font-family="${fontFamily}" font-size="${fontSize}"
      fill="url(#offerGrad)"
      direction="${direction}" text-anchor="${textAnchor}"
      dominant-baseline="auto"
    >${escapeXml(line)}</text>`).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${totalH}">
    <defs>
      <style>@font-face { font-family: '${fontFamily}'; src: url('data:font/${fontFormat};base64,${fontBase}'); }</style>
      <linearGradient id="offerGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="${g0.offset * 100}%" stop-color="${g0.color}"/>
        <stop offset="${g1.offset * 100}%" stop-color="${g1.color}"/>
      </linearGradient>
    </defs>
    ${linesSVG}
  </svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

// Generate "Watch now on" / Arabic equivalent static text PNG
export async function renderWatchNowText(lang: Language, frameW: number): Promise<Buffer> {
  const text = WATCH_NOW_TEXT[lang]
  const isAR = lang === 'AR'
  const fontFamily = 'YangoText'
  const fontFile = FONT_TEXT
  const fontBase = fontBase64(fontFile)
  const fontSize = WATCH_NOW_TEXT.fontSize
  const direction = isAR ? 'rtl' : 'ltr'
  const textAnchor = 'middle'
  const h = fontSize * 2

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${h}">
    <defs>
      <style>@font-face { font-family: '${fontFamily}'; src: url('data:font/truetype;base64,${fontBase}'); }</style>
    </defs>
    <text
      x="${frameW / 2}" y="${fontSize}"
      font-family="${fontFamily}" font-size="${fontSize}"
      fill="${WATCH_NOW_TEXT.color}"
      direction="${direction}" text-anchor="${textAnchor}"
    >${escapeXml(text)}</text>
  </svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

// Generate CTA button PNG with gradient background and dynamic width
export async function renderCtaButton(text: string, lang: Language, frameW: number): Promise<Buffer> {
  const isAR = lang === 'AR'
  const fontFamily = 'YangoText'
  const fontBase = fontBase64(FONT_TEXT)
  const { fontSize, paddingV, paddingH, borderRadius, color } = CTA_BUTTON
  const [g0, g1, g2] = CTA_BUTTON_GRADIENT.stops

  // Estimate text width (rough: 0.6 * fontSize per char)
  const textW = text.length * fontSize * 0.55
  const btnW = Math.ceil(textW + paddingH * 2)
  const btnH = Math.ceil(fontSize + paddingV * 2)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${btnH + 20}">
    <defs>
      <style>@font-face { font-family: '${fontFamily}'; src: url('data:font/truetype;base64,${fontBase}'); }</style>
      <linearGradient id="btnGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="${g0.offset * 100}%" stop-color="${g0.color}"/>
        <stop offset="${g1.offset * 100}%" stop-color="${g1.color}"/>
        <stop offset="${g2.offset * 100}%" stop-color="${g2.color}"/>
      </linearGradient>
    </defs>
    <rect
      x="${(frameW - btnW) / 2}" y="10"
      width="${btnW}" height="${btnH}"
      rx="${borderRadius}" ry="${borderRadius}"
      fill="url(#btnGrad)"
    />
    <text
      x="${frameW / 2}" y="${10 + btnH / 2 + fontSize * 0.35}"
      font-family="${fontFamily}" font-size="${fontSize}"
      fill="${color}"
      direction="${isAR ? 'rtl' : 'ltr'}" text-anchor="middle"
    >${escapeXml(text)}</text>
  </svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

// Scale and center a logo image to fit a container (fill height, max width)
export async function fitLogo(logoPath: string, containerW: number, containerH: number): Promise<Buffer> {
  const meta = await sharp(logoPath).metadata()
  const srcW = meta.width ?? containerW
  const srcH = meta.height ?? containerH
  const ratio = srcW / srcH

  let targetW: number, targetH: number
  if (ratio * containerH <= containerW) {
    targetH = containerH
    targetW = Math.round(ratio * containerH)
  } else {
    targetW = containerW
    targetH = Math.round(containerW / ratio)
  }

  const resized = await sharp(logoPath).resize(targetW, targetH, { fit: 'fill' }).toBuffer()

  // Place on transparent canvas, centered
  return sharp({
    create: { width: containerW, height: containerH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: resized, left: Math.round((containerW - targetW) / 2), top: Math.round((containerH - targetH) / 2) }])
    .png()
    .toBuffer()
}

// Simple text wrapper: split into lines based on estimated pixel width
function wrapText(text: string, maxPxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/)
  const charW = fontSize * 0.55
  const maxChars = Math.floor(maxPxWidth / charW)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if ((current + ' ' + word).length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
