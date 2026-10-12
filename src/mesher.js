import * as THREE from 'three'
import { BLOCK_DEFS, faceTexName } from './blocks.js'
import { OPACITY } from './light.js'

const g22 = (v) => Math.pow(v, 2.2)

// Minecraft's forest biome uses temperature 0.7 and downfall 0.8.  Its grass
// colour-map lookup resolves to sRGB #79C05A.  Store it in Three's working
// (linear) colour space because vertex colours are multiplied with the atlas.
const FOREST_GRASS_TINT = new THREE.Color().setRGB(
  0x79 / 255, 0xc0 / 255, 0x5a / 255, THREE.SRGBColorSpace
)

const tintCache = new Map()
const tintColour = (tint) => {
  if (tint === true) return FOREST_GRASS_TINT
  let c = tintCache.get(tint)
  if (!c) {
    c = new THREE.Color().setRGB(((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255, THREE.SRGBColorSpace)
    tintCache.set(tint, c)
  }
  return c
}

const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: g22(0.6), f: 'side', adj: [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: g22(0.6), f: 'side', adj: [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1, f: 'top', adj: [[1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: g22(0.5), f: 'bottom', adj: [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: g22(0.8), f: 'side', adj: [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: g22(0.8), f: 'side', adj: [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]] }
]

const curve = (l) => {
  const v = l / 15
  return v / (4 - 3 * v)
}
const notGamma = (x) => {
  const n = 1 - x
  return 1 - n * n * n * n
}
const LIGHT_TABLE = Array.from({ length: 16 }, (_, l) => {
  const c = Math.min(1, 10 / 255 + curve(l))
  return c + (notGamma(c) - c) * 0.5
})
const lightBrightness = (avg) => {
  const lo = Math.floor(avg)
  const hi = Math.min(15, lo + 1)
  return LIGHT_TABLE[lo] + (LIGHT_TABLE[hi] - LIGHT_TABLE[lo]) * (avg - lo)
}

const pickSide = (a, b, c) => {
  const axis = a[0] !== 0 ? 0 : a[1] !== 0 ? 1 : 2
  return a[axis] === (c[axis] ? 1 : -1) ? a : b
}

function vertexShade(world, face, x, y, z, corner) {
  if (!world) return 1
  const light = world.light
  const adj = face.adj
  const d = face.d
  const bx = x + d[0]
  const by = y + d[1]
  const bz = z + d[2]
  const a = pickSide(adj[0], adj[1], corner)
  const b = pickSide(adj[2], adj[3], corner)
  const shade = (px, py, pz) => (world.isSolid(px, py, pz) ? 0.2 : 1)
  const sky = (px, py, pz) => (light ? light.get(px, py, pz) : 15)
  const ax = bx + a[0]
  const ay = by + a[1]
  const az = bz + a[2]
  const cx = bx + b[0]
  const cy = by + b[1]
  const cz = bz + b[2]
  const shadeA = shade(ax, ay, az)
  const shadeB = shade(cx, cy, cz)
  const lightA = sky(ax, ay, az)
  const lightB = sky(cx, cy, cz)
  const translucentA = OPACITY[world.get(ax + d[0], ay + d[1], az + d[2])] < 15
  const translucentB = OPACITY[world.get(cx + d[0], cy + d[1], cz + d[2])] < 15
  let shadeC
  let lightC
  if (!translucentA && !translucentB) {
    const s0 = adj[0]
    shadeC = shade(bx + s0[0], by + s0[1], bz + s0[2])
    lightC = sky(bx + s0[0], by + s0[1], bz + s0[2])
  } else {
    shadeC = shade(ax + b[0], ay + b[1], az + b[2])
    lightC = sky(ax + b[0], ay + b[1], az + b[2])
  }
  const shadeCenter = shade(bx, by, bz)
  const lightCenter = sky(bx, by, bz)
  let n1 = lightA
  let n2 = lightB
  let n3 = lightC
  if (lightCenter > 2) {
    if (n1 === 0) n1 = lightCenter
    if (n2 === 0) n2 = lightCenter
    if (n3 === 0) n3 = lightCenter
  }
  const ao = (shadeA + shadeB + shadeC + shadeCenter) * 0.25
  return g22(ao * lightBrightness((n1 + n2 + n3 + lightCenter) * 0.25))
}

function pushFace(out, atlas, id, face, x, y, z, textureName = faceTexName(id, face.f), tint = null, offset = 0, world = null) {
  const [u0, v0, u1, v1] = atlas.uv(textureName)
  const base = out.pos.length / 3
  const colour = tint ? tintColour(tint) : null
  for (const c of face.c) {
    const shade = face.s * vertexShade(world, face, x, y, z, c)
    out.pos.push(
      x + c[0] + face.d[0] * offset,
      y + c[1] + face.d[1] * offset,
      z + c[2] + face.d[2] * offset
    )
    out.col.push(
      shade * (colour?.r ?? 1),
      shade * (colour?.g ?? 1),
      shade * (colour?.b ?? 1)
    )
  }
  out.uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function toGeometry(out) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3))
  g.setIndex(out.idx)
  g.computeBoundingSphere()
  return g
}

const hidesFace = (neighbour, id) => {
  if (neighbour === 0) return false
  if (OPACITY[neighbour] >= 15) return true
  return neighbour === id
}

export function buildChunk(world, atlas, cx, cy, cz) {
  const out = { pos: [], uv: [], col: [], idx: [] }
  const x0 = cx * 16 - world.ox
  const y0 = cy * 16
  const z0 = cz * 16 - world.oz
  for (let y = y0; y < y0 + 16; y++) {
    for (let z = z0; z < z0 + 16; z++) {
      for (let x = x0; x < x0 + 16; x++) {
        const id = world.get(x, y, z)
        if (!id || !BLOCK_DEFS[id]) continue
        const block = BLOCK_DEFS[id]
        for (const f of FACES) {
          if (hidesFace(world.get(x + f.d[0], y + f.d[1], z + f.d[2]), id)) continue
          // `tintindex: 0` in Minecraft's grass-block model applies to the
          // top face and to the side overlay, not to the dirt side itself.
          pushFace(out, atlas, id, f, x, y, z, undefined, block.tint && (block.tintAll || f.f === 'top') ? block.tint : null, 0, world)
          if (block.overlay?.[f.f]) {
            pushFace(out, atlas, id, f, x, y, z, block.overlay[f.f], block.tint, 0, world)
          }
        }
      }
    }
  }
  return out.idx.length ? toGeometry(out) : null
}

export function blockCubeGeometry(atlas, id) {
  const out = { pos: [], uv: [], col: [], idx: [] }
  const block = BLOCK_DEFS[id]
  for (const f of FACES) {
    pushFace(out, atlas, id, f, -0.5, -0.5, -0.5, undefined, block.tint && (block.tintAll || f.f === 'top') ? block.tint : null)
    if (block.overlay?.[f.f]) {
      pushFace(out, atlas, id, f, -0.5, -0.5, -0.5, block.overlay[f.f], block.tint, 0)
    }
  }
  return toGeometry(out)
}
