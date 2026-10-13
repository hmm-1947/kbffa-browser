export const CONFIG = {
  TPS: 20,
  WORLD: { sx: 192, sy: 160, sz: 192, ox: 96, oz: 96 },
  JUMP_VY: 0.42,
  REACH_ATTACK: 3.0,
  REACH_BLOCK: 5.0,
  KB_LEVEL: 4,
  HURT_RESISTANT: 20,
  VOID_Y: -48,
  RESPAWN_TICKS: 10,
  KILL_CREDIT_TICKS: 200,
  BLOCK_LIFETIME: 200,
  PLATE_LIFETIME: 200,
  PLATE_LAUNCH_VY: 2.0,
  BUILD_MAX_Y: 110,
  START_PEARLS: 1,
  PEARL_PER_KILL: 1,
  START_ARROWS: 64,
  INFINITE_ARROWS: true,
  ARROW_STAY_TICKS: 40,
  BOTS: 0,
  PLACE_BLOCK: 'sandstone',
  PROTECT_MAP_BLOCKS: true,
  FOV: 70,
  MOUSE_SENS: 0.15,
  AD: { x: 0, y: 150, z: -75, w: 36, h: 30, width: 300, height: 250, zone: 10, client: '', slot: '', testImage: '/ads/test.png' },
  HOTBAR: [
    { type: 'stick', item: 'stick' },
    { type: 'bow', item: 'bow_standby' },
    { type: 'block', block: 'sandstone' },
    { type: 'pearl', item: 'ender_pearl' },
    { type: 'plate', item: 'gold_pressure_plate' }
  ]
}

export const inAdZone = (x, y, z) => {
  const a = CONFIG.AD
  return Math.abs(x + 0.5 - a.x) <= a.w / 2 + 1 + a.zone && Math.abs(y + 0.5 - a.y) <= a.h / 2 + 4 + a.zone && Math.abs(z + 0.5 - a.z) <= a.zone + 1
}

export const HOTBAR_ITEMS = ['stick', 'bow', 'block', 'pearl', 'plate']
export const HOTBAR_DEFAULT = ['stick', 'bow', 'block', 'pearl', 'plate', '', '', '', '']
export const BLOCK_CHOICES = [
  'stone', 'cobblestone', 'dirt', 'oak_planks', 'spruce_planks', 'birch_planks', 'sandstone', 'red_sandstone', 'bricks',
  'stone_bricks', 'white_wool', 'red_wool', 'blue_wool', 'netherrack', 'obsidian', 'coal_block', 'iron_block', 'gold_block',
  'diamond_block', 'emerald_block', 'lapis_block', 'clay', 'terracotta', 'glowstone', 'bookshelf', 'oak_log', 'end_stone'
]
