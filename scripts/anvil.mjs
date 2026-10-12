import fs from 'node:fs'
import zlib from 'node:zlib'

export function parseNbt(buf) {
  let p = 0
  const readers = {
    1: () => buf.readInt8(p++),
    2: () => { const v = buf.readInt16BE(p); p += 2; return v },
    3: () => { const v = buf.readInt32BE(p); p += 4; return v },
    4: () => { const hi = buf.readUInt32BE(p), lo = buf.readUInt32BE(p + 4); p += 8; return { hi, lo } },
    5: () => { const v = buf.readFloatBE(p); p += 4; return v },
    6: () => { const v = buf.readDoubleBE(p); p += 8; return v },
    7: () => { const n = buf.readInt32BE(p); p += 4; const v = buf.subarray(p, p + n); p += n; return v },
    8: () => { const n = buf.readUInt16BE(p); p += 2; const v = buf.toString('utf8', p, p + n); p += n; return v },
    9: () => {
      const t = buf[p++]
      const n = buf.readInt32BE(p)
      p += 4
      const out = []
      for (let i = 0; i < n; i++) out.push(readers[t]())
      return out
    },
    10: () => {
      const o = {}
      for (;;) {
        const t = buf[p++]
        if (t === 0) break
        const n = buf.readUInt16BE(p)
        p += 2
        const k = buf.toString('utf8', p, p + n)
        p += n
        o[k] = readers[t]()
      }
      return o
    },
    11: () => { const n = buf.readInt32BE(p); p += 4; const v = new Array(n); for (let i = 0; i < n; i++) { v[i] = buf.readInt32BE(p); p += 4 } return v },
    12: () => { const n = buf.readInt32BE(p); p += 4; const v = new Array(n); for (let i = 0; i < n; i++) { v[i] = { hi: buf.readUInt32BE(p), lo: buf.readUInt32BE(p + 4) }; p += 8 } return v }
  }
  const t = buf[p++]
  const n = buf.readUInt16BE(p)
  p += 2 + n
  return readers[t]()
}

export function readLevelDat(file) {
  return parseNbt(zlib.gunzipSync(fs.readFileSync(file)))
}

export function* readRegion(file) {
  const buf = fs.readFileSync(file)
  for (let i = 0; i < 1024; i++) {
    const off = buf.readUIntBE(i * 4, 3) * 4096
    if (!off) continue
    const len = buf.readInt32BE(off)
    const comp = buf[off + 4]
    const raw = buf.subarray(off + 5, off + 4 + len)
    const data = comp === 2 ? zlib.inflateSync(raw) : comp === 1 ? zlib.gunzipSync(raw) : raw
    yield { cx: i & 31, cz: i >> 5, nbt: parseNbt(data) }
  }
}

export function unpackIndices(longs, bits, count) {
  const out = new Uint16Array(count)
  const per = Math.floor(64 / bits)
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1
  for (let i = 0; i < count; i++) {
    const w = longs[Math.floor(i / per)]
    const s = (i % per) * bits
    let v
    if (s + bits <= 32) v = (w.lo >>> s) & mask
    else if (s >= 32) v = (w.hi >>> (s - 32)) & mask
    else v = ((w.lo >>> s) | (w.hi << (32 - s))) & mask
    out[i] = v
  }
  return out
}

export function chunkSections(nbt) {
  const root = nbt.Level || nbt
  const secs = root.sections || root.Sections || []
  const res = []
  for (const s of secs) {
    const y = s.Y
    const bs = s.block_states
    if (bs) {
      const palette = bs.palette.map((e) => e.Name)
      if (palette.length === 1 || !bs.data) res.push({ y, palette, idx: null })
      else res.push({ y, palette, idx: unpackIndices(bs.data, Math.max(4, Math.ceil(Math.log2(palette.length))), 4096) })
    } else if (s.Palette) {
      const palette = s.Palette.map((e) => e.Name)
      if (!s.BlockStates) continue
      res.push({ y, palette, idx: unpackIndices(s.BlockStates, Math.max(4, Math.ceil(Math.log2(palette.length))), 4096) })
    }
  }
  return res
}
