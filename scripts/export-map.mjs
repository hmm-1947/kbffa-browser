import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from '../src/config.js'
import { World } from '../src/world.js'
import { BLOCK_DEFS } from '../src/blocks.js'
import nik from '../src/maps/nik.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server-rs')

const world = new World(CONFIG.WORLD)
nik.build(world)

const runs = []
let prev = world.data[0]
let n = 1
for (let i = 1; i < world.data.length; i++) {
  if (world.data[i] === prev) n++
  else {
    runs.push([n, prev])
    prev = world.data[i]
    n = 1
  }
}
runs.push([n, prev])
const buf = Buffer.alloc(runs.length * 5)
runs.forEach(([count, id], i) => {
  buf.writeUInt32LE(count, i * 5)
  buf[i * 5 + 4] = id
})
fs.mkdirSync(path.join(root, 'data'), { recursive: true })
fs.writeFileSync(path.join(root, 'data', 'map.bin'), buf)

const softSound = (name) => /wool|leaves|snow|mud|grass/.test(name)
const lines = BLOCK_DEFS.map((d) => {
  if (!d) return '    BlockDef { name: "air", sound: "" },'
  const sound = d.sound || (softSound(d.name) ? 'grass' : 'stone')
  return `    BlockDef { name: "${d.name}", sound: "${sound}" },`
})
const src = `pub struct BlockDef {
    pub name: &'static str,
    pub sound: &'static str,
}

pub const BLOCK_DEFS: &[BlockDef] = &[
${lines.join('\n')}
];

pub fn id_of(name: &str) -> u8 {
    BLOCK_DEFS.iter().position(|d| d.name == name).unwrap_or(0) as u8
}

pub fn sound_of(id: u8) -> &'static str {
    BLOCK_DEFS.get(id as usize).map(|d| d.sound).unwrap_or("stone")
}
`
fs.writeFileSync(path.join(root, 'src', 'blocks.rs'), src)
console.log(`map.bin ${buf.length} bytes (${runs.length} runs), blocks.rs ${BLOCK_DEFS.length} entries`)
