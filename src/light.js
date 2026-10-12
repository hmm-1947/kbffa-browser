import { BLOCK_DEFS } from './blocks.js'

export const OPACITY = new Uint8Array(256).fill(15)
OPACITY[0] = 0
for (let id = 1; id < BLOCK_DEFS.length; id++) {
  const name = BLOCK_DEFS[id]?.name
  if (!name) continue
  if (name.endsWith('_leaves') || name === 'ice') OPACITY[id] = 1
  else if (name === 'glass') OPACITY[id] = 0
}

export class SkyLight {
  constructor(world) {
    this.w = world
    this.sx = world.sx
    this.sy = world.sy
    this.sz = world.sz
    this.sxz = world.sx * world.sz
    this.data = new Uint8Array(world.data.length)
    this.build()
    world.light = this
    world.onSet = (x, y, z, o, n) => this.update(x, y, z, o, n)
  }

  get(x, y, z) {
    if (y >= this.sy) return 15
    if (y < 0) return 0
    const ix = x + this.w.ox
    const iz = z + this.w.oz
    if (ix < 0 || ix >= this.sx || iz < 0 || iz >= this.sz) return 15
    return this.data[(y * this.sz + iz) * this.sx + ix]
  }

  candidate(i, x, y, z) {
    const blocks = this.w.data
    const light = this.data
    const o = OPACITY[blocks[i]]
    if (o >= 15) return 0
    const d = o > 1 ? o : 1
    let best = 0
    let v
    if (y === this.sy - 1) best = o === 0 ? 15 : 15 - d
    else {
      const la = light[i + this.sxz]
      v = la === 15 && o === 0 ? 15 : la - d
      if (v > best) best = v
    }
    if (y > 0) {
      v = light[i - this.sxz] - d
      if (v > best) best = v
    }
    v = (x > 0 ? light[i - 1] : 15) - d
    if (v > best) best = v
    v = (x < this.sx - 1 ? light[i + 1] : 15) - d
    if (v > best) best = v
    v = (z > 0 ? light[i - this.sx] : 15) - d
    if (v > best) best = v
    v = (z < this.sz - 1 ? light[i + this.sx] : 15) - d
    if (v > best) best = v
    return best
  }

  spread(q, changed) {
    const { sx, sy, sz, sxz } = this
    const light = this.data
    const blocks = this.w.data
    const push = (j, l, down) => {
      const o = OPACITY[blocks[j]]
      if (o >= 15) return
      const nl = down && l === 15 && o === 0 ? 15 : l - (o > 1 ? o : 1)
      if (nl > light[j]) {
        light[j] = nl
        q.push(j)
        if (changed) changed.push(j)
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]
      const l = light[i]
      if (l <= 1) continue
      const x = i % sx
      const z = ((i / sx) | 0) % sz
      const y = (i / sxz) | 0
      if (x > 0) push(i - 1, l, false)
      if (x < sx - 1) push(i + 1, l, false)
      if (z > 0) push(i - sx, l, false)
      if (z < sz - 1) push(i + sx, l, false)
      if (y > 0) push(i - sxz, l, true)
      if (y < sy - 1) push(i + sxz, l, false)
    }
  }

  build() {
    const { sx, sy, sz, sxz } = this
    const light = this.data
    const blocks = this.w.data
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        let l = 15
        for (let y = sy - 1; y >= 0; y--) {
          const i = y * sxz + z * sx + x
          const o = OPACITY[blocks[i]]
          if (o >= 15) l = 0
          else if (o > 0) l = Math.max(0, l - o)
          light[i] = l
        }
      }
    }
    const q = []
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        const edgeZ = z === 0 || z === sz - 1
        for (let x = 0; x < sx; x++) {
          const i = y * sxz + z * sx + x
          if (edgeZ || x === 0 || x === sx - 1) {
            const c = this.candidate(i, x, y, z)
            if (c > light[i]) light[i] = c
          }
          const l = light[i]
          if (l <= 1) continue
          let need = false
          if (x > 0) need = this.lights(i - 1, l, false)
          if (!need && x < sx - 1) need = this.lights(i + 1, l, false)
          if (!need && z > 0) need = this.lights(i - sx, l, false)
          if (!need && z < sz - 1) need = this.lights(i + sx, l, false)
          if (!need && y > 0) need = this.lights(i - sxz, l, true)
          if (!need && y < sy - 1) need = this.lights(i + sxz, l, false)
          if (need) q.push(i)
        }
      }
    }
    this.spread(q, null)
  }

  lights(j, l, down) {
    const o = OPACITY[this.w.data[j]]
    if (o >= 15) return false
    const nl = down && l === 15 && o === 0 ? 15 : l - (o > 1 ? o : 1)
    return nl > this.data[j]
  }

  update(x, y, z, oldId, newId) {
    if (OPACITY[oldId] === OPACITY[newId]) return
    const { sx, sy, sz, sxz } = this
    const light = this.data
    const blocks = this.w.data
    const ox = this.w.ox
    const oz = this.w.oz
    const i = y * sxz + (z + oz) * sx + (x + ox)
    const removed = [i]
    const rq = [i]
    const rl = [light[i]]
    const sources = []
    light[i] = 0
    for (let h = 0; h < rq.length; h++) {
      const j = rq[h]
      const lj = rl[h]
      const jx = j % sx
      const jz = ((j / sx) | 0) % sz
      const jy = (j / sxz) | 0
      for (let n = 0; n < 6; n++) {
        let k
        if (n === 0) { if (jx === 0) continue; k = j - 1 }
        else if (n === 1) { if (jx === sx - 1) continue; k = j + 1 }
        else if (n === 2) { if (jz === 0) continue; k = j - sx }
        else if (n === 3) { if (jz === sz - 1) continue; k = j + sx }
        else if (n === 4) { if (jy === 0) continue; k = j - sxz }
        else { if (jy === sy - 1) continue; k = j + sxz }
        const lk = light[k]
        if (lk === 0) continue
        if (lk < lj || (n === 4 && lj === 15 && lk === 15 && OPACITY[blocks[k]] === 0)) {
          light[k] = 0
          rq.push(k)
          rl.push(lk)
          removed.push(k)
        } else sources.push(k)
      }
    }
    const q = []
    const changed = removed.slice()
    for (const r of removed) {
      const rx = r % sx
      const rz = ((r / sx) | 0) % sz
      const ry = (r / sxz) | 0
      const c = this.candidate(r, rx, ry, rz)
      if (c > light[r]) {
        light[r] = c
        q.push(r)
      }
    }
    for (const s of sources) q.push(s)
    this.spread(q, changed)
    const w = this.w
    let last = -1
    for (const j of changed) {
      if (j === last) continue
      last = j
      w.mark((j % sx) - ox, (j / sxz) | 0, (((j / sx) | 0) % sz) - oz)
    }
  }
}
