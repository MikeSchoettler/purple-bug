import { NextRequest, NextResponse } from 'next/server'
import {
  getIssue, getAttachments, postComment, patchIssue, getTransitions,
  type TrackerAttachment,
} from '@/lib/tracker-client'
import { parseFormDescription, countTextVersions, extractTitleName } from '@/lib/issue-parser'

export const maxDuration = 60

const ROBOT_LOGIN = 'robot-bolty'
const PRODUCER_LOGIN = 'pmerkulovext'
const ASSESSED_TAG = 'robot-assessed'

// Tracker sends: { "issue": { "key": "SPARKCREATIVE-123" }, "event": "..." }
// We also accept: { "issue_key": "SPARKCREATIVE-123" } for simplicity
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Parse issue key from various possible webhook body formats
  const issueKey =
    (body.issue_key as string) ||
    ((body.issue as Record<string, unknown>)?.key as string)

  if (!issueKey) {
    return NextResponse.json({ error: 'No issue_key in body' }, { status: 400 })
  }

  // Prevent double-processing: if already assessed, skip Phase 1
  const issue = await getIssue(issueKey)
  const alreadyAssessed = issue.tags?.includes(ASSESSED_TAG)

  if (alreadyAssessed) {
    // Phase 2: confirmed by human — run generation (handled separately)
    return NextResponse.json({ status: 'already_assessed, generation not yet implemented' })
  }

  // Phase 1: assess data completeness and post prognosis
  try {
    await runAssessment(issueKey)
    return NextResponse.json({ status: 'assessed' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[tracker-webhook] Error assessing ${issueKey}:`, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function runAssessment(issueKey: string) {
  const [issue, attachments] = await Promise.all([
    getIssue(issueKey),
    getAttachments(issueKey),
  ])

  const titleName = extractTitleName(issue.summary)
  const form = parseFormDescription(issue.description ?? '')
  const logoAttachments = getLogoAttachments(attachments)
  const customPngAttachments = getCustomPngAttachments(attachments)

  // Build assessment checklist
  const checks = buildChecklist({
    titleName,
    form,
    logoAttachments,
    customPngAttachments,
  })

  const allGood = checks.every(c => c.ok)
  const comment = buildComment(titleName, form, checks, logoAttachments, customPngAttachments)

  await postComment(issueKey, comment)

  // Tag issue as assessed so we don't re-run Phase 1 on next trigger
  const existingTags = issue.tags ?? []
  await patchIssue(issueKey, {
    tags: [...existingTags, ASSESSED_TAG],
    ...(allGood ? {} : { assignee: ROBOT_LOGIN }),
  })
}

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
        ? `найден только 1 файл (нужен EN + AR) — нужно @${PRODUCER_LOGIN}`
        : `не прикреплены — нужно @${PRODUCER_LOGIN}`,
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
      ok: form.hasLogoshot !== undefined,
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
  logos: TrackerAttachment[],
  customPngs: TrackerAttachment[],
): string {
  const allGood = checks.every(c => c.ok)
  const textVersions = form.rawTexts ? countTextVersions(form.rawTexts) : 0

  const checkLines = checks
    .map(c => `${c.ok ? '✅' : '❌'} **${c.label}**: ${c.note ?? ''}`)
    .join('\n')

  const missingItems = checks.filter(c => !c.ok)

  if (!allGood) {
    const needsProducer = !logos.length && !form.isCustom
    const producerMention = needsProducer ? `\n@${PRODUCER_LOGIN}, нужны логотипы для **${titleName}** (EN + AR PNG)` : ''

    return [
      `🤖 **Проверка данных по задаче "${titleName}"**`,
      '',
      checkLines,
      '',
      `⚠️ Не хватает ${missingItems.length} позиции(й). Пожалуйста, дополните задачу:`,
      ...missingItems.map(c => `- ${c.label}`),
      producerMention,
    ].join('\n')
  }

  // All good — build prognosis
  const hasLogoshot = form.hasLogoshot !== false
  const usingCustomPngs = form.isCustom && customPngs.length > 0

  const note = [
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
    usingCustomPngs ? `- Оверлеи: готовые Purple Bug PNG (${customPngs.length} файл(ов))` : '',
    '',
    `📦 Итог: **~ ${textVersions * 2} × N_видео × форматы** MP4 + JPG`,
    '',
    '---',
    '**Если объём верный — подтвердите, и я начну генерацию.**',
    '*(Смените статус на «В работе» или используйте кнопку подтверждения)*',
  ].filter(Boolean).join('\n')

  return note
}

// Title logo files: expect 2 PNGs (EN + AR)
function getLogoAttachments(attachments: TrackerAttachment[]): TrackerAttachment[] {
  return attachments.filter(a =>
    /\.(png|jpg|jpeg)$/i.test(a.name) &&
    /logo|лого|title/i.test(a.name)
  )
}

// Custom Purple Bug overlays: PNGs uploaded when Campaign type = Custom
function getCustomPngAttachments(attachments: TrackerAttachment[]): TrackerAttachment[] {
  return attachments.filter(a =>
    /\.(png)$/i.test(a.name) &&
    !/logo|лого|title/i.test(a.name)
  )
}

function campaignLabel(campaign: string): string {
  const map: Record<string, string> = {
    YangoPlay: 'Yango Play',
    YangoPlay_noon: 'Yango Play + Noon',
    YangoPlay_talabat: 'Yango Play + Talabat',
  }
  return map[campaign] ?? campaign
}
