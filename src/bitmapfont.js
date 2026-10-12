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

const FORMAT_COLORS = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa',
  '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff'
}

export function parseStyled(str, baseColor = '#ffffff') {
  const out = []
  let color = baseColor
  let bold = false
  let italic = false
  let underline = false
  let strike = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '\u00a7' && i + 1 < str.length) {
      const k = str[i + 1].toLowerCase()
      if (FORMAT_COLORS[k]) {
        color = FORMAT_COLORS[k]
        bold = italic = underline = strike = false
        i++
        continue
      }
      if (k === 'r') {
        color = baseColor
        bold = italic = underline = strike = false
        i++
        continue
      }
      if (k === 'l') { bold = true; i++; continue }
      if (k === 'o') { italic = true; i++; continue }
      if (k === 'n') { underline = true; i++; continue }
      if (k === 'm') { strike = true; i++; continue }
      if (k === 'k') { i++; continue }
    }
    out.push({ ch, color, bold, italic, underline, strike })
  }
  return out
}

function glyphAdvance(g, w) {
  return w[g.ch.charCodeAt(0) & 255] + (g.bold ? 1 : 0)
}

export function glyphsWidth(glyphs) {
  const w = widths()
  let total = 0
  for (const g of glyphs) total += glyphAdvance(g, w)
  return total
}

export function styledWidth(str) {
  return glyphsWidth(parseStyled(str))
}

let styledBuf = null

export function makeGlyphCanvas(glyphs, shadow = true, opacity = 1) {
  const image = img('font', 'ascii')
  const w = widths()
  const pad = 2
  const width = glyphsWidth(glyphs) + pad * 2 + (shadow ? 1 : 0)
  const height = 10 + (shadow ? 1 : 0)
  const c = document.createElement('canvas')
  c.width = Math.max(1, width)
  c.height = height
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  if (!styledBuf) {
    styledBuf = document.createElement('canvas')
    styledBuf.width = CELL
    styledBuf.height = CELL
  }
  const gctx = styledBuf.getContext('2d')
  const pass = (ox, oy, isShadow) => {
    let cx = pad + ox
    for (const g of glyphs) {
      const code = g.ch.charCodeAt(0) & 255
      const adv = glyphAdvance(g, w)
      const col = isShadow ? shadeColor(g.color) : g.color
      if (g.ch !== ' ') {
        const sx = (code % COLS) * CELL
        const sy = Math.floor(code / COLS) * CELL
        gctx.clearRect(0, 0, CELL, CELL)
        gctx.globalCompositeOperation = 'source-over'
        gctx.drawImage(image, sx, sy, CELL, CELL, 0, 0, CELL, CELL)
        gctx.globalCompositeOperation = 'source-in'
        gctx.fillStyle = col
        gctx.fillRect(0, 0, CELL, CELL)
        const draw = (dx) => {
          ctx.save()
          if (g.italic) ctx.transform(1, 0, -0.25, 1, cx + dx + 1, oy)
          else ctx.translate(cx + dx, oy)
          ctx.drawImage(styledBuf, 0, 0)
          ctx.restore()
        }
        draw(0)
        if (g.bold) draw(1)
      }
      if (g.underline || g.strike) {
        ctx.fillStyle = col
        if (g.underline) ctx.fillRect(cx - 1, oy + 8, adv + 1, 1)
        if (g.strike) ctx.fillRect(cx - 1, oy + 4, adv + 1, 1)
      }
      cx += adv
    }
  }
  if (shadow) pass(1, 1, true)
  pass(0, 0, false)
  return c
}
