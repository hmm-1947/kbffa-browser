import * as THREE from 'three'
import { blockTextureNames } from './blocks.js'

const CATS = {
  blocks: blockTextureNames(),
  items: ['stick', 'bow_standby', 'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'arrow', 'ender_pearl', 'gold_pressure_plate'],
  entity: ['steve'],
  gui: ['hotbar', 'hotbar_selected', 'crosshair', 'logo', 'edition'],
  font: ['ascii']
}

const images = {}
const version = Date.now()

function missing() {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  g.fillStyle = '#000'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#f0f'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  return c
}

function load(cat, name) {
  return new Promise((res) => {
    const i = new Image()
    i.onload = () => {
      images[`${cat}/${name}`] = i
      res()
    }
    i.onerror = () => {
      console.warn(`missing texture: textures/${cat}/${name}.png`)
      images[`${cat}/${name}`] = missing()
      res()
    }
    i.src = `${import.meta.env.BASE_URL}textures/${cat}/${name}.png?v=${version}`
  })
}

export async function loadTextures() {
  await Promise.all(Object.entries(CATS).flatMap(([c, ns]) => ns.map((n) => load(c, n))))
}

export const img = (cat, name) => images[`${cat}/${name}`]
export const url = (cat, name) => `${import.meta.env.BASE_URL}textures/${cat}/${name}.png?v=${version}`

export function makeTexture(cat, name) {
  const t = new THREE.Texture(img(cat, name))
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

export function buildAtlas() {
  const names = CATS.blocks
  // Keep every sprite in a power-of-two cell.  That lets each mip level keep
  // one isolated copy of every block texture instead of filtering into the
  // neighbouring atlas cell.
  const maxTile = Math.max(16, ...names.map((n) => img('blocks', n).width))
  const tile = THREE.MathUtils.ceilPowerOfTwo(maxTile)
  const cols = THREE.MathUtils.ceilPowerOfTwo(Math.ceil(Math.sqrt(names.length)))
  const rows = THREE.MathUtils.ceilPowerOfTwo(Math.ceil(names.length / cols))
  const canvas = document.createElement('canvas')
  canvas.width = cols * tile
  canvas.height = rows * tile
  const g = canvas.getContext('2d')
  g.imageSmoothingEnabled = false
  const map = {}
  names.forEach((n, i) => {
    const cx = i % cols
    const cy = Math.floor(i / cols)
    const im = img('blocks', n)
    g.drawImage(im, 0, 0, im.width, Math.min(im.height, im.width), cx * tile, cy * tile, tile, tile)
    const e = 0.02
    map[n] = [
      (cx * tile + e) / canvas.width,
      1 - ((cy + 1) * tile - e) / canvas.height,
      ((cx + 1) * tile - e) / canvas.width,
      1 - (cy * tile + e) / canvas.height
    ]
  })

  // WebGL's automatic atlas mipmaps blend adjacent block textures, causing
  // coloured seams.  Generate every level tile-by-tile instead: distant
  // blocks receive stable, averaged texels without borrowing a neighbour.
  const mipmaps = [canvas]
  for (let size = tile >> 1; size >= 1; size >>= 1) {
    const mip = document.createElement('canvas')
    mip.width = cols * size
    mip.height = rows * size
    const mg = mip.getContext('2d')
    mg.imageSmoothingEnabled = true
    names.forEach((n, i) => {
      const im = img('blocks', n)
      const cx = i % cols
      const cy = Math.floor(i / cols)
      mg.drawImage(im, 0, 0, im.width, Math.min(im.height, im.width), cx * size, cy * size, size, size)
    })
    mipmaps.push(mip)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapLinearFilter
  texture.generateMipmaps = false
  texture.mipmaps = mipmaps
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return { texture, uv: (n) => map[n] }
}
