import http from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Game } from './src/game.js'
import sky from './src/maps/sky.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const statsPath = path.join(root, 'data', 'stats.json')
const validName = /^[A-Za-z][A-Za-z0-9_]{0,15}$/
const serverNames = ['Apple Arena', 'Mango Mayhem', 'Berry Brawl']
let stats = {}
try { stats = JSON.parse(await readFile(statsPath, 'utf8')) } catch { /* created on first save */ }

const blankStats = () => ({ kills: 0, deaths: 0, maxKillStreak: 0, deathStreak: 0, pearlsThrown: 0, blocksPlaced: 0 })
const playerStats = (name) => (stats[name.toLowerCase()] ??= blankStats())
let saveTimer
const saveStats = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await mkdir(path.dirname(statsPath), { recursive: true })
    await writeFile(statsPath, JSON.stringify(stats, null, 2))
  }, 250)
}

const maps = serverNames.map((name, index) => ({ id: `fruit-${index}`, name, game: new Game({ ...sky, name }) }))
const clients = new Map()
const publicStats = (name) => playerStats(name)
const serialize = (game) => ({
  time: game.time,
  // The base map is generated identically on every client.  Only transmit
  // temporary player placements, which keeps snapshots small while making
  // placed blocks visible and collidable everywhere.
  blocks: [...game.placed.keys()].map((key) => {
    const [x, y, z] = key.split(',').map(Number)
    return { x, y, z, id: game.world.get(x, y, z) }
  }),
  plates: game.plates.map((plate, id) => ({ ...plate, id: `plate-${id}` })),
  arrows: game.arrows.map((arrow, id) => ({ ...arrow, id: `arrow-${id}` })),
  pearls: game.pearls.map((pearl, id) => ({ ...pearl, id: `pearl-${id}` })),
  players: [...game.players.values()].map((p) => ({
    id: p.id, name: p.name, pos: p.pos, prev: p.prev, vel: p.vel, yaw: p.yaw, pitch: p.pitch,
    prevYaw: p.prevYaw, prevPitch: p.prevPitch, alive: p.alive, sneaking: p.sneaking,
    sprinting: p.sprinting, slot: p.slot, pearls: p.pearls, arrows: p.arrows, kills: p.kills,
    deaths: p.deaths, hurtAnim: p.hurtAnim, swingTick: p.swingTick, onGround: p.onGround, stats: p.stats
  })),
  events: game.events
})
const send = (ws, message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(message))
const list = () => maps.map(({ id, name, game }) => ({ id, name, players: game.players.size }))

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' }
const app = http.createServer((req, res) => {
  let file = path.join(root, 'dist', req.url === '/' ? 'index.html' : decodeURIComponent(req.url).split('?')[0])
  if (!file.startsWith(path.join(root, 'dist'))) return res.writeHead(403).end()
  if (!existsSync(file)) file = path.join(root, 'dist', 'index.html')
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
const wss = new WebSocketServer({ server: app, path: '/ws' })
wss.on('connection', (ws) => {
  send(ws, { type: 'servers', servers: list() })
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw) } catch { return }
    const session = clients.get(ws)
    if (m.type === 'list') return send(ws, { type: 'servers', servers: list(), stats: m.name && validName.test(m.name) ? publicStats(m.name) : null })
    if (m.type === 'join') {
      if (!validName.test(m.name || '')) return send(ws, { type: 'error', message: 'Name must start with a letter and use only letters, numbers, or _.' })
      const map = maps.find((entry) => entry.id === m.server)
      if (!map) return send(ws, { type: 'error', message: 'That server is unavailable.' })
      if ([...map.game.players.values()].some((p) => p.name.toLowerCase() === m.name.toLowerCase())) return send(ws, { type: 'error', message: 'That name is already playing on this server. Use another name.' })
      if (session) session.map.game.removePlayer(session.player.id)
      const player = map.game.addPlayer(m.name)
      player.stats = playerStats(m.name)
      player.kills = player.stats.kills
      player.deaths = player.stats.deaths
      player.deathStreak = player.stats.deathStreak
      clients.set(ws, { map, player })
      return send(ws, { type: 'joined', server: map.id, playerId: player.id, stats: player.stats })
    }
    if (!session) return
    const p = session.player
    if (m.type === 'input') {
      p.input.fwd = Math.max(-1, Math.min(1, Number(m.fwd) || 0))
      p.input.strafe = Math.max(-1, Math.min(1, Number(m.strafe) || 0))
      p.input.jump = !!m.jump; p.input.sneak = !!m.sneak
      p.yaw = Number.isFinite(m.yaw) ? m.yaw : p.yaw
      p.pitch = Number.isFinite(m.pitch) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.pitch)) : p.pitch
      if (Number.isInteger(m.slot) && m.slot >= 0 && m.slot < 9) session.map.game.setSlot(p, m.slot)
      if (m.sprint) p.act.sprintTap = true
    }
    if (m.type === 'action') {
      if (Number.isFinite(m.yaw)) p.yaw = m.yaw
      if (Number.isFinite(m.pitch)) p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.pitch))
      if (m.target && Number.isInteger(m.target.x) && Number.isInteger(m.target.y) && Number.isInteger(m.target.z)) p.actionTarget = m.target
      else p.actionTarget = null
      if (m.attack) p.act.attack = true
      p.act.useHeld = !!m.useHeld
    }
    if (m.type === 'chat' && typeof m.text === 'string') session.map.game.command(m.text.slice(0, 100))
  })
  ws.on('close', () => { const s = clients.get(ws); if (s) s.map.game.removePlayer(s.player.id); clients.delete(ws) })
})

setInterval(() => {
  for (const { game } of maps) {
    game.update()
    for (const p of game.players.values()) {
      if (!p.stats) continue
      Object.assign(p.stats, { kills: p.kills, deaths: p.deaths })
      p.stats.maxKillStreak = Math.max(p.stats.maxKillStreak, p.killStreak)
      p.stats.deathStreak = p.deathStreak
    }
    const snapshot = serialize(game)
    for (const [ws, s] of clients) if (s.map.game === game) send(ws, { type: 'snapshot', ...snapshot, stats: s.player.stats })
    game.events.length = 0
  }
  saveStats()
}, 50)

app.listen(process.env.PORT || 3000, () => console.log('KBFFA multiplayer server listening on http://localhost:3000'))
