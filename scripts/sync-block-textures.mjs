// Copies every block texture referenced by src/blocks.js that is not yet in
// public/textures/blocks from the vanilla resource pack in ../16text.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blockTextureNames } from '../src/blocks.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dest = path.resolve(here, '..', 'public', 'textures', 'blocks')
const src = path.resolve(here, '..', '..', '16text', 'assets', 'minecraft', 'textures', 'block')

let copied = 0
const missing = []
for (const name of blockTextureNames()) {
  const to = path.join(dest, `${name}.png`)
  if (fs.existsSync(to)) continue
  const from = path.join(src, `${name}.png`)
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to)
    copied++
  } else missing.push(name)
}
console.log(`copied ${copied} textures`)
if (missing.length) console.log('MISSING (not in resource pack):', missing.join(', '))
