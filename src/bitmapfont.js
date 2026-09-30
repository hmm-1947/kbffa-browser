import { img } from './textures.js'

const COLS = 16
const CELL = 8
let widthCache = null

function computeWidths() {
  const image = img('font', 'ascii')
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const g = c.getContext('2d')
  g.drawImage(image, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height).data
  const widths = new Array(256).fill(6)
  for (let code = 0; code < 256; code++) {
    const cx = (code % COLS) * CELL
    const cy = Math.floor(code / COLS) * CELL
    let last = -1
    for (let x = 0; x < CELL; x++) {
      for (let y = 0; y < CELL; y++) {
        const idx = ((cy + y) * c.width + (cx + x)) * 4 + 3
        if (data[idx] > 16) {
          last = x
          break
        }
      }
    }
    widths[code] = code === 32 ? 4 : last < 0 ? 0 : last + 2
  }
  return widths
}

function widths() {
  if (!widthCache) widthCache = computeWidths()
  return widthCache
}

export function textWidth(str, scale = 1) {
  const w = widths()
  let total = 0
  for (let i = 0; i < str.length; i++) total += w[str.charCodeAt(i) & 255]
  return total * scale
}

export function drawBitmapText(ctx, str, x, y, scale = 1, color = '#ffffff', shadow = true) {
  const image = img('font', 'ascii')
  const w = widths()
  // Tint each glyph on its own small offscreen cell before compositing onto
  // the destination. 'source-in' clears everything on whatever canvas it's
  // applied to outside the drawn shape, not just the glyph - applying it
  // directly on the shared destination canvas was wiping out every glyph
  // drawn before the current one, leaving only the last character visible.
  const glyphBuf = document.createElement('canvas')
  glyphBuf.width = CELL
  glyphBuf.height = CELL
  const gctx = glyphBuf.getContext('2d')
  const draw = (px, py, col) => {
    let cx = px
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i) & 255
      const sx = (code % COLS) * CELL
      const sy = Math.floor(code / COLS) * CELL
      gctx.clearRect(0, 0, CELL, CELL)
      gctx.globalCompositeOperation = 'source-over'
      gctx.drawImage(image, sx, sy, CELL, CELL, 0, 0, CELL, CELL)
      gctx.globalCompositeOperation = 'source-in'
      gctx.fillStyle = col
      gctx.fillRect(0, 0, CELL, CELL)
      ctx.save()
      ctx.translate(cx, py)
      ctx.scale(scale, scale)
      ctx.drawImage(glyphBuf, 0, 0)
      ctx.restore()
      cx += w[code] * scale
    }
  }
  if (shadow) draw(x + scale, y + scale, shadeColor(color))
  draw(x, y, color)
}

function shadeColor(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = ((n >> 16) & 255) >> 2
  const g = ((n >> 8) & 255) >> 2
  const b = (n & 255) >> 2
  return `rgb(${r},${g},${b})`
}

export function makeBitmapTextCanvas(str, scale = 2, color = '#ffffff', shadow = true) {
  const w = Math.ceil(textWidth(str, scale)) + (shadow ? scale : 0)
  const h = Math.ceil(8 * scale) + (shadow ? scale : 0)
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  drawBitmapText(ctx, str, 0, 0, scale, color, shadow)
  return c
}

// Replaces an element's text with the Minecraft bitmap font, same as the
// game's HUD text. Re-render whenever the label's string changes (e.g. call
// again after updating text), since it's a rasterized canvas, not live DOM text.
export function setPixelText(el, str, scale = 2, color = '#e0e0e0', shadow = true) {
  el.textContent = ''
  el.classList.add('px-text')
  const c = makeBitmapTextCanvas(str, scale, color, shadow)
  el.appendChild(c)
  return c
}
