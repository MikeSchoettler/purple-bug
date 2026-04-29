import { test, expect } from '@playwright/test'
import path from 'path'

const ASSETS = path.resolve(__dirname, '../test-assets')

const TASK_TEXT = `# Version 1
## Main text
Watch It, Love It
اشاهدها، أحبها
## CTA
Watch now
شاهد الآن`

test('full pipeline — local files, SQ + V', async ({ page }) => {
  const errors: string[] = []
  const logs: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    logs.push(`[${msg.type()}] ${text}`)
    if (msg.type() === 'error') errors.push(text)
  })
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`))

  await page.goto('/')

  await page.fill('input[name=titleName]', 'TestShow')
  await page.selectOption('select[name=campaign]', 'YangoPlay')
  await page.locator('input[name=logoEN]').setInputFiles(path.join(ASSETS, 'logo_en.png'))
  await page.locator('input[name=logoAR]').setInputFiles(path.join(ASSETS, 'logo_ar.png'))
  await page.locator('input[name=videos]').setInputFiles([
    path.join(ASSETS, 'trailer_sq_v1.mp4'),
    path.join(ASSETS, 'trailer_v_v1.mp4'),
  ])
  const ta = page.locator('textarea[name=taskText]')
  await ta.fill(TASK_TEXT)

  await page.click('button[type=submit]')

  // If there's an error banner, fail immediately with the message
  const errorBanner = page.locator('.text-red-400').first()

  // Wait for FFmpeg to load (first run downloads ~20 MB WASM — allow 3 min)
  try {
    await expect(page.locator('text=FFmpeg ready')).toBeVisible({ timeout: 180_000 })
    console.log('✓ FFmpeg loaded')
  } catch {
    const errText = await errorBanner.textContent().catch(() => null)
    if (errText) throw new Error(`FFmpeg load failed — UI error: ${errText}`)
    console.log('Console log dump:\n', logs.slice(-20).join('\n'))
    await page.screenshot({ path: 'test-results/ffmpeg-load-failed.png', fullPage: true })
    throw new Error(`FFmpeg did not finish loading. Browser errors:\n${errors.join('\n') || '(none)'}`)
  }

  // Wait for full processing
  try {
    await expect(page.locator('text=Ready to download')).toBeVisible({ timeout: 300_000 })
    console.log('✓ Processing done')
  } catch {
    const errText = await errorBanner.textContent().catch(() => null)
    await page.screenshot({ path: 'test-results/processing-failed.png', fullPage: true })
    throw new Error(`Processing failed — UI: ${errText ?? '(no error banner)'}. Browser errors:\n${errors.join('\n') || '(none)'}`)
  }

  const dlLink = page.locator('a[download]')
  await expect(dlLink).toBeVisible()
  const href = await dlLink.getAttribute('href')
  expect(href).toMatch(/^blob:/)
  console.log('✓ Download link:', href?.slice(0, 60))

  if (errors.length > 0) {
    throw new Error(`Pipeline succeeded but ${errors.length} browser error(s):\n${errors.join('\n')}`)
  }
})

test('validation — missing logos shows error banner', async ({ page }) => {
  await page.goto('/')
  await page.fill('input[name=titleName]', 'TestShow')
  await page.locator('textarea[name=taskText]').fill(TASK_TEXT)
  await page.click('button[type=submit]')
  await expect(page.locator('text=Logo EN is required')).toBeVisible({ timeout: 5_000 })
})

test('validation — missing title shows error banner', async ({ page }) => {
  await page.goto('/')
  await page.click('button[type=submit]')
  await expect(page.locator('text=Show / film title is required')).toBeVisible({ timeout: 5_000 })
})
