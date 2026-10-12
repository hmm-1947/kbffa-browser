import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRegion, chunkSections } from './anvil.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '..', 'Natural KBFFA Nikstudios')
const out = path.resolve(here, '..', 'src', 'maps', 'nik-data.js')

const MAP = {
  dirt: 'dirt',
  grass_block: 'grass',
  spruce_leaves: 'spruce_leaves',
  spruce_log: 'spruce_log',
  stone: 'stone',
  dirt_path: 'dirt_path',
  podzol: 'podzol',
  stone_brick_slab: 'stone_bricks',
  stone_brick_stairs: 'stone_bricks',
  cobblestone: 'cobblestone',
  spruce_slab: 'spruce_planks',
  cobblestone_wall: 'cobblestone',
  spruce_fence: 'spruce_planks',
  glowstone: 'glowstone',
  beacon: 'sea_lantern',
  granite: 'granite'
}

const SHIFT = { x: -9, y: 47, z: 158 }
const solid = new Map()
const files = fs.readdirSync(path.join(dir, 'region')).filter((f) => f.endsWith('.mca'))
for (const f of files) {
  const [, rx, rz] = f.replace('.mca', '').split('.').map(Number)
  for (const { cx, cz, nbt } of readRegion(path.join(dir, 'region', f))) {
    for (const s of chunkSections(nbt)) {
      for (let i = 0; i < 4096; i++) {
        const raw = s.palette[s.idx ? s.idx[i] : 0].replace('minecraft:', '')
        const name = MAP[raw]
        if (!name) continue
        const x = (rx * 32 + cx) * 16 + (i & 15) + SHIFT.x
        const z = (rz * 32 + cz) * 16 + ((i >> 4) & 15) + SHIFT.z
        const y = s.y * 16 + (i >> 8) + SHIFT.y
        solid.set(`${x},${y},${z}`, name)
      }
    }
  }
}

let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9
for (const k of solid.keys()) {
  const [x, y, z] = k.split(',').map(Number)
  x0 = Math.min(x0, x); x1 = Math.max(x1, x)
  y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  z0 = Math.min(z0, z); z1 = Math.max(z1, z)
}
const w = x1 - x0 + 1, h = y1 - y0 + 1, d = z1 - z0 + 1
const palette = ['air', ...new Set(solid.values())]
const pi = new Map(palette.map((n, i) => [n, i]))

const bytes = []
const varint = (n) => {
  while (n >= 128) { bytes.push((n & 127) | 128); n >>>= 7 }
  bytes.push(n)
}
let prev = -1, run = 0
for (let y = y0; y <= y1; y++) {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const n = solid.get(`${x},${y},${z}`)
      const id = n ? pi.get(n) : 0
      if (id === prev) run++
      else {
        if (run) { varint(run); bytes.push(prev) }
        prev = id
        run = 1
      }
    }
  }
}
varint(run)
bytes.push(prev)

let sy = y1 + 1
for (let y = y1; y >= y0; y--) {
  if (solid.has(`0,${y},0`)) { sy = y + 1; break }
}

const src = `export default ${JSON.stringify({ min: [x0, y0, z0], size: [w, h, d], spawnY: sy, palette, rle: Buffer.from(bytes).toString('base64') })}\n`
fs.writeFileSync(out, src)
console.log(`box ${w}x${h}x${d} min ${x0},${y0},${z0} blocks ${solid.size} runs-bytes ${bytes.length} spawnY ${sy} file ${src.length}`)
console.log(palette.join(', '))
