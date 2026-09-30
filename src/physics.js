export const PW = 0.6
export const PH = 1.8

export function playerBox(p, pad = 0) {
  const h = PW / 2 + pad
  return { minX: p.x - h, minY: p.y - pad, minZ: p.z - h, maxX: p.x + h, maxY: p.y + PH + pad, maxZ: p.z + h }
}

export function overlapsSolid(world, b) {
  const x0 = Math.floor(b.minX)
  const x1 = Math.ceil(b.maxX) - 1
  const y0 = Math.floor(b.minY)
  const y1 = Math.ceil(b.maxY) - 1
  const z0 = Math.floor(b.minZ)
  const z1 = Math.ceil(b.maxZ) - 1
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (world.isSolid(x, y, z)) return true
      }
    }
  }
  return false
}

const off = (b, x, y, z) => ({
  minX: b.minX + x,
  minY: b.minY + y,
  minZ: b.minZ + z,
  maxX: b.maxX + x,
  maxY: b.maxY + y,
  maxZ: b.maxZ + z
})

const reduce = (v, s) => (v > -s && v < s ? 0 : v > 0 ? v - s : v + s)

export function moveEntity(world, e, dx, dy, dz) {
  const p = e.pos
  const box = playerBox(p)
  if (e.sneaking && e.onGround) {
    const s = 0.05
    while (dx !== 0 && !overlapsSolid(world, off(box, dx, -1, 0))) dx = reduce(dx, s)
    while (dz !== 0 && !overlapsSolid(world, off(box, 0, -1, dz))) dz = reduce(dz, s)
    while (dx !== 0 && dz !== 0 && !overlapsSolid(world, off(box, dx, -1, dz))) {
      dx = reduce(dx, s)
      dz = reduce(dz, s)
    }
  }
  const ox = dx
  const oy = dy
  const oz = dz
  const x0 = Math.floor(box.minX + Math.min(dx, 0))
  const x1 = Math.ceil(box.maxX + Math.max(dx, 0)) - 1
  const y0 = Math.floor(box.minY + Math.min(dy, 0))
  const y1 = Math.ceil(box.maxY + Math.max(dy, 0)) - 1
  const z0 = Math.floor(box.minZ + Math.min(dz, 0))
  const z1 = Math.ceil(box.maxZ + Math.max(dz, 0)) - 1
  const cells = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (world.isSolid(x, y, z)) cells.push([x, y, z])
      }
    }
  }
  for (const [cx, cy, cz] of cells) {
    if (box.maxX <= cx || box.minX >= cx + 1 || box.maxZ <= cz || box.minZ >= cz + 1) continue
    if (dy > 0 && box.maxY <= cy) dy = Math.min(dy, cy - box.maxY)
    else if (dy < 0 && box.minY >= cy + 1) dy = Math.max(dy, cy + 1 - box.minY)
  }
  box.minY += dy
  box.maxY += dy
  for (const [cx, cy, cz] of cells) {
    if (box.maxY <= cy || box.minY >= cy + 1 || box.maxZ <= cz || box.minZ >= cz + 1) continue
    if (dx > 0 && box.maxX <= cx) dx = Math.min(dx, cx - box.maxX)
    else if (dx < 0 && box.minX >= cx + 1) dx = Math.max(dx, cx + 1 - box.minX)
  }
  box.minX += dx
  box.maxX += dx
  for (const [cx, cy, cz] of cells) {
    if (box.maxY <= cy || box.minY >= cy + 1 || box.maxX <= cx || box.minX >= cx + 1) continue
    if (dz > 0 && box.maxZ <= cz) dz = Math.min(dz, cz - box.maxZ)
    else if (dz < 0 && box.minZ >= cz + 1) dz = Math.max(dz, cz + 1 - box.minZ)
  }
  box.minZ += dz
  box.maxZ += dz
  p.x = (box.minX + box.maxX) / 2
  p.y = box.minY
  p.z = (box.minZ + box.maxZ) / 2
  e.onGround = oy !== dy && oy < 0
  e.hCollide = ox !== dx || oz !== dz
  if (ox !== dx) e.vel.x = 0
  if (oy !== dy) e.vel.y = 0
  if (oz !== dz) e.vel.z = 0
}
