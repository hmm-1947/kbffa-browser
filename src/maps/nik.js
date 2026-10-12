import { ID } from '../blocks.js'
import data from './nik-data.js'

const decode = (b64) => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export default {
  name: 'nik',
  spawn: { x: 0.5, y: data.spawnY, z: 0.5 },
  build(world) {
    const ids = data.palette.map((n) => (n === 'air' ? 0 : ID[n]))
    const [x0, y0, z0] = data.min
    const [w, h, d] = data.size
    const bytes = decode(data.rle)
    let p = 0
    let i = 0
    const total = w * h * d
    while (i < total && p < bytes.length) {
      let n = 0
      let shift = 0
      let b
      do {
        b = bytes[p++]
        n += (b & 127) * 2 ** shift
        shift += 7
      } while (b & 128)
      const id = ids[bytes[p++]]
      if (id) {
        for (let k = i; k < i + n; k++) {
          const x = k % w
          const z = Math.floor(k / w) % d
          const y = Math.floor(k / (w * d))
          world.set(x0 + x, y0 + y, z0 + z, id)
        }
      }
      i += n
    }
  }
}
