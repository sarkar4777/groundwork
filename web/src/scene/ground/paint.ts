import type { SiteLayout, Vec2 } from '../../proto/types'

export const TEX = {
  dirt: '/assets/textures/dirt_aerial_02_diff_2k.jpg',
  mud: '/assets/textures/aerial_mud_1_diff_2k.jpg',
  rock: '/assets/textures/aerial_ground_rock_diff_2k.jpg',
  asphalt: '/assets/textures/aerial_asphalt_01_diff_2k.jpg',
  grass: '/assets/textures/aerial_grass_rock_diff_2k.jpg',
  tracks: '/assets/textures/muddy_tracks_diff_2k.jpg',
  concrete: '/assets/textures/concrete_floor_02_diff_2k.jpg',
  gravel: '/assets/textures/gravel_road_diff_2k.jpg',
}
export type TexKey = keyof typeof TEX
export type Imgs = Record<TexKey, HTMLImageElement>

let rs = 11
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647)

// Fill with an image pattern where one texture tile covers `metres` of ground.
function pat(g: CanvasRenderingContext2D, img: HTMLImageElement, metres: number, pxPerM: number, rot = 0, ox = 0, oy = 0): CanvasPattern {
  const p = g.createPattern(img, 'repeat')!
  const s = (metres * pxPerM) / img.width
  p.setTransform(new DOMMatrix().translate(ox, oy).rotate(rot).scale(s, s))
  return p
}

function poly(g: CanvasRenderingContext2D, pts: Vec2[], toPx: (p: Vec2) => [number, number]) {
  g.beginPath()
  pts.forEach((p, i) => {
    const [x, y] = toPx(p)
    if (i) g.lineTo(x, y)
    else g.moveTo(x, y)
  })
  g.closePath()
}

function grade(g: CanvasRenderingContext2D, w: number, h: number) {
  g.globalCompositeOperation = 'soft-light'
  g.fillStyle = 'rgba(255, 214, 176, 0.16)'
  g.fillRect(0, 0, w, h)
  g.globalCompositeOperation = 'source-over'
}

// Soft random blobs, upscaled from a tiny grid so the edges are smooth.
function noiseMask(N: number, cells: number, bias: number, contrast = 3): HTMLCanvasElement {
  const s = document.createElement('canvas')
  s.width = s.height = cells
  const sg = s.getContext('2d')!
  const img = sg.createImageData(cells, cells)
  for (let i = 0; i < cells * cells; i++) {
    const v = Math.max(0, Math.min(1, (rnd() - 0.5) * contrast + bias))
    img.data[i * 4 + 3] = v * 255
  }
  sg.putImageData(img, 0, 0)
  const M = 512
  const c = document.createElement('canvas')
  c.width = c.height = M
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.filter = `blur(${Math.round(M / cells / 2.5)}px)`
  g.drawImage(s, -M / cells, -M / cells, M + (2 * M) / cells, M + (2 * M) / cells)
  void N
  return c
}

// Draw a texture layer through an alpha mask. Masks are built at low resolution, then scaled up soft.
type MaskFn = (m: CanvasRenderingContext2D, k: number) => void
const MASK = 1024
function layer(g: CanvasRenderingContext2D, N: number, fill: CanvasPattern | string, mask: HTMLCanvasElement | MaskFn, alpha = 1, filter = 'none') {
  const mc = document.createElement('canvas')
  mc.width = mc.height = MASK
  const mg = mc.getContext('2d')!
  const k = MASK / N
  if (typeof mask === 'function') {
    mg.scale(k, k)
    mask(mg, k)
  } else mg.drawImage(mask, 0, 0, MASK, MASK)
  const t = document.createElement('canvas')
  t.width = t.height = N
  const tg = t.getContext('2d')!
  tg.imageSmoothingQuality = 'high'
  tg.drawImage(mc, 0, 0, N, N)
  tg.globalCompositeOperation = 'source-in'
  tg.filter = filter
  tg.fillStyle = fill
  tg.fillRect(0, 0, N, N)
  g.globalAlpha = alpha
  g.drawImage(t, 0, 0)
  g.globalAlpha = 1
}

function softPoly(pts: Vec2[], toPx: (p: Vec2) => [number, number], blur: number): MaskFn {
  return (m, k) => {
    m.filter = `blur(${Math.max(0.5, blur * k)}px)`
    m.fillStyle = '#000'
    poly(m, pts, toPx)
    m.fill()
    m.filter = 'none'
  }
}

// The site ground as seen from the air, 200 m square, north up.
export async function paintSite(imgs: Imgs, site: SiteLayout | null, N = 2048): Promise<HTMLCanvasElement> {
  rs = 11
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const ext = site?.size ?? 200
  const ppm = N / ext
  const toPx = (p: Vec2): [number, number] => [((p[0] + ext / 2) / ext) * N, ((ext / 2 - p[1]) / ext) * N]

  g.fillStyle = pat(g, imgs.rock, 24, ppm, 0)
  g.fillRect(0, 0, N, N)
  await tick()
  layer(g, N, pat(g, imgs.rock, 31, ppm, 63, 140, 70), noiseMask(N, 14, 0.5), 0.75)
  await tick()
  layer(g, N, pat(g, imgs.gravel, 20, ppm, 25), noiseMask(N, 10, 0.35), 0.55)
  await tick()
  layer(g, N, pat(g, imgs.dirt, 34, ppm, 110), noiseMask(N, 8, 0.25, 2.4), 0.45)
  await tick()
  layer(g, N, pat(g, imgs.tracks, 16, ppm, 12), noiseMask(N, 18, 0.2, 2.5), 0.35)

  await tick()

  layer(g, N, '#2a1c12', noiseMask(N, 9, 0.3, 2.6), 0.28)
  await tick()
  layer(g, N, '#e8d6bc', noiseMask(N, 12, 0.2, 2.6), 0.12)

  // compacted working platforms around the cabins and along the south
  await tick()
  layer(g, N, pat(g, imgs.gravel, 14, ppm, 90), softPoly([[-100, -100], [100, -100], [100, -66], [-100, -66]], toPx, 30), 0.5)

  // grass margins inside the hoarding, ragged where the plant has worn them
  const margin: MaskFn = (m) => {
    m.fillStyle = '#000'
    const w = 6 * ppm
    m.fillRect(0, 0, N, w)
    m.fillRect(0, N - w * 0.7, N, w * 0.7)
    m.fillRect(0, 0, w, N)
    m.fillRect(N - w, 0, w, N)
    m.globalCompositeOperation = 'destination-in'
    m.drawImage(noiseMask(N, 40, 0.7, 2.2), 0, 0, N, N)
    m.globalCompositeOperation = 'source-over'
  }
  await tick()
  layer(g, N, pat(g, imgs.grass, 18, ppm, 30), margin, 0.95)

  if (site) {
    if (site.spoil) {
      await tick()
      layer(g, N, pat(g, imgs.rock, 10, ppm, 70), softPoly(site.spoil, toPx, 26), 0.9, 'brightness(1.18) saturate(0.75)')
      await tick()
      layer(g, N, pat(g, imgs.gravel, 12, ppm, 20), (m, k) => {
        softPoly(site.spoil!, toPx, 26)(m, k)
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(noiseMask(N, 16, 0.4, 3), 0, 0, N, N)
      }, 0.6, 'brightness(1.1)')
    }
    if (site.pit) {
      await tick()
      layer(g, N, pat(g, imgs.rock, 12, ppm, 33), softPoly(site.pit, toPx, 10), 1, 'brightness(0.78) saturate(1.1)')
      await tick()
      layer(g, N, pat(g, imgs.tracks, 10, ppm, 200), (m, k) => {
        softPoly(site.pit!, toPx, 10)(m, k)
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(noiseMask(N, 22, 0.45, 3), 0, 0, N, N)
      }, 0.6)
    }
    for (const z of site.zones) {
      if (z.kind === 'walkway' || /cabin|welfare/i.test(z.label)) {
        await tick()
        layer(g, N, pat(g, imgs.concrete, 8, ppm), softPoly(z.polygon, toPx, 3), 1)
      } else if (/laydown/i.test(z.label)) {
        await tick()
        layer(g, N, pat(g, imgs.gravel, 8, ppm, 45), softPoly(z.polygon, toPx, 6), 0.9, 'brightness(1.15) saturate(0.6)')
      }
    }
    // haul roads: one soft compacted base for all of them, then tyre tracks laid along each leg
    const w = 10 * ppm
    await tick()
    layer(g, N, pat(g, imgs.gravel, 9, ppm, 0), (m, k) => {
      m.filter = `blur(${Math.max(0.5, ppm * 0.8 * k)}px)`
      m.strokeStyle = '#000'
      m.lineCap = 'round'
      m.lineJoin = 'round'
      m.lineWidth = w * 1.3
      for (const r of site.haulRoads) {
        m.beginPath()
        r.points.forEach((p, i) => (i ? m.lineTo(...toPx(p)) : m.moveTo(...toPx(p))))
        m.stroke()
      }
    }, 0.75)
    for (const r of site.haulRoads) {
      for (let i = 1; i < r.points.length; i++) {
        const a = toPx(r.points[i - 1]), b = toPx(r.points[i])
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
        const tracks = g.createPattern(imgs.mud, 'repeat')!
        const sc = (11 * ppm) / imgs.mud.width
        tracks.setTransform(new DOMMatrix().translate(a[0], a[1]).rotate((ang * 180) / Math.PI).translate(0, -w * 0.5).scale(sc, sc))
        g.save()
        g.translate(a[0], a[1])
        g.rotate(ang)
        g.beginPath()
        g.roundRect(-w * 0.2, -w * 0.4, len + w * 0.4, w * 0.8, w * 0.3)
        g.restore()
        g.save()
        g.clip()
        g.globalAlpha = 0.55
        g.fillStyle = tracks
        g.fillRect(0, 0, N, N)
        g.restore()
      }
    }
    if (site.gate) {
      const [gx, gy] = site.gate
      await tick()
      layer(g, N, pat(g, imgs.asphalt, 14, ppm), softPoly([[gx - 8, gy - 3], [gx + 8, gy - 3], [gx + 8, gy + 10], [gx - 8, gy + 10]], toPx, 4), 1)
    }
  }

  g.save()
  g.lineCap = 'round'
  for (let i = 0; i < 70; i++) {
    const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, l = (12 + rnd() * 30) * ppm, k = (rnd() - 0.5) * 0.004
    g.strokeStyle = rnd() < 0.6 ? 'rgba(40, 28, 20, 0.13)' : 'rgba(230, 205, 170, 0.08)'
    g.lineWidth = (0.5 + rnd() * 0.3) * ppm
    for (const off of [-1.1, 1.1]) {
      g.beginPath()
      for (let s = 0; s <= 24; s++) {
        const t = (s / 24) * l
        const aa = a + k * s * 5
        const px = x + Math.cos(aa) * t - Math.sin(a) * off * ppm
        const py = y + Math.sin(aa) * t + Math.cos(a) * off * ppm
        if (s) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.stroke()
    }
  }
  g.restore()
  grade(g, N, N)
  return c
}

// The neighbourhood around the yard: road grid, blocks, a river to the west and a rail line to the east.
export const CITY = { size: 1200, hole: 200 }

export interface Block { x: number; y: number; w: number; d: number; h: number; tone: number }

export function cityBlocks(): Block[] {
  rs = 23
  const out: Block[] = []
  const pitch = 90
  for (let bx = -6; bx <= 6; bx++) {
    for (let by = -6; by <= 6; by++) {
      const cx = bx * pitch, cy = by * pitch
      if (Math.abs(cx) < 150 && Math.abs(cy) < 150) continue
      if (cx < -230) continue
      if (cx > 170 && cx < 230) continue
      const n = 2 + Math.floor(rnd() * 3)
      for (let i = 0; i < n; i++) {
        const w = 18 + rnd() * 22, d = 14 + rnd() * 24
        out.push({ x: cx + (rnd() - 0.5) * (pitch - 30 - w), y: cy + (rnd() - 0.5) * (pitch - 30 - d), w, d, h: 6 + rnd() * rnd() * 26, tone: rnd() })
      }
    }
  }
  return out
}

export function paintCity(imgs: Imgs, N = 4096): HTMLCanvasElement {
  rs = 5
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const ext = CITY.size
  const ppm = N / ext
  const X = (x: number) => ((x + ext / 2) / ext) * N
  const Y = (y: number) => ((ext / 2 - y) / ext) * N
  g.fillStyle = pat(g, imgs.grass, 30, ppm)
  g.fillRect(0, 0, N, N)
  g.save()
  g.globalAlpha = 0.35
  g.fillStyle = pat(g, imgs.dirt, 40, ppm)
  g.fillRect(0, 0, N, N)
  g.restore()
  const pitch = 90
  // pavements, then carriageways
  g.fillStyle = pat(g, imgs.concrete, 10, ppm)
  for (let k = -7; k <= 7; k++) {
    const v = k * pitch + pitch / 2
    if (v > -230) g.fillRect(X(v) - 9 * ppm, 0, 18 * ppm, N)
    g.fillRect(X(-230), Y(v) - 9 * ppm, N - X(-230), 18 * ppm)
  }
  g.fillStyle = pat(g, imgs.asphalt, 16, ppm)
  for (let k = -7; k <= 7; k++) {
    const v = k * pitch + pitch / 2
    if (v > -230) g.fillRect(X(v) - 5.5 * ppm, 0, 11 * ppm, N)
    g.fillRect(X(-230), Y(v) - 5.5 * ppm, N - X(-230), 11 * ppm)
  }
  g.strokeStyle = 'rgba(235, 235, 225, 0.55)'
  g.lineWidth = 0.18 * ppm
  g.setLineDash([3 * ppm, 4 * ppm])
  for (let k = -7; k <= 7; k++) {
    const v = k * pitch + pitch / 2
    if (v > -230) {
      g.beginPath()
      g.moveTo(X(v), 0)
      g.lineTo(X(v), N)
      g.stroke()
    }
    g.beginPath()
    g.moveTo(X(-230), Y(v))
    g.lineTo(N, Y(v))
    g.stroke()
  }
  g.setLineDash([])
  // block yards and car parks
  for (const b of cityBlocks()) {
    g.fillStyle = pat(g, b.tone > 0.5 ? imgs.asphalt : imgs.concrete, 10, ppm)
    g.globalAlpha = 0.7
    g.fillRect(X(b.x - b.w / 2 - 4), Y(b.y + b.d / 2 + 4), (b.w + 8) * ppm, (b.d + 8) * ppm)
    g.globalAlpha = 1
  }
  // river to the west
  const rx = (y: number) => -330 + Math.sin(y / 140) * 26 + Math.sin(y / 47) * 6
  g.beginPath()
  for (let y = ext / 2; y >= -ext / 2; y -= 10) g.lineTo(X(rx(y) - 34), Y(y))
  for (let y = -ext / 2; y <= ext / 2; y += 10) g.lineTo(X(rx(y) + 34), Y(y))
  g.closePath()
  g.save()
  g.fillStyle = pat(g, imgs.mud, 20, ppm)
  g.filter = 'brightness(0.8)'
  g.fill()
  g.restore()
  g.beginPath()
  for (let y = ext / 2; y >= -ext / 2; y -= 10) g.lineTo(X(rx(y) - 26), Y(y))
  for (let y = -ext / 2; y <= ext / 2; y += 10) g.lineTo(X(rx(y) + 26), Y(y))
  g.closePath()
  g.fillStyle = '#1d3a3f'
  g.fill()
  // rail corridor to the east
  g.fillStyle = pat(g, imgs.gravel, 6, ppm, 90)
  g.fillRect(X(186), 0, 28 * ppm, N)
  g.strokeStyle = '#6d6a66'
  g.lineWidth = 0.25 * ppm
  for (const tx of [192, 193.5, 205, 206.5]) {
    g.beginPath()
    g.moveTo(X(tx), 0)
    g.lineTo(X(tx), N)
    g.stroke()
  }
  // the site hoarding apron
  g.fillStyle = pat(g, imgs.concrete, 8, ppm)
  g.fillRect(X(-104), Y(104), 208 * ppm, 208 * ppm)
  grade(g, N, N)
  return c
}

export const riverX = (y: number) => -330 + Math.sin(y / 140) * 26 + Math.sin(y / 47) * 6
