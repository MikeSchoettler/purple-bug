import { test, expect } from '@playwright/test'
import path from 'path'

const ASSETS = path.resolve(__dirname, '../test-assets')

test('FFmpeg loads without errors', async ({ page }) => {
  const browserLogs: string[] = []
  page.on('console', msg => {
    const line = `[${msg.type()}] ${msg.text()}`
    browserLogs.push(line)
    console.log('BROWSER:', line)
  })
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message)
    browserLogs.push(`PAGE ERROR: ${err.message}`)
  })

  await page.goto('/')

  // Fill minimum required to get past validation
  await page.fill('input[name=titleName]', 'TestShow')
  await page.locator('input[name=logoEN]').setInputFiles(path.join(ASSETS, 'logo_en.png'))
  await page.locator('input[name=logoAR]').setInputFiles(path.join(ASSETS, 'logo_ar.png'))
  await page.locator('input[name=videos]').setInputFiles(path.join(ASSETS, 'trailer_sq_v1.mp4'))
  await page.locator('textarea[name=taskText]').fill('# Version 1\n## Main text\nTest\nاختبار\n## CTA\nWatch now\nشاهد الآن')

  await page.click('button[type=submit]')

  // Should immediately enter loading state
  await expect(page.locator('text=Loading FFmpeg').first()).toBeVisible({ timeout: 5_000 })
  console.log('✓ Loading state visible')

  // Screenshot at 30s to see progress
  await page.waitForTimeout(30_000)
  await page.screenshot({ path: 'test-results/ffmpeg-30s.png', fullPage: true })
  console.log('Screenshot at 30s taken')

  await expect(page.locator('text=FFmpeg ready')).toBeVisible({ timeout: 240_000 })
  console.log('✓ FFmpeg loaded successfully')
  await page.screenshot({ path: 'test-results/ffmpeg-done.png', fullPage: true })
})
