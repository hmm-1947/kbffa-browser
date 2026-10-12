const STORAGE_KEY = 'kbffa_settings_v1'

export const DEFAULT_KEYBINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  attack: 'Mouse0',
  use: 'Mouse2',
  inventory: 'KeyE',
  chat: 'KeyT',
  command: 'Slash',
  hotbar1: 'Digit1',
  hotbar2: 'Digit2',
  hotbar3: 'Digit3',
  hotbar4: 'Digit4',
  hotbar5: 'Digit5',
  hotbar6: 'Digit6',
  hotbar7: 'Digit7',
  hotbar8: 'Digit8',
  hotbar9: 'Digit9'
}

export const ACTION_LABELS = {
  forward: 'Move Forward',
  back: 'Move Backward',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump',
  sneak: 'Sneak',
  sprint: 'Sprint',
  attack: 'Attack / Destroy',
  use: 'Use Item / Place Block',
  inventory: 'Open Inventory',
  chat: 'Open Chat',
  command: 'Open Command',
  hotbar1: 'Hotbar Slot 1',
  hotbar2: 'Hotbar Slot 2',
  hotbar3: 'Hotbar Slot 3',
  hotbar4: 'Hotbar Slot 4',
  hotbar5: 'Hotbar Slot 5',
  hotbar6: 'Hotbar Slot 6',
  hotbar7: 'Hotbar Slot 7',
  hotbar8: 'Hotbar Slot 8',
  hotbar9: 'Hotbar Slot 9'
}

export const CHAT_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

const DEFAULTS = {
  fov: 70,
  guiScale: 0,
  mouseSens: 100,
  sensVersion: 2,
  toggleSprint: false,
  masterVolume: 100,
  chatPosition: 'bottom-left',
  chatLength: 10,
  chatOpacity: 50,
  chatTextOpacity: 100,
  keys: { ...DEFAULT_KEYBINDS }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULTS)
    const parsed = JSON.parse(raw)
    return {
      fov: typeof parsed.fov === 'number' ? parsed.fov : DEFAULTS.fov,
      guiScale: Number.isInteger(parsed.guiScale) && parsed.guiScale >= 0 && parsed.guiScale <= 6 ? parsed.guiScale : DEFAULTS.guiScale,
      mouseSens: parsed.sensVersion === 2 && typeof parsed.mouseSens === 'number' ? Math.max(0, Math.min(200, parsed.mouseSens)) : DEFAULTS.mouseSens,
      sensVersion: 2,
      toggleSprint: !!parsed.toggleSprint,
      masterVolume: typeof parsed.masterVolume === 'number' ? parsed.masterVolume : DEFAULTS.masterVolume,
      chatPosition: CHAT_POSITIONS.includes(parsed.chatPosition) ? parsed.chatPosition : DEFAULTS.chatPosition,
      chatLength: typeof parsed.chatLength === 'number' ? parsed.chatLength : DEFAULTS.chatLength,
      chatOpacity: typeof parsed.chatOpacity === 'number' ? parsed.chatOpacity : DEFAULTS.chatOpacity,
      chatTextOpacity: typeof parsed.chatTextOpacity === 'number' ? parsed.chatTextOpacity : DEFAULTS.chatTextOpacity,
      keys: { ...DEFAULT_KEYBINDS, ...(parsed.keys || {}) }
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export const settings = load()

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

export function resetSettings() {
  Object.assign(settings, structuredClone(DEFAULTS))
  saveSettings()
}

export function keyLabel(code) {
  if (!code) return '---'
  if (code === 'Mouse0') return 'Left Button'
  if (code === 'Mouse1') return 'Middle Button'
  if (code === 'Mouse2') return 'Right Button'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  if (code === 'ShiftLeft') return 'Left Shift'
  if (code === 'ShiftRight') return 'Right Shift'
  if (code === 'ControlLeft') return 'Left Ctrl'
  if (code === 'ControlRight') return 'Right Ctrl'
  if (code === 'Slash') return '/'
  return code
}
