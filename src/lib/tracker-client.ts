const TRACKER_BASE = 'https://st-api.yandex-team.ru/v2'

function robotToken(): string {
  if (process.env.ROBOT_BOLTY_TOKEN) return process.env.ROBOT_BOLTY_TOKEN
  throw new Error('ROBOT_BOLTY_TOKEN env var not set')
}

async function trackerFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${TRACKER_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `OAuth ${robotToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tracker API ${res.status} for ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

export interface TrackerUser {
  id: string
  display: string
  passportUid?: number
}

export interface TrackerIssue {
  key: string
  summary: string
  description?: string
  status: { key: string; display: string }
  type: { key: string; display: string }
  tags?: string[]
  attachments?: TrackerAttachment[]
  producer?: TrackerUser | TrackerUser[]
  artDirector?: TrackerUser
  createdBy: TrackerUser
  assignee?: TrackerUser
  components?: Array<{ display: string }>
  approvementId?: string
  approvementStatus?: string
}

export interface TrackerAttachment {
  id: string
  name: string
  content: string
  mimeType: string
  size: number
  createdAt: string
}

export async function getIssue(key: string): Promise<TrackerIssue> {
  return trackerFetch<TrackerIssue>(`/issues/${key}`)
}

export async function getAttachments(key: string): Promise<TrackerAttachment[]> {
  return trackerFetch<TrackerAttachment[]>(`/issues/${key}/attachments`)
}

export async function downloadAttachment(attachment: TrackerAttachment): Promise<Buffer> {
  const res = await fetch(attachment.content, {
    headers: { 'Authorization': `OAuth ${robotToken()}` },
  })
  if (!res.ok) throw new Error(`Failed to download attachment ${attachment.name}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function postComment(key: string, text: string): Promise<void> {
  await trackerFetch(`/issues/${key}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function changeStatus(key: string, transition: string): Promise<void> {
  await trackerFetch(`/issues/${key}/transitions/${transition}/_execute`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function patchIssue(key: string, fields: Record<string, unknown>): Promise<TrackerIssue> {
  return trackerFetch<TrackerIssue>(`/issues/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export async function getTransitions(key: string): Promise<Array<{ id: string; display: string }>> {
  return trackerFetch<Array<{ id: string; display: string }>>(`/issues/${key}/transitions`)
}
