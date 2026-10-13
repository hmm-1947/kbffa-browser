import * as THREE from 'three'
import { CONFIG as C, BLOCK_CHOICES, HOTBAR_DEFAULT } from './config.js'
import { ID } from './blocks.js'
import { loadTextures, buildAtlas, img, makeTexture } from './textures.js'
import { Game } from './game.js'
import nik from './maps/nik.js'
import { buildChunk, blockCubeGeometry } from './mesher.js'
import { extrudeSprite, buildPlayerModel, buildFirstPersonArm, vertexMaterial } from './models.js'
import { Hud, maxGuiScale, blockIcon, itemIcon } from './hud.js'
import { applyLoadout, commitLoadout, onLoadout, defFor } from './loadout.js'
import { SkyLight } from './light.js'
import { createBillboard } from './billboard.js'
import { raycastBlocks } from './raycast.js'
import { overlapsSolid, playerBox } from './physics.js'
import { settings, saveSettings, resetSettings, DEFAULT_KEYBINDS, ACTION_LABELS, keyLabel, CHAT_POSITIONS } from './settings.js'
import { setPixelText, makeBitmapTextCanvas, textWidth, parseStyled, glyphsWidth, makeGlyphCanvas } from './bitmapfont.js'
import { playSound } from './sounds.js'
import { TabList } from './tablist.js'

const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

async function main() {
  await loadTextures()
  applyLoadout()
  const atlas = buildAtlas()
  const game = new Game(nik)
  const local = game.addPlayer('Player')
  for (let i = 0; i < C.BOTS; i++) game.addPlayer(`Bot${i + 1}`, true)
  const world = game.world
  new SkyLight(world)

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
  const billboard = createBillboard(scene)
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false)
    billboard.resize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  const hud = new Hud(document.getElementById('hud'))
  const tabList = new TabList(document.getElementById('hud'))
  hud.setHotbarSwapHandler((a, b) => {
    const h = [...settings.hotbar]
    ;[h[a], h[b]] = [h[b], h[a]]
    commitLoadout(h)
    playSound('ui_click', { volume: 0.35 })
  })
  // The grass side overlay contains transparent pixels.  Discard them so its
  // grayscale RGB data never covers the dirt layer below it.
  const chunkMat = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })
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
      const speed = Math.min(Math.hypot(x - m.lx, z - m.lz) / Math.max(dt, 0.001), 40)
      m.lx = x
      m.lz = z
      m.amp += (Math.min(speed / 5, 1) - m.amp) * (1 - Math.pow(0.6, Math.min(dt, 0.1) * 20))
      const limb = Math.min(m.amp, 1)
      m.walk += limb * Math.min(dt, 0.1) * 20 * 0.6662
      const sw = Math.cos(m.walk) * limb
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
      m.legR.rotation.x = sw * 1.4
      m.legL.rotation.x = -sw * 1.4
      m.armR.rotation.x = -sw
      m.armL.rotation.x = sw
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
      m.mat.color.setHex(p.hurtAnim > 0 ? 0xffb3b3 : 0xffffff)
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
  const spriteDisplay = display([1.13, 3.2, 1.13], [0, -90, 25], 0.68)
  const blockDisplay = display([0, 0, 0], [0, 45, 0], 0.4)
  const thinBlockDisplay = display([0, 4.2, 0], [0, 45, 0], 0.4)
  addHeld('stick', tool('stick'), spriteDisplay)
  addHeld('bow-1', tool('bow_standby'), spriteDisplay)
  for (let i = 0; i < 3; i++) addHeld(`bow${i}`, tool(`bow_pulling_${i}`), spriteDisplay)
  addHeld('pearl', tool('ender_pearl'), spriteDisplay)
  const heldPlateGeo = new THREE.BoxGeometry(14 / 16, 1 / 16, 14 / 16)
  {
    const side = [1, 15, 15, 16]
    const flat = [1, 1, 15, 15]
    const rects = [side, side, flat, flat, side, side]
    const uv = heldPlateGeo.attributes.uv
    rects.forEach(([x0, y0, x1, y1], f) => {
      uv.setXY(f * 4, x0 / 16, 1 - y0 / 16)
      uv.setXY(f * 4 + 1, x1 / 16, 1 - y0 / 16)
      uv.setXY(f * 4 + 2, x0 / 16, 1 - y1 / 16)
      uv.setXY(f * 4 + 3, x1 / 16, 1 - y1 / 16)
    })
    const n = heldPlateGeo.attributes.normal
    const colors = []
    for (let i = 0; i < n.count; i++) {
      const shade = n.getY(i) > 0.5 ? 1 : n.getY(i) < -0.5 ? 0.5 : Math.abs(n.getZ(i)) > 0.5 ? 0.8 : 0.6
      const c = Math.pow(shade, 2.2)
      colors.push(c, c, c)
    }
    heldPlateGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    heldPlateGeo.translate(0, 0.5 / 16 - 0.5, 0)
  }
  const heldPlateMat = new THREE.MeshBasicMaterial({ map: makeTexture('blocks', 'gold_block'), vertexColors: true })
  addHeld('plate', new THREE.Mesh(heldPlateGeo, heldPlateMat), thinBlockDisplay)
  const cube = new THREE.Mesh(blockCubeGeometry(atlas, ID[C.PLACE_BLOCK]), chunkMat)
  addHeld('block', cube, blockDisplay)
  onLoadout(() => {
    hud.refreshHotbar()
    cube.geometry.dispose()
    cube.geometry = blockCubeGeometry(atlas, ID[C.PLACE_BLOCK])
    sendLoadout()
  })

  const armModel = chain(mt(-5 / 16, 2 / 16, 0), new M4().makeRotationZ(0.1), mrx(180), mt(-1 / 16, 2 / 16, 0), msc(2 / 1.8, 2 / 1.8, 2 / 1.8))
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
    const handScale = Math.tan(70 * D2R / 2) / Math.tan(camera.fov * D2R / 2)
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
    armM.multiply(mt(-0.3 * Math.sin(sq * pi) + 0.64000005, 0.4 * Math.sin(sq * pi * 2) - 0.6 + invH * -0.6, -0.4 * Math.sin(a * pi) - 0.71999997))
    armM.multiply(mry(45)).multiply(mry(Math.sin(sq * pi) * 70)).multiply(mrz(Math.sin(a * a * pi) * -20))
    armM.multiply(mt(-1, 3.6, 3.5)).multiply(mrz(120)).multiply(mrx(200)).multiply(mry(-135)).multiply(mt(5.6, 0, 0))
    arm.matrix.copy(armM.multiply(armModel))
    arm.matrixWorldNeedsUpdate = true
    if (shown === 'empty') {
      return
    }
    const bt = online ? visualBowTicks : local.bowTicks
    m.multiply(mt(0.56, -0.52 + invH * -0.6, -0.72))
    if (handGroup(shown) === 'bow' && bt >= 0) {
      const th = bt + alpha
      let p = th / 20
      p = Math.min(1, (p * p + p * 2) / 3)
      m.multiply(mt(-0.2785682, 0.18344387, 0.15731531)).multiply(mrx(-13.935)).multiply(mry(35.3)).multiply(mrz(-9.785))
      if (p > 0.1) m.multiply(mt(0, Math.sin((th - 0.1) * 1.3) * (p - 0.1) * 0.004, 0))
      m.multiply(mt(0, 0, p * 0.04)).multiply(msc(1, 1, 1 + p * 0.2)).multiply(mry(-45))
    } else {
      m.multiply(mt(-0.4 * Math.sin(sq * pi), 0.2 * Math.sin(sq * pi * 2), -0.2 * Math.sin(a * pi)))
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
  const btnChangeBlocks = document.getElementById('btnChangeBlocks')
  const btnBlockPickerDone = document.getElementById('btnBlockPickerDone')
  const btnHotbarOpen = document.getElementById('btnHotbarOpen')
  const btnHotbarSave = document.getElementById('btnHotbarSave')
  const btnHotbarReset = document.getElementById('btnHotbarReset')
  const btnHotbarCancel = document.getElementById('btnHotbarCancel')
  const blockPicker = document.getElementById('blockPicker')
  const hotbarEditor = document.getElementById('hotbarEditor')
  const btnChatSettingsDone = document.getElementById('btnChatSettingsDone')
  const btnChatTL = document.getElementById('btnChatTL')
  const btnChatTR = document.getElementById('btnChatTR')
  const btnChatBL = document.getElementById('btnChatBL')
  const btnChatBR = document.getElementById('btnChatBR')
  const sldChatLen = document.getElementById('sldChatLen')
  const sldChatOpacity = document.getElementById('sldChatOpacity')
  const sldChatTextOpacity = document.getElementById('sldChatTextOpacity')
  const controlsList = document.getElementById('controlsList')
  const chatWrap = document.getElementById('chatWrap')
  const chatLog = document.getElementById('chatLog')
  const chatInput = document.getElementById('chatInput')
  const chatBox = document.getElementById('chatBox')
  const chatView = document.getElementById('chatView')

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
  let lastEscAt = 0
  let lastCloseAt = 0
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
  const sendLoadout = () => {
    if (online && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'loadout', hotbar: settings.hotbar.join(','), block: settings.placeBlock }))
  }
  let selectedServer = null
  let clientAnimationTick = 0
  let visualBowTicks = -1
  const networkBlocks = new Map()
  const blockPredictions = []
  const pendingInputs = []
  let inputSeq = 0
  let placeSeq = 0
  let lastNetworkSnapshot = performance.now()
  let previousNetworkPlayers = new Map()

  const serverList = document.getElementById('serverList')
  const playerName = document.getElementById('playerName')
  const playerNameBox = document.getElementById('playerNameBox')
  const playerNameView = document.getElementById('playerNameView')
  const joinServer = document.getElementById('joinServer')
  const refreshServers = document.getElementById('refreshServers')
  const statsButton = document.getElementById('statsButton')
  const joinErrorEl = document.getElementById('joinError')
  const lobbyStatsEl = document.getElementById('lobbyStats')
  const formatStats = (st) => st ? `Kills: ${st.kills}\nDeaths: ${st.deaths}\nMax kill streak: ${st.maxKillStreak}\nDeath streak: ${st.deathStreak}\nPearls thrown: ${st.pearlsThrown}\nBlocks placed: ${st.blocksPlaced}` : ''
  const mcText = (str, color = '#ffffff') => {
    const c = makeBitmapTextCanvas(str, 1, color, true)
    c.style.width = `calc(${c.width}px * var(--s))`
    c.style.height = `calc(${c.height}px * var(--s))`
    c.style.imageRendering = 'pixelated'
    c.style.display = 'block'
    return c
  }
  const mcSet = (el, str, color) => el.replaceChildren(mcText(str, color))
  const joinError = {
    set textContent(v) {
      joinErrorEl.replaceChildren()
      if (v) joinErrorEl.appendChild(mcText(v, '#ff5555'))
    }
  }
  let lobbyStatsTimer = 0
  const lobbyStats = {
    set textContent(v) {
      lobbyStatsEl.replaceChildren()
      clearTimeout(lobbyStatsTimer)
      if (!v) return lobbyStatsEl.classList.remove('show')
      for (const line of v.split('\n')) {
        const d = document.createElement('div')
        d.className = 'sl-line'
        d.appendChild(mcText(line))
        lobbyStatsEl.appendChild(d)
      }
      lobbyStatsEl.classList.add('show')
      lobbyStatsTimer = setTimeout(() => lobbyStatsEl.classList.remove('show'), 6000)
    }
  }
  mcSet(document.getElementById('slTitle'), 'Play Multiplayer')
  mcSet(joinServer, 'Join Server', '#e0e0e0')
  mcSet(statsButton, 'Statistics', '#e0e0e0')
  mcSet(refreshServers, 'Refresh', '#e0e0e0')
  let caretOn = true
  const renderName = () => {
    const v = playerName.value
    const focused = document.activeElement === playerName
    playerNameBox.classList.toggle('focus', focused)
    playerNameView.replaceChildren()
    if (v) playerNameView.appendChild(mcText(v, '#e0e0e0'))
    else playerNameView.appendChild(mcText('Player name', '#808080'))
    if (focused && caretOn) {
      const pos = playerName.selectionStart ?? v.length
      const caret = document.createElement('div')
      caret.className = 'sl-caret'
      caret.style.left = `calc(${textWidth(v.slice(0, pos))}px * var(--s))`
      if (pos >= v.length) {
        caret.style.width = `calc(5px * var(--s))`
        caret.style.height = `calc(1px * var(--s))`
        caret.style.top = `calc(8px * var(--s))`
      }
      playerNameView.appendChild(caret)
    }
  }
  try { playerName.value = localStorage.getItem('kbffa_name') || '' } catch {}
  for (const ev of ['input', 'keyup', 'click', 'focus', 'blur', 'select']) playerName.addEventListener(ev, () => { caretOn = true; renderName() })
  playerName.addEventListener('input', () => { try { localStorage.setItem('kbffa_name', playerName.value) } catch {} })
  setInterval(() => { if (document.activeElement === playerName) { caretOn = !caretOn; renderName() } }, 500)
  renderName()
  let lastEntryClick = 0
  const selectEntry = (id) => {
    selectedServer = id
    serverList.focus({ preventScroll: true })
    for (const row of serverList.querySelectorAll('.sl-entry')) row.classList.toggle('selected', row.dataset.id === id)
    joinServer.disabled = !selectedServer
  }
  const joinSelected = () => {
    if (!selectedServer) return
    if (!socket || socket.readyState !== WebSocket.OPEN) return (joinError.textContent = 'Connecting to server…')
    socket.send(JSON.stringify({ type: 'join', server: selectedServer, name: playerName.value.trim() }))
  }
  const drawServers = (servers) => {
    serverList.replaceChildren()
    const inner = document.createElement('div')
    inner.className = 'sl-inner'
    if (selectedServer && !servers.some((s) => s.id === selectedServer)) selectedServer = null
    for (const server of servers) {
      const row = document.createElement('div')
      row.className = 'sl-entry' + (selectedServer === server.id ? ' selected' : '')
      row.dataset.id = server.id
      const icon = document.createElement('div')
      icon.className = 'sl-icon'
      icon.innerHTML = '<div class="sl-join"></div><div class="sl-hot"></div>'
      const name = document.createElement('div')
      name.className = 'sl-name'
      mcSet(name, server.name, '#ffffff')
      const motd1 = document.createElement('div')
      motd1.className = 'sl-motd'
      motd1.style.top = 'calc(14px * var(--s))'
      mcSet(motd1, 'Knockback FFA', '#808080')
      const motd2 = document.createElement('div')
      motd2.className = 'sl-motd'
      motd2.style.top = 'calc(23px * var(--s))'
      mcSet(motd2, 'Knock everyone into the void', '#808080')
      const status = document.createElement('div')
      status.className = 'sl-status'
      status.style.right = 'calc(22px * var(--s))'
      mcSet(status, `${server.players} player${server.players === 1 ? '' : 's'}`, '#808080')
      const ping = document.createElement('div')
      ping.className = 'sl-ping'
      ping.style.backgroundImage = 'url(/textures/gui/server_list/ping_5.png)'
      row.append(icon, name, motd1, motd2, status, ping)
      row.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        const r = icon.getBoundingClientRect()
        const overJoin = e.clientX >= r.left + r.width / 2 && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        const now = performance.now()
        const double = selectedServer === server.id && now - lastEntryClick < 250
        lastEntryClick = now
        selectEntry(server.id)
        if (overJoin || double) joinSelected()
      })
      inner.appendChild(row)
    }
    serverList.appendChild(inner)
    joinServer.disabled = !selectedServer
    layoutList()
  }
  addEventListener('keydown', (e) => {
    if (menu.style.display === 'none' || started) return
    if (e.code === 'Enter' || e.code === 'NumpadEnter') return joinSelected()
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return
    const rows = [...serverList.querySelectorAll('.sl-entry')]
    if (!rows.length) return
    const at = rows.findIndex((r) => r.dataset.id === selectedServer)
    const next = e.code === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1)
    selectEntry(rows[next].dataset.id)
    rows[next].scrollIntoView({ block: "nearest" })
    e.preventDefault()
  })
  joinServer.disabled = true
  const slSb = document.getElementById('slScroll')
  const slThumb = slSb.querySelector('.sl-sb-thumb')
  const guiS = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1
  const thumbH = (h, content) => Math.min(h - 8, Math.max(32, Math.floor(h * h / content)))
  const layoutList = () => {
    const s = guiS()
    serverList.style.setProperty('--sl-bx', `${-(Math.ceil(innerWidth / s) % 32) * s}px`)
    serverList.style.setProperty('--sl-by', `${-((Math.ceil(innerHeight / s) - 60) % 32) * s}px`)
    const h = serverList.clientHeight / s
    const content = serverList.scrollHeight / s
    const max = Math.round(content - h)
    slSb.classList.toggle('show', max > 0)
    if (max <= 0) return
    const bar = thumbH(h, content)
    const y = Math.max(0, Math.floor(Math.floor(serverList.scrollTop / s) * (h - bar) / max))
    slThumb.style.height = `calc(${bar}px * var(--s))`
    slThumb.style.top = `calc(${y}px * var(--s))`
  }
  serverList.addEventListener('scroll', layoutList)
  new ResizeObserver(layoutList).observe(serverList)
  serverList.addEventListener('wheel', (e) => {
    e.preventDefault()
    serverList.scrollTop += Math.sign(e.deltaY) * 18 * guiS()
  }, { passive: false })
  let sbDragY = null
  slSb.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    sbDragY = e.clientY
    slSb.classList.add('drag')
  })
  addEventListener('mousemove', (e) => {
    if (sbDragY === null) return
    const s = guiS()
    const r = serverList.getBoundingClientRect()
    const max = serverList.scrollHeight - serverList.clientHeight
    if (e.clientY < r.top) serverList.scrollTop = 0
    else if (e.clientY > r.bottom) serverList.scrollTop = max
    else {
      const h = serverList.clientHeight / s
      const bar = thumbH(h, serverList.scrollHeight / s)
      serverList.scrollTop += (e.clientY - sbDragY) * Math.max(1, (max / s) / (h - bar))
    }
    sbDragY = e.clientY
  })
  addEventListener('mouseup', () => { sbDragY = null; slSb.classList.remove('drag') })
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
  const predictPlace = (h) => {
    local.useDelay = 4
    const x = h.x + h.nx
    const y = h.y + h.ny
    const z = h.z + h.nz
    if (!game.canPlace(x, y, z) || game.isSpawnProtected({ x: x + 0.5, y, z: z + 0.5 })) return
    for (const q of game.players.values()) {
      if (!q.alive) continue
      const b = playerBox(q.pos)
      if (b.minX - 0.12 < x + 1 && b.maxX + 0.12 > x && b.minY < y + 1 && b.maxY > y && b.minZ - 0.12 < z + 1 && b.maxZ + 0.12 > z) return
    }
    placeSeq++
    blockPredictions.push({ seq: placeSeq, key: `${x},${y},${z}`, at: performance.now() })
    world.set(x, y, z, ID[C.PLACE_BLOCK])
    local.swingTick = clientAnimationTick
  }
  const reconcileLocal = (s, wasAlive) => {
    if (!Number.isInteger(s.inputAck)) {
      pendingInputs.length = 0
      const gap = Math.hypot(local.pos.x - s.pos.x, local.pos.y - s.pos.y, local.pos.z - s.pos.z)
      if (local.alive && wasAlive && gap < 0.6) return
      if (wasAlive && local.alive) addCamOffset(local.pos, s.pos)
      Object.assign(local.pos, s.pos)
      Object.assign(local.prev, s.pos)
      Object.assign(local.vel, s.vel)
      return
    }
    while (pendingInputs.length && pendingInputs[0].seq <= s.inputAck) pendingInputs.shift()
    const sim = s.sim || {}
    if (!local.alive) {
      pendingInputs.length = 0
      return
    }
    if (!wasAlive) {
      pendingInputs.length = 0
      Object.assign(local.pos, s.pos)
      Object.assign(local.prev, s.pos)
      Object.assign(local.vel, s.vel)
      local.onGround = s.onGround
      local.wantSprint = !!sim.ws
      local.jumpTicks = sim.jt || 0
      local.hCollide = !!sim.hc
      return
    }
    const cur = {
      pos: { ...local.pos },
      vel: { ...local.vel },
      onGround: local.onGround,
      wantSprint: local.wantSprint,
      sprinting: local.sprinting,
      sneaking: local.sneaking,
      jumpTicks: local.jumpTicks,
      hCollide: local.hCollide,
      stepDistance: local.stepDistance,
      yaw: local.yaw,
      input: { ...local.input },
      tap: local.act.sprintTap
    }
    Object.assign(local.pos, s.pos)
    Object.assign(local.vel, s.vel)
    local.onGround = s.onGround
    local.wantSprint = !!sim.ws
    local.jumpTicks = sim.jt || 0
    local.hCollide = !!sim.hc
    const eventCount = game.events.length
    for (const r of pendingInputs) {
      Object.assign(local.prev, local.pos)
      local.input.fwd = r.fwd
      local.input.strafe = r.strafe
      local.input.jump = r.jump
      local.input.sneak = r.sneak
      local.yaw = r.yaw
      if (r.stopSprint) local.wantSprint = false
      local.act.sprintTap = !!r.sprint
      game.move(local)
    }
    game.events.length = eventCount
    local.yaw = cur.yaw
    Object.assign(local.input, cur.input)
    local.act.sprintTap = cur.tap
    local.stepDistance = cur.stepDistance
    const error = Math.hypot(local.pos.x - cur.pos.x, local.pos.y - cur.pos.y, local.pos.z - cur.pos.z)
    if (error < 0.03) {
      Object.assign(local.pos, cur.pos)
      Object.assign(local.vel, cur.vel)
      local.onGround = cur.onGround
      local.wantSprint = cur.wantSprint
      local.sprinting = cur.sprinting
      local.sneaking = cur.sneaking
      local.jumpTicks = cur.jumpTicks
      local.hCollide = cur.hCollide
      return
    }
    addCamOffset(cur.pos, local.pos)
    Object.assign(local.prev, local.pos)
  }
  const syncSnapshot = (snapshot) => {
    const receivedAt = performance.now()
    const seen = new Set()
    const oldPlayers = previousNetworkPlayers
    previousNetworkPlayers = new Map(snapshot.players.map((state) => [state.id, state]))
    let localSync = null
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
      const prior = oldPlayers.get(state.id)
      if (p !== local) {
        Object.assign(p.pos, state.pos)
        Object.assign(p.prev, prior?.pos || state.pos)
        Object.assign(p.vel, state.vel)
      }
      if (p === local) {
        const wasAlive = p.alive
        if (Number.isFinite(state.pingAt)) p.ping = Math.max(0, performance.now() - state.pingAt)
        const { pos, prev, vel, yaw, pitch, prevYaw, prevPitch, input, act, swingTick, onGround, sneaking, sprinting, slot, sim, ping, ...serverState } = state
        Object.assign(p, serverState)
        localSync = { state, wasAlive }
      } else Object.assign(p, state)
    }
    for (const [id, p] of game.players) if (p !== local && !seen.has(id)) game.removePlayer(id)
    game.time = snapshot.time
    lastNetworkSnapshot = receivedAt
    const nextBlocks = new Map(snapshot.blocks?.map((b) => [`${b.x},${b.y},${b.z}`, b]) || [])
    const resolved = []
    if (localSync) {
      const ack = localSync.state.placeAck
      const legacy = !Number.isInteger(ack)
      while (blockPredictions.length && (legacy ? receivedAt - blockPredictions[0].at > 400 : blockPredictions[0].seq <= ack)) resolved.push(blockPredictions.shift().key)
    }
    const pending = new Set(blockPredictions.map((b) => b.key))
    for (const [key, block] of networkBlocks) {
      if (!nextBlocks.has(key) && !pending.has(key)) game.world.set(block.x, block.y, block.z, 0)
    }
    for (const [key, block] of nextBlocks) {
      if (pending.has(key)) continue
      if (!networkBlocks.has(key) || networkBlocks.get(key).id !== block.id) game.world.set(block.x, block.y, block.z, block.id)
    }
    for (const key of resolved) {
      if (pending.has(key)) continue
      const [x, y, z] = key.split(',').map(Number)
      game.world.set(x, y, z, nextBlocks.get(key)?.id ?? 0)
    }
    networkBlocks.clear()
    for (const [key, block] of nextBlocks) networkBlocks.set(key, block)
    if (localSync) reconcileLocal(localSync.state, localSync.wasAlive)
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
        sendLoadout()
      }
      if (message.type === 'snapshot') syncSnapshot(message)
      if (message.type === 'all_stats') { allPlayerStats = message.players || []; renderStatsList() }
    })
    socket.addEventListener('close', () => { if (!online) joinError.textContent = 'Could not reach the multiplayer server.' })
  }
  connect()
  joinServer.addEventListener('click', joinSelected)
  refreshServers.addEventListener('click', () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'list' }))
  })
  statsButton.addEventListener('click', () => {
    if (lobbyStatsEl.classList.contains('show')) return lobbyStatsEl.classList.remove('show')
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
  }

  const CHAT_W = 320
  const chatTrim = []
  const recentChat = []
  let chatScroll = 0
  let chatNewSince = false
  let chatHistPos = 0
  let chatHistBuf = ''
  const chatSbMain = document.createElement('div')
  const chatSbEdge = document.createElement('div')
  chatSbMain.className = chatSbEdge.className = 'chat-sb'
  chatLog.append(chatSbMain, chatSbEdge)
  const chatPerPage = () => (chatOpen ? 20 : Math.max(1, Math.min(20, settings.chatLength)))
  const wrapChat = (text) => {
    const out = []
    let rest = parseStyled(String(text))
    let wrapped = false
    for (;;) {
      let i = 0
      let w = wrapped ? 4 : 0
      while (i < rest.length) {
        const cw = glyphsWidth([rest[i]])
        if (w + cw > CHAT_W) break
        w += cw
        i++
      }
      if (i >= rest.length) {
        out.push({ glyphs: rest, wrapped })
        break
      }
      let sp = -1
      for (let k = i; k >= 0; k--) {
        if (rest[k].ch === ' ') {
          sp = k
          break
        }
      }
      if (sp > 0) {
        out.push({ glyphs: rest.slice(0, sp), wrapped })
        rest = rest.slice(sp + 1)
      } else {
        const cut = Math.max(1, i)
        out.push({ glyphs: rest.slice(0, cut), wrapped })
        rest = rest.slice(cut)
      }
      wrapped = true
    }
    return out
  }
  const mcGlyphs = (glyphs) => {
    const c = makeGlyphCanvas(glyphs, true)
    c.style.width = `calc(${c.width}px * var(--s))`
    c.style.height = `calc(${c.height}px * var(--s))`
    c.style.imageRendering = 'pixelated'
    return c
  }
  const scrollChat = (dir) => {
    chatScroll += dir
    const max = chatTrim.length - chatPerPage()
    if (chatScroll > max) chatScroll = max
    if (chatScroll <= 0) {
      chatScroll = 0
      chatNewSince = false
    }
    updateChat()
  }
  const updateChat = () => {
    const s = guiS()
    const top = settings.chatPosition.startsWith('top')
    const right = settings.chatPosition.endsWith('right')
    const bgOp = Math.max(0, Math.min(100, settings.chatOpacity)) / 100
    const textOp = Math.max(0, Math.min(100, settings.chatTextOpacity)) / 100 * 0.9 + 0.1
    chatBox.classList.toggle('chat-box-top', top)
    const per = chatPerPage()
    const now = performance.now()
    const n = Math.max(0, Math.min(chatTrim.length - chatScroll, per))
    for (const ln of chatTrim) ln.el.style.display = 'none'
    let count = 0
    for (let i = n - 1; i >= 0; i--) {
      const ln = chatTrim[i + chatScroll]
      let a = 1
      if (!chatOpen) {
        const t = Math.max(0, Math.min(1, (1 - (now - ln.at) / 50 / 200) * 10))
        a = t * t
      }
      if (a <= 1e-5) continue
      const st = ln.el.style
      st.display = 'block'
      st.left = right ? '' : '0'
      st.right = right ? '0' : ''
      if (top) {
        st.bottom = ''
        st.top = `calc(${14 + count * 9}px * var(--s))`
      } else {
        st.top = ''
        st.bottom = `calc(${40 + i * 9}px * var(--s))`
      }
      st.background = `rgba(0,0,0,${a * bgOp})`
      ln.el.firstChild.style.opacity = a * textOp
      count++
    }
    const total = chatTrim.length
    const chatHeight = count * 9
    const virtual = total * 9
    if (chatOpen && total > 0 && virtual !== chatHeight && count > 0) {
      const off = Math.trunc(chatScroll * chatHeight / total)
      const barH = Math.trunc(chatHeight * chatHeight / virtual)
      const gh = Math.ceil(innerHeight / s)
      const alpha = off - (gh - 40) > 0 ? 170 / 255 : 96 / 255
      const col = chatNewSince ? '204,51,51' : '51,51,170'
      const place = (el, x, w, color) => {
        el.style.display = 'block'
        el.style.width = `calc(${w}px * var(--s))`
        el.style.height = `calc(${barH}px * var(--s))`
        el.style.background = `rgba(${color},${alpha})`
        el.style.left = right ? '' : `calc(${x}px * var(--s))`
        el.style.right = right ? `calc(${332 - x - w}px * var(--s))` : ''
        if (top) {
          el.style.bottom = ''
          el.style.top = `calc(${14 + chatHeight - off - barH}px * var(--s))`
        } else {
          el.style.top = ''
          el.style.bottom = `calc(${40 + off}px * var(--s))`
        }
      }
      place(chatSbMain, 328, 2, col)
      place(chatSbEdge, 329, 1, '204,204,204')
    } else {
      chatSbMain.style.display = chatSbEdge.style.display = 'none'
    }
  }
  const applyChatSettings = () => {
    updateChat()
    renderChatInput()
  }
  const addChatLine = (text) => {
    const parts = wrapChat(String(text))
    const now = performance.now()
    for (const p of parts) {
      if (chatOpen && chatScroll > 0) {
        chatNewSince = true
        chatScroll++
      }
      const el = document.createElement('div')
      el.className = 'chat-line'
      el.appendChild(mcGlyphs(p.wrapped ? [{ ch: ' ', color: '#ffffff', bold: false, italic: false, underline: false, strike: false }, ...p.glyphs] : p.glyphs))
      chatLog.appendChild(el)
      chatTrim.unshift({ el, at: now })
    }
    while (chatTrim.length > 100) chatTrim.pop().el.remove()
    const max = chatTrim.length - chatPerPage()
    if (chatScroll > max) chatScroll = Math.max(0, max)
    updateChat()
  }
  let chatFocusAt = 0
  let chatViewKey = ''
  let chatViewText = null
  const renderChatInput = () => {
    if (!chatOpen) return
    const s = guiS()
    const v = chatInput.value
    const ss = chatInput.selectionStart ?? v.length
    const se = chatInput.selectionEnd ?? v.length
    const caretIdx = chatInput.selectionDirection === 'backward' ? ss : se
    const caretPx = textWidth(v.slice(0, caretIdx))
    const viewW = Math.ceil(innerWidth / s) - 4
    const scrollX = Math.max(0, caretPx + (caretIdx >= v.length ? 6 : 1) - viewW)
    const blink = Math.floor((performance.now() - chatFocusAt) / 300) % 2 === 0
    const key = `${v}|${ss}|${se}|${scrollX}|${blink}|${s}`
    if (key === chatViewKey) return
    chatViewKey = key
    if (!chatViewText || chatViewText.v !== v) chatViewText = { v, c: mcText(v, '#e0e0e0') }
    chatView.replaceChildren()
    const t = chatViewText.c
    t.style.position = 'absolute'
    t.style.top = '0'
    t.style.left = `calc(${-scrollX}px * var(--s))`
    chatView.appendChild(t)
    if (ss !== se) {
      const x0 = textWidth(v.slice(0, Math.min(ss, se)))
      const x1 = textWidth(v.slice(0, Math.max(ss, se)))
      const sel = document.createElement('div')
      sel.className = 'chat-sel'
      sel.style.left = `calc(${x0 - scrollX}px * var(--s))`
      sel.style.width = `calc(${x1 - x0}px * var(--s))`
      chatView.appendChild(sel)
    }
    if (blink) {
      const caret = document.createElement('div')
      caret.className = 'chat-caret'
      caret.style.left = `calc(${caretPx - scrollX}px * var(--s))`
      if (caretIdx >= v.length) {
        caret.style.width = 'calc(5px * var(--s))'
        caret.style.height = 'calc(1px * var(--s))'
        caret.style.top = 'calc(8px * var(--s))'
      }
      chatView.appendChild(caret)
    }
  }
  for (const ev of ['input', 'keyup', 'keydown', 'click', 'select', 'focus']) {
    chatInput.addEventListener(ev, () => {
      chatFocusAt = performance.now()
      chatViewKey = ''
      renderChatInput()
    })
  }
  setInterval(() => {
    if (chatOpen) renderChatInput()
    if (chatTrim.length) updateChat()
  }, 50)
  const moveInHistory = (dir) => {
    const max = recentChat.length
    const np = Math.max(0, Math.min(max, chatHistPos + dir))
    if (np === chatHistPos) return
    if (np === max) {
      chatHistPos = max
      chatInput.value = chatHistBuf
    } else {
      if (chatHistPos === max) chatHistBuf = chatInput.value
      chatInput.value = recentChat[np]
      chatHistPos = np
    }
    const end = chatInput.value.length
    chatInput.setSelectionRange(end, end)
  }
  addEventListener('wheel', (e) => {
    if (!chatOpen) return
    e.preventDefault()
    const dir = -Math.sign(e.deltaY)
    scrollChat(Math.trunc(dir * (e.shiftKey ? 1 : 7)))
  }, { passive: false })
  addEventListener('resize', () => { chatViewKey = ''; updateChat(); renderChatInput() })

  const isPauseLayerOpen = () => paused || options.classList.contains('show') || controls.classList.contains('show') || stats.classList.contains('show') || chatSettings.classList.contains('show') || blockPicker.classList.contains('show') || hotbarEditor.classList.contains('show')
  const showPauseLayer = (el) => {
    pause.classList.remove('show')
    options.classList.remove('show')
    controls.classList.remove('show')
    stats.classList.remove('show')
    chatSettings.classList.remove('show')
    blockPicker.classList.remove('show')
    hotbarEditor.classList.remove('show')
    pauseBlur.classList.add('show')
    el.classList.add('show')
  }
  const hidePauseLayers = () => {
    pause.classList.remove('show')
    options.classList.remove('show')
    controls.classList.remove('show')
    stats.classList.remove('show')
    chatSettings.classList.remove('show')
    blockPicker.classList.remove('show')
    hotbarEditor.classList.remove('show')
    pauseBlur.classList.remove('show')
  }

  const openChat = (initial = '') => {
    if (!started || isPauseLayerOpen()) return
    chatOpen = true
    suppressPause = true
    chatInput.value = initial
    chatHistPos = recentChat.length
    chatHistBuf = ''
    chatBox.classList.add('show')
    chatFocusAt = performance.now()
    chatViewKey = ''
    document.exitPointerLock()
    requestAnimationFrame(() => { chatInput.focus(); chatInput.setSelectionRange(initial.length, initial.length) })
    local.act.breakHeld = false
    local.act.useHeld = false
    updateChat()
    renderChatInput()
  }
  const closeChat = (submit) => {
    const msg = chatInput.value.trim().replace(/\s+/g, ' ').slice(0, 256)
    if (submit && msg) {
      if (recentChat[recentChat.length - 1] !== msg) recentChat.push(msg)
      if (recentChat.length > 100) recentChat.shift()
      if (online) socket?.send(JSON.stringify({ type: 'chat', text: msg }))
      else game.command(msg, local.id)
    }
    chatOpen = false
    chatScroll = 0
    chatNewSince = false
    chatBox.classList.remove('show')
    chatInput.blur()
    updateChat()
    if (started) {
      if (submit) startRelockPoll()
      else setTimeout(() => { if (!chatOpen && !paused && !invOpen) startRelockPoll() }, 350)
    }
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
    else if (e.key === 'Escape') { e.preventDefault(); closeChat(false) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveInHistory(-1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveInHistory(1) }
    else if (e.key === 'PageUp') { e.preventDefault(); scrollChat(chatPerPage() - 1) }
    else if (e.key === 'PageDown') { e.preventDefault(); scrollChat(-chatPerPage() + 1) }
  })
  chatInput.addEventListener('blur', () => { if (chatOpen) setTimeout(() => chatOpen && chatInput.focus(), 0) })

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
  let lastLockExit = 0
  const stopRelockPoll = () => {
    if (relockPoll) { clearInterval(relockPoll); relockPoll = null }
  }
  const tryRelock = () => {
    if (!started || paused || invOpen || chatOpen || locked) { stopRelockPoll(); return }
    lockPointer()
  }
  const startRelockPoll = () => {
    stopRelockPoll()
    tryRelock()
    relockPoll = setInterval(tryRelock, 40)
    setTimeout(stopRelockPoll, 30000)
  }
  for (const type of ['mousemove', 'mousedown', 'keydown', 'pointermove', 'touchstart']) {
    addEventListener(type, () => {
      if (started && !paused && !invOpen && !chatOpen && !locked && !isPauseLayerOpen()) tryRelock()
    }, { capture: true })
  }
  const closePause = () => {
    paused = false
    hidePauseLayers()
    suppressPause = true
    lastCloseAt = performance.now()
    startRelockPoll()
  }
  btnResume.addEventListener('click', closePause)
  btnBackToServerList.addEventListener('click', () => {
    document.exitPointerLock()
    try { socket?.close() } catch {}
    location.reload()
  })

  const guiCanvasText = (str, color) => {
    const c = makeBitmapTextCanvas(str, 1, color)
    c.style.width = `calc(${c.width}px * var(--s))`
    c.style.height = `calc(${c.height}px * var(--s))`
    return c
  }
  const chestBox = document.getElementById('chestBox')
  const chestSlots = []
  {
    const title = document.createElement('div')
    title.className = 'chest-title'
    title.appendChild(guiCanvasText('Choose Block', '#404040'))
    chestBox.appendChild(title)
    BLOCK_CHOICES.forEach((name, i) => {
      const s = document.createElement('div')
      s.className = 'chest-slot'
      s.style.left = `calc(${8 + (i % 9) * 18}px * var(--s))`
      s.style.top = `calc(${18 + Math.floor(i / 9) * 18}px * var(--s))`
      s.title = name.replace(/_/g, ' ')
      s.appendChild(blockIcon(ID[name]))
      s.addEventListener('click', () => {
        commitLoadout(null, name)
        refreshChestSel()
        playSound('ui_click', { volume: 0.35 })
      })
      chestBox.appendChild(s)
      chestSlots.push(s)
    })
  }
  const refreshChestSel = () => chestSlots.forEach((s, i) => s.classList.toggle('sel', BLOCK_CHOICES[i] === settings.placeBlock))
  btnChangeBlocks.addEventListener('click', () => {
    refreshChestSel()
    showPauseLayer(blockPicker)
  })
  btnBlockPickerDone.addEventListener('click', () => showPauseLayer(pause))

  const heBar = document.getElementById('heBar')
  const heCursor = document.getElementById('heCursor')
  let heLayout = []
  let heHeld = ''
  const heSlots = []
  const heIcon = (t) => {
    const d = defFor(t)
    return d.type === 'block' ? blockIcon(ID[d.block]) : itemIcon(d.item)
  }
  const heRender = () => {
    heSlots.forEach((s, i) => {
      s.replaceChildren()
      if (heLayout[i]) s.appendChild(heIcon(heLayout[i]))
    })
    heCursor.replaceChildren()
    if (heHeld) heCursor.appendChild(heIcon(heHeld))
    heCursor.style.display = heHeld ? 'block' : 'none'
  }
  const heClick = (i) => {
    const cur = heLayout[i]
    if (heHeld) {
      heLayout[i] = heHeld
      heHeld = cur
    } else if (cur) {
      heHeld = cur
      heLayout[i] = ''
    } else {
      return
    }
    playSound('ui_click', { volume: 0.35 })
    heRender()
  }
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('div')
    s.className = 'he-slot'
    s.style.left = `calc(${3 + i * 20}px * var(--s))`
    s.addEventListener('click', () => heClick(i))
    heBar.appendChild(s)
    heSlots.push(s)
  }
  addEventListener('mousemove', (e) => {
    if (!heHeld) return
    heCursor.style.left = `calc(${e.clientX}px - 8px * var(--s))`
    heCursor.style.top = `calc(${e.clientY}px - 8px * var(--s))`
  })
  const openHotbarEditor = () => {
    heLayout = [...settings.hotbar]
    heHeld = ''
    heRender()
    showPauseLayer(hotbarEditor)
  }
  const cancelHotbarEditor = () => {
    heHeld = ''
    heRender()
    showPauseLayer(options)
  }
  btnHotbarOpen.addEventListener('click', openHotbarEditor)
  btnHotbarCancel.addEventListener('click', cancelHotbarEditor)
  btnHotbarReset.addEventListener('click', () => {
    heLayout = [...HOTBAR_DEFAULT]
    heHeld = ''
    heRender()
  })
  btnHotbarSave.addEventListener('click', () => {
    if (heHeld) {
      const empty = heLayout.indexOf('')
      if (empty >= 0) heLayout[empty] = heHeld
      heHeld = ''
    }
    commitLoadout(heLayout)
    heRender()
    showPauseLayer(options)
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

  const sensToDeg = (v) => {
    const f = (v / 200) * 0.6 + 0.2
    return f * f * f * 8 * 0.15
  }
  const refreshOptionsUI = () => {
    setPixelText(btnToggleSprint, 'Sprint: ' + (settings.toggleSprint ? 'Toggle' : 'Hold'), 2, '#e0e0e0')
    setPixelText(btnGuiScale, 'GUI Scale: ' + (settings.guiScale === 0 ? 'Auto' : settings.guiScale), 2, '#e0e0e0')
    sldSens.querySelector('.mc-slider-fill').style.width = settings.mouseSens / 2 + '%'
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
    sldChatTextOpacity.querySelector('.mc-slider-fill').style.width = settings.chatTextOpacity + '%'
    setPixelText(sldChatTextOpacity.querySelector('.mc-slider-label'), settings.chatTextOpacity + '%', 2, '#ffffff')
    sldChatOpacity.querySelector('.mc-slider-fill').style.width = settings.chatOpacity + '%'
    setPixelText(sldChatOpacity.querySelector('.mc-slider-label'), settings.chatOpacity + '%', 2, '#ffffff')
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
  bindSlider(
    sldChatTextOpacity,
    () => settings.chatTextOpacity,
    (t) => (settings.chatTextOpacity = Math.round(t * 100)),
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
      if (e.repeat) { e.preventDefault(); return }
      if (performance.now() - lastEscAt < 300) return
      lastEscAt = performance.now()
      if (invOpen) {
        e.preventDefault()
        closeInventory()
      } else if (hotbarEditor.classList.contains('show')) {
        cancelHotbarEditor()
      } else if (blockPicker.classList.contains('show')) {
        showPauseLayer(pause)
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
    if (e.key === '/' || e.code === 'Slash' || e.code === settings.keys.command) {
      e.preventDefault()
      openChat('/')
      return
    }
    if (e.code === 'KeyT' || e.key === 't' || e.key === 'T' || e.code === settings.keys.chat) {
      e.preventDefault()
      openChat()
      return
    }
    if (e.code === 'Tab') {
      e.preventDefault()
      if (!invOpen) tabList.setVisible(true)
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
    if (e.code === 'Tab') tabList.setVisible(false)
  })
  addEventListener('blur', () => {
    tabList.setVisible(false)
    for (const k in keys) keys[k] = false
  })

  canvas.addEventListener('click', () => {
    if (!locked && !isPauseLayerOpen() && !chatOpen && !invOpen) lockPointer()
  })
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas
    if (locked) {
      started = true
      try { navigator.keyboard?.lock?.(["Escape"])?.catch?.(() => {}) } catch {}
      billboard.start()
      hidePauseLayers()
      paused = false
      menu.style.display = 'none'
    } else {
      lastLockExit = performance.now()
      local.act.breakHeld = false
      local.act.useHeld = false
      menu.style.display = started ? 'none' : 'flex'
      if (started && !invOpen && !chatOpen && !suppressPause && performance.now() - lastCloseAt > 700) {
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
      local.swingTick = clientAnimationTick
    }
    if (settings.keys.use === 'Mouse2' && e.button === 2) {
      local.act.useHeld = true
      local.act.useClick = true
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
    const rec = {
      fwd: i.fwd,
      strafe: i.strafe,
      jump: i.jump,
      sneak: i.sneak,
      yaw: local.yaw,
      pitch: local.pitch,
      slot: local.slot,
      sprint: local.act.sprintTap,
      stopSprint: sprintStopPending,
      pingAt: performance.now(),
      ping: Math.round(local.ping || 0)
    }
    sprintStopPending = false
    return rec
  }

  const onlineTick = (rec) => {
    const act = local.act
    const useClick = act.useClick
    act.useClick = false
    if (useClick) act.usePending = true
    const slotType = C.HOTBAR[local.slot]?.type
    if (slotType !== 'block') act.usePending = false
    let target = null
    if (local.alive && locked && (act.useHeld || act.usePending)) {
      const eye = local.eye()
      const d = local.look()
      target = raycastBlocks(world, eye.x, eye.y, eye.z, d.x, d.y, d.z, C.REACH_BLOCK)
    }
    if (local.alive && target && slotType === 'block' && (act.useHeld || act.usePending) && local.useDelay === 0) {
      act.usePending = false
      predictPlace(target)
    } else if (local.useDelay === 0 && slotType === 'block' && (act.useHeld || act.usePending) && local.alive) {
      local.useDelay = 4
      act.usePending = false
    }
    rec.attack = act.attack
    act.attack = false
    rec.useHeld = act.useHeld
    rec.useClick = useClick
    rec.target = target
    rec.placeSeq = placeSeq
    rec.seq = ++inputSeq
    pendingInputs.push({ seq: rec.seq, fwd: rec.fwd, strafe: rec.strafe, jump: rec.jump, sneak: rec.sneak, yaw: rec.yaw, sprint: rec.sprint, stopSprint: rec.stopSprint })
    if (pendingInputs.length > 60) pendingInputs.shift()
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', ...rec }))
    if (local.alive) game.move(local)
  }

  const hurtCam = { time: 0, yaw: 0 }
  const hurtQa = new THREE.Quaternion()
  const hurtQz = new THREE.Quaternion()
  const hurtQb = new THREE.Quaternion()
  const AXIS_Y = new THREE.Vector3(0, 1, 0)
  const AXIS_Z = new THREE.Vector3(0, 0, 1)
  const name = (id) => (game.players.get(id) ? game.players.get(id).name : '?')
  const handleEvents = () => {
    for (const ev of game.events) {
      // KBFFA has no spatial sound engine yet, so play only sounds caused by
      // the local player. This keeps bot sounds from stacking on top of one
      // another while retaining every player action's Minecraft event mapping.
      if (ev.id === local.id) {
        if (ev.type === 'hurt') {
          hurtCam.time = 10
          hurtCam.yaw = Number.isFinite(ev.angle) ? ev.angle - (local.yaw * 180) / Math.PI : 0
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
      if (ev.type === 'hurt' && ev.id !== local.id) {
        const hm = models.get(ev.id)
        if (hm) hm.amp = 1.5
      }
      if (ev.type === 'death') {
        const victim = ev.victimName ?? name(ev.victim)
        const killer = ev.killer != null ? ev.killerName ?? name(ev.killer) : null
        const line = killer ? `\u00a7a${killer}\u00a7f knocked \u00a7c${victim}\u00a7f into the void` : `\u00a7c${victim}\u00a7f fell into the void`
        hud.addFeed(line)
        addChatLine(line)
      }
      if (ev.type === 'chat') addChatLine(ev.text)
    }
    game.events.length = 0
  }

  let fovMod = 1
  let fovModOld = 1
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
    camera.rotation.set(-local.pitch, Math.PI - local.yaw, 0)
    if (hurtCam.time > 0) {
      const f0 = (hurtCam.time - alpha) / 10
      if (f0 > 0) {
        const f = Math.sin(f0 * f0 * f0 * f0 * Math.PI)
        const a = (hurtCam.yaw * Math.PI) / 180
        hurtQa.setFromAxisAngle(AXIS_Y, -a)
        hurtQz.setFromAxisAngle(AXIS_Z, (f * 14 * Math.PI) / 180)
        hurtQb.setFromAxisAngle(AXIS_Y, a)
        camera.quaternion.multiply(hurtQa.multiply(hurtQz).multiply(hurtQb))
      }
    }
    if (tabList.visible) tabList.update([...game.players.values()].map((p) => ({ name: p.name, ping: p === local ? local.ping : p.ping })))
    const fov = settings.fov * lerp(fovModOld, fovMod, alpha)
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
    billboard.render(camera)
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
      const rec = pollInput()
      clientAnimationTick++
      if (!online) game.update()
      else {
        Object.assign(local.prev, local.pos)
        local.prevYaw = local.yaw
        local.prevPitch = local.pitch
        if (local.useDelay > 0) local.useDelay--
        onlineTick(rec)
        const selected = C.HOTBAR[local.slot]
        visualBowTicks = selected?.type === 'bow' && local.act.useHeld ? visualBowTicks + 1 : -1
      }
      if (hurtCam.time > 0) hurtCam.time--
      fovModOld = fovMod
      fovMod += ((local.sprinting ? 1.15 : 1) - fovMod) * 0.5
      handleEvents()
      acc -= 50
    }
    render(acc / 50, dt / 1000)
  }
  requestAnimationFrame(frame)
}

main()
