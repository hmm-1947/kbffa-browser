import { settings } from './settings.js'

const VERSION = Date.now()

// These groups match the event entries in Minecraft's 26.2 sounds.json.
const SOUND_FILES = {
  grass_break: ['grass_break_1', 'grass_break_2', 'grass_break_3', 'grass_break_4'],
  grass_place: ['grass_break_1', 'grass_break_2', 'grass_break_3', 'grass_break_4'],
  grass_step: ['grass_step_1', 'grass_step_2', 'grass_step_3', 'grass_step_4', 'grass_step_5', 'grass_step_6'],
  stone_break: ['stone_break_1', 'stone_break_2', 'stone_break_3', 'stone_break_4'],
  stone_place: ['stone_break_1', 'stone_break_2', 'stone_break_3', 'stone_break_4'],
  bow_shoot: ['bow'],
  bow_hit: ['bow_hit_1', 'bow_hit_2', 'bow_hit_3', 'bow_hit_4'],
  pearl_throw: ['bow'],
  player_hurt: ['player_hurt_1', 'player_hurt_2', 'player_hurt_3'],
  player_attack: ['attack_1', 'attack_2', 'attack_3', 'attack_4', 'attack_5', 'attack_6'],
  teleport: ['ender_teleport_1', 'ender_teleport_2'],
  pressure_plate: ['pressure_plate'],
  ui_click: ['ui_click']
}

export function playSound(event, { volume = 1, pitch = 1 } = {}) {
  const files = SOUND_FILES[event]
  if (!files) return
  const name = files[Math.floor(Math.random() * files.length)]
  const audio = new Audio(`${import.meta.env.BASE_URL}sounds/${name}.ogg?v=${VERSION}`)
  const master = Math.max(0, Math.min(100, settings.masterVolume ?? 100)) / 100
  audio.volume = Math.max(0, Math.min(1, volume)) * master
  audio.playbackRate = pitch
  // Browsers can reject a sound before the first player interaction.  Sound
  // playback is optional in that situation and becomes available on the next
  // normal interaction, so deliberately avoid an unhandled promise warning.
  audio.play().catch(() => {})
}
