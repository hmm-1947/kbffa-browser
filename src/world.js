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
    const i = (y * this.sz + (z + this.oz)) * this.sx + (x + this.ox)
    const old = this.data[i]
    if (old === id) return true
    this.data[i] = id
    this.mark(x, y, z)
    if (this.onSet) this.onSet(x, y, z, old, id)
    return true
  }

  isSolid(x, y, z) {
    return this.get(x, y, z) !== 0
  }

  mark(x, y, z) {
    const ix = x + this.ox
    const iz = z + this.oz
    const cx1 = Math.min((ix + 1) >> 4, (this.sx - 1) >> 4)
    const cy1 = Math.min((y + 1) >> 4, (this.sy - 1) >> 4)
    const cz1 = Math.min((iz + 1) >> 4, (this.sz - 1) >> 4)
    for (let cx = Math.max((ix - 1) >> 4, 0); cx <= cx1; cx++) {
      for (let cy = Math.max((y - 1) >> 4, 0); cy <= cy1; cy++) {
        for (let cz = Math.max((iz - 1) >> 4, 0); cz <= cz1; cz++) this.dirty.add(`${cx},${cy},${cz}`)
      }
    }
  }
}
