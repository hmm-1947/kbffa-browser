export class World {
  constructor(c) {
    this.sx = c.sx
    this.sy = c.sy
    this.sz = c.sz
    this.ox = c.ox
    this.oz = c.oz
    this.data = new Uint8Array(c.sx * c.sy * c.sz)
    this.dirty = new Set()
  }

  inBounds(x, y, z) {
    const ix = x + this.ox
    const iz = z + this.oz
    return ix >= 0 && ix < this.sx && y >= 0 && y < this.sy && iz >= 0 && iz < this.sz
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0
    return this.data[(y * this.sz + (z + this.oz)) * this.sx + (x + this.ox)]
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false
    this.data[(y * this.sz + (z + this.oz)) * this.sx + (x + this.ox)] = id
    this.mark(x, y, z)
    return true
  }

  isSolid(x, y, z) {
    return this.get(x, y, z) !== 0
  }

  mark(x, y, z) {
    const ix = x + this.ox
    const iz = z + this.oz
    const cx = ix >> 4
    const cy = y >> 4
    const cz = iz >> 4
    this.dirty.add(`${cx},${cy},${cz}`)
    const lx = ix & 15
    const ly = y & 15
    const lz = iz & 15
    if (lx === 0) this.dirty.add(`${cx - 1},${cy},${cz}`)
    if (lx === 15) this.dirty.add(`${cx + 1},${cy},${cz}`)
    if (ly === 0) this.dirty.add(`${cx},${cy - 1},${cz}`)
    if (ly === 15) this.dirty.add(`${cx},${cy + 1},${cz}`)
    if (lz === 0) this.dirty.add(`${cx},${cy},${cz - 1}`)
    if (lz === 15) this.dirty.add(`${cx},${cy},${cz + 1}`)
  }
}
