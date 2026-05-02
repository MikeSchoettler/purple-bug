import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  getIssue, getAttachments, getComments, postComment, patchIssue,
  attachFile, downloadAttachment,
  type TrackerAttachment,
} from '@/lib/tracker-client'
import { parseFormDescription, countTextVersions, extractTitleName } from '@/lib/issue-parser'
import { parseTaskFile } from '@/lib/parser'
import { runPipeline, zipOutputs } from '@/lib/processor'
import { downloadDiskFolder } from '@/lib/disk-downloader'

export const maxDuration = 300

const ROBOT_LOGIN = 'robot-bolty'
const GENERATION_STATUS_KEY = 'inProgressAtVendor'

// Signatures used to detect existing robot comments
const SIG_ASSESSMENT  = '🤖 **Проверка данных'
const SIG_ALL_GOOD    = '🤖 **Все данные собраны'
const SIG_GENERATION  = '🤖 **Начинаю генерацию'
const SIG_DONE        = '🤖 **Генерация завершена'
const SIG_CANT_START  = '🤖 **Не могу начать'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const issueKey =
    (body.issue_key as string) ||
    ((body.issue as Record<string, unknown>)?.key as string)

  if (!issueKey) {
    return NextResponse.json({ error: 'No issue_key in body' }, { status: 400 })
  }

  let issue, comments
  try {
    ;[issue, comments] = await Promise.all([
      getIssue(issueKey),
      getComments(issueKey),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const robotComments = comments.filter(c => c.createdBy.id === ROBOT_LOGIN)
  const isPhase2 = issue.status.key === GENERATION_STATUS_KEY

  if (isPhase2) {
    // Dedup: skip if generation already started in last 15 minutes
    // SIG_CANT_START is excluded — materials may have been fixed, retry should be immediate
    const recentGen = robotComments.find(c =>
      (c.text.startsWith(SIG_GENERATION) || c.text.startsWith(SIG_DONE)) &&
      Date.now() - new Date(c.createdAt).getTime() < 15 * 60_000
    )
    if (recentGen) {
      return NextResponse.json({ status: 'generation_already_running' })
    }

    try {
      await runGeneration(issueKey)
      return NextResponse.json({ status: 'generation_started' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // Phase 1: dedup — skip if robot already posted any assessment
  const alreadyAssessed = robotComments.some(c =>
    c.text.startsWith(SIG_ASSESSMENT) || c.text.startsWith(SIG_ALL_GOOD)
  )
  if (alreadyAssessed) {
    return NextResponse.json({ status: 'already_assessed' })
  }

  try {
    await runAssessment(issueKey)
    return NextResponse.json({ status: 'assessed' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── Phase 1: assessment ──────────────────────────────────────────────────────

async function runAssessment(issueKey: string) {
  const [issue, attachments] = await Promise.all([
    getIssue(issueKey),
    getAttachments(issueKey),
  ])

  const form = parseFormDescription(issue.description ?? '')
  const titleName = form.titleName ?? extractTitleName(issue.summary)
  const logoAttachments = getLogoAttachments(attachments)
  const customPngAttachments = getCustomPngAttachments(attachments)

  const checks = buildChecklist({ titleName, form, logoAttachments, customPngAttachments })
  const allGood = checks.every(c => c.ok)
  const comment = buildComment(titleName, form, checks, logoAttachments, customPngAttachments)

  await postComment(issueKey, comment)

  // Tag issue as assessed to allow Phase 2 trigger to fire
  const existingTags = issue.tags ?? []
  if (!existingTags.includes('robot-assessed')) {
    await patchIssue(issueKey, {
      tags: [...existingTags, 'robot-assessed'],
    })
  }

  void allGood // Phase 2 is triggered by status change, not automatically
}

// ─── Phase 2: generation ─────────────────────────────────────────────────────

async function runGeneration(issueKey: string) {
  const [issue, attachments] = await Promise.all([
    getIssue(issueKey),
    getAttachments(issueKey),
  ])

  const form = parseFormDescription(issue.description ?? '')
  const titleName = form.titleName ?? extractTitleName(issue.summary)
  const logoAttachments = getLogoAttachments(attachments)
  const customPngAttachments = getCustomPngAttachments(attachments)

  // Re-check materials before starting
  const checks = buildChecklist({ titleName, form, logoAttachments, customPngAttachments })
  if (!checks.every(c => c.ok)) {
    const missingItems = checks.filter(c => !c.ok)
    const checkLines = checks.map(c => `${c.ok ? '✅' : '❌'} **${c.label}**: ${c.note ?? ''}`).join('\n')
    await postComment(issueKey, [
      `🤖 **Не могу начать генерацию по задаче "${titleName}"**`,
      '',
      checkLines,
      '',
      `⚠️ Не хватает: ${missingItems.map(c => c.label).join(', ')}`,
    ].join('\n'))
    return
  }

  const logoEN = logoAttachments.find(a => /\ben\b|_en\.|en_/i.test(a.name)) ?? logoAttachments[0]
  const logoAR = logoAttachments.find(a => /\bar\b|_ar\.|ar_/i.test(a.name)) ?? logoAttachments[1]

  await postComment(issueKey, [
    `🤖 **Начинаю генерацию по задаче "${titleName}"**`,
    `- Логотип EN: \`${logoEN?.name ?? '?'}\``,
    `- Логотип AR: \`${logoAR?.name ?? '?'}\``,
    `- Видео: ${form.diskUrl}`,
    '',
    '_Это займёт до 5 минут. Архив будет прикреплён к задаче._',
  ].join('\n'))

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'))
  const videosDir = path.join(tmpDir, 'videos')
  fs.mkdirSync(videosDir)

  try {
    const [logoENBuf, logoARBuf] = await Promise.all([
      downloadAttachment(logoEN!),
      downloadAttachment(logoAR!),
    ])

    const logoENPath = path.join(tmpDir, 'logo_en.png')
    const logoARPath = path.join(tmpDir, 'logo_ar.png')
    fs.writeFileSync(logoENPath, logoENBuf)
    fs.writeFileSync(logoARPath, logoARBuf)

    // Download custom overlay PNGs if present
    const customOverlays: Record<string, string> = {}
    for (const a of customPngAttachments) {
      const fmt = detectOverlayFormat(a.name)
      if (fmt) {
        const buf = await downloadAttachment(a)
        const p = path.join(tmpDir, `overlay_${fmt}.png`)
        fs.writeFileSync(p, buf)
        customOverlays[fmt] = p
      }
    }

    if (form.diskUrl) {
      await downloadDiskFolder(form.diskUrl, videosDir, () => {})
    }

    const taskContent = buildTaskFileContent(form, titleName)
    const taskConfig = parseTaskFile(taskContent, {
      titleLogoEN: logoENPath,
      titleLogoAR: logoARPath,
      titleName,
      campaign: form.campaign,
      videosLocalDir: videosDir,
      videosDiskUrl: form.diskUrl,
      customOverlays: Object.keys(customOverlays).length > 0 ? customOverlays : undefined,
    })

    const outputDir = path.join(tmpDir, 'output')
    const result = await runPipeline(taskConfig, videosDir, outputDir, () => {})

    fs.rmSync(videosDir, { recursive: true, force: true })

    if (result.outputs.length === 0) {
      throw new Error(`No outputs generated. Errors: ${result.errors.join('; ')}`)
    }

    const zipPath = path.join(tmpDir, `${titleName}_creatives.zip`)
    await zipOutputs(result.outputs, zipPath)

    const zipBuffer = fs.readFileSync(zipPath)
    const safeFilename = titleName.replace(/[^\x20-\x7E]/g, '_') + '_creatives.zip'
    await attachFile(issueKey, zipBuffer, safeFilename, 'application/zip')

    await postComment(issueKey, `🤖 **Генерация завершена!**\nАрхив **${safeFilename}** прикреплён к задаче.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await postComment(issueKey, `🤖 ❌ Генерация не удалась: \`${msg}\`\nОбратитесь к @schettler.`)
    throw err
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// Build a task file string from form answers for parseTaskFile
function buildTaskFileContent(form: ReturnType<typeof parseFormDescription>, titleName: string): string {
  const raw = form.rawTexts ?? ''

  if (/version\s*\d+/i.test(raw)) {
    // Normalize Yandex Forms markdown-bold headers (**Version N**, *Version N*, or plain "Version N")
    // to the # Version N format that parseTaskFile expects. Already-correct # Version N lines
    // won't match \*{0,2} so they pass through unchanged.
    return raw.replace(/^\*{0,2}(version\s*\d+)\*{0,2}\s*$/gim, '# $1')
  }

  // Single version block
  const lines = ['# Version 1', 'Main Text', ...raw.split('\n').filter(Boolean)]
  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface CheckItem {
  label: string
  ok: boolean
  note?: string
}

function buildChecklist(ctx: {
  titleName: string
  form: ReturnType<typeof parseFormDescription>
  logoAttachments: TrackerAttachment[]
  customPngAttachments: TrackerAttachment[]
}): CheckItem[] {
  const { form, logoAttachments, customPngAttachments } = ctx

  return [
    {
      label: 'Тип кампании',
      ok: !!form.campaign,
      note: form.campaign ? campaignLabel(form.campaign) : 'не распознан',
    },
    {
      label: 'Ссылка на видео (Диск)',
      ok: !!form.diskUrl,
      note: form.diskUrl ? form.diskUrl.slice(0, 60) + '…' : 'не найдена',
    },
    {
      label: 'Логотипы PNG',
      ok: logoAttachments.length >= 2 || (!!form.isCustom && customPngAttachments.length > 0),
      note: form.isCustom && customPngAttachments.length > 0
        ? `Custom режим: ${customPngAttachments.length} PNG файл(ов) прикреплено`
        : logoAttachments.length >= 2
        ? `найдено: ${logoAttachments.map(a => a.name).join(', ')}`
        : logoAttachments.length === 1
        ? `найден только 1 файл (нужен EN + AR)`
        : 'не прикреплены',
    },
    {
      label: 'Тексты',
      ok: !!form.rawTexts,
      note: form.rawTexts
        ? `${countTextVersions(form.rawTexts)} версий`
        : 'не заполнены',
    },
    {
      label: 'Логошот',
      ok: true,  // undefined = default "yes"; any value is valid
      note: form.hasLogoshot === undefined
        ? 'не указан (по умолчанию — есть)'
        : form.hasLogoshot ? 'есть' : 'нет',
    },
  ]
}

function buildComment(
  titleName: string,
  form: ReturnType<typeof parseFormDescription>,
  checks: CheckItem[],
  _logos: TrackerAttachment[],
  _customPngs: TrackerAttachment[],
): string {
  const allGood = checks.every(c => c.ok)
  const textVersions = form.rawTexts ? countTextVersions(form.rawTexts) : 0
  const checkLines = checks.map(c => `${c.ok ? '✅' : '❌'} **${c.label}**: ${c.note ?? ''}`).join('\n')

  if (!allGood) {
    const missingItems = checks.filter(c => !c.ok)
    return [
      `🤖 **Проверка данных по задаче "${titleName}"**`,
      '',
      checkLines,
      '',
      `⚠️ Не хватает ${missingItems.length} позиции(й). Пожалуйста, дополните задачу:`,
      ...missingItems.map(c => `- ${c.label}`),
    ].join('\n')
  }

  const hasLogoshot = form.hasLogoshot !== false
  const usingCustomPngs = form.isCustom && _customPngs.length > 0

  return [
    `🤖 **Все данные собраны. Прогноз по задаче "${titleName}"**`,
    '',
    checkLines,
    '',
    '---',
    '**Расчёт объёма:**',
    `- Кампания: ${campaignLabel(form.campaign ?? 'YangoPlay')}`,
    `- Версий текста: ${textVersions}`,
    `- Языков: 2 (EN + AR)`,
    `- Форматы: SQ, WIDE, V, FEED (авто по видеофайлам)`,
    `- Логошот: ${hasLogoshot ? 'да' : 'нет'}`,
    usingCustomPngs ? `- Оверлеи: готовые Purple Bug PNG (${_customPngs.length} файл(ов))` : '',
    '',
    `📦 Итог: **~ ${textVersions * 2} × N_видео × форматы** MP4 + JPG`,
    '',
    '---',
    '**Если объём верный — смените статус на «В работе у подрядчика», и я начну генерацию.**',
  ].filter(Boolean).join('\n')
}

function getLogoAttachments(attachments: TrackerAttachment[]): TrackerAttachment[] {
  return attachments.filter(a =>
    /\.(png|jpg|jpeg)$/i.test(a.name) &&
    /logo|лого|title/i.test(a.name)
  )
}

function getCustomPngAttachments(attachments: TrackerAttachment[]): TrackerAttachment[] {
  return attachments.filter(a =>
    /\.(png)$/i.test(a.name) &&
    !/logo|лого|title/i.test(a.name)
  )
}

function detectOverlayFormat(filename: string): string | null {
  if (/\bSQ\b/i.test(filename)) return 'SQ'
  if (/\bWIDE\b/i.test(filename)) return 'WIDE'
  if (/\bV\b/i.test(filename)) return 'V'
  if (/\bFEED\b/i.test(filename)) return 'FEED'
  return null
}

function campaignLabel(campaign: string): string {
  const map: Record<string, string> = {
    YangoPlay: 'Yango Play',
    YangoPlay_noon: 'Yango Play + Noon',
    YangoPlay_talabat: 'Yango Play + Talabat',
  }
  return map[campaign] ?? campaign
}
