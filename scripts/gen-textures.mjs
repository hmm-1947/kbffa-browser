import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures')
const force = process.argv.includes('--force')

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const encode = (w, h, px) => {
  const stride = w * 4 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) px.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const rng = (seed) => {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const shade = (c, n) => [clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n)]
const noisy = (base, amp, seed) => {
  const r = rng(seed)
  return () => shade(base, (r() - 0.5) * 2 * amp)
}

const canvas = (w, h) => {
  const px = Buffer.alloc(w * h * 4)
  return {
    w,
    h,
    px,
    set(x, y, c) {
      x = Math.round(x)
      y = Math.round(y)
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = (y * w + x) * 4
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
      px[i + 3] = c.length > 3 ? c[3] : 255
    },
    rect(x, y, rw, rh, c) {
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) this.set(x + i, y + j, typeof c === 'function' ? c(i, j) : c)
    },
    line(x0, y0, x1, y1, c) {
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) || 1
      for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c)
    }
  }
}
const filled = (w, h, fn) => {
  const c = canvas(w, h)
  c.rect(0, 0, w, h, (x, y) => fn(x, y))
  return c
}

const out = {}
const add = (cat, name, c) => (out[`${cat}/${name}`] = c)

const dirtFn = noisy([134, 96, 67], 14, 11)
add('blocks', 'dirt', filled(16, 16, () => dirtFn()))
add('blocks', 'grass_top', filled(16, 16, noisy([104, 168, 58], 16, 12)))
{
  const r = rng(13)
  const hs = Array.from({ length: 16 }, () => 3 + (r() < 0.5 ? 1 : 0))
  const d = noisy([134, 96, 67], 14, 14)
  const g = noisy([104, 168, 58], 16, 15)
  add('blocks', 'grass_side', filled(16, 16, (x, y) => (y < hs[x] ? g() : d())))
}
add('blocks', 'stone', filled(16, 16, noisy([127, 127, 127], 14, 16)))
add('blocks', 'bedrock', filled(16, 16, noisy([84, 84, 84], 34, 17)))
add('blocks', 'sandstone_top', filled(16, 16, noisy([222, 212, 166], 7, 18)))
add('blocks', 'sandstone_bottom', filled(16, 16, noisy([222, 212, 166], 7, 19)))
{
  const n = noisy([222, 212, 166], 7, 20)
  add('blocks', 'sandstone_side', filled(16, 16, (x, y) => (y === 3 || y === 12 ? shade(n(), -22) : n())))
}
{
  const n = noisy([246, 208, 61], 6, 21)
  add(
    'blocks',
    'gold_block',
    filled(16, 16, (x, y) => {
      const c = n()
      if (x === 0 || y === 0) return shade(c, 18)
      if (x === 15 || y === 15) return shade(c, -34)
      return c
    })
  )
}
{
  const n = noisy([234, 229, 222], 5, 22)
  add(
    'blocks',
    'spawn',
    filled(16, 16, (x, y) => {
      const c = n()
      return x === 0 || y === 0 || x === 15 || y === 15 ? shade(c, -26) : c
    })
  )
}

{
  const c = canvas(16, 16)
  const wood = [128, 92, 50]
  const dark = [92, 64, 32]
  for (let i = 2; i <= 13; i++) {
    c.set(i, 15 - i, wood)
    if (i < 13) c.set(i + 1, 15 - i, dark)
  }
  add('items', 'stick', c)
}
const bow = (stage) => {
  const c = canvas(16, 16)
  const A = [13, 1]
  const B = [1, 13]
  const C = [0, 0]
  for (let t = 0; t <= 1; t += 0.01) {
    const x = (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * C[0] + t * t * B[0]
    const y = (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * C[1] + t * t * B[1]
    c.set(x, y, [112, 80, 42])
    c.set(x + 1, y, [84, 58, 28])
  }
  const d = stage < 0 ? 7 : 8.5 + stage
  c.line(A[0], A[1], d, d, [225, 225, 225])
  c.line(d, d, B[0], B[1], [225, 225, 225])
  if (stage >= 0) {
    c.line(d, d, d - 7, d - 7, [128, 92, 50])
    c.set(d - 8, d - 8, [150, 150, 150])
    c.set(d - 7, d - 8, [150, 150, 150])
    c.set(d - 8, d - 7, [150, 150, 150])
  }
  return c
}
add('items', 'bow_standby', bow(-1))
add('items', 'bow_pulling_0', bow(0))
add('items', 'bow_pulling_1', bow(1))
add('items', 'bow_pulling_2', bow(2))
{
  const c = canvas(16, 16)
  c.line(3, 12, 12, 3, [128, 92, 50])
  c.set(13, 2, [150, 150, 150])
  c.set(12, 2, [150, 150, 150])
  c.set(13, 3, [150, 150, 150])
  c.set(14, 1, [150, 150, 150])
  for (const [x, y] of [[1, 14], [2, 14], [1, 13], [2, 13], [3, 14], [1, 12]]) c.set(x, y, [240, 240, 240])
  add('items', 'arrow', c)
}
{
  const c = canvas(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5)
      if (d > 6.2) continue
      const h = Math.hypot(x - 5, y - 5)
      let col = d > 5 ? [10, 46, 54] : [24, 96, 82]
      if (h < 2.2) col = [128, 226, 196]
      else if (h < 3.6) col = [58, 158, 130]
      c.set(x, y, col)
    }
  }
  add('items', 'ender_pearl', c)
}
{
  const c = canvas(16, 16)
  c.rect(1, 9, 14, 4, [246, 208, 61])
  c.rect(1, 9, 14, 1, [255, 240, 140])
  c.rect(1, 12, 14, 1, [200, 150, 20])
  c.rect(1, 9, 1, 4, [255, 240, 140])
  c.rect(14, 9, 1, 4, [200, 150, 20])
  add('items', 'gold_pressure_plate', c)
}
{
  const skin = [198, 134, 101]
  const hair = [78, 50, 24]
  const c = canvas(64, 32)
  c.rect(0, 0, 32, 16, skin)
  c.rect(8, 0, 8, 8, hair)
  c.rect(24, 8, 8, 8, hair)
  c.rect(0, 8, 8, 3, hair)
  c.rect(16, 8, 8, 3, hair)
  c.rect(8, 8, 8, 2, hair)
  c.rect(9, 12, 2, 1, [255, 255, 255])
  c.rect(13, 12, 2, 1, [255, 255, 255])
  c.rect(10, 12, 1, 1, [64, 64, 170])
  c.rect(13, 12, 1, 1, [64, 64, 170])
  c.rect(11, 14, 2, 1, [140, 80, 60])
  c.rect(16, 16, 24, 16, [0, 160, 160])
  c.rect(40, 16, 16, 16, [0, 160, 160])
  c.rect(40, 28, 16, 4, skin)
  c.rect(48, 16, 4, 4, skin)
  c.rect(0, 16, 16, 16, [58, 52, 140])
  c.rect(0, 29, 16, 3, [96, 96, 96])
  add('entity', 'steve', c)
}
{
  const c = canvas(182, 22)
  c.rect(0, 0, 182, 22, [10, 10, 10, 255])
  c.rect(1, 1, 180, 20, [139, 139, 139, 255])
  for (let i = 0; i < 9; i++) {
    c.rect(2 + i * 20, 2, 18, 18, [55, 55, 55, 255])
    c.rect(3 + i * 20, 3, 16, 16, [0, 0, 0, 120])
  }
  add('gui', 'hotbar', c)
}
{
  const c = canvas(24, 24)
  c.rect(0, 0, 24, 24, [255, 255, 255, 255])
  c.rect(2, 2, 20, 20, [0, 0, 0, 0])
  add('gui', 'hotbar_selected', c)
}
{
  const c = canvas(16, 16)
  c.rect(7, 2, 2, 12, [255, 255, 255, 255])
  c.rect(2, 7, 12, 2, [255, 255, 255, 255])
  c.rect(7, 7, 2, 2, [0, 0, 0, 0])
  add('gui', 'crosshair', c)
}

let written = 0
let skipped = 0
for (const [key, c] of Object.entries(out)) {
  const file = path.join(root, `${key}.png`)
  if (fs.existsSync(file) && !force) {
    skipped++
    continue
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, encode(c.w, c.h, c.px))
  written++
}
console.log(`textures: ${written} written, ${skipped} kept (use --force to overwrite)`)
