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
  detail: '/assets/textures/aerial_ground_rock_diff_4k.jpg',
  sand: '/assets/textures/sandy_gravel_diff_1k.jpg',
  stone: '/assets/textures/gravel_diff_1k.jpg',
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
  g.fillStyle = 'rgba(255, 226, 200, 0.08)'
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
  const zone = (re: RegExp) => site?.zones.find((z) => re.test(z.kind) || re.test(z.label))

  // compacted fill: grey-beige crushed ground, the colour of a dry working platform
  g.filter = 'saturate(0.5) brightness(0.98) contrast(1.08)'
  g.fillStyle = pat(g, imgs.rock, 26, ppm, 0)
  g.fillRect(0, 0, N, N)
  g.filter = 'none'
  await tick()
  layer(g, N, pat(g, imgs.rock, 37, ppm, 63, 140, 70), noiseMask(N, 14, 0.55, 2.4), 0.8, 'saturate(0.5) brightness(0.98) contrast(1.08)')
  await tick()
  layer(g, N, pat(g, imgs.sand, 9, ppm, 33), noiseMask(N, 12, 0.42, 2.8), 0.55, 'saturate(0.6) brightness(1.05)')
  await tick()
  layer(g, N, pat(g, imgs.stone, 7, ppm, 71), noiseMask(N, 16, 0.3, 3), 0.45, 'saturate(0.35) brightness(1.25)')
  await tick()
  // damp clay where the ground holds water, and dry dust where plant has scoured it
  layer(g, N, pat(g, imgs.dirt, 30, ppm, 110), noiseMask(N, 9, 0.3, 2.6), 0.45, 'saturate(0.75) brightness(0.75) blur(1px)')
  await tick()
  layer(g, N, '#d9d1c4', noiseMask(N, 20, 0.18, 3), 0.1)
  await tick()
  layer(g, N, '#1c1510', noiseMask(N, 26, 0.16, 3), 0.18)

  // grass margins inside the hoarding, worn ragged by the plant
  const margin: MaskFn = (m) => {
    m.fillStyle = '#000'
    const w = 6 * ppm
    m.fillRect(0, 0, N, w)
    m.fillRect(0, N - w * 0.7, N, w * 0.7)
    m.fillRect(0, 0, w, N)
    m.fillRect(N - w, 0, w, N)
    m.globalCompositeOperation = 'destination-in'
    m.drawImage(noiseMask(N, 40, 0.7, 2.2), 0, 0, N, N)
  }
  await tick()
  layer(g, N, pat(g, imgs.grass, 16, ppm, 30), margin, 0.9, 'saturate(0.55) brightness(0.62) hue-rotate(12deg)')

  if (site) {
    const pit = site.pit ?? zone(/excav|pit/)?.polygon ?? null
    if (pit) {
      // the excavation: dark wet clay, scraped in bands by the bucket
      await tick()
      layer(g, N, pat(g, imgs.dirt, 18, ppm, 20), softPoly(pit, toPx, 8), 1, 'saturate(0.8) brightness(0.6) blur(1px)')
      await tick()
      layer(g, N, pat(g, imgs.tracks, 9, ppm, 200), (m, k) => {
        softPoly(pit, toPx, 8)(m, k)
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(noiseMask(N, 22, 0.5, 3), 0, 0, N, N)
      }, 0.7, 'saturate(0.7) brightness(0.8)')
    }
    const spoil = site.spoil ?? zone(/spoil/)?.polygon ?? null
    if (spoil) {
      await tick()
      layer(g, N, pat(g, imgs.rock, 11, ppm, 70), softPoly(spoil, toPx, 18), 0.95, 'saturate(0.8) brightness(0.74)')
      await tick()
      layer(g, N, pat(g, imgs.mud, 10, ppm, 0), (m, k) => {
        softPoly(spoil, toPx, 18)(m, k)
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(noiseMask(N, 14, 0.45, 3), 0, 0, N, N)
      }, 0.55, 'saturate(0.6) sepia(0.4)')
    }
    for (const z of site.zones) {
      if (/welfare|cabin|walkway/i.test(z.kind + z.label)) {
        await tick()
        layer(g, N, pat(g, imgs.concrete, 8, ppm), softPoly(z.polygon, toPx, 3), 1, 'saturate(0.3) brightness(1.05)')
      } else if (/laydown/i.test(z.kind + z.label)) {
        await tick()
        layer(g, N, pat(g, imgs.stone, 5, ppm, 45), softPoly(z.polygon, toPx, 6), 0.95, 'saturate(0.25) brightness(1.3)')
      }
    }
    // haul roads: a soft compacted base, then real tyre-track imagery laid along each leg
    const w = 10 * ppm
    await tick()
    layer(g, N, pat(g, imgs.gravel, 9, ppm, 0), (m, k) => {
      m.filter = `blur(${Math.max(0.5, ppm * 1.2 * k)}px)`
      m.strokeStyle = '#000'
      m.lineCap = 'round'
      m.lineJoin = 'round'
      m.lineWidth = w * 1.35
      for (const r of site.haulRoads) {
        m.beginPath()
        r.points.forEach((p, i) => (i ? m.lineTo(...toPx(p)) : m.moveTo(...toPx(p))))
        m.stroke()
      }
    }, 0.85, 'saturate(0.4) brightness(0.78)')
    const tr = document.createElement('canvas')
    tr.width = tr.height = N
    const tg = tr.getContext('2d')!
    for (const r of site.haulRoads) {
      for (let i = 1; i < r.points.length; i++) {
        const a = toPx(r.points[i - 1]), b = toPx(r.points[i])
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
        const tracks = tg.createPattern(imgs.mud, 'repeat')!
        const sc = (11 * ppm) / imgs.mud.width
        tracks.setTransform(new DOMMatrix().translate(a[0], a[1]).rotate((ang * 180) / Math.PI).translate(0, -w * 0.5).scale(sc, sc))
        tg.save()
        tg.translate(a[0], a[1])
        tg.rotate(ang)
        tg.fillStyle = tracks
        tg.beginPath()
        tg.roundRect(-w * 0.2, -w * 0.42, len + w * 0.4, w * 0.84, w * 0.3)
        tg.fill()
        tg.restore()
      }
    }
    g.globalAlpha = 0.6
    g.filter = 'saturate(0.5)'
    g.drawImage(tr, 0, 0)
    g.globalAlpha = 1
    g.filter = 'none'
    if (site.gate) {
      const [gx, gy] = site.gate
      await tick()
      layer(g, N, pat(g, imgs.asphalt, 14, ppm), softPoly([[gx - 9, gy - 3], [gx + 9, gy - 3], [gx + 9, gy + 12], [gx - 9, gy + 12]], toPx, 4), 1, 'brightness(0.8)')
    }
  }

  // tyre ruts everywhere the plant turns: paired curved tracks with a little spoil on the outside
  g.save()
  g.lineCap = 'round'
  for (let i = 0; i < 130; i++) {
    const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, l = (8 + rnd() * 34) * ppm, bend = (rnd() - 0.5) * 0.018
    const dark = rnd() < 0.7
    g.strokeStyle = dark ? `rgba(38, 30, 24, ${0.08 + rnd() * 0.12})` : `rgba(235, 228, 214, ${0.05 + rnd() * 0.06})`
    const half = rnd() < 0.5 ? 1.1 : 1.6
    g.lineWidth = (0.45 + rnd() * 0.35) * ppm
    for (const off of [-half, half]) {
      g.beginPath()
      for (let s = 0; s <= 24; s++) {
        const t = (s / 24) * l
        const aa = a + bend * s
        const px = x + Math.cos(aa) * t - Math.sin(aa) * off * ppm
        const py = y + Math.sin(aa) * t + Math.cos(aa) * off * ppm
        if (s) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.stroke()
    }
  }
  // scattered stones and clods
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N, y = rnd() * N, r = (0.06 + rnd() * 0.18) * ppm
    g.fillStyle = rnd() < 0.6 ? `rgba(40, 33, 28, ${0.25 + rnd() * 0.3})` : `rgba(225, 220, 210, ${0.2 + rnd() * 0.3})`
    g.beginPath()
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
  grade(g, N, N)
  return c
}

// The neighbourhood around the yard: road grid, blocks, a river to the west and a rail line to the east.
export const CITY = { size: 1200, hole: 200 }

export function paintCity(imgs: Imgs, N = 4096): HTMLCanvasElement {
  rs = 5
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const ext = CITY.size
  const ppm = N / ext
  const X = (x: number) => ((x + ext / 2) / ext) * N
  const Y = (y: number) => ((ext / 2 - y) / ext) * N
  const PITCH = 90, ROAD = 11, PAVE = 4.5
  // lawns and scrub: muted, a little worn
  g.filter = 'saturate(0.5) brightness(0.62) hue-rotate(14deg)'
  g.fillStyle = pat(g, imgs.grass, 24, ppm)
  g.fillRect(0, 0, N, N)
  g.filter = 'saturate(0.4) brightness(0.7)'
  g.globalAlpha = 0.35
  g.fillStyle = pat(g, imgs.rock, 37, ppm, 40)
  g.fillRect(0, 0, N, N)
  g.globalAlpha = 1
  g.filter = 'none'
  // block interiors: paved courtyards and car parks
  for (let bx = -6; bx <= 6; bx++) {
    for (let by = -6; by <= 6; by++) {
      const cx = bx * PITCH, cy = by * PITCH
      if (Math.abs(cx) < 120 && Math.abs(cy) < 120) continue
      if (cx < riverX(cy) + 40) continue
      if (cx > 182 && cx < 218) continue
      const half = PITCH / 2 - ROAD / 2 - PAVE
      const r = rnd()
      g.fillStyle = pat(g, r < 0.5 ? imgs.concrete : imgs.asphalt, 10, ppm, r * 90)
      g.filter = r < 0.5 ? 'saturate(0.3) brightness(0.92)' : 'brightness(0.7)'
      g.fillRect(X(cx - half), Y(cy + half), half * 2 * ppm, half * 2 * ppm)
      g.filter = 'none'
      if (r < 0.75) {
        // a garden square inside the courtyard
        g.filter = 'saturate(0.55) brightness(0.6) hue-rotate(14deg)'
        g.fillStyle = pat(g, imgs.grass, 18, ppm)
        const q = 9 + rnd() * 8
        g.fillRect(X(cx - q), Y(cy + q), q * 2 * ppm, q * 2 * ppm)
        g.filter = 'none'
      }
    }
  }
  // pavements with a kerb, then carriageways with markings
  const lines = (fn: (v: number) => void) => {
    for (let k = -7; k <= 7; k++) fn(k * PITCH + PITCH / 2)
  }
  const xMin = (y: number) => X(riverX(y) + 30)
  g.filter = 'saturate(0.2) brightness(1.02)'
  g.fillStyle = pat(g, imgs.concrete, 6, ppm)
  lines((v) => {
    if (v > -260) g.fillRect(X(v - ROAD / 2 - PAVE), 0, (ROAD + PAVE * 2) * ppm, N)
    g.fillRect(xMin(v), Y(v + ROAD / 2 + PAVE), N - xMin(v), (ROAD + PAVE * 2) * ppm)
  })
  g.filter = 'brightness(0.55) contrast(1.1)'
  g.fillStyle = pat(g, imgs.asphalt, 14, ppm)
  lines((v) => {
    if (v > -260) g.fillRect(X(v - ROAD / 2), 0, ROAD * ppm, N)
    g.fillRect(xMin(v), Y(v + ROAD / 2), N - xMin(v), ROAD * ppm)
  })
  g.filter = 'none'
  g.strokeStyle = 'rgba(30, 30, 32, 0.6)'
  g.lineWidth = 0.25 * ppm
  lines((v) => {
    for (const s of [-1, 1]) {
      if (v > -260) {
        g.beginPath()
        g.moveTo(X(v + (s * ROAD) / 2), 0)
        g.lineTo(X(v + (s * ROAD) / 2), N)
        g.stroke()
      }
      g.beginPath()
      g.moveTo(xMin(v), Y(v + (s * ROAD) / 2))
      g.lineTo(N, Y(v + (s * ROAD) / 2))
      g.stroke()
    }
  })
  g.strokeStyle = 'rgba(232, 232, 222, 0.75)'
  g.lineWidth = 0.15 * ppm
  g.setLineDash([3 * ppm, 6 * ppm])
  lines((v) => {
    if (v > -260) {
      g.beginPath()
      g.moveTo(X(v), 0)
      g.lineTo(X(v), N)
      g.stroke()
    }
    g.beginPath()
    g.moveTo(xMin(v), Y(v))
    g.lineTo(N, Y(v))
    g.stroke()
  })
  g.setLineDash([])
  // zebra crossings at a few junctions
  g.fillStyle = 'rgba(236, 236, 228, 0.8)'
  lines((vx) => lines((vy) => {
    if (rnd() > 0.3 || vx < -260) return
    for (let i = 0; i < 6; i++) g.fillRect(X(vx - ROAD / 2 + 1 + i * 1.6), Y(vy + ROAD / 2 + PAVE + 3), 0.8 * ppm, 3 * ppm)
  }))
  // river with banks
  const bank = (w: number) => {
    g.beginPath()
    for (let y = ext / 2; y >= -ext / 2; y -= 8) g.lineTo(X(riverX(y) - w), Y(y))
    for (let y = -ext / 2; y <= ext / 2; y += 8) g.lineTo(X(riverX(y) + w), Y(y))
    g.closePath()
  }
  bank(34)
  g.filter = 'saturate(0.6) brightness(0.6)'
  g.fillStyle = pat(g, imgs.mud, 20, ppm)
  g.fill()
  g.filter = 'none'
  bank(26)
  g.fillStyle = '#132326'
  g.fill()
  // rail corridor: ballast, sleepers and two tracks
  g.filter = 'saturate(0.2) brightness(0.85)'
  g.fillStyle = pat(g, imgs.stone, 5, ppm, 90)
  g.fillRect(X(186), 0, 28 * ppm, N)
  g.filter = 'none'
  g.fillStyle = 'rgba(60, 48, 40, 0.75)'
  for (const tx of [192.75, 205.75]) for (let y = -ext / 2; y < ext / 2; y += 0.65) g.fillRect(X(tx - 1.3), Y(y), 2.6 * ppm, 0.22 * ppm)
  g.strokeStyle = '#8d8e90'
  g.lineWidth = 0.12 * ppm
  for (const tx of [192, 193.5, 205, 206.5]) {
    g.beginPath()
    g.moveTo(X(tx), 0)
    g.lineTo(X(tx), N)
    g.stroke()
  }
  // the hoarding apron round the yard
  g.filter = 'saturate(0.2)'
  g.fillStyle = pat(g, imgs.concrete, 8, ppm)
  g.fillRect(X(-104), Y(104), 208 * ppm, 208 * ppm)
  g.filter = 'none'
  grade(g, N, N)
  return c
}

export const riverX = (y: number) => -330 + Math.sin(y / 140) * 26 + Math.sin(y / 47) * 6
