import * as THREE from 'three'

const g22 = (v) => Math.pow(v, 2.2)

export const vertexMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true })

export function extrudeSprite(image) {
  const w = image.width
  const h = Math.min(image.height, image.width)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.drawImage(image, 0, 0, w, h, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 10
  const pos = []
  const col = []
  const idx = []
  const px = 1 / w
  const zf = px / 2
  const zb = -px / 2
  const tmp = new THREE.Color()
  const quad = (verts, r, gg, b, s) => {
    tmp.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace)
    const base = pos.length / 3
    for (const v of verts) {
      pos.push(v[0], v[1], v[2])
      col.push(tmp.r * s, tmp.g * s, tmp.b * s)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const side = g22(0.8)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      const i = (y * w + x) * 4
      const r = d[i]
      const gg = d[i + 1]
      const b = d[i + 2]
      const x0 = x * px - 0.5
      const x1 = x0 + px
      const y1 = 0.5 - y * px
      const y0 = y1 - px
      quad([[x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf]], r, gg, b, 1)
      quad([[x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb]], r, gg, b, 1)
      if (!opaque(x - 1, y)) quad([[x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb]], r, gg, b, side)
      if (!opaque(x + 1, y)) quad([[x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf]], r, gg, b, side)
      if (!opaque(x, y - 1)) quad([[x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb]], r, gg, b, side)
      if (!opaque(x, y + 1)) quad([[x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf]], r, gg, b, side)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  return geo
}

function part(w, h, d, u, v, s, texH) {
  const th = texH || 32
  const g = new THREE.BoxGeometry(w * s, h * s, d * s)
  const rects = [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u + d, v + d, w, h],
    [u + 2 * d + w, v + d, w, h]
  ]
  const uv = g.attributes.uv
  rects.forEach(([rx, ry, rw, rh], f) => {
    const u0 = rx / 64
    const u1 = (rx + rw) / 64
    const vt = 1 - ry / th
    const vb = 1 - (ry + rh) / th
    uv.setXY(f * 4, u0, vt)
    uv.setXY(f * 4 + 1, u1, vt)
    uv.setXY(f * 4 + 2, u0, vb)
    uv.setXY(f * 4 + 3, u1, vb)
  })
  const n = g.attributes.normal
  const col = []
  for (let i = 0; i < n.count; i++) {
    const s2 = n.getY(i) > 0.5 ? 1 : n.getY(i) < -0.5 ? g22(0.5) : Math.abs(n.getZ(i)) > 0.5 ? g22(0.8) : g22(0.6)
    col.push(s2, s2, s2)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export function buildFirstPersonArm(skin) {
  const s = 1.8 / 32
  const mat = new THREE.MeshBasicMaterial({ map: skin, vertexColors: true, transparent: true, alphaTest: 0.5 })
  const geo = part(4, 12, 4, 40, 16, s, 64)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = -6 * s
  const pivot = new THREE.Group()
  pivot.add(mesh)
  return pivot
}

export function buildPlayerModel(skin) {
  const s = 1.8 / 32
  const mat = new THREE.MeshBasicMaterial({ map: skin, vertexColors: true, transparent: true, alphaTest: 0.5 })
  const group = new THREE.Group()
  const mk = (geo, x, y, z, oy) => {
    const pivot = new THREE.Group()
    pivot.position.set(x * s, y * s, z * s)
    const m = new THREE.Mesh(geo, mat)
    m.position.y = oy * s
    pivot.add(m)
    group.add(pivot)
    return pivot
  }
  const head = mk(part(8, 8, 8, 0, 0, s, 64), 0, 24, 0, 4)
  const body = mk(part(8, 12, 4, 16, 16, s, 64), 0, 24, 0, -6)
  const armR = mk(part(4, 12, 4, 40, 16, s, 64), -6, 22, 0, -4)
  const armL = mk(part(4, 12, 4, 40, 16, s, 64), 6, 22, 0, -4)
  const legR = mk(part(4, 12, 4, 0, 16, s, 64), -2, 12, 0, -6)
  const legL = mk(part(4, 12, 4, 0, 16, s, 64), 2, 12, 0, -6)
  return { group, head, body, armR, armL, legR, legL, mat, walk: 0, amp: 0, lx: 0, lz: 0, scale: s }
}
