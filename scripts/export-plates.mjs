/**
 * Exports creative frame plates from Figma, crops to the plate area,
 * and saves as full-frame transparent PNGs for FFmpeg overlay.
 */

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'plates')
fs.mkdirSync(OUT_DIR, { recursive: true })

const FIGMA_TOKEN = process.env.FIGMA_TOKEN
const FILE_KEY = '7XjfnAHrJgPhW3Ld7OW5WZ'

// Plate crop regions (y, height) for each format
// These define what portion of the full frame is the plate
const PLATE_REGIONS = {
  FEED: { frameW: 1080, frameH: 1350, cropY: 1036, cropH: 314 },
  SQ:   { frameW: 1080, frameH: 1080, cropY: 852,  cropH: 228 },
  WIDE: { frameW: 1920, frameH: 1080, cropY: 820,  cropH: 260 },
  V:    { frameW: 1080, frameH: 1920, cropY: 1172, cropH: 748 },
}

// EN frames only (plate visuals are the same for EN/AR)
const FRAMES = [
  // Yango Play
  { id: '3012:5933', format: 'FEED', campaign: 'YangoPlay' },
  { id: '3012:5950', format: 'SQ',   campaign: 'YangoPlay' },
  { id: '3012:5967', format: 'WIDE', campaign: 'YangoPlay' },
  { id: '3012:5982', format: 'V',    campaign: 'YangoPlay' },
  // Yango Play + noon
  { id: '3015:6322', format: 'FEED', campaign: 'YangoPlay_noon' },
  { id: '3015:6336', format: 'SQ',   campaign: 'YangoPlay_noon' },
  { id: '3015:6350', format: 'WIDE', campaign: 'YangoPlay_noon' },
  { id: '3015:6364', format: 'V',    campaign: 'YangoPlay_noon' },
  // Yango Play + Talabat
  { id: '3015:6459', format: 'FEED', campaign: 'YangoPlay_talabat' },
  { id: '3015:6473', format: 'SQ',   campaign: 'YangoPlay_talabat' },
  { id: '3015:6487', format: 'WIDE', campaign: 'YangoPlay_talabat' },
  { id: '3015:6501', format: 'V',    campaign: 'YangoPlay_talabat' },
]

async function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function main() {
  if (!FIGMA_TOKEN) throw new Error('Set FIGMA_TOKEN env var')

  const ids = FRAMES.map(f => f.id).join(',')
  console.log('Requesting export URLs from Figma...')

  const exportData = await fetchJson(
    `https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=png&scale=1`,
    { 'X-Figma-Token': FIGMA_TOKEN }
  )

  if (exportData.err) throw new Error(`Figma API error: ${exportData.err}`)
  const imageUrls = exportData.images

  for (const frame of FRAMES) {
    const url = imageUrls[frame.id]
    if (!url) { console.warn(`No URL for ${frame.id}`); continue }

    const region = PLATE_REGIONS[frame.format]
    const outFile = path.join(OUT_DIR, `plate_${frame.format}_${frame.campaign}.png`)

    console.log(`Downloading ${frame.campaign} ${frame.format}...`)
    const buf = await downloadBuffer(url)

    // Crop to the plate area
    const plateCrop = await sharp(buf)
      .extract({ left: 0, top: region.cropY, width: region.frameW, height: region.cropH })
      .toBuffer()

    // Composite onto full-frame transparent canvas, plate at correct Y position
    await sharp({
      create: {
        width: region.frameW,
        height: region.frameH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: plateCrop, left: 0, top: region.cropY }])
      .png()
      .toFile(outFile)

    console.log(`  ✓ Saved: ${path.basename(outFile)}`)
  }

  console.log('\nAll plates exported!')
}

main().catch(err => { console.error(err); process.exit(1) })
