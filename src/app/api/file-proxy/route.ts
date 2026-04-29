import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  let upstream: Response
  try {
    upstream = await fetch(url)
  } catch {
    return new NextResponse('Upstream fetch failed', { status: 502 })
  }

  if (!upstream.ok) {
    return new NextResponse(`Upstream error ${upstream.status}`, { status: 502 })
  }

  const headers = new Headers({
    'Content-Type':                upstream.headers.get('Content-Type') ?? 'video/mp4',
    'Access-Control-Allow-Origin': '*',
  })
  const cl = upstream.headers.get('Content-Length')
  if (cl) headers.set('Content-Length', cl)

  return new NextResponse(upstream.body, { headers })
}
