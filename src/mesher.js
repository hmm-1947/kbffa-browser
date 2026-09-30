import * as THREE from 'three'
import { BLOCK_DEFS, faceTexName } from './blocks.js'

const g22 = (v) => Math.pow(v, 2.2)

// Minecraft's forest biome uses temperature 0.7 and downfall 0.8.  Its grass
// colour-map lookup resolves to sRGB #79C05A.  Store it in Three's working
// (linear) colour space because vertex colours are multiplied with the atlas.
const FOREST_GRASS_TINT = new THREE.Color().setRGB(
  0x79 / 255, 0xc0 / 255, 0x5a / 255, THREE.SRGBColorSpace
)

const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: g22(0.6), f: 'side' },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: g22(0.6), f: 'side' },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1, f: 'top' },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: g22(0.5), f: 'bottom' },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: g22(0.8), f: 'side' },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: g22(0.8), f: 'side' }
]

// This is the same three-neighbour corner rule used by Minecraft's smooth
// lighting path.  At each vertex of an exposed face, the two edge neighbours
// and their diagonal darken the vertex.  When both edges are solid, the
// diagonal must not brighten the corner (the vanilla "three" case).
function ambientOcclusion(world, face, x, y, z, corner) {
  if (!world) return 1
  const normal = face.d
  const axes = [0, 1, 2].filter((axis) => normal[axis] === 0)
  const sign = (axis) => (corner[axis] === 0 ? -1 : 1)
  const a = [normal[0], normal[1], normal[2]]
  const b = [normal[0], normal[1], normal[2]]
  const diagonal = [normal[0], normal[1], normal[2]]
  a[axes[0]] += sign(axes[0])
  b[axes[1]] += sign(axes[1])
  diagonal[axes[0]] += sign(axes[0])
  diagonal[axes[1]] += sign(axes[1])
  const solid = (d) => world.isSolid(x + d[0], y + d[1], z + d[2])
  const sideA = solid(a)
  const sideB = solid(b)
  const level = sideA && sideB ? 3 : Number(sideA) + Number(sideB) + Number(solid(diagonal))
  // 0, 1, 2, and 3 occluding neighbours map to Minecraft's softly shaded
  // face corners.  Keep it in linear space so the material receives the same
  // gamma-correct multiplication as the existing directional shading.
  return 1 - level * 0.2
}

function pushFace(out, atlas, id, face, x, y, z, textureName = faceTexName(id, face.f), tint = null, offset = 0, world = null) {
  const [u0, v0, u1, v1] = atlas.uv(textureName)
  const base = out.pos.length / 3
  const colour = tint ? FOREST_GRASS_TINT : null
  for (const c of face.c) {
    const ao = ambientOcclusion(world, face, x, y, z, c)
    out.pos.push(
      x + c[0] + face.d[0] * offset,
      y + c[1] + face.d[1] * offset,
      z + c[2] + face.d[2] * offset
    )
    out.col.push(
      face.s * ao * (colour?.r ?? 1),
      face.s * ao * (colour?.g ?? 1),
      face.s * ao * (colour?.b ?? 1)
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
        for (const f of FACES) {
          if (world.get(x + f.d[0], y + f.d[1], z + f.d[2]) !== 0) continue
          const block = BLOCK_DEFS[id]
          // `tintindex: 0` in Minecraft's grass-block model applies to the
          // top face and to the side overlay, not to the dirt side itself.
          pushFace(out, atlas, id, f, x, y, z, undefined, block.tint && f.f === 'top', 0, world)
          if (block.overlay?.[f.f]) {
            // Avoid depth fighting with the dirt base while preserving the
            // vanilla two-layer side model.
            pushFace(out, atlas, id, f, x, y, z, block.overlay[f.f], block.tint, 0.0001, world)
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
    pushFace(out, atlas, id, f, -0.5, -0.5, -0.5, undefined, block.tint && f.f === 'top')
    if (block.overlay?.[f.f]) {
      pushFace(out, atlas, id, f, -0.5, -0.5, -0.5, block.overlay[f.f], block.tint, 0.0001)
    }
  }
  return toGeometry(out)
}
