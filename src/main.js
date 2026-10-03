import * as THREE from 'three'
import { CONFIG as C } from './config.js'
import { ID } from './blocks.js'
import { loadTextures, buildAtlas, img, makeTexture } from './textures.js'
import { Game } from './game.js'
import sky from './maps/sky.js'
import { buildChunk, blockCubeGeometry } from './mesher.js'
import { extrudeSprite, buildPlayerModel, buildFirstPersonArm, vertexMaterial } from './models.js'
import { Hud, maxGuiScale } from './hud.js'
import { raycastBlocks } from './raycast.js'
import { overlapsSolid, playerBox } from './physics.js'
import { settings, saveSettings, resetSettings, DEFAULT_KEYBINDS, ACTION_LABELS, keyLabel, CHAT_POSITIONS } from './settings.js'
import { setPixelText, makeBitmapTextCanvas } from './bitmapfont.js'
import { playSound } from './sounds.js'

const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

async function main() {
  await loadTextures()
  const atlas = buildAtlas()
  const game = new Game(sky)
  const local = game.addPlayer('Player')
  for (let i = 0; i < C.BOTS; i++) game.addPlayer(`Bot${i + 1}`, true)
  const world = game.world

  const canvas = document.getElementById('c')
  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) playSound('ui_click', { volume: 0.35 })
  })
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  // Mip levels remove distant pixel shimmer; anisotropy keeps those mips
  // stable across ground surfaces viewed at a shallow angle.
  atlas.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  const scene = new THREE.Scene()
  scene.background = new THREE.Color().setRGB(0.47, 0.65, 1.0, THREE.SRGBColorSpace)
  const camera = new THREE.PerspectiveCamera(C.FOV, 1, 0.05, 600)
  camera.rotation.order = 'YXZ'
  scene.add(camera)
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  const hud = new Hud(document.getElementById('hud'))
  hud.setHotbarSwapHandler((a, b) => {
    ;[C.HOTBAR[a], C.HOTBAR[b]] = [C.HOTBAR[b], C.HOTBAR[a]]
    hud.refreshHotbar()
    playSound('ui_click', { volume: 0.35 })
  })
  // The grass side overlay contains transparent pixels.  Discard them so its
  // grayscale RGB data never covers the dirt layer below it.
  const chunkMat = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 })
  const chunks = new Map()
  const syncChunks = () => {
    if (!world.dirty.size) return
    for (const k of world.dirty) {
      const old = chunks.get(k)
      if (old) {
        scene.remove(old)
        old.geometry.dispose()
        chunks.delete(k)
      }
      const [cx, cy, cz] = k.split(',').map(Number)
      if (cx < 0 || cy < 0 || cz < 0) continue
      const g = buildChunk(world, atlas, cx, cy, cz)
      if (g) {
        const m = new THREE.Mesh(g, chunkMat)
        scene.add(m)
        chunks.set(k, m)
      }
    }
    world.dirty.clear()
  }

  const plateGeo = new THREE.BoxGeometry(0.875, 0.0625, 0.875)
  const plateMat = new THREE.MeshBasicMaterial({ map: makeTexture('blocks', 'gold_block') })
  const plateMeshes = new Map()
  const syncPlates = () => {
    for (const pl of game.plates) {
      if (plateMeshes.has(pl)) continue
      const m = new THREE.Mesh(plateGeo, plateMat)
      m.position.set(pl.x + 0.5, pl.y + 0.03125, pl.z + 0.5)
      scene.add(m)
      plateMeshes.set(pl, m)
    }
    for (const [pl, m] of plateMeshes) {
      if (!game.plates.includes(pl)) {
        scene.remove(m)
        plateMeshes.delete(pl)
      }
    }
  }

  const spriteMat = vertexMaterial()
  const arrowGeo = extrudeSprite(img('items', 'arrow'))
  const pearlTex = makeTexture('items', 'ender_pearl')
  const projMeshes = new Map()
  const syncProjectiles = (alpha) => {
    const live = new Set([...game.arrows, ...game.pearls])
    for (const [p, m] of projMeshes) {
      if (!live.has(p)) {
        scene.remove(m)
        projMeshes.delete(p)
      }
    }
    for (const a of game.arrows) {
      let m = projMeshes.get(a)
      if (!m) {
        m = new THREE.Group()
        const inner = new THREE.Mesh(arrowGeo, spriteMat)
        inner.rotation.z = -Math.PI / 4
        inner.scale.setScalar(0.9)
        m.add(inner)
        scene.add(m)
        projMeshes.set(a, m)
      }
      m.position.set(lerp(a.prev.x, a.pos.x, alpha), lerp(a.prev.y, a.pos.y, alpha), lerp(a.prev.z, a.pos.z, alpha))
      // The Rust server's snapshot has no `dir` field (the Node server and
      // offline Game do). Derive it from velocity; stuck arrows have zero
      // velocity, so keep the last known direction on the entity (entity
      // identity is preserved across snapshots by syncEntities).
      const vs = Math.hypot(a.vel.x, a.vel.y, a.vel.z)
      if (vs > 1e-6) a.dir = { x: a.vel.x / vs, y: a.vel.y / vs, z: a.vel.z / vs }
      else if (!a.dir) a.dir = { x: 1, y: 0, z: 0 }
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(a.dir.x, a.dir.y, a.dir.z))
    }
    for (const p of game.pearls) {
      let m = projMeshes.get(p)
      if (!m) {
        m = new THREE.Sprite(new THREE.SpriteMaterial({ map: pearlTex }))
        m.scale.setScalar(0.3)
        scene.add(m)
        projMeshes.set(p, m)
      }
      m.position.set(lerp(p.prev.x, p.pos.x, alpha), lerp(p.prev.y, p.pos.y, alpha), lerp(p.prev.z, p.pos.z, alpha))
    }
  }

  const skin = makeTexture('entity', 'steve')
  const models = new Map()
  const makeNameSprite = (name) => {
    const cvs = makeBitmapTextCanvas(name, 2, '#ffffff')
    const tex = new THREE.CanvasTexture(cvs)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, sizeAttenuation: true })
    const sprite = new THREE.Sprite(mat)
    const scale = 0.025
    sprite.scale.set(cvs.width * scale, cvs.height * scale, 1)
    sprite.renderOrder = 999
    return sprite
  }
  const syncPlayers = (alpha, dt) => {
    for (const [id, m] of models) {
      if (!game.players.has(id)) {
        scene.remove(m.group)
        models.delete(id)
      }
    }
    for (const p of game.players.values()) {
      if (p === local) continue
      let m = models.get(p.id)
      if (!m) {
        m = buildPlayerModel(skin)
        scene.add(m.group)
        models.set(p.id, m)
        m.lx = p.pos.x
        m.lz = p.pos.z
        m.nameTag = makeNameSprite(p.name)
        m.nameTagText = p.name
        m.nameTag.position.y = 2.35
        m.group.add(m.nameTag)
      }
      if (m.nameTagText !== p.name) {
        m.group.remove(m.nameTag)
        m.nameTag = makeNameSprite(p.name)
        m.nameTagText = p.name
        m.nameTag.position.y = 2.35
        m.group.add(m.nameTag)
      }
      m.group.visible = p.alive
      const x = lerp(p.prev.x, p.pos.x, alpha)
      const y = lerp(p.prev.y, p.pos.y, alpha)
      const z = lerp(p.prev.z, p.pos.z, alpha)
      m.group.position.set(x, y, z)
      m.group.rotation.y = -lerpAngle(p.prevYaw, p.yaw, alpha)
      m.head.rotation.x = lerp(p.prevPitch, p.pitch, alpha)
      const speed = Math.hypot(x - m.lx, z - m.lz) / Math.max(dt, 0.001)
      m.lx = x
      m.lz = z
      m.amp += (Math.min(speed / 5, 1) - m.amp) * 0.3
      m.walk += speed * dt * 2.4
      const sw = Math.sin(m.walk) * m.amp
      // Reset the pose before applying animation.  These are the vanilla
      // HumanoidModel crouch transforms, converted from its downward-Y model
      // space to this renderer's upward-Y coordinate system.
      const s = m.scale
      m.head.position.y = 24 * s
      m.body.position.y = 24 * s
      m.armR.position.y = 22 * s
      m.armL.position.y = 22 * s
      m.legR.position.z = 0
      m.legL.position.z = 0
      m.armR.position.x = -6 * s
      m.armL.position.x = 6 * s
      m.body.rotation.x = 0
      m.body.rotation.y = 0
      m.armR.rotation.y = m.armL.rotation.y = 0
      m.armR.rotation.z = m.armL.rotation.z = 0
      m.legR.rotation.x = sw
      m.legL.rotation.x = -sw
      m.armR.rotation.x = -sw * 0.8
      m.armL.rotation.x = sw * 0.8
      if (p.sneaking) {
        m.body.rotation.x = 0.5
        m.armR.rotation.x += 0.4
        m.armL.rotation.x += 0.4
        m.legR.position.z = 4 * s
        m.legL.position.z = 4 * s
        m.head.position.y -= 4.2 * s
        m.body.position.y -= 3.2 * s
        m.armR.position.y -= 3.2 * s
        m.armL.position.y -= 3.2 * s
      }
      // Port of HumanoidModel.setupAttackAnimation's normal "whack" pose.
      // Attack time is replicated by the server, so every observer sees the
      // same torso turn and right-arm swing.
      const attackTime = Math.max(0, Math.min(1, (game.time + alpha - p.swingTick) / 6))
      if (attackTime > 0 && attackTime < 1) {
        const bodyYaw = Math.sin(Math.sqrt(attackTime) * Math.PI * 2) * 0.2
        m.body.rotation.y = bodyYaw
        m.armR.position.z = Math.sin(bodyYaw) * 5 * s
        m.armR.position.x = -6 * s - Math.cos(bodyYaw) * 5 * s
        m.armL.position.z = -Math.sin(bodyYaw) * 5 * s
        m.armL.position.x = 6 * s + Math.cos(bodyYaw) * 5 * s
        m.armR.rotation.y += bodyYaw * 2
        m.armL.rotation.y += bodyYaw
        const swing = 1 - Math.pow(1 - attackTime, 4)
        const aa = Math.sin(swing * Math.PI)
        const bb = Math.sin(attackTime * Math.PI) * -(m.head.rotation.x - 0.7) * 0.75
        m.armR.rotation.x -= aa * 1.2 + bb
        m.armR.rotation.z -= Math.sin(attackTime * Math.PI) * 0.4
      }
      m.mat.color.setHex(p.hurtAnim > 0 ? 0xff7070 : 0xffffff)
    }
  }

  const D2R = Math.PI / 180
  const M4 = THREE.Matrix4
  const mt = (x, y, z) => new M4().makeTranslation(x, y, z)
  const mrx = (d) => new M4().makeRotationX(d * D2R)
  const mry = (d) => new M4().makeRotationY(d * D2R)
  const mrz = (d) => new M4().makeRotationZ(d * D2R)
  const msc = (x, y, z) => new M4().makeScale(x, y, z)
  const chain = (...ms) => ms.reduce((a, b) => a.multiply(b), new M4())
  const display = (t, r, s) => chain(mt(t[0] / 16, t[1] / 16, t[2] / 16), mrx(r[0]), mry(r[1]), mrz(r[2]), msc(s, s, s))

  const hand = new THREE.Group()
  hand.matrixAutoUpdate = false
  camera.add(hand)
  const arm = buildFirstPersonArm(skin)
  arm.matrixAutoUpdate = false
  hand.add(arm)
  const itemRig = new THREE.Group()
  itemRig.matrixAutoUpdate = false
  hand.add(itemRig)
  const held = {}
  const addHeld = (key, obj, m) => {
    obj.matrixAutoUpdate = false
    obj.matrix.copy(m)
    const g = new THREE.Group()
    g.add(obj)
    g.visible = false
    itemRig.add(g)
    held[key] = g
  }
  const tool = (name) => new THREE.Mesh(extrudeSprite(img('items', name)), spriteMat)
  const spriteDisplay = display([1.13, 3.2, 1.13], [0, -90, 0], 0.98)
  // Keep the stick prominent in the lower-right hand pose, comparable to
  // Minecraft's large first-person held-item presentation.
  const stickDisplay = display([1.13, 3.2, 1.13], [0, -90, 0], 0.9)
  addHeld('stick', tool('stick'), stickDisplay)
  addHeld('bow-1', tool('bow_standby'), spriteDisplay)
  for (let i = 0; i < 3; i++) addHeld(`bow${i}`, tool(`bow_pulling_${i}`), spriteDisplay)
  addHeld('pearl', tool('ender_pearl'), spriteDisplay)
  addHeld('plate', tool('gold_pressure_plate'), spriteDisplay)
  const blockDef = C.HOTBAR.find((s) => s.type === 'block')
  const cube = new THREE.Mesh(blockCubeGeometry(atlas, ID[blockDef.block]), chunkMat)
  addHeld('block', cube, display([0, 0, 0], [0, 45, 0], 0.4))

  const armModel = chain(mt(-5 / 16, 2 / 16, 0), new M4().makeRotationZ(0.1), mrx(180), mt(0, 2 / 16, 0), msc(2 / 1.8, 2 / 1.8, 2 / 1.8))
  const handState = { tick: 0, h: 1, oh: 1, shown: undefined, bob: 0, oBob: 0, walk: 0, oWalk: 0, xb: 0, oxb: 0, yb: 0, oyb: 0, init: false }
  const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180
  const handKey = () => {
    if (!local.alive) return null
    const def = C.HOTBAR[local.slot]
    if (!def) return 'empty'
    // Out of pearls: show an empty hand instead of a pearl.
    if (def.type === 'pearl' && (local.pearls ?? 0) <= 0) return 'empty'
    if (def.type === 'bow') {
      const bt = online ? visualBowTicks : local.bowTicks
      const f = bt / 20
      return 'bow' + (bt < 0 ? -1 : f >= 0.9 ? 2 : f > 0.65 ? 1 : 0)
    }
    return def.type
  }
  const handGroup = (k) => (k && k.startsWith('bow') ? 'bow' : k)
  const handTick = () => {
    const st = handState
    const next = handKey()
    const pitch = local.pitch / D2R
    const yaw = local.yaw / D2R
    if (!st.init) {
      st.init = true
      st.shown = next
      st.xb = pitch
      st.yb = yaw
    }
    st.oh = st.h
    st.oBob = st.bob
    st.oWalk = st.walk
    st.oxb = st.xb
    st.oyb = st.yb
    if (handGroup(st.shown) === handGroup(next)) st.shown = next
    const target = st.shown === next ? 1 : 0
    st.h += Math.max(-0.4, Math.min(0.4, target - st.h))
    if (st.h < 0.1) st.shown = next
    // Authoritative position changes arrive in network-sized steps.  They are
    // unsuitable for viewmodel bobbing and made held blocks look like they
    // were vibrating.
    const hd = online ? 0 : Math.hypot(local.pos.x - local.prev.x, local.pos.z - local.prev.z)
    st.bob += ((local.onGround && local.alive ? Math.min(0.1, hd) : 0) - st.bob) * 0.4
    st.walk += hd * 0.6
    st.xb += (pitch - st.xb) * 0.5
    st.yb += wrapDeg(yaw - st.yb) * 0.5
  }
  const updateHand = (alpha) => {
    const st = handState
    while (st.tick < clientAnimationTick) {
      st.tick++
      handTick()
    }
    const shown = local.alive && st.init ? st.shown : null
    for (const k in held) held[k].visible = k === shown
    // Occupied slots render only the large first-person item.  The arm is
    // reserved for an empty hand so it never overlaps a held item.
    arm.visible = shown === 'empty'
    itemRig.visible = shown !== null && shown !== 'empty'
    if (shown === null) return
    const pi = Math.PI
    // The vanilla first-person pose constants are authored for a 16:9 view.
    // Scale their horizontal offsets so the hand stays in frame on narrower
    // windows instead of disappearing beyond the right edge.
    const handX = (x) => x * camera.aspect / (16 / 9)
    // Sprint widens the world camera FOV.  Apply the inverse projection ratio
    // to the viewmodel so the hand remains attached at the same screen-space
    // point while the world FOV animates.
    const handScale = Math.tan(settings.fov * D2R / 2) / Math.tan(camera.fov * D2R / 2)
    const invH = 1 - lerp(st.oh, st.h, alpha)
    const bd = -lerp(st.oWalk, st.walk, alpha)
    const bob = lerp(st.oBob, st.bob, alpha)
    const m = chain(
      mt(Math.sin(bd * pi) * bob * 0.5, -Math.abs(Math.cos(bd * pi) * bob), 0),
      mrz(Math.sin(bd * pi) * bob * 3),
      mrx(Math.abs(Math.cos(bd * pi - 0.2) * bob) * 5),
      mrx(((local.pitch / D2R) - lerp(st.oxb, st.xb, alpha)) * 0.1),
      mry(wrapDeg(local.yaw / D2R - lerp(st.oyb, st.yb, alpha)) * 0.1),
      msc(handScale, handScale, handScale)
    )
    const s = (clientAnimationTick + alpha - local.swingTick) / 6
    const a = s >= 0 && s < 1 ? s : 0
    const sq = Math.sqrt(a)
    // The arm uses its own first-person pose while the item has an additional
    // item-specific transform.  Build this pose for every live hand state;
    // previously it was only assigned for an empty slot, leaving a visible arm
    // at the camera origin whenever an item was selected.
    const armM = m.clone()
    armM.multiply(mt(handX(-0.3 * Math.sin(sq * pi) + 0.64000005), 0.4 * Math.sin(sq * pi * 2) - 0.6 + invH * -0.6, -0.4 * Math.sin(a * pi) - 0.71999997))
    armM.multiply(mry(45)).multiply(mry(Math.sin(sq * pi) * 70)).multiply(mrz(Math.sin(a * a * pi) * -20))
    armM.multiply(mt(-1, 3.6, 3.5)).multiply(mrz(120)).multiply(mrx(200)).multiply(mry(-135)).multiply(mt(5.6, 0, 0))
    arm.matrix.copy(armM.multiply(armModel))
    arm.matrixWorldNeedsUpdate = true
    if (shown === 'empty') {
      return
    }
    // Item and arm share the same bob/FOV base pose.  Put the standard
    // display origin into the palm (rather than above the knuckles); this is
    // especially noticeable with the slim stick sprite.
    // Keep long tools at the lower-right edge; their tall sprites otherwise
    // read as centred even when smaller item types are correctly placed.
    const isLongHeldItem = shown === 'stick' || handGroup(shown) === 'bow'
    const lowerHeldItem = isLongHeldItem || shown === 'pearl'
    const itemY = (shown === 'stick' ? -0.55 : -0.44) + (lowerHeldItem ? -0.18 : 0) + invH * -0.6
    // Block sits a little further left than other items; the stick is pushed
    // forward (away from the camera) so its whole length reads clearly.
    const itemX = isLongHeldItem ? 1.15 : shown === 'block' ? 0.52 : 0.4
    m.multiply(mt(handX(itemX), itemY, shown === 'stick' ? -0.86 : -0.72))
    // Lean the tip of long tools (stick, bow) forward so it is not cut off by
    // the top of the screen.
    if (isLongHeldItem) m.multiply(mrx(-20))
    const bt = online ? visualBowTicks : local.bowTicks
    if (handGroup(shown) === 'bow' && bt >= 0) {
      const th = bt + alpha
      let p = th / 20
      p = Math.min(1, (p * p + p * 2) / 3)
      m.multiply(mt(-0.2785682, 0.18344387, 0.15731531)).multiply(mrx(-13.935)).multiply(mry(35.3)).multiply(mrz(-9.785))
      if (p > 0.1) m.multiply(mt(0, Math.sin((th - 0.1) * 1.3) * (p - 0.1) * 0.004, 0))
      m.multiply(mt(0, 0, p * 0.04)).multiply(msc(1, 1, 1 + p * 0.2)).multiply(mry(-45))
    } else {
      m.multiply(mt(handX(-0.4 * Math.sin(sq * pi)), 0.2 * Math.sin(sq * pi * 2), -0.2 * Math.sin(a * pi)))
      m.multiply(mry(45 + Math.sin(a * a * pi) * -20)).multiply(mrz(Math.sin(sq * pi) * -20)).multiply(mrx(Math.sin(sq * pi) * -80)).multiply(mry(-45))
    }
    itemRig.matrix.copy(m)
    itemRig.matrixWorldNeedsUpdate = true
  }

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  )
  outline.visible = false
  scene.add(outline)

  const menu = document.getElementById('menu')
  const pauseBlur = document.getElementById('pauseBlur')
  const pause = document.getElementById('pause')
  const options = document.getElementById('options')
  const controls = document.getElementById('controls')
  const stats = document.getElementById('stats')
  const chatSettings = document.getElementById('chatSettings')
  const btnResume = document.getElementById('btnResume')
  const btnBackToServerList = document.getElementById('btnBackToServerList')
  const btnStats = document.getElementById('btnStats')
  const btnStatsDone = document.getElementById('btnStatsDone')
  const btnStatsOnline = document.getElementById('btnStatsOnline')
  const btnStatsOffline = document.getElementById('btnStatsOffline')
  const btnStatsAll = document.getElementById('btnStatsAll')
  const btnStatsSort = document.getElementById('btnStatsSort')
  const statsList = document.getElementById('statsList')
  const btnOptions = document.getElementById('btnOptions')
  const btnOptionsDone = document.getElementById('btnOptionsDone')
  const btnControls = document.getElementById('btnControls')
  const btnControlsDone = document.getElementById('btnControlsDone')
  const btnResetSettings = document.getElementById('btnResetSettings')
  const btnToggleSprint = document.getElementById('btnToggleSprint')
  const btnGuiScale = document.getElementById('btnGuiScale')
  const sldSens = document.getElementById('sldSens')
  const sldFov = document.getElementById('sldFov')
  const sldVolume = document.getElementById('sldVolume')
  const btnChatSettingsOpen = document.getElementById('btnChatSettingsOpen')
  const btnChatSettingsDone = document.getElementById('btnChatSettingsDone')
  const btnChatTL = document.getElementById('btnChatTL')
  const btnChatTR = document.getElementById('btnChatTR')
  const btnChatBL = document.getElementById('btnChatBL')
  const btnChatBR = document.getElementById('btnChatBR')
  const sldChatLen = document.getElementById('sldChatLen')
  const sldChatOpacity = document.getElementById('sldChatOpacity')
  const controlsList = document.getElementById('controlsList')
  const chatWrap = document.getElementById('chatWrap')
  const chatLog = document.getElementById('chatLog')
  const chatInput = document.getElementById('chatInput')

  // Render all static menu text with Minecraft's own bitmap font (the same
  // ascii.png glyph atlas the game already uses for the HUD) instead of a
  // browser font, so the menus read like the real game.
  document.querySelectorAll('.mc-title').forEach((el) => setPixelText(el, el.textContent.trim(), 3, '#ffffff'))
  document.querySelectorAll('.mc-btn').forEach((el) => setPixelText(el, el.textContent.trim(), 2, '#e0e0e0'))
  document.querySelectorAll('.mc-label').forEach((el) => setPixelText(el, el.textContent.trim(), 2, '#d8d8d8'))
  document.querySelectorAll('.mc-stats-col-name, .mc-stats-col').forEach((el) => setPixelText(el, el.textContent.trim(), 2, '#ffffa0'))
  let locked = false
  let invOpen = false
  let started = false
  let paused = false
  let chatOpen = false
  let suppressPause = false
  let rebindAction = null
  let allPlayerStats = []
  let statsFilter = 'online'
  const STATS_SORT_FIELDS = [
    { key: 'kills', label: 'Kills' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'maxKillStreak', label: 'Max Streak' },
    { key: 'deathStreak', label: 'Death Streak' },
    { key: 'pearlsThrown', label: 'Pearls Thrown' },
    { key: 'blocksPlaced', label: 'Blocks Placed' }
  ]
  let statsSortIndex = 0
  const keys = {}
  let lastW = 0
  let sprintToggled = false
  let wheelAcc = 0
  // One-shot: tell the server the player toggled sprint OFF. The server keeps
  // its own sprint state and otherwise only clears it on releasing forward,
  // sneaking or a wall hit, so it would keep moving at sprint speed while the
  // client predicts walking and the drift got snapped back (~1 block).
  let sprintStopPending = false
  let socket = null
  let online = false
  let selectedServer = null
  let clientAnimationTick = 0
  let visualBowTicks = -1
  const networkBlocks = new Map()
  let lastNetworkSnapshot = performance.now()
  let previousNetworkPlayers = new Map()

  const serverList = document.getElementById('serverList')
  const playerName = document.getElementById('playerName')
  const joinServer = document.getElementById('joinServer')
  const joinError = document.getElementById('joinError')
  const statsButton = document.getElementById('statsButton')
  const lobbyStats = document.getElementById('lobbyStats')
  const formatStats = (st) => st ? `Kills: ${st.kills}\nDeaths: ${st.deaths}\nMax kill streak: ${st.maxKillStreak}\nDeath streak: ${st.deathStreak}\nPearls thrown: ${st.pearlsThrown}\nBlocks placed: ${st.blocksPlaced}` : ''
  const drawServers = (servers) => {
    serverList.replaceChildren()
    for (const server of servers) {
      const row = document.createElement('div')
      row.className = 'server-entry' + (selectedServer === server.id ? ' selected' : '')
      row.innerHTML = `<strong>${server.name}</strong><span>${server.players} player${server.players === 1 ? '' : 's'}</span>`
      row.addEventListener('click', () => { selectedServer = server.id; drawServers(servers) })
      serverList.appendChild(row)
    }
    if (!selectedServer && servers[0]) { selectedServer = servers[0].id; drawServers(servers) }
  }
  // Recent locally-predicted positions (one per client tick). The server's
  // snapshot is always a few ticks old, so the right question for
  // reconciliation is "is the server position on the path I predicted?",
  // not "is it near where I am right now?" - the latter grows with
  // speed x latency (0.6 blocks/tick while bunny hopping) and caused a snap
  // back every snapshot.
  const predHistory = []
  const PRED_HISTORY_TICKS = 20
  // When a server correction moves the local player, the camera glides from the
  // old position to the new one instead of jumping, which removes the visible
  // lagback/stutter on small corrections.
  const camOffset = { x: 0, y: 0, z: 0 }
  const addCamOffset = (from, to) => {
    const dx = from.x - to.x
    const dy = from.y - to.y
    const dz = from.z - to.z
    if (Math.hypot(dx, dy, dz) > 3) {
      camOffset.x = camOffset.y = camOffset.z = 0
      return
    }
    camOffset.x += dx
    camOffset.y += dy
    camOffset.z += dz
  }
  const distToPath = (pt, path) => {
    let best = Infinity
    for (let i = 0; i < path.length; i++) {
      const a = path[i]
      const b = path[i + 1] || a
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
      const len2 = abx * abx + aby * aby + abz * abz
      let t = len2 > 1e-12 ? ((pt.x - a.x) * abx + (pt.y - a.y) * aby + (pt.z - a.z) * abz) / len2 : 0
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(pt.x - (a.x + abx * t), pt.y - (a.y + aby * t), pt.z - (a.z + abz * t))
      if (d < best) best = d
    }
    return best
  }
  // Client-side block placement prediction. The authoritative placement only
  // reaches the client one network round trip later; until then the local
  // player kept falling through the gap while the server had already put a
  // block under them, so every bridging step ended in a snap-back ("lagback").
  // Placing the block locally right away keeps both simulations identical.
  // Blocks the server never confirms are rolled back after a short grace.
  const predictedBlocks = new Map()
  const PREDICTED_BLOCK_GRACE_MS = 750
  const predictPlace = () => {
    if (!online || !local.alive || C.HOTBAR[local.slot]?.type !== 'block' || local.useDelay > 0) return
    local.useDelay = 4
    const e = local.eye()
    const d = local.look()
    const h = raycastBlocks(world, e.x, e.y, e.z, d.x, d.y, d.z, C.REACH_BLOCK)
    if (!h) return
    const x = h.x + h.nx
    const y = h.y + h.ny
    const z = h.z + h.nz
    if (!game.canPlace(x, y, z) || game.isSpawnProtected({ x: x + 0.5, y, z: z + 0.5 })) return
    world.set(x, y, z, ID[C.PLACE_BLOCK])
    predictedBlocks.set(`${x},${y},${z}`, performance.now())
    local.swingTick = clientAnimationTick
  }
  const reconcilePredictedBlocks = (confirmed) => {
    const now = performance.now()
    for (const [key, at] of predictedBlocks) {
      if (confirmed.has(key)) predictedBlocks.delete(key)
      else if (now - at > PREDICTED_BLOCK_GRACE_MS) {
        predictedBlocks.delete(key)
        const [x, y, z] = key.split(',').map(Number)
        world.set(x, y, z, 0)
      }
    }
  }
  const syncSnapshot = (snapshot) => {
    const receivedAt = performance.now()
    const seen = new Set()
    const oldPlayers = previousNetworkPlayers
    previousNetworkPlayers = new Map(snapshot.players.map((state) => [state.id, state]))
    let authoritativeLocalPos = null
    let authoritativeLocalVel = null
    for (const state of snapshot.players) {
      let p = game.players.get(state.id)
      if (!p && state.id === local.id) p = local
      if (!p) {
        p = game.addPlayer(state.name)
        game.players.delete(p.id)
        p.id = state.id
        game.players.set(p.id, p)
      }
      seen.add(p.id)
      p.name = state.name
      // Interpolate non-local players from their previous received state. The
      // server tick's `prev` is not suitable here because it is only 50 ms
      // behind its `pos` and arrives irregularly over the network.
      const prior = oldPlayers.get(state.id)
      if (p !== local) {
        Object.assign(p.pos, state.pos)
        Object.assign(p.prev, prior?.pos || state.pos)
        Object.assign(p.vel, state.vel)
      }
      // Mouse look is predicted locally.  Applying its round-trip snapshot
      // would pull the view back every server tick and makes turning vibrate.
      if (p === local) {
        // Minecraft predicts its own movement, looking, sprinting and arm
        // swing locally.  Never replay ordinary server snapshots over those
        // values: doing so turns each 20 Hz packet into a visible shake.
        // The server still owns inventory/result state and can issue a hard
        const wasAlive = p.alive
        if (Number.isFinite(state.pingAt)) p.ping = Math.max(0, performance.now() - state.pingAt)
        const { pos, prev, vel, yaw, pitch, prevYaw, prevPitch, input, act, swingTick, onGround, sneaking, sprinting, slot, ...serverState } = state
        authoritativeLocalPos = pos
        authoritativeLocalVel = vel
        Object.assign(p, serverState)
        // A small tolerance avoids visible jitter from ordinary network
        // jitter/ping, but must stay well under one block: the old 3-block
        // threshold let a client's prediction drift through a wall and keep
        // that position indefinitely, since anything under 3 was never
        // corrected. 0.35 is comfortably inside normal per-tick movement
        // while still forcing a snap back before a full block of drift.
        const correction = predHistory.length ? distToPath(pos, predHistory) : Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z)
        if ((!wasAlive && state.alive) || correction > 0.35) {
          if (wasAlive) addCamOffset(p.pos, pos)
          Object.assign(p.pos, pos)
          Object.assign(p.prev, pos)
          Object.assign(p.vel, vel)
          predHistory.length = 0
          predHistory.push({ x: pos.x, y: pos.y, z: pos.z })
        }
      } else Object.assign(p, state)
    }
    for (const [id, p] of game.players) if (p !== local && !seen.has(id)) game.removePlayer(id)
    game.time = snapshot.time
    lastNetworkSnapshot = receivedAt
    const nextBlocks = new Map(snapshot.blocks?.map((b) => [`${b.x},${b.y},${b.z}`, b]) || [])
    reconcilePredictedBlocks(nextBlocks)
    for (const [key, block] of networkBlocks) {
      if (!nextBlocks.has(key)) game.world.set(block.x, block.y, block.z, 0)
    }
    for (const [key, block] of nextBlocks) {
      if (!networkBlocks.has(key) || networkBlocks.get(key).id !== block.id) game.world.set(block.x, block.y, block.z, block.id)
    }
    networkBlocks.clear()
    for (const [key, block] of nextBlocks) networkBlocks.set(key, block)
    // A placement can arrive while the locally predicted player is moving
    // into that exact block. The server has already resolved the same move
    // against the new block, so its position is the authoritative safe
    // position. Reconcile to that position instead of pushing the player
    // upward one step at a time (which caused the old floor/air teleport).
    if (local.alive && authoritativeLocalPos && overlapsSolid(world, playerBox(local.pos))) {
      addCamOffset(local.pos, authoritativeLocalPos)
      Object.assign(local.pos, authoritativeLocalPos)
      Object.assign(local.prev, authoritativeLocalPos)
      if (authoritativeLocalVel) Object.assign(local.vel, authoritativeLocalVel)
    }
    // Preserve client-side object identity while refreshing server-owned
    // plates and projectiles, so their render meshes do not flicker.
    const syncEntities = (target, states = []) => {
      const existing = new Map(target.map((entity) => [entity.id, entity]))
      target.length = 0
      for (const state of states) {
        const entity = existing.get(state.id) || {}
        Object.assign(entity, state)
        target.push(entity)
      }
    }
    syncEntities(game.plates, snapshot.plates)
    syncEntities(game.arrows, snapshot.arrows)
    syncEntities(game.pearls, snapshot.pearls)
    if (snapshot.events?.length) game.events.push(...snapshot.events)
    if (snapshot.stats) local.stats = snapshot.stats
  }
  const connect = () => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(`${protocol}//${location.host}/ws`)
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.type === 'servers') { drawServers(message.servers); if (message.stats) lobbyStats.textContent = formatStats(message.stats) }
      if (message.type === 'error') joinError.textContent = message.message
      if (message.type === 'joined') {
        game.players.delete(local.id); local.id = message.playerId; local.name = playerName.value.trim(); local.stats = message.stats; game.players.set(local.id, local)
        online = true; started = true; menu.style.display = 'none'; joinError.textContent = ''
      }
      if (message.type === 'snapshot') syncSnapshot(message)
      if (message.type === 'all_stats') { allPlayerStats = message.players || []; renderStatsList() }
    })
    socket.addEventListener('close', () => { if (!online) joinError.textContent = 'Could not reach the multiplayer server.' })
  }
  connect()
  joinServer.addEventListener('click', () => {
    const name = playerName.value.trim()
    if (!socket || socket.readyState !== WebSocket.OPEN) return (joinError.textContent = 'Connecting to server…')
    socket.send(JSON.stringify({ type: 'join', server: selectedServer, name }))
  })
  statsButton.addEventListener('click', () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'list', name: playerName.value.trim() }))
  })

  // Raw (unaccelerated) mouse input gives steadier mouse look; fall back to a
  // normal lock where the browser does not support it.
  const lockPointer = () => {
    try {
      const r = canvas.requestPointerLock({ unadjustedMovement: true })
      if (r && r.catch) r.catch(() => canvas.requestPointerLock())
    } catch {
      canvas.requestPointerLock()
    }
  }
  const setSlot = (n) => {
    game.setSlot(local, ((n % 9) + 9) % 9)
    if (online) socket?.send(JSON.stringify({ type: 'input', slot: local.slot }))
  }

  // Each visible line carries its own fade-out timer, like vanilla chat.
  // While the chat box is open for typing, those timers are cleared so the
  // whole history stays put; closeChat() restarts a fresh fade window.
  const chatLines = []
  const applyChatSettings = () => {
    chatWrap.classList.remove('chat-top-left', 'chat-top-right', 'chat-bottom-left', 'chat-bottom-right')
    chatWrap.classList.add('chat-' + settings.chatPosition)
    chatWrap.style.setProperty('--chat-opacity', Math.max(0, Math.min(100, settings.chatOpacity)) / 100)
    while (chatLines.length > settings.chatLength) {
      const old = chatLines.shift()
      clearTimeout(old.timer)
      old.el.remove()
    }
  }
  const scheduleFade = (line, delay) => {
    clearTimeout(line.timer)
    line.timer = setTimeout(() => {
      line.el.remove()
      const i = chatLines.indexOf(line)
      if (i !== -1) chatLines.splice(i, 1)
    }, delay)
  }
  const addChatLine = (text) => {
    const d = document.createElement('div')
    d.textContent = text
    chatLog.appendChild(d)
    const line = { el: d, timer: null }
    chatLines.push(line)
    while (chatLines.length > settings.chatLength) {
      const old = chatLines.shift()
      clearTimeout(old.timer)
      old.el.remove()
    }
    if (!chatOpen) scheduleFade(line, 10000)
  }

  const isPauseLayerOpen = () => paused || options.classList.contains('show') || controls.classList.contains('show') || stats.classList.contains('show') || chatSettings.classList.contains('show')
  const showPauseLayer = (el) => {
    pause.classList.remove('show')
    options.classList.remove('show')
    controls.classList.remove('show')
    stats.classList.remove('show')
    chatSettings.classList.remove('show')
    pauseBlur.classList.add('show')
    el.classList.add('show')
  }
  const hidePauseLayers = () => {
    pause.classList.remove('show')
    options.classList.remove('show')
    controls.classList.remove('show')
    stats.classList.remove('show')
    chatSettings.classList.remove('show')
    pauseBlur.classList.remove('show')
  }

  const openChat = () => {
    if (!started || isPauseLayerOpen()) return
    chatOpen = true
    suppressPause = true
    chatInput.value = ''
    chatInput.classList.add('show')
    // Keep the whole visible history on screen (no fading) while the
    // player is actively typing, like vanilla chat.
    for (const line of chatLines) clearTimeout(line.timer)
    document.exitPointerLock()
    requestAnimationFrame(() => chatInput.focus())
    local.act.breakHeld = false
    local.act.useHeld = false
  }
  const closeChat = (submit) => {
    if (submit && chatInput.value.trim()) {
      if (online) socket?.send(JSON.stringify({ type: 'chat', text: chatInput.value.trim() }))
      else game.command(chatInput.value.trim())
    }
    chatOpen = false
    chatInput.classList.remove('show')
    chatInput.blur()
    for (const line of chatLines) scheduleFade(line, 10000)
    if (started) startRelockPoll()
  }
  const closeInventory = () => {
    invOpen = false
    hud.toggleInventory(false)
    canvas.classList.remove('blurred')
    // Escape releases pointer lock as well.  Keep that browser event from
    // being interpreted as a request to open the pause menu.
    suppressPause = true
    startRelockPoll()
  }
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') closeChat(true)
    else if (e.key === 'Escape') closeChat(false)
  })

  const openPause = () => {
    if (!started || invOpen || chatOpen) return
    paused = true
    showPauseLayer(pause)
    document.exitPointerLock()
  }
  // Chrome (per the Pointer Lock spec) refuses to re-lock the pointer for
  // ~1s after the user exits it with Escape. Re-requesting during that
  // window is silently ignored - no 'pointerlockerror' event and no
  // 'pointerlockchange' event fire, so there is nothing to listen for.
  // Poll instead: keep retrying on a short interval until it actually
  // locks (or we no longer want it locked), which reliably catches the
  // moment the browser lifts the cooldown.
  let relockPoll = null
  const stopRelockPoll = () => {
    if (relockPoll) { clearInterval(relockPoll); relockPoll = null }
  }
  const tryRelock = () => {
    if (!started || paused || invOpen || chatOpen) { stopRelockPoll(); return }
    lockPointer()
    canvas.requestPointerLock()
  }
  const startRelockPoll = () => {
    stopRelockPoll()
    tryRelock()
    relockPoll = setInterval(tryRelock, 120)
    setTimeout(stopRelockPoll, 2000)
  }
  const closePause = () => {
    paused = false
    hidePauseLayers()
    suppressPause = true
    startRelockPoll()
  }
  btnResume.addEventListener('click', closePause)
  btnBackToServerList.addEventListener('click', () => {
    document.exitPointerLock()
    try { socket?.close() } catch {}
    location.reload()
  })

  const renderStatsList = () => {
    const sortField = STATS_SORT_FIELDS[statsSortIndex]
    setPixelText(btnStatsSort, 'Sort: ' + sortField.label, 2, '#e0e0e0')
    let rows = allPlayerStats
    if (statsFilter === 'online') rows = rows.filter((p) => p.online)
    else if (statsFilter === 'offline') rows = rows.filter((p) => !p.online)
    rows = [...rows].sort((a, b) => (b[sortField.key] || 0) - (a[sortField.key] || 0))
    statsList.innerHTML = ''
    if (!rows.length) {
      const empty = document.createElement('div')
      empty.className = 'mc-stats-empty'
      setPixelText(empty, 'No players to show', 2, '#aaaaaa')
      statsList.appendChild(empty)
      return
    }
    for (const p of rows) {
      const row = document.createElement('div')
      row.className = 'mc-stats-row'
      const name = document.createElement('span')
      name.className = 'mc-stats-col-name mc-stats-name'
      setPixelText(name, (p.online ? '* ' : '- ') + p.name, 2, p.online ? '#55ff55' : '#aaaaaa')
      row.appendChild(name)
      const values = [
        p.kills ?? 0,
        p.deaths ?? 0,
        `${p.maxKillStreak ?? 0}/${p.deathStreak ?? 0}`,
        p.pearlsThrown ?? 0,
        p.blocksPlaced ?? 0
      ]
      for (const value of values) {
        const cell = document.createElement('span')
        cell.className = 'mc-stats-col'
        setPixelText(cell, String(value), 2, '#ffffff')
        row.appendChild(cell)
      }
      statsList.appendChild(row)
    }
  }
  const setStatsFilter = (filter) => {
    statsFilter = filter
    btnStatsOnline.classList.toggle('mc-tab-active', filter === 'online')
    btnStatsOffline.classList.toggle('mc-tab-active', filter === 'offline')
    btnStatsAll.classList.toggle('mc-tab-active', filter === 'all')
    renderStatsList()
  }
  btnStatsOnline.addEventListener('click', () => setStatsFilter('online'))
  btnStatsOffline.addEventListener('click', () => setStatsFilter('offline'))
  btnStatsAll.addEventListener('click', () => setStatsFilter('all'))
  btnStatsSort.addEventListener('click', () => {
    statsSortIndex = (statsSortIndex + 1) % STATS_SORT_FIELDS.length
    renderStatsList()
  })
  btnStats.addEventListener('click', () => {
    setStatsFilter(statsFilter)
    showPauseLayer(stats)
    if (online && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'all_stats' }))
  })
  btnStatsDone.addEventListener('click', () => showPauseLayer(pause))

  const sensToDeg = (v) => 0.02 + (v / 100) * 0.6
  const refreshOptionsUI = () => {
    setPixelText(btnToggleSprint, 'Sprint: ' + (settings.toggleSprint ? 'Toggle' : 'Hold'), 2, '#e0e0e0')
    setPixelText(btnGuiScale, 'GUI Scale: ' + (settings.guiScale === 0 ? 'Auto' : settings.guiScale), 2, '#e0e0e0')
    sldSens.querySelector('.mc-slider-fill').style.width = settings.mouseSens + '%'
    setPixelText(sldSens.querySelector('.mc-slider-label'), 'Sensitivity: ' + settings.mouseSens + '%', 2, '#ffffff')
    const fovPct = ((settings.fov - 30) / (110 - 30)) * 100
    sldFov.querySelector('.mc-slider-fill').style.width = fovPct + '%'
    setPixelText(sldFov.querySelector('.mc-slider-label'), 'FOV: ' + settings.fov, 2, '#ffffff')
    sldVolume.querySelector('.mc-slider-fill').style.width = settings.masterVolume + '%'
    setPixelText(sldVolume.querySelector('.mc-slider-label'), 'Volume: ' + settings.masterVolume + '%', 2, '#ffffff')
  }
  // Cycles Auto -> 1 -> 2 ... up to the largest scale that fits the window.
  btnGuiScale.addEventListener('click', () => {
    const max = maxGuiScale()
    settings.guiScale = settings.guiScale >= max ? 0 : settings.guiScale + 1
    saveSettings()
    hud.resize()
    refreshOptionsUI()
  })
  btnToggleSprint.addEventListener('click', () => {
    settings.toggleSprint = !settings.toggleSprint
    saveSettings()
    refreshOptionsUI()
  })
  const bindSlider = (el, get, set, onChange = refreshOptionsUI) => {
    let dragging = false
    const apply = (clientX) => {
      const r = el.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      set(t)
      onChange()
    }
    el.addEventListener('mousedown', (e) => {
      dragging = true
      apply(e.clientX)
    })
    addEventListener('mousemove', (e) => {
      if (dragging) apply(e.clientX)
    })
    addEventListener('mouseup', () => {
      if (dragging) saveSettings()
      dragging = false
    })
  }
  bindSlider(
    sldSens,
    () => settings.mouseSens,
    (t) => (settings.mouseSens = Math.round(t * 200))
  )
  bindSlider(
    sldFov,
    () => settings.fov,
    (t) => (settings.fov = Math.round(30 + t * (110 - 30)))
  )
  bindSlider(
    sldVolume,
    () => settings.masterVolume,
    (t) => (settings.masterVolume = Math.round(t * 100))
  )

  const refreshChatSettingsUI = () => {
    btnChatTL.classList.toggle('mc-tab-active', settings.chatPosition === 'top-left')
    btnChatTR.classList.toggle('mc-tab-active', settings.chatPosition === 'top-right')
    btnChatBL.classList.toggle('mc-tab-active', settings.chatPosition === 'bottom-left')
    btnChatBR.classList.toggle('mc-tab-active', settings.chatPosition === 'bottom-right')
    sldChatLen.querySelector('.mc-slider-fill').style.width = ((settings.chatLength - 4) / (20 - 4)) * 100 + '%'
    setPixelText(sldChatLen.querySelector('.mc-slider-label'), 'Lines: ' + settings.chatLength, 2, '#ffffff')
    sldChatOpacity.querySelector('.mc-slider-fill').style.width = settings.chatOpacity + '%'
    setPixelText(sldChatOpacity.querySelector('.mc-slider-label'), 'Opacity: ' + settings.chatOpacity + '%', 2, '#ffffff')
    applyChatSettings()
  }
  const setChatPosition = (pos) => {
    settings.chatPosition = pos
    saveSettings()
    refreshChatSettingsUI()
  }
  btnChatTL.addEventListener('click', () => setChatPosition('top-left'))
  btnChatTR.addEventListener('click', () => setChatPosition('top-right'))
  btnChatBL.addEventListener('click', () => setChatPosition('bottom-left'))
  btnChatBR.addEventListener('click', () => setChatPosition('bottom-right'))
  bindSlider(
    sldChatLen,
    () => settings.chatLength,
    (t) => (settings.chatLength = Math.round(4 + t * (20 - 4))),
    refreshChatSettingsUI
  )
  bindSlider(
    sldChatOpacity,
    () => settings.chatOpacity,
    (t) => (settings.chatOpacity = Math.round(t * 100)),
    refreshChatSettingsUI
  )
  btnChatSettingsOpen.addEventListener('click', () => {
    refreshChatSettingsUI()
    showPauseLayer(chatSettings)
  })
  btnChatSettingsDone.addEventListener('click', () => showPauseLayer(options))
  applyChatSettings()

  btnOptions.addEventListener('click', () => {
    refreshOptionsUI()
    showPauseLayer(options)
  })
  btnOptionsDone.addEventListener('click', () => showPauseLayer(pause))
  btnResetSettings.addEventListener('click', () => {
    resetSettings()
    hud.resize()
    refreshOptionsUI()
    refreshChatSettingsUI()
    buildControlsList()
  })

  const buildControlsList = () => {
    controlsList.innerHTML = ''
    for (const action in ACTION_LABELS) {
      const row = document.createElement('div')
      row.className = 'ctrl-row'
      const label = document.createElement('span')
      label.className = 'ctrl-label'
      setPixelText(label, ACTION_LABELS[action], 2, '#d8d8d8')
      const key = document.createElement('button')
      key.className = 'ctrl-key'
      setPixelText(key, keyLabel(settings.keys[action]), 2, '#e0e0e0')
      key.addEventListener('click', () => {
        if (rebindAction) return
        rebindAction = action
        setPixelText(key, '> ' + keyLabel(settings.keys[action]) + ' <', 2, '#ffffa0')
        key.classList.add('listening')
      })
      row.appendChild(label)
      row.appendChild(key)
      controlsList.appendChild(row)
    }
  }
  buildControlsList()
  btnControls.addEventListener('click', () => showPauseLayer(controls))
  btnControlsDone.addEventListener('click', () => showPauseLayer(pause))

  addEventListener('keydown', (e) => {
    if (rebindAction) {
      e.preventDefault()
      if (e.code !== 'Escape') settings.keys[rebindAction] = e.code
      rebindAction = null
      saveSettings()
      buildControlsList()
      return
    }
    if (chatOpen) return
    if (e.code === 'Escape') {
      if (invOpen) {
        e.preventDefault()
        closeInventory()
      } else if (options.classList.contains('show')) {
        showPauseLayer(pause)
      } else if (controls.classList.contains('show')) {
        showPauseLayer(options)
      } else if (paused) {
        closePause()
      } else if (started) {
        openPause()
      }
      return
    }
    if (isPauseLayerOpen()) return
    if (started && !paused && !invOpen && !chatOpen && !locked) startRelockPoll()
    if (e.code === settings.keys.chat) {
      e.preventDefault()
      openChat()
      return
    }
    if (e.code === settings.keys.inventory) {
      if (invOpen) closeInventory()
      else {
        invOpen = true
        hud.toggleInventory(true)
        canvas.classList.add('blurred')
        document.exitPointerLock()
      }
      return
    }
    if (invOpen) return
    if (e.repeat) return
    keys[e.code] = true
    if (e.code === settings.keys.forward && !settings.toggleSprint) {
      const now = performance.now()
      if (now - lastW < 300) local.act.sprintTap = true
      lastW = now
    }
    if (e.code === settings.keys.sprint) {
      if (settings.toggleSprint) {
        sprintToggled = !sprintToggled
        if (sprintToggled) local.act.sprintTap = true
        else {
          local.wantSprint = false
          sprintStopPending = true
        }
      } else {
        local.act.sprintTap = true
      }
    }
    for (let n = 1; n <= 9; n++) {
      if (e.code === settings.keys['hotbar' + n]) setSlot(n - 1)
    }
    if (locked && [settings.keys.jump, settings.keys.sprint].includes(e.code)) e.preventDefault()
  })
  addEventListener('keyup', (e) => {
    keys[e.code] = false
  })
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false
  })

  canvas.addEventListener('click', () => {
    if (!locked && !isPauseLayerOpen() && !chatOpen && !invOpen) lockPointer()
  })
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas
    if (locked) {
      started = true
      hidePauseLayers()
      paused = false
      menu.style.display = 'none'
    } else {
      local.act.breakHeld = false
      local.act.useHeld = false
      menu.style.display = started ? 'none' : 'flex'
      if (started && !invOpen && !chatOpen && !suppressPause) {
        paused = true
        showPauseLayer(pause)
      }
    }
    suppressPause = false
  })
  addEventListener('mousemove', (e) => {
    if (!locked || invOpen || isPauseLayerOpen() || chatOpen) return
    const sens = sensToDeg(settings.mouseSens)
    local.yaw += ((e.movementX * sens) * Math.PI) / 180
    local.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, local.pitch + ((e.movementY * sens) * Math.PI) / 180))
  })
  addEventListener('mousedown', (e) => {
    if (!locked || invOpen || isPauseLayerOpen() || chatOpen) return
    if (e.code === settings.keys.attack || (settings.keys.attack === 'Mouse0' && e.button === 0)) {
      local.act.attack = true
      // Render immediately; the server's swingTick confirms the same action
      // for all other players on the next authoritative tick.
      local.swingTick = clientAnimationTick
      if (online && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'action', attack: true, yaw: local.yaw, pitch: local.pitch }))
        local.act.attack = false
      }
    }
    if (settings.keys.use === 'Mouse2' && e.button === 2) {
      local.act.useHeld = true
      // Send the initial placement immediately so a normal click (down/up
      // between two 50 ms input polls) cannot be lost. Held placement then
      // continues through the regular 20 TPS action packets below.
      if (online && socket?.readyState === WebSocket.OPEN) {
        const eye = local.eye()
        const d = local.look()
        const target = raycastBlocks(world, eye.x, eye.y, eye.z, d.x, d.y, d.z, C.REACH_BLOCK)
        socket.send(JSON.stringify({ type: 'action', useHeld: true, yaw: local.yaw, pitch: local.pitch, target }))
        predictPlace()
      }
    }
  })
  addEventListener('mouseup', (e) => {
    if (settings.keys.use === 'Mouse2' && e.button === 2) local.act.useHeld = false
  })
  addEventListener('contextmenu', (e) => e.preventDefault())
  addEventListener(
    'wheel',
    (e) => {
      if (!locked || !e.deltaY) return
      // One slot per wheel notch. Trackpads/high-resolution wheels send many
      // small deltas, so accumulate them rather than stepping once per event.
      const unit = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? 1 : 100
      if (Math.sign(wheelAcc) !== Math.sign(e.deltaY)) wheelAcc = 0
      wheelAcc += e.deltaY / unit
      const steps = Math.trunc(wheelAcc)
      if (steps !== 0) {
        wheelAcc -= steps
        setSlot(local.slot + Math.sign(steps))
      }
    },
    { passive: true }
  )

  const pollInput = () => {
    const i = local.input
    // Movement input is only live while the pointer is locked to the game and
    // no inventory/chat/pause layer is open. When it is not, we must still send
    // the zeroed input to the server: returning early left the server holding
    // the last held-W input, so the player kept walking server-side (and the
    // client then snapped back to it).
    const k = settings.keys
    const inputLive = locked && !invOpen && !chatOpen && !isPauseLayerOpen()
    i.fwd = inputLive ? (keys[k.forward] ? 1 : 0) - (keys[k.back] ? 1 : 0) : 0
    i.strafe = inputLive ? (keys[k.left] ? 1 : 0) - (keys[k.right] ? 1 : 0) : 0
    i.jump = inputLive && !!keys[k.jump]
    i.sneak = inputLive && !!keys[k.sneak]
    if (!inputLive) {
      local.act.useHeld = false
      local.wantSprint = false
    }
    if (settings.toggleSprint && sprintToggled && i.fwd > 0 && !i.sneak) local.act.sprintTap = true
    if (online && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', ...i, yaw: local.yaw, pitch: local.pitch, slot: local.slot, sprint: local.act.sprintTap, stopSprint: sprintStopPending, pingAt: performance.now() }))
      sprintStopPending = false
      let target = null
      if (local.act.useHeld) {
        const eye = local.eye()
        const d = local.look()
        target = raycastBlocks(world, eye.x, eye.y, eye.z, d.x, d.y, d.z, C.REACH_BLOCK)
      }
      socket.send(JSON.stringify({ type: 'action', attack: local.act.attack, useHeld: local.act.useHeld, yaw: local.yaw, pitch: local.pitch, target }))
      local.act.attack = false
    }
  }

  const name = (id) => (game.players.get(id) ? game.players.get(id).name : '?')
  const handleEvents = () => {
    for (const ev of game.events) {
      // KBFFA has no spatial sound engine yet, so play only sounds caused by
      // the local player. This keeps bot sounds from stacking on top of one
      // another while retaining every player action's Minecraft event mapping.
      if (ev.id === local.id) {
        if (ev.type === 'hurt') {
          hud.flashHurt()
          playSound('player_hurt', { volume: 0.7 })
        }
        if (ev.type === 'melee_hit') playSound('player_attack', { volume: 0.6 })
        if (ev.type === 'jump' || ev.type === 'step') playSound('grass_step', { volume: 0.22 })
        if (ev.type === 'block_break') playSound(`${ev.sound}_break`, { volume: 0.5 })
        if (ev.type === 'block_place') playSound(`${ev.sound}_place`, { volume: 0.5 })
        if (ev.type === 'bow_shoot') playSound('bow_shoot', { volume: 0.7, pitch: 0.8 + ev.power * 0.4 })
        if (ev.type === 'pearl_throw') playSound('pearl_throw', { volume: 0.5, pitch: 1.15 })
        if (ev.type === 'arrow_hit') playSound('bow_hit', { volume: 0.6 })
        if (ev.type === 'teleport') playSound('teleport', { volume: 0.6 })
        if (ev.type === 'plate_place') playSound('grass_place', { volume: 0.35, pitch: 0.8 })
        if (ev.type === 'launch') playSound('pressure_plate', { volume: 0.3, pitch: 0.75 })
      }
      if (ev.type === 'death') {
        const line = ev.killer ? `${name(ev.killer)} knocked ${name(ev.victim)} into the void` : `${name(ev.victim)} fell into the void`
        hud.addFeed(line)
        addChatLine(line)
      }
      if (ev.type === 'chat') addChatLine(ev.text)
    }
    game.events.length = 0
  }

  let fov = settings.fov
  const render = (alpha, dt) => {
    syncChunks()
    syncPlates()
    const networkAlpha = online ? Math.min(1, (performance.now() - lastNetworkSnapshot) / 50) : alpha
    syncProjectiles(networkAlpha)
    syncPlayers(networkAlpha, dt)
    // The local player is predicted every game tick, so it can use the same
    // smooth fixed-timestep interpolation as offline play.  Remote players
    // use their received network interpolation in syncPlayers above.
    let ex = lerp(local.prev.x, local.pos.x, alpha)
    let ey = lerp(local.prev.y, local.pos.y, alpha)
    let ez = lerp(local.prev.z, local.pos.z, alpha)
    const camDecay = Math.exp(-dt * 12)
    camOffset.x *= camDecay
    camOffset.y *= camDecay
    camOffset.z *= camDecay
    ex += camOffset.x
    ey += camOffset.y
    ez += camOffset.z
    ey += local.sneaking ? 1.54 : 1.62
    camera.position.set(ex, ey, ez)
    camera.rotation.y = Math.PI - local.yaw
    camera.rotation.x = -local.pitch
    const target = settings.fov * (local.sprinting ? 1.12 : 1)
    fov += (target - fov) * 0.2
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    updateHand(alpha, dt)
    const d = local.look()
    const h = local.alive ? raycastBlocks(world, ex, ey, ez, d.x, d.y, d.z, C.REACH_BLOCK) : null
    outline.visible = !!h
    if (h) outline.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5)
    hud.update(local, game)
    renderer.render(scene, camera)
  }

  window.game = game
  window.local = local
  window._dbg = { hand, arm, itemRig, held, handState }

  let last = performance.now()
  let acc = 0
  const frame = (now) => {
    requestAnimationFrame(frame)
    const dt = Math.min(now - last, 250)
    last = now
    acc += dt
    while (acc >= 50) {
      pollInput()
      clientAnimationTick++
      if (!online) game.update()
      else {
        // Keep the same update ordering as Game.update(): interpolation must
        // start from this tick's position before predicted movement mutates
        // it.  Without this, the camera lerps back to a stale position every
        // frame and the entire map visibly vibrates.
        Object.assign(local.prev, local.pos)
        local.prevYaw = local.yaw
        local.prevPitch = local.pitch
        if (local.useDelay > 0) local.useDelay--
        if (local.act.useHeld && locked) predictPlace()
        game.move(local)
        predHistory.push({ x: local.pos.x, y: local.pos.y, z: local.pos.z })
        if (predHistory.length > PRED_HISTORY_TICKS) predHistory.shift()
        const selected = C.HOTBAR[local.slot]
        visualBowTicks = selected?.type === 'bow' && local.act.useHeld ? visualBowTicks + 1 : -1
      }
      handleEvents()
      acc -= 50
    }
    render(acc / 50, dt / 1000)
  }
  requestAnimationFrame(frame)
}

main()
