import { makeGlyphCanvas, parseStyled, glyphsWidth } from './bitmapfont.js'
import { img, url } from './textures.js'

const MAX_PLAYERS = 80
const MAX_ROWS = 20
const HEAD_LINES = ['\u00a76\u00a7lKBFFA \u00a78| \u00a7e\u00a7lKnockback FFA', '\u00a77Knock your enemies into the \u00a7c\u00a7lVOID\u00a77!']
const footLines = (count) => [`\u00a77Players online: \u00a7a${count}`, '\u00a76Good luck and have fun!']

const px = (n) => `calc(${n}px * var(--s))`
const pingRow = (ping) => (ping < 0 ? 5 : ping < 150 ? 0 : ping < 300 ? 1 : ping < 600 ? 2 : ping < 1000 ? 3 : 4)

const sizeCanvas = (c) => {
  c.style.width = px(c.width)
  c.style.height = px(c.height)
  c.style.imageRendering = 'pixelated'
  c.style.display = 'block'
  return c
}

const textLine = (str) => sizeCanvas(makeGlyphCanvas(parseStyled(str), true))

const headCanvas = () => {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  const skin = img('entity', 'steve')
  if (skin && skin.width >= 48) {
    g.drawImage(skin, 8, 8, 8, 8, 0, 0, 8, 8)
    g.drawImage(skin, 40, 8, 8, 8, 0, 0, 8, 8)
  }
  return sizeCanvas(c)
}

const block = (parent, cls) => {
  const d = document.createElement('div')
  d.className = `tab-block ${cls}`
  parent.appendChild(d)
  return d
}

export class TabList {
  constructor(root) {
    this.root = document.createElement('div')
    this.root.className = 'tablist'
    root.appendChild(this.root)
    this.visible = false
    this.key = ''
  }

  setVisible(on) {
    if (on === this.visible) return
    this.visible = on
    this.root.style.display = on ? 'flex' : 'none'
    if (!on) this.key = ''
  }

  update(entries) {
    if (!this.visible) return
    const list = entries
      .map((p) => ({ name: String(p.name), ping: Number.isFinite(p.ping) ? p.ping : 0 }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .slice(0, MAX_PLAYERS)
    const key = list.map((p) => `${p.name}:${pingRow(p.ping)}`).join('|') + `#${entries.length}`
    if (key === this.key) return
    this.key = key
    this.root.replaceChildren()

    const head = block(this.root, 'tab-head')
    for (const line of HEAD_LINES) {
      const row = document.createElement('div')
      row.className = 'tab-line'
      row.appendChild(textLine(line))
      head.appendChild(row)
    }

    let columns = 1
    let perColumn = list.length
    while (perColumn > MAX_ROWS) {
      columns++
      perColumn = Math.ceil(list.length / columns)
    }
    const nameWidth = list.reduce((m, p) => Math.max(m, glyphsWidth(parseStyled(p.name))), 0)
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1
    const cellWidth = Math.floor(Math.min(columns * (nameWidth + 22), innerWidth / scale - 50) / columns)

    const players = block(this.root, 'tab-players')
    const grid = document.createElement('div')
    grid.className = 'tab-grid'
    grid.style.gridTemplateColumns = `repeat(${columns}, ${px(cellWidth)})`
    grid.style.gridAutoFlow = 'column'
    grid.style.gridTemplateRows = `repeat(${perColumn}, ${px(9)})`
    players.appendChild(grid)
    for (const p of list) {
      const cell = document.createElement('div')
      cell.className = 'tab-cell'
      const face = headCanvas()
      face.style.left = '0'
      face.style.top = '0'
      cell.appendChild(face)
      const name = textLine(p.name)
      name.style.left = px(7)
      name.style.top = '0'
      cell.appendChild(name)
      const ping = document.createElement('div')
      ping.className = 'tab-ping'
      ping.style.backgroundImage = `url(${url('gui', 'icons')})`
      ping.style.backgroundSize = `${px(256)} ${px(256)}`
      ping.style.backgroundPosition = `0 calc(${-(176 + pingRow(p.ping) * 8)}px * var(--s))`
      cell.appendChild(ping)
      grid.appendChild(cell)
    }

    const foot = block(this.root, 'tab-foot')
    for (const line of footLines(entries.length)) {
      const row = document.createElement('div')
      row.className = 'tab-line'
      row.appendChild(textLine(line))
      foot.appendChild(row)
    }
  }
}
