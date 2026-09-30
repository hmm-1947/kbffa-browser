import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

function readPNG(buf) {
  let off = 8
  let width, height, idatChunks = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    }
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * 4 + 1
  const px = Buffer.alloc(width * height * 4)
  let prevRow = Buffer.alloc(width * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride]
    const rowIn = raw.subarray(y * stride + 1, y * stride + 1 + width * 4)
    const rowOut = Buffer.alloc(width * 4)
    for (let i = 0; i < width * 4; i++) {
      const a = i >= 4 ? rowOut[i - 4] : 0
      const b = prevRow[i]
      const c = i >= 4 ? prevRow[i - 4] : 0
      let pred
      if (filter === 0) pred = 0
      else if (filter === 1) pred = a
      else if (filter === 2) pred = b
      else if (filter === 3) pred = Math.floor((a + b) / 2)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      rowOut[i] = (rowIn[i] + pred) & 255
    }
    rowOut.copy(px, y * width * 4)
    prevRow = rowOut
  }
  return { width, height, px }
}

function writePNG(width, height, px) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc32 = (buf) => {
    let c = -1
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) px.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const file = path.resolve('public/textures/entity/steve.png')
const buf = fs.readFileSync(file)
const { width, height, px } = readPNG(buf)

const set = (x, y, r, g, b, a = 255) => {
  const i = (y * width + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
}

const SKIN = [204, 153, 117]
const SLEEVE = [70, 141, 141]
const PANTS = [59, 68, 130]
const HAIR = [88, 55, 30]
const SHOE = [90, 90, 90]

const fillRect = (x0, y0, w, h, col) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, col[0], col[1], col[2])
}

fillRect(44, 16, 4, 4, SLEEVE)
fillRect(44, 20, 4, 8, SKIN)
fillRect(40, 16, 4, 4, SLEEVE)
fillRect(40, 20, 4, 8, SKIN)
fillRect(48, 16, 4, 4, SLEEVE)
fillRect(48, 20, 4, 8, SKIN)
fillRect(52, 16, 4, 4, SLEEVE)
fillRect(52, 20, 4, 8, SKIN)

fillRect(4, 20, 4, 12, PANTS)
fillRect(0, 20, 4, 12, PANTS)
fillRect(8, 20, 4, 12, PANTS)
fillRect(12, 20, 4, 12, PANTS)
fillRect(4, 28, 4, 4, SHOE)
fillRect(0, 28, 4, 4, SHOE)
fillRect(8, 28, 4, 4, SHOE)
fillRect(12, 28, 4, 4, SHOE)

fillRect(20, 20, 8, 12, SLEEVE)
fillRect(16, 20, 4, 12, SLEEVE)
fillRect(28, 20, 4, 12, SLEEVE)
fillRect(32, 20, 8, 12, PANTS)

fillRect(8, 8, 8, 8, SKIN)
fillRect(0, 8, 8, 8, HAIR)
fillRect(16, 8, 8, 8, HAIR)
fillRect(24, 8, 8, 8, SKIN)
fillRect(8, 0, 8, 8, HAIR)
fillRect(0, 0, 32, 8, HAIR)

fs.writeFileSync(file, writePNG(width, height, px))
console.log('patched', file)
