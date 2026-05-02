// When TRACKER_PROXY_URL is set, all Tracker API calls are routed through the
// proxy as POST {path, method, data, binary?, attach?}. The proxy adds the
// robot-bolty OAuth header and forwards to st-api.yandex-team.ru.
// Without a proxy, direct OAuth calls are made using ROBOT_BOLTY_TOKEN.

async function trackerFetch<T>(
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<T> {
  const proxyUrl = process.env.TRACKER_PROXY_URL

  if (proxyUrl) {
    return proxyCall<T>(proxyUrl, {
      path: '/v2' + path,
      method: options.method ?? 'GET',
      data: options.body ? JSON.parse(options.body) : undefined,
    })
  }

  const token = process.env.TRACKER_TOKEN ?? process.env.ROBOT_BOLTY_TOKEN
  if (!token) throw new Error('No Tracker OAuth token configured')

  const res = await fetch('https://st-api.yandex-team.ru/v2' + path, {
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `OAuth ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tracker API ${res.status} for ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function proxyCall<T>(
  proxyUrl: string,
  payload: { path: string; method: string; data?: unknown; binary?: boolean; attach?: unknown },
): Promise<T> {
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-proxy-secret': process.env.PROXY_SECRET ?? '',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Proxy ${res.status}: ${text}`)
  }
  const wrapper = await res.json() as { status: number; body?: T; data?: string; error?: string }
  if (wrapper.error) throw new Error(wrapper.error)
  if (wrapper.status && wrapper.status >= 400) {
    throw new Error(`Tracker API ${wrapper.status} for ${payload.path}: ${JSON.stringify(wrapper.body)}`)
  }
  return (wrapper.data !== undefined ? wrapper.data : wrapper.body) as T
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
}

export interface TrackerAttachment {
  id: string
  name: string
  content: string
  mimeType: string
  size: number
  createdAt: string
}

export interface TrackerComment {
  id: string
  createdBy: TrackerUser
  createdAt: string
  text: string
}

export async function getIssue(key: string): Promise<TrackerIssue> {
  return trackerFetch<TrackerIssue>(`/issues/${key}`)
}

export async function getAttachments(key: string): Promise<TrackerAttachment[]> {
  return trackerFetch<TrackerAttachment[]>(`/issues/${key}/attachments`)
}

export async function getComments(key: string): Promise<TrackerComment[]> {
  return trackerFetch<TrackerComment[]>(`/issues/${key}/comments`)
}

export async function postComment(key: string, text: string): Promise<void> {
  await trackerFetch(`/issues/${key}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function patchIssue(key: string, fields: Record<string, unknown>): Promise<TrackerIssue> {
  return trackerFetch<TrackerIssue>(`/issues/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export async function changeStatus(key: string, transition: string): Promise<void> {
  await trackerFetch(`/issues/${key}/transitions/${transition}/_execute`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function getTransitions(key: string): Promise<Array<{ id: string; display: string }>> {
  return trackerFetch<Array<{ id: string; display: string }>>(`/issues/${key}/transitions`)
}

export async function downloadAttachment(attachment: TrackerAttachment): Promise<Buffer> {
  const proxyUrl = process.env.TRACKER_PROXY_URL

  if (proxyUrl) {
    // Attachment URL is absolute; strip the base to get path for the proxy
    const url = new URL(attachment.content)
    const path = url.pathname + url.search
    const result = await proxyCall<string>(proxyUrl, {
      path,
      method: 'GET',
      binary: true,
    })
    return Buffer.from(result as string, 'base64')
  }

  const token = process.env.TRACKER_TOKEN ?? process.env.ROBOT_BOLTY_TOKEN
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `OAuth ${token}`
  const res = await fetch(attachment.content, { headers })
  if (!res.ok) throw new Error(`Failed to download attachment ${attachment.name}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function attachFile(
  key: string,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  const proxyUrl = process.env.TRACKER_PROXY_URL

  if (proxyUrl) {
    await proxyCall<unknown>(proxyUrl, {
      path: `/v2/issues/${key}/attachments`,
      method: 'POST',
      attach: {
        name: filename,
        type: mimeType,
        data: buffer.toString('base64'),
      },
    })
    return
  }

  const token = process.env.TRACKER_TOKEN ?? process.env.ROBOT_BOLTY_TOKEN
  if (!token) throw new Error('No Tracker OAuth token configured')

  const form = new FormData()
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  form.append('file', new Blob([ab], { type: mimeType }), filename)

  const res = await fetch(`https://st-api.yandex-team.ru/v2/issues/${key}/attachments`, {
    method: 'POST',
    headers: { 'Authorization': `OAuth ${token}` },
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tracker attach ${res.status}: ${text}`)
  }
}
