import { NextRequest, NextResponse } from 'next/server'
import https from 'https'

const API_BASE = 'https://cloud-api.yandex.net/v1/disk/public'

function apiGet<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PurpleBug/1.0' } }, res => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T) }
        catch { reject(new Error(`Disk API error: ${data.slice(0, 300)}`)) }
      })
    }).on('error', reject)
  })
}

function parseDiskUrl(url: string): { publicKey: string; folderPath: string } {
  const match = url.match(/^(https?:\/\/disk\.yandex\.(?:com|ru)\/d\/[^/?#\s]+)(\/[^?#]*)?/)
  if (!match) throw new Error(`Invalid Yandex Disk URL: ${url}`)
  return { publicKey: match[1], folderPath: decodeURIComponent(match[2] ?? '/') }
}

// GET /api/disk-proxy?diskUrl=... → { files: [{ name, downloadUrl }] }
export async function GET(req: NextRequest) {
  const diskUrl = req.nextUrl.searchParams.get('diskUrl')
  if (!diskUrl) return NextResponse.json({ error: 'Missing diskUrl' }, { status: 400 })

  try {
    const { publicKey, folderPath } = parseDiskUrl(diskUrl)

    const listData = await apiGet<{
      _embedded?: { items: Array<{ name: string; type: string; path: string }> }
    }>(`${API_BASE}/resources?public_key=${encodeURIComponent(publicKey)}&path=${encodeURIComponent(folderPath)}&limit=100`)

    const videoItems = (listData._embedded?.items ?? []).filter(
      i => i.type === 'file' && /\.(mp4|mov|webm)$/i.test(i.name)
    )

    if (videoItems.length === 0) {
      return NextResponse.json({ error: 'No video files found at this URL' }, { status: 404 })
    }

    const files = await Promise.all(
      videoItems.map(async item => {
        const dl = await apiGet<{ href: string }>(
          `${API_BASE}/resources/download?public_key=${encodeURIComponent(publicKey)}&path=${encodeURIComponent(item.path)}`
        )
        return { name: item.name, downloadUrl: dl.href }
      })
    )

    return NextResponse.json({ files })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
