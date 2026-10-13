import { CONFIG as C } from './config.js'
import { settings, saveSettings } from './settings.js'

const DEFS = {
  stick: { type: 'stick', item: 'stick' },
  bow: { type: 'bow', item: 'bow_standby' },
  pearl: { type: 'pearl', item: 'ender_pearl' },
  plate: { type: 'plate', item: 'gold_pressure_plate' }
}

const listeners = []

export const defFor = (t) => (!t ? undefined : t === 'block' ? { type: 'block', block: C.PLACE_BLOCK } : DEFS[t])
export const onLoadout = (fn) => listeners.push(fn)

export const applyLoadout = () => {
  C.PLACE_BLOCK = settings.placeBlock
  C.HOTBAR.length = 0
  for (const t of settings.hotbar) C.HOTBAR.push(defFor(t))
  for (const fn of listeners) fn()
}

export const commitLoadout = (hotbar, block) => {
  if (hotbar) settings.hotbar = [...hotbar]
  if (block) settings.placeBlock = block
  saveSettings()
  applyLoadout()
}
