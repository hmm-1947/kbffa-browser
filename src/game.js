import { CONFIG as C } from './config.js'
import { World } from './world.js'
import { BLOCK_DEFS, ID } from './blocks.js'
import { moveEntity, playerBox, overlapsSolid } from './physics.js'
import { raycastBlocks, rayBox } from './raycast.js'

const gauss = () =>
  (Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random() - 3) * 1.414

export class Player {
  constructor(id, name, isBot) {
    this.id = id
    this.name = name
    this.isBot = isBot
    this.pos = { x: 0, y: 0, z: 0 }
    this.prev = { x: 0, y: 0, z: 0 }
    this.vel = { x: 0, y: 0, z: 0 }
    this.yaw = 0
    this.pitch = 0
    this.prevYaw = 0
    this.prevPitch = 0
    this.onGround = false
    this.hCollide = false
    this.sprinting = false
    this.wantSprint = false
    this.sneaking = false
    this.input = { fwd: 0, strafe: 0, jump: false, sneak: false }
    this.act = { attack: false, breakHeld: false, useHeld: false, sprintTap: false }
    this.slot = 0
    this.jumpTicks = 0
    this.stepDistance = 0
    this.hurtTime = 0
    this.hurtAnim = 0
    this.kills = 0
    this.deaths = 0
    this.killStreak = 0
    this.deathStreak = 0
    this.stats = null
    this.pearls = C.START_PEARLS
    this.arrows = C.START_ARROWS
    this.plate = null
    this.bowTicks = -1
    this.useDelay = 0
    this.breakDelay = 0
    this.swingTick = -100
    this.lastAttacker = null
    this.lastAttackTime = -1000
    this.alive = true
    this.ping = 0
    this.pingAt = null
    this.respawnAt = 0
  }

  eye() {
    return { x: this.pos.x, y: this.pos.y + (this.sneaking ? 1.54 : 1.62), z: this.pos.z }
  }

  look() {
    const cp = Math.cos(this.pitch)
    return { x: -Math.sin(this.yaw) * cp, y: -Math.sin(this.pitch), z: Math.cos(this.yaw) * cp }
  }
}

export class Game {
  constructor(map) {
    this.map = map
    this.world = new World(C.WORLD)
    map.build(this.world)
    this.players = new Map()
    this.arrows = []
    this.pearls = []
    this.plates = []
    this.placed = new Map()
    this.time = 0
    this.events = []
    this.nextId = 1
    this.nextEntityId = 1
    this.botsEnabled = true
  }

  addPlayer(name, isBot = false) {
    const p = new Player(this.nextId++, name, isBot)
    this.players.set(p.id, p)
    this.respawn(p)
    return p
  }

  removePlayer(id) {
    this.players.delete(id)
  }

  setSlot(p, n) {
    p.slot = n
    p.bowTicks = -1
  }

  respawn(p) {
    const s = this.map.spawn
    p.pos.x = s.x + (Math.random() - 0.5) * 1.6
    p.pos.y = s.y
    p.pos.z = s.z + (Math.random() - 0.5) * 1.6
    Object.assign(p.prev, p.pos)
    p.vel.x = p.vel.y = p.vel.z = 0
    p.yaw = Math.atan2(p.pos.x, -p.pos.z)
    p.pitch = 0
    p.prevYaw = p.yaw
    p.prevPitch = 0
    p.alive = true
    p.onGround = false
    p.hurtTime = 0
    p.hurtAnim = 0
    p.pearls = C.START_PEARLS
    p.arrows = C.START_ARROWS
    p.bowTicks = -1
    p.wantSprint = false
    p.sprinting = false
    p.stepDistance = 0
    p.lastAttacker = null
    p.slot = 0
    this.events.push({ type: 'respawn', id: p.id })
  }

  update() {
    this.time++
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.respawn(p)
        continue
      }
      Object.assign(p.prev, p.pos)
      p.prevYaw = p.yaw
      p.prevPitch = p.pitch
      if (p.isBot) this.think(p)
      this.actions(p)
      this.move(p)
      if (p.pos.y < C.VOID_Y) this.kill(p)
    }
    this.updatePlates()
    this.updateArrows()
    this.updatePearls()
    this.expire()
  }

  think(p) {
    p.input.fwd = 0
    p.input.strafe = 0
    p.input.jump = false
    p.input.sneak = false
    if (!this.botsEnabled) return
    let t = null
    let best = 1e9
    for (const q of this.players.values()) {
      // Bots only ever go after real players, never each other.
      if (q === p || !q.alive || q.isBot) continue
      const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z)
      if (d < best) {
        best = d
        t = q
      }
    }
    if (!t) return
    p.slot = 0
    p.yaw = Math.atan2(-(t.pos.x - p.pos.x), t.pos.z - p.pos.z)
    p.pitch = -Math.atan2(t.pos.y + 0.9 - (p.pos.y + 1.62), Math.max(best, 0.01))
    if (best > 1.2) p.input.fwd = 1
    if (best > 3.5 && !p.wantSprint) p.act.sprintTap = true
    p.input.strafe = Math.sin(this.time / 12 + p.id) > 0.3 ? 1 : 0
    p.input.jump = p.onGround && this.time % 23 === p.id % 23
    if (best < 3 && this.time % 9 === 0) p.act.attack = true
  }

  actions(p) {
    const a = p.act
    if (p.useDelay > 0) p.useDelay--
    if (a.attack) {
      a.attack = false
      p.swingTick = this.time
      const t = this.pickPlayer(p)
      if (t) this.melee(p, t)
    }
    // Attacking is exclusively for combat in KBFFA. Blocks, including player
    // placements, are never breakable.
    a.breakHeld = false
    const slot = C.HOTBAR[p.slot]
    const type = slot && slot.type
    if (type === 'bow') {
      if (a.useHeld && (p.bowTicks >= 0 || p.arrows > 0)) p.bowTicks = p.bowTicks < 0 ? 0 : p.bowTicks + 1
      else if (p.bowTicks >= 0) {
        this.shoot(p)
        p.bowTicks = -1
      }
    } else {
      p.bowTicks = -1
      if (a.useHeld && p.useDelay === 0) {
        if (type === 'block') {
          p.useDelay = 4
          if (this.placeBlock(p)) p.swingTick = this.time
        } else if (type === 'pearl') {
          p.useDelay = 4
          this.throwPearl(p)
        } else if (type === 'plate') {
          p.useDelay = 4
          this.placePlate(p)
        }
      }
    }
  }

  move(p) {
    const inp = p.input
    const v = p.vel
    p.sneaking = inp.sneak
    if (p.hurtTime > 0) p.hurtTime--
    if (p.hurtAnim > 0) p.hurtAnim--
    if (p.act.sprintTap && inp.fwd > 0 && !p.sneaking) p.wantSprint = true
    p.act.sprintTap = false
    if (inp.fwd <= 0 || p.sneaking) p.wantSprint = false
    if (p.wantSprint && p.hCollide) p.wantSprint = false
    p.sprinting = p.wantSprint
    if (Math.abs(v.x) < 0.005) v.x = 0
    if (Math.abs(v.y) < 0.005) v.y = 0
    if (Math.abs(v.z) < 0.005) v.z = 0
    if (p.jumpTicks > 0) p.jumpTicks--
    if (inp.jump) {
      if (p.onGround && p.jumpTicks === 0) {
        v.y = C.JUMP_VY
        this.events.push({ type: 'jump', id: p.id })
        if (p.sprinting) {
          v.x -= Math.sin(p.yaw) * 0.2
          v.z += Math.cos(p.yaw) * 0.2
        }
        p.jumpTicks = 10
      }
    } else p.jumpTicks = 0
    let strafe = inp.strafe * 0.98
    let fwd = inp.fwd * 0.98
    if (p.sneaking) {
      strafe *= 0.3
      fwd *= 0.3
    }
    const f4 = p.onGround ? 0.546 : 0.91
    const base = 0.1 * (p.sprinting ? 1.3 : 1)
    const accel = p.onGround ? (base * 0.16277136) / (f4 * f4 * f4) : p.sprinting ? 0.026 : 0.02
    let d = strafe * strafe + fwd * fwd
    if (d >= 1e-4) {
      d = Math.sqrt(d)
      if (d < 1) d = 1
      d = accel / d
      strafe *= d
      fwd *= d
      const sin = Math.sin(p.yaw)
      const cos = Math.cos(p.yaw)
      v.x += strafe * cos - fwd * sin
      v.z += fwd * cos + strafe * sin
    }
    moveEntity(this.world, p, v.x, v.y, v.z)
    const walked = Math.hypot(p.pos.x - p.prev.x, p.pos.z - p.prev.z)
    if (p.onGround && walked > 0) {
      p.stepDistance += walked
      if (p.stepDistance >= 0.55) {
        p.stepDistance %= 0.55
        this.events.push({ type: 'step', id: p.id })
      }
    }
    v.y = (v.y - 0.08) * 0.98
    v.x *= f4
    v.z *= f4
  }

  pickPlayer(p) {
    const e = p.eye()
    const d = p.look()
    const bh = raycastBlocks(this.world, e.x, e.y, e.z, d.x, d.y, d.z, C.REACH_ATTACK)
    let bt = bh ? bh.t : C.REACH_ATTACK
    let best = null
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue
      const t = rayBox(e.x, e.y, e.z, d.x, d.y, d.z, playerBox(q.pos, 0.1), bt)
      if (t !== null && t <= bt) {
        best = q
        bt = t
      }
    }
    return best
  }

  hit(v, a) {
    if (this.isSpawnProtected(v.pos) || this.isSpawnProtected(a.pos)) return false
    if (v.hurtTime > C.HURT_RESISTANT / 2) return false
    v.hurtTime = C.HURT_RESISTANT
    v.hurtAnim = 10
    v.lastAttacker = a.id
    v.lastAttackTime = this.time
    let dx = a.pos.x - v.pos.x
    let dz = a.pos.z - v.pos.z
    while (dx * dx + dz * dz < 1e-4) {
      dx = (Math.random() - 0.5) * 0.02
      dz = (Math.random() - 0.5) * 0.02
    }
    const f = Math.hypot(dx, dz)
    v.vel.x = v.vel.x / 2 - (dx / f) * 0.4
    v.vel.y = v.vel.y / 2 + 0.4
    v.vel.z = v.vel.z / 2 - (dz / f) * 0.4
    if (v.vel.y > 0.4) v.vel.y = 0.4
    this.events.push({ type: 'hurt', id: v.id })
    return true
  }

  melee(p, t) {
    if (!this.hit(t, p)) return
    this.events.push({ type: 'melee_hit', id: p.id })
    const kb = (p.slot === 0 ? C.KB_LEVEL : 0) + (p.sprinting ? 1 : 0)
    if (kb > 0) {
      t.vel.x += -Math.sin(p.yaw) * kb * 0.5
      t.vel.y += 0.1
      t.vel.z += Math.cos(p.yaw) * kb * 0.5
      p.vel.x *= 0.6
      p.vel.z *= 0.6
      p.wantSprint = false
      p.sprinting = false
    }
  }

  target(p) {
    // The client's reported actionTarget is only a hint for which face was
    // clicked; it must match an authoritative raycast from the player's own
    // eye/look, never trusted on distance alone. A distance-only check let a
    // client claim any in-range block regardless of line of sight, which is
    // how blocks ended up placed somewhere other than where the player was
    // actually looking, and let placements happen through walls.
    const e = p.eye()
    const d = p.look()
    const hit = raycastBlocks(this.world, e.x, e.y, e.z, d.x, d.y, d.z, C.REACH_BLOCK)
    const claimed = p.actionTarget
    p.actionTarget = null
    if (hit && claimed && hit.x === claimed.x && hit.y === claimed.y && hit.z === claimed.z) return hit
    return hit
  }

  breakBlock(p) {
    return false
  }

  canPlace(x, y, z) {
    if (!this.world.inBounds(x, y, z) || y > C.BUILD_MAX_Y || this.world.get(x, y, z) !== 0) return false
    if (this.plates.some((pl) => pl.x === x && pl.y === y && pl.z === z)) return false
    for (const q of this.players.values()) {
      if (!q.alive) continue
      const b = playerBox(q.pos)
      if (b.minX < x + 1 && b.maxX > x && b.minY < y + 1 && b.maxY > y && b.minZ < z + 1 && b.maxZ > z) return false
    }
    return true
  }

  placeBlock(p) {
    const h = this.target(p)
    if (!h) return false
    const x = h.x + h.nx
    const y = h.y + h.ny
    const z = h.z + h.nz
    if (!this.canPlace(x, y, z) || this.isSpawnProtected({ x: x + 0.5, y, z: z + 0.5 })) return false
    this.world.set(x, y, z, ID[C.PLACE_BLOCK])
    this.placed.set(`${x},${y},${z}`, this.time + C.BLOCK_LIFETIME)
    if (p.stats) p.stats.blocksPlaced++
    this.events.push({ type: 'block_place', id: p.id, sound: BLOCK_DEFS[ID[C.PLACE_BLOCK]]?.sound || 'stone' })
    return true
  }

  placePlate(p) {
    if (p.plate) {
      this.events.push({ type: 'plate_cd', id: p.id })
      return
    }
    const h = this.target(p)
    if (!h || h.ny !== 1) return
    const x = h.x
    const y = h.y + 1
    const z = h.z
    if (this.world.get(x, y, z) !== 0 || this.plates.some((pl) => pl.x === x && pl.y === y && pl.z === z)) return
    const pl = { id: this.nextEntityId++, x, y, z, owner: p.id, expire: this.time + C.PLATE_LIFETIME }
    this.plates.push(pl)
    p.plate = pl
    p.swingTick = this.time
    this.events.push({ type: 'plate_place', id: p.id })
  }

  updatePlates() {
    for (let i = this.plates.length - 1; i >= 0; i--) {
      const pl = this.plates[i]
      if (this.time >= pl.expire || !this.world.isSolid(pl.x, pl.y - 1, pl.z)) {
        this.plates.splice(i, 1)
        const o = this.players.get(pl.owner)
        if (o && o.plate === pl) o.plate = null
        continue
      }
      for (const q of this.players.values()) {
        if (!q.alive) continue
        const b = playerBox(q.pos)
        if (
          b.minX < pl.x + 0.875 &&
          b.maxX > pl.x + 0.125 &&
          b.minZ < pl.z + 0.875 &&
          b.maxZ > pl.z + 0.125 &&
          b.minY < pl.y + 0.25 &&
          b.maxY > pl.y
        ) {
          q.vel.y = C.PLATE_LAUNCH_VY
          q.onGround = false
          this.events.push({ type: 'launch', id: q.id })
        }
      }
    }
  }

  shoot(p) {
    let f = p.bowTicks / 20
    f = (f * f + f * 2) / 3
    if (f < 0.1) return
    if (f > 1) f = 1
    if (!C.INFINITE_ARROWS) {
      if (p.arrows <= 0) return
      p.arrows--
    }
    const d = p.look()
    const e = p.eye()
    const sp = f * 3
    const pos = { x: e.x - Math.cos(p.yaw) * 0.16, y: e.y - 0.1, z: e.z - Math.sin(p.yaw) * 0.16 }
    const vel = {
      x: (d.x + gauss() * 0.0075) * sp,
      y: (d.y + gauss() * 0.0075) * sp,
      z: (d.z + gauss() * 0.0075) * sp
    }
    this.arrows.push({
      id: this.nextEntityId++,
      pos,
      prev: { ...pos },
      vel,
      dir: { x: d.x, y: d.y, z: d.z },
      owner: p.id,
      age: 0,
      stuck: false,
      stuckTicks: 0
    })
    this.events.push({ type: 'bow_shoot', id: p.id, power: f })
    p.swingTick = this.time
  }

  throwPearl(p) {
    if (p.pearls <= 0) return
    p.pearls--
    const d = p.look()
    const e = p.eye()
    const pos = { x: e.x - Math.cos(p.yaw) * 0.16, y: e.y - 0.1, z: e.z - Math.sin(p.yaw) * 0.16 }
    const vel = {
      x: (d.x + gauss() * 0.0075) * 1.5,
      y: (d.y + gauss() * 0.0075) * 1.5,
      z: (d.z + gauss() * 0.0075) * 1.5
    }
    this.pearls.push({ id: this.nextEntityId++, pos, prev: { ...pos }, vel, owner: p.id, age: 0 })
    if (p.stats) p.stats.pearlsThrown++
    this.events.push({ type: 'pearl_throw', id: p.id })
    p.swingTick = this.time
  }

  sweep(pr, sp, dx, dy, dz) {
    const bh = raycastBlocks(this.world, pr.pos.x, pr.pos.y, pr.pos.z, dx, dy, dz, sp)
    let bt = bh ? bh.t : sp
    let who = null
    for (const q of this.players.values()) {
      if (!q.alive || (q.id === pr.owner && pr.age < 5)) continue
      const t = rayBox(pr.pos.x, pr.pos.y, pr.pos.z, dx, dy, dz, playerBox(q.pos, 0.3), bt)
      if (t !== null && t <= bt) {
        who = q
        bt = t
      }
    }
    return { bh, bt, who }
  }

  updateArrows() {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]
      Object.assign(a.prev, a.pos)
      if (a.stuck) {
        if (++a.stuckTicks > C.ARROW_STAY_TICKS) this.arrows.splice(i, 1)
        continue
      }
      a.age++
      const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z)
      if (sp < 1e-6) {
        a.stuck = true
        a.vel = { x: 0, y: 0, z: 0 }
        continue
      }
      const dx = a.vel.x / sp
      const dy = a.vel.y / sp
      const dz = a.vel.z / sp
      a.dir = { x: dx, y: dy, z: dz }
      const { bh, bt, who } = this.sweep(a, sp, dx, dy, dz)
      if (who) {
        const o = this.players.get(a.owner)
        if (o) this.hit(who, o)
        this.arrows.splice(i, 1)
        continue
      }
      if (bh) {
        a.pos.x += dx * bt
        a.pos.y += dy * bt
        a.pos.z += dz * bt
        a.stuck = true
        a.vel = { x: 0, y: 0, z: 0 }
        this.events.push({ type: 'arrow_hit', id: a.owner })
        continue
      }
      a.pos.x += a.vel.x
      a.pos.y += a.vel.y
      a.pos.z += a.vel.z
      a.vel.x *= 0.99
      a.vel.y = a.vel.y * 0.99 - 0.05
      a.vel.z *= 0.99
      if (a.pos.y < C.VOID_Y - 30) this.arrows.splice(i, 1)
    }
  }

  updatePearls() {
    for (let i = this.pearls.length - 1; i >= 0; i--) {
      const pr = this.pearls[i]
      Object.assign(pr.prev, pr.pos)
      pr.age++
      const sp = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z)
      if (sp < 1e-6) {
        this.pearls.splice(i, 1)
        continue
      }
      const dx = pr.vel.x / sp
      const dy = pr.vel.y / sp
      const dz = pr.vel.z / sp
      const { bh, bt, who } = this.sweep(pr, sp, dx, dy, dz)
      if (who || bh) {
        const o = this.players.get(pr.owner)
        const pt = { x: pr.pos.x + dx * bt, y: pr.pos.y + dy * bt, z: pr.pos.z + dz * bt }
        if (who && o && who !== o) this.hit(who, o)
        if (o && o.alive) this.teleport(o, pt, who ? null : { x: bh.nx, y: bh.ny, z: bh.nz })
        this.pearls.splice(i, 1)
        continue
      }
      pr.pos.x += pr.vel.x
      pr.pos.y += pr.vel.y
      pr.pos.z += pr.vel.z
      pr.vel.x *= 0.99
      pr.vel.y = pr.vel.y * 0.99 - 0.03
      pr.vel.z *= 0.99
      if (pr.pos.y < C.VOID_Y - 40 || pr.age > 300) this.pearls.splice(i, 1)
    }
  }

  teleport(o, pt, n) {
    let { x, y, z } = pt
    if (n) {
      if (Math.abs(n.y) < 0.5) {
        x += n.x * 0.31
        z += n.z * 0.31
      } else if (n.y < 0) y -= 1.8
    }
    o.pos.x = x
    o.pos.y = y
    o.pos.z = z
    for (let k = 0; k < 80 && overlapsSolid(this.world, playerBox(o.pos)); k++) o.pos.y += 0.1
    Object.assign(o.prev, o.pos)
    this.events.push({ type: 'teleport', id: o.id })
  }

  kill(p) {
    let killer = null
    if (p.lastAttacker !== null && this.time - p.lastAttackTime <= C.KILL_CREDIT_TICKS) {
      killer = this.players.get(p.lastAttacker) || null
    }
    if (killer === p) killer = null
    if (killer) {
      killer.kills++
      killer.killStreak++
      killer.deathStreak = 0
      killer.pearls += C.PEARL_PER_KILL
    }
    p.deaths++
    p.killStreak = 0
    p.deathStreak++
    p.alive = false
    p.respawnAt = this.time + C.RESPAWN_TICKS
    p.bowTicks = -1
    this.events.push({ type: 'death', victim: p.id, killer: killer ? killer.id : null })
  }

  isSpawnProtected(pos) {
    const s = this.map.spawn
    return Math.abs(pos.x - s.x) <= 2 && Math.abs(pos.z - s.z) <= 2 && pos.y >= s.y - 1 && pos.y <= s.y + 2
  }

  expire() {
    for (const [k, t] of this.placed) {
      if (this.time >= t) {
        const [x, y, z] = k.split(',').map(Number)
        this.world.set(x, y, z, 0)
        this.placed.delete(k)
      }
    }
  }

  nextBotName() {
    const taken = new Set([...this.players.values()].map((q) => q.name.toLowerCase()))
    let n = 1
    while (taken.has(`bot${n}`)) n++
    return `Bot${n}`
  }

  command(text) {
    const parts = text.trim().split(/\s+/)
    const cmd = (parts[0] || '').toLowerCase()
    if (cmd === '/bot') {
      const arg = (parts[1] || '').toLowerCase()
      if (arg === 'on') {
        // /bot on [count]: spawn melee-only bots (default 3, max 10). They chase
        // and hit real players with their stick; no bow, pearls, blocks or plates.
        const want = Math.max(1, Math.min(10, parseInt(parts[2], 10) || 3))
        this.botsEnabled = true
        const bots = [...this.players.values()].filter((q) => q.isBot)
        for (let i = bots.length; i < want; i++) this.addPlayer(this.nextBotName(), true)
        for (let i = bots.length - 1; i >= want; i--) this.removePlayer(bots[i].id)
        this.events.push({ type: 'chat', text: `Bots: ON (${want})` })
      } else if (arg === 'off') {
        this.botsEnabled = false
        for (const [id, q] of [...this.players]) if (q.isBot) this.players.delete(id)
        this.events.push({ type: 'chat', text: 'Bots: OFF' })
      } else {
        this.events.push({ type: 'chat', text: 'Usage: /bot on [count] | /bot off' })
      }
      return
    }
    this.events.push({ type: 'chat', text: `Unknown command: ${cmd}` })
  }
}
