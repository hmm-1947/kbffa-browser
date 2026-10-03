import { CONFIG as C } from './config.js'
import { img, url } from './textures.js'
import { ID, faceTexName } from './blocks.js'
import { makeBitmapTextCanvas, setPixelText, textWidth, drawBitmapText } from './bitmapfont.js'
import { settings } from './settings.js'

// HUD text is rasterised at 1 font-pixel per canvas pixel and sized with CSS so it
// follows the GUI scale (--s) like every other HUD element.
const sizeCanvas = (c) => {
  c.style.width = `calc(${c.width}px * var(--s))`
  c.style.height = `calc(${c.height}px * var(--s))`
  return c
}
const guiText = (str, color) => sizeCanvas(makeBitmapTextCanvas(str, 1, color))
// Vanilla experience level: green 0x80FF20 text with a black outline on four sides.
const levelText = (str) => {
  const c = document.createElement('canvas')
  c.width = Math.ceil(textWidth(str, 1)) + 2
  c.height = 10
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) drawBitmapText(ctx, str, dx, dy, 1, '#000000', false)
  drawBitmapText(ctx, str, 1, 1, 1, '#80ff20', false)
  return sizeCanvas(c)
}

// Largest GUI scale that still fits the window (same rule Minecraft uses).
export const maxGuiScale = () => Math.max(1, Math.floor(Math.min(innerWidth / 320, innerHeight / 240)))

function blockIcon(id) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  const top = img('blocks', faceTexName(id, 'top'))
  const left = img('blocks', faceTexName(id, 'side'))
  const right = img('blocks', faceTexName(id, 'side'))
  const T = 26
  const cx = 32
  const top0 = (64 - T * 2) / 2
  const draw = (im, a, b, cc, d, e, f, dark) => {
    const s = im.width
    const sh = Math.min(im.height, im.width)
    g.setTransform(a / s, b / s, cc / s, d / s, e, f)
    g.drawImage(im, 0, 0, s, sh, 0, 0, s, sh)
    if (dark) {
      g.fillStyle = `rgba(0,0,0,${dark})`
      g.fillRect(0, 0, s, sh)
    }
  }
  // Top-face diamond has vertices N=(cx,top0) E=(cx+T,top0+T/2) W=(cx-T,top0+T/2) S=(cx,top0+T).
  // The side faces must start exactly at W and S so their top edges line up with
  // the top face's edges instead of leaving a gap.
  draw(top, T, T * 0.5, -T, T * 0.5, cx, top0, 0)
  draw(left, T, T * 0.5, 0, T, cx - T, top0 + T * 0.5, 0.3)
  draw(right, T, -T * 0.5, 0, T, cx, top0 + T, 0.5)
  return c
}

function itemIcon(name) {
  if (name === 'gold_pressure_plate') return plateIcon()
  const i = document.createElement('img')
  i.src = url('items', name)
  return i
}

function plateIcon() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  const gold = img('blocks', 'gold_block')
  const inset = 8
  g.drawImage(gold, 0, 0, gold.width, gold.width, inset, inset, 64 - inset * 2, 64 - inset * 2)
  return c
}

const el = (tag, cls, parent) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (parent) parent.appendChild(e)
  return e
}

export class Hud {
  constructor(root) {
    this.root = root
    this.resize()
    const cross = el('img', 'crosshair', root)
    cross.src = url('gui', 'crosshair')
    this.hurt = el('div', 'hurt', root)
    this.feed = el('div', 'feed', root)
    this.board = el('div', 'board', root)
    this.boardTitle = el('div', 'board-title', this.board)
    this.boardTitle.appendChild(guiText('KBFFA', '#ffff55'))
    this.boardRows = el('div', 'board-rows', this.board)
    this.boardPing = '0ms'
    this.boardPingUpdatedAt = -Infinity
    this.hotbar = el('div', 'hotbar', root)
    this.hotbar.style.backgroundImage = `url(${url('gui', 'hotbar')})`
    this.status = el('div', 'status', root)
    this.health = el('div', 'health', this.status)
    this.hunger = el('div', 'hunger', this.status)
    // KBFFA currently has knockback/void elimination rather than a damage and
    // food simulation, so both vanilla-style meters begin full and remain a
    // truthful presentation of the current ruleset.
    for (let i = 0; i < 10; i++) {
      const heartBg = el('div', 'status-icon heart-container', this.health)
      heartBg.style.left = `calc(${i * 8}px * var(--s))`
      const heart = el('div', 'status-icon heart-full', this.health)
      heart.style.left = `calc(${i * 8}px * var(--s))`
      const foodBg = el('div', 'status-icon hunger-container', this.hunger)
      foodBg.style.right = `calc(${i * 8}px * var(--s))`
      const food = el('div', 'status-icon hunger-full', this.hunger)
      // Minecraft draws the first food icon at the far-right edge and steps
      // left by eight pixels for every following icon.
      food.style.right = `calc(${i * 8}px * var(--s))`
    }
    // Survival-style experience bar: icons.png (0,64) background and (0,69) fill,
    // 182x5 at 29 px above the bottom edge, level number centred above it.
    this.xp = el('div', 'xp', root)
    this.xpFill = el('div', 'xp-fill', this.xp)
    this.xpLevel = el('div', 'xp-level', root)
    this.xpKey = ''
    this.sel = el('div', 'selector', this.hotbar)
    this.sel.style.backgroundImage = `url(${url('gui', 'hotbar_selected')})`
    this.slots = []
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot', this.hotbar)
      s.style.left = `calc(${3 + i * 20}px * var(--s))`
      const count = el('div', 'count', s)
      const cd = el('div', 'cd', s)
      this.slots.push({ s, count, cd, def: null, last: '' })
    }
    this.inv = el('div', 'inv', root)
    this.inv.style.display = 'none'
    const title = el('div', 'inv-title', this.inv)
    title.textContent = 'Inventory — drag or click two hotbar items to swap'
    const grid = el('div', 'inv-grid', this.inv)
    this.invHotbarSlots = []
    this.selectedHotbarSlot = null
    this.hotbarSwapHandler = null
    for (let i = 0; i < 36; i++) {
      const s = el('div', 'inv-slot', grid)
      if (i === 0) {
        s.appendChild(itemIcon('arrow'))
        const c = el('div', 'count', s)
        setPixelText(c, '64', 2, '#ffffff')
      }
      if (i >= 27 && C.HOTBAR[i - 27]) {
        const hotbarIndex = i - 27
        s.classList.add('inv-hotbar-slot')
        s.draggable = true
        s.addEventListener('click', () => this.selectHotbarSlot(hotbarIndex))
        s.addEventListener('dragstart', (e) => {
          this.draggedHotbarSlot = hotbarIndex
          e.dataTransfer.effectAllowed = 'move'
        })
        s.addEventListener('dragend', () => { this.draggedHotbarSlot = null })
        s.addEventListener('dragover', (e) => e.preventDefault())
        s.addEventListener('drop', (e) => {
          e.preventDefault()
          if (this.draggedHotbarSlot !== undefined && this.draggedHotbarSlot !== hotbarIndex) this.swapHotbarSlots(this.draggedHotbarSlot, hotbarIndex)
          this.draggedHotbarSlot = null
        })
        this.invHotbarSlots[hotbarIndex] = s
      }
    }
    this.refreshHotbar()
    addEventListener('resize', () => this.resize())
  }

  setHotbarSwapHandler(handler) {
    this.hotbarSwapHandler = handler
  }

  selectHotbarSlot(index) {
    if (this.selectedHotbarSlot === null) {
      this.selectedHotbarSlot = index
    } else if (this.selectedHotbarSlot !== index) {
      this.swapHotbarSlots(this.selectedHotbarSlot, index)
      this.selectedHotbarSlot = null
    } else {
      this.selectedHotbarSlot = null
    }
    this.invHotbarSlots.forEach((slot, i) => slot.classList.toggle('selected', i === this.selectedHotbarSlot))
  }

  swapHotbarSlots(a, b) {
    this.hotbarSwapHandler?.(a, b)
    this.selectedHotbarSlot = null
    this.invHotbarSlots.forEach((slot) => slot.classList.remove('selected'))
  }

  refreshHotbar() {
    this.slots.forEach((slot, i) => {
      const def = C.HOTBAR[i]
      slot.def = def
      slot.last = ''
      for (const icon of slot.s.querySelectorAll('img, canvas')) icon.remove()
      if (def) slot.s.insertBefore(def.type === 'block' ? blockIcon(ID[def.block]) : itemIcon(def.item), slot.count)
      const inventorySlot = this.invHotbarSlots[i]
      if (!inventorySlot) return
      inventorySlot.replaceChildren()
      if (def) inventorySlot.appendChild(def.type === 'block' ? blockIcon(ID[def.block]) : itemIcon(def.item))
    })
  }

  resize() {
    // guiScale 0 = Auto (largest that fits, capped at 3 as before); otherwise the
    // chosen value, clamped so it never exceeds what fits in the window.
    const s = settings.guiScale > 0 ? Math.min(settings.guiScale, maxGuiScale()) : Math.min(3, maxGuiScale())
    // Set on :root (not just #hud) so the pause/options/controls screens, which
    // live outside #hud, scale together with the HUD at the same "GUI scale"
    // Minecraft would pick for this window size.
    document.documentElement.style.setProperty('--s', s)
  }

  toggleInventory(on) {
    this.inv.style.display = on ? 'block' : 'none'
  }

  flashHurt() {
    this.hurt.style.transition = 'none'
    this.hurt.style.opacity = '0.45'
    requestAnimationFrame(() => {
      this.hurt.style.transition = 'opacity 0.4s'
      this.hurt.style.opacity = '0'
    })
  }

  addFeed(text) {
    const d = el('div', 'feed-line', this.feed)
    d.appendChild(guiText(text, '#ffffff'))
    setTimeout(() => d.remove(), 6000)
  }

  update(player, game) {
    this.sel.style.left = `calc(${player.slot * 20 - 1}px * var(--s))`
    for (const sl of this.slots) {
      const def = sl.def
      let txt = ''
      let cd = ''
      let hide = false
      if (def) {
        if (def.type === 'block') txt = '64'
        else if (def.type === 'pearl') {
          // No pearls: hide the icon. Exactly one: show the icon without a number.
          const n = Math.max(0, player.pearls ?? 0)
          txt = n > 1 ? String(n) : ''
          hide = n <= 0
        }
        else if (def.type === 'plate') {
          // Online, the player's plate is not serialized; find it by owner so the
          // 10 s timer works in both online and offline play.
          const plate = game.plates.find((pl) => pl.owner === player.id)
          if (plate) txt = String(Math.max(1, Math.ceil((plate.expire - game.time) / C.TPS)))
        }
      }
      const key = txt + '|' + cd + '|' + hide
      if (key !== sl.last) {
        sl.last = key
        sl.s.classList.toggle('empty', hide)
        if (txt) setPixelText(sl.count, txt, 1, '#ffffff')
        else sl.count.replaceChildren()
        if (cd) setPixelText(sl.cd, cd, 1, '#ffffff')
        else sl.cd.replaceChildren()
        sl.cd.style.display = cd ? 'flex' : 'none'
      }
    }
    const st = player.stats || {}
    const kills = Number(st.kills ?? player.kills ?? 0)
    const deaths = Number(st.deaths ?? player.deaths ?? 0)
    const killStreak = Number(player.killStreak ?? st.killStreak ?? 0)
    const deathStreak = Number(player.deathStreak ?? st.deathStreak ?? 0)
    const kdRatio = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2)
    // Experience bar: level = kills, bar fill = kill streak progress (5 = full).
    const level = Math.max(0, Math.floor(kills))
    const xpPx = Math.round(Math.min(1, Math.max(0, killStreak) / 5) * 182)
    const xpKey = level + '|' + xpPx
    if (xpKey !== this.xpKey) {
      this.xpKey = xpKey
      this.xpFill.style.width = `calc(${xpPx}px * var(--s))`
      this.xpLevel.replaceChildren()
      if (level > 0) this.xpLevel.appendChild(levelText(String(level)))
    }
    const online = Math.max(0, game?.players?.size ?? 1)
    const now = performance.now()
    if (now - this.boardPingUpdatedAt >= 3000) {
      this.boardPingUpdatedAt = now
      this.boardPing = Number.isFinite(player.ping) ? String(Math.round(player.ping)) + 'ms' : '0ms'
    }
    const ping = this.boardPing
    const boardState = [
      { section: 'STATS' },
      ['Kills:', String(kills)],
      ['Deaths:', String(deaths)],
      ['Kill Streak:', String(killStreak)],
      ['Death Streak:', String(deathStreak)],
      ['KDR:', kdRatio],
      { section: 'SERVER' },
      ['Online:', String(online)],
      ['Ping:', ping]
    ]
    const boardText = JSON.stringify(boardState)
    if (boardText !== this.boardText) {
      this.boardText = boardText
      this.boardRows.replaceChildren()
      for (const entry of boardState) {
        if (entry.section) {
          const section = el('div', 'board-section', this.boardRows)
          section.appendChild(guiText(entry.section, '#ffffff'))
          continue
        }
        const [label, value] = entry
        const row = el('div', 'board-row', this.boardRows)
        const labelEl = el('span', 'board-label', row)
        labelEl.appendChild(guiText(label, '#ffffff'))
        const valueEl = el('span', 'board-value', row)
        valueEl.appendChild(guiText(value, '#ffff55'))
      }
    }
  }
}
