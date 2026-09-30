import { ID } from '../blocks.js'

export default {
  name: 'sky',
  spawn: { x: 0.5, y: 80, z: 0.5 },
  build(world) {
    const disc = (y, r, id) => {
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          if (x * x + z * z <= r * r + r) world.set(x, y, z, id)
        }
      }
    }
    disc(63, 14, ID.grass)
    disc(62, 14, ID.dirt)
    disc(61, 13, ID.dirt)
    disc(60, 11, ID.stone)
    disc(59, 9, ID.stone)
    disc(58, 7, ID.stone)
    disc(57, 5, ID.stone)
    disc(56, 3, ID.stone)
    disc(55, 1, ID.stone)
    for (const [px, pz] of [[8, 8], [-8, 8], [8, -8], [-8, -8]]) {
      for (let y = 64; y <= 66; y++) world.set(px, y, pz, ID.stone)
    }
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) world.set(x, 79, z, ID.spawn)
    }
  }
}
