export function raycastBlocks(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let x = Math.floor(ox)
  let y = Math.floor(oy)
  let z = Math.floor(oz)
  const sx = dx > 0 ? 1 : -1
  const sy = dy > 0 ? 1 : -1
  const sz = dz > 0 ? 1 : -1
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity
  let tx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity
  let ty = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity
  let tz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity
  let nx = 0
  let ny = 0
  let nz = 0
  let t = 0
  if (world.isSolid(x, y, z)) return { x, y, z, nx, ny, nz, t: 0 }
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null
  // Bound iterations defensively so a pathological input can never hang
  // the caller: one step per unit of maxDist is always enough headroom.
  let guard = Math.ceil(maxDist) * 3 + 8
  for (;;) {
    if (--guard < 0) return null
    if (tx <= ty && tx <= tz) {
      t = tx
      if (t > maxDist) return null
      x += sx
      tx += tdx
      nx = -sx
      ny = 0
      nz = 0
    } else if (ty <= tz) {
      t = ty
      if (t > maxDist) return null
      y += sy
      ty += tdy
      nx = 0
      ny = -sy
      nz = 0
    } else {
      t = tz
      if (t > maxDist) return null
      z += sz
      tz += tdz
      nx = 0
      ny = 0
      nz = -sz
    }
    if (world.isSolid(x, y, z)) return { x, y, z, nx, ny, nz, t }
  }
}

export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0
  let tmax = maxT
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  const lo = [b.minX, b.minY, b.minZ]
  const hi = [b.maxX, b.maxY, b.maxZ]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null
      continue
    }
    let t1 = (lo[i] - o[i]) / d[i]
    let t2 = (hi[i] - o[i]) / d[i]
    if (t1 > t2) {
      const s = t1
      t1 = t2
      t2 = s
    }
    if (t1 > tmin) tmin = t1
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  return tmin
}
