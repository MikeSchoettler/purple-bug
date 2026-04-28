import https from 'https'
import fs from 'fs'
import path from 'path'

const API_BASE = 'https://cloud-api.yandex.net/v1/disk/public'

interface DiskItem {
  name: string
  type: 'file' | 'dir'
  path: string
}

export async function downloadDiskFolder(
  diskUrl: string,
  destDir: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const log = onProgress ?? ((m: string) => console.log(m))
  const { publicKey, folderPath } = parseDiskUrl(diskUrl)

  const items = await listFolder(publicKey, folderPath)
  const videos = items.filter(i => i.type === 'file' && /\.(mp4|mov|webm)$/i.test(i.name))

  if (videos.length === 0) throw new Error('No video files found at the provided Yandex Disk URL')

  log(`Downloading ${videos.length} video(s) from Yandex Disk...`)

  for (const file of videos) {
    log(`Downloading: ${file.name}`)
    const { href } = await apiFetch<{ href: string }>(
      `${API_BASE}/resources/download?public_key=${encodeURIComponent(publicKey)}&path=${encodeURIComponent(file.path)}`
    )
    await streamDownload(href, path.join(destDir, file.name))
    log(`  ✓ ${file.name}`)
  }
}

function parseDiskUrl(url: string): { publicKey: string; folderPath: string } {
  const match = url.match(/^(https?:\/\/disk\.yandex\.(?:com|ru)\/d\/[^/?#\s]+)(\/[^?#]*)?/)
  if (!match) throw new Error(`Invalid Yandex Disk URL: ${url}`)
  return {
    publicKey: match[1],
    folderPath: decodeURIComponent(match[2] ?? '/'),
  }
}

async function listFolder(publicKey: string, folderPath: string): Promise<DiskItem[]> {
  const data = await apiFetch<{ _embedded?: { items: DiskItem[] } }>(
    `${API_BASE}/resources?public_key=${encodeURIComponent(publicKey)}&path=${encodeURIComponent(folderPath)}&limit=100`
  )
  return data._embedded?.items ?? []
}

function apiFetch<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PurpleBug/1.0' } }, res => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T) }
        catch { reject(new Error(`Disk API parse error: ${data.slice(0, 200)}`)) }
      })
    }).on('error', reject)
  })
}

function streamDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = (u: string) => {
      https.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location!); return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${res.statusCode}`)); return
        }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', err => { fs.unlink(dest, () => {}); reject(err) })
        res.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}
