import fs from 'node:fs'
import path from 'node:path'

const MC = 'C:/Users/Admin/Desktop/testestst/assets/minecraft/textures'
const OUT = 'D:/projects/kbffa/public/textures'

const copy = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  console.log('ok', dst)
}

const blocks = {
  grass_block_top: 'grass_block_top',
  dirt: 'dirt',
  grass_block_side: 'grass_block_side',
  grass_block_side_overlay: 'grass_block_side_overlay',
  stone: 'stone',
  bedrock: 'bedrock',
  sandstone_top: 'sandstone_top',
  sandstone_bottom: 'sandstone_bottom',
  sandstone_side: 'sandstone',
  spawn: null,
  cobblestone: 'cobblestone',
  oak_planks: 'oak_planks',
  oak_log_top: 'oak_log_top',
  oak_log: 'oak_log',
  oak_leaves: 'oak_leaves',
  spruce_planks: 'spruce_planks',
  spruce_log_top: 'spruce_log_top',
  spruce_log: 'spruce_log',
  spruce_leaves: 'spruce_leaves',
  birch_planks: 'birch_planks',
  birch_log_top: 'birch_log_top',
  birch_log: 'birch_log',
  birch_leaves: 'birch_leaves',
  sand: 'sand',
  gravel: 'gravel',
  bricks: 'bricks',
  stone_bricks: 'stone_bricks',
  glass: 'glass',
  gold_block: 'gold_block',
  iron_block: 'iron_block',
  diamond_block: 'diamond_block',
  emerald_block: 'emerald_block',
  coal_block: 'coal_block',
  redstone_block: 'redstone_block',
  lapis_block: 'lapis_block',
  obsidian: 'obsidian',
  white_wool: 'white_wool',
  red_wool: 'red_wool',
  blue_wool: 'blue_wool',
  black_wool: 'black_wool',
  yellow_wool: 'yellow_wool',
  green_wool: 'green_wool',
  orange_wool: 'orange_wool',
  netherrack: 'netherrack',
  snow: 'snow',
  ice: 'ice',
  clay: 'clay',
  mud: 'mud'
}

for (const [ours, real] of Object.entries(blocks)) {
  if (!real) continue
  const src = `${MC}/block/${real}.png`
  if (!fs.existsSync(src)) { console.warn('MISSING', src); continue }
  copy(src, `${OUT}/blocks/${ours}.png`)
}

const items = {
  stick: 'stick',
  bow_standby: 'bow',
  bow_pulling_0: 'bow_pulling_0',
  bow_pulling_1: 'bow_pulling_1',
  bow_pulling_2: 'bow_pulling_2',
  arrow: 'arrow',
  ender_pearl: 'ender_pearl'
}
for (const [ours, real] of Object.entries(items)) {
  const src = `${MC}/item/${real}.png`
  if (!fs.existsSync(src)) { console.warn('MISSING', src); continue }
  copy(src, `${OUT}/items/${ours}.png`)
}

copy(`${MC}/entity/player/wide/steve.png`, `${OUT}/entity/steve.png`)
copy(`${MC}/font/ascii.png`, `${OUT}/font/ascii.png`)

copy(`${MC}/gui/sprites/hud/hotbar.png`, `${OUT}/gui/hotbar.png`)
copy(`${MC}/gui/sprites/hud/hotbar_selection.png`, `${OUT}/gui/hotbar_selected.png`)
copy(`${MC}/gui/sprites/hud/crosshair.png`, `${OUT}/gui/crosshair.png`)
copy(`${MC}/title/minecraft.png`, `${OUT}/gui/logo.png`)
copy(`${MC}/title/edition.png`, `${OUT}/gui/edition.png`)
copy(`${MC}/gui/inworld_menu_background.png`, `${OUT}/gui/menu_background.png`)
copy(`${MC}/gui/inworld_menu_list_background.png`, `${OUT}/gui/menu_list_background.png`)

for (const name of ['button', 'button_disabled', 'button_highlighted', 'slider', 'slider_highlighted', 'text_field', 'text_field_highlighted']) {
  copy(`${MC}/gui/sprites/widget/${name}.png`, `${OUT}/gui/widget/${name}.png`)
}

console.log('done')