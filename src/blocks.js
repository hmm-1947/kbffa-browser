export const BLOCK_DEFS = [
  null,
  // Vanilla's grass-block model draws the side twice: its dirt base, then a
  // separately tinted transparent grass overlay.  Keep the tint fixed to the
  // vanilla forest biome rather than deriving it from a world biome.
  {
    name: 'grass',
    tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
    tint: 0x79c05a,
    sound: 'grass',
    overlay: { side: 'grass_block_side_overlay' }
  },
  { name: 'dirt', tex: 'dirt' },
  { name: 'stone', tex: 'stone' },
  { name: 'bedrock', tex: 'bedrock' },
  { name: 'sandstone', tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, sound: 'stone' },
  { name: 'spawn', tex: 'spawn' },
  { name: 'cobblestone', tex: 'cobblestone' },
  { name: 'oak_planks', tex: 'oak_planks' },
  { name: 'oak_log', tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' } },
  { name: 'oak_leaves', tex: 'oak_leaves' },
  { name: 'spruce_planks', tex: 'spruce_planks' },
  { name: 'spruce_log', tex: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' } },
  { name: 'spruce_leaves', tex: 'spruce_leaves' },
  { name: 'birch_planks', tex: 'birch_planks' },
  { name: 'birch_log', tex: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' } },
  { name: 'birch_leaves', tex: 'birch_leaves' },
  { name: 'sand', tex: 'sand' },
  { name: 'gravel', tex: 'gravel' },
  { name: 'bricks', tex: 'bricks' },
  { name: 'stone_bricks', tex: 'stone_bricks' },
  { name: 'glass', tex: 'glass' },
  { name: 'gold_block', tex: 'gold_block' },
  { name: 'iron_block', tex: 'iron_block' },
  { name: 'diamond_block', tex: 'diamond_block' },
  { name: 'emerald_block', tex: 'emerald_block' },
  { name: 'coal_block', tex: 'coal_block' },
  { name: 'redstone_block', tex: 'redstone_block' },
  { name: 'lapis_block', tex: 'lapis_block' },
  { name: 'obsidian', tex: 'obsidian' },
  { name: 'white_wool', tex: 'white_wool' },
  { name: 'red_wool', tex: 'red_wool' },
  { name: 'blue_wool', tex: 'blue_wool' },
  { name: 'black_wool', tex: 'black_wool' },
  { name: 'yellow_wool', tex: 'yellow_wool' },
  { name: 'green_wool', tex: 'green_wool' },
  { name: 'orange_wool', tex: 'orange_wool' },
  { name: 'netherrack', tex: 'netherrack' },
  { name: 'snow', tex: 'snow' },
  { name: 'ice', tex: 'ice' },
  { name: 'clay', tex: 'clay' },
  { name: 'mud', tex: 'mud' }
]

export const ID = {}
BLOCK_DEFS.forEach((d, i) => {
  if (d) ID[d.name] = i
})

export function faceTexName(id, face) {
  const t = BLOCK_DEFS[id].tex
  return typeof t === 'string' ? t : t[face]
}

export function blockTextureNames() {
  const set = new Set()
  for (const d of BLOCK_DEFS) {
    if (!d) continue
    if (typeof d.tex === 'string') set.add(d.tex)
    else Object.values(d.tex).forEach((n) => set.add(n))
    if (d.overlay) Object.values(d.overlay).forEach((n) => set.add(n))
  }
  return [...set]
}
