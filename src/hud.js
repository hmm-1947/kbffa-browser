import { CONFIG as C } from './config.js'
import { img, url } from './textures.js'
import { ID, faceTexName } from './blocks.js'
import { makeBitmapTextCanvas } from './bitmapfont.js'

function blockIcon(id) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  const top = img('blocks', faceTexName(id, 'top'))
  const left = img('blocks', faceTexName(id, 'side'))
  const right = img('blocks', faceTexName(id, 'side'))
  const T = 16.6
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
  // Top-face diamond has vertices N=(32,4) E=(32+T,4+T/2) W=(32-T,4+T/2) S=(32,4+T).
  // The side faces must start exactly at W and S so their top edges line up with
  // the top face's edges instead of leaving a gap (previous e/f values of
  // (0,16)/(32,16) didn't match those vertices, which is why the cube looked broken).
  draw(top, T, T * 0.5, -T, T * 0.5, 32, 4, 0)
  draw(left, T, T * 0.5, 0, T, 32 - T, 4 + T * 0.5, 0.3)
  draw(right, T, -T * 0.5, 0, T, 32, 4 + T, 0.5)
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
  c.width = c.height = 16
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  const gold = img('blocks', 'gold_block')
  g.drawImage(gold, 0, 0, gold.width, gold.width, 1, 6, 14, 8)
  g.fillStyle = 'rgba(0,0,0,0.35)'
  g.fillRect(1, 12, 14, 2)
  g.strokeStyle = 'rgba(0,0,0,0.4)'
  g.strokeRect(1.5, 6.5, 13, 7)
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
    this.hotbar = el('div', 'hotbar', root)
    this.hotbar.style.backgroundImage = `url(${url('gui', 'hotbar')})`
    this.status = el('div', 'status', root)
    this.health = el('div', 'health', this.status)
    this.hunger = el('div', 'hunger', this.status)
    // KBFFA currently has knockback/void elimination rather than a damage and
    // food simulation, so both vanilla-style meters begin full and remain a
    // truthful presentation of the current ruleset.
    for (let i = 0; i < 10; i++) {
      const heart = el('div', 'status-icon heart-full', this.health)
      heart.style.left = `calc(${i * 8}px * var(--s))`
      const food = el('div', 'status-icon hunger-full', this.hunger)
      // Minecraft draws the first food icon at the far-right edge and steps
      // left by eight pixels for every following icon.
      food.style.right = `calc(${i * 8}px * var(--s))`
    }
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
        c.textContent = '64'
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
    const s = Math.max(1, Math.min(3, Math.floor(Math.min(innerWidth / 320, innerHeight / 240))))
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
    d.appendChild(makeBitmapTextCanvas(text, 3, '#ffffff'))
    setTimeout(() => d.remove(), 6000)
  }

  update(player, game) {
    this.sel.style.left = `calc(${player.slot * 20 - 1}px * var(--s))`
    for (const sl of this.slots) {
      const def = sl.def
      let txt = ''
      let cd = ''
      if (def) {
        if (def.type === 'block') txt = '64'
        else if (def.type === 'pearl') txt = player.pearls > 1 ? String(player.pearls) : ''
        else if (def.type === 'plate' && player.plate) cd = String(Math.ceil((player.plate.expire - game.time) / 20))
      }
      const key = txt + '|' + cd
      if (key !== sl.last) {
        sl.last = key
        sl.count.textContent = txt
        sl.cd.textContent = cd
        sl.cd.style.display = cd ? 'flex' : 'none'
      }
    }
    const rows = [...game.players.values()].sort((a, b) => b.kills - a.kills)
    const st = player.stats || {}
    const html = [
      'Statistics',
      `Kills: ${st.kills ?? player.kills}`,
      `Deaths: ${st.deaths ?? player.deaths}`,
      `Max streak: ${st.maxKillStreak ?? 0}`,
      `Death streak: ${st.deathStreak ?? 0}`,
      `Pearls: ${st.pearlsThrown ?? 0}`,
      `Blocks: ${st.blocksPlaced ?? 0}`,
      '',
      ...rows.map((p) => `${p.name}  ${p.kills}`)
    ].join('\n')
    if (html !== this.boardText) {
      this.boardText = html
      this.board.innerHTML = ''
      for (const lineText of html.split('\n')) {
        const line = el('div', null, this.board)
        line.style.marginBottom = '2px'
        if (lineText) line.appendChild(makeBitmapTextCanvas(lineText, 3, '#ffffff'))
      }
    }
  }
}
