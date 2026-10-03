use crate::config::*;

pub struct World {
    pub data: Vec<u8>,
}

impl World {
    pub fn new() -> Self {
        World { data: vec![0u8; (WORLD_SX * WORLD_SY * WORLD_SZ) as usize] }
    }

    pub fn in_bounds(&self, x: i32, y: i32, z: i32) -> bool {
        let ix = x + WORLD_OX;
        let iz = z + WORLD_OZ;
        ix >= 0 && ix < WORLD_SX && y >= 0 && y < WORLD_SY && iz >= 0 && iz < WORLD_SZ
    }

    #[inline]
    fn index(&self, x: i32, y: i32, z: i32) -> usize {
        let ix = x + WORLD_OX;
        let iz = z + WORLD_OZ;
        ((y * WORLD_SZ + iz) * WORLD_SX + ix) as usize
    }

    pub fn get(&self, x: i32, y: i32, z: i32) -> u8 {
        if !self.in_bounds(x, y, z) {
            return 0;
        }
        self.data[self.index(x, y, z)]
    }

    pub fn set(&mut self, x: i32, y: i32, z: i32, id: u8) -> bool {
        if !self.in_bounds(x, y, z) {
            return false;
        }
        let i = self.index(x, y, z);
        self.data[i] = id;
        true
    }

    pub fn is_solid(&self, x: i32, y: i32, z: i32) -> bool {
        self.get(x, y, z) != 0
    }
}

pub fn build_sky(world: &mut World) {
    use crate::blocks::id_of;
    let mut disc = |y: i32, r: i32, id: u8| {
        for x in -r..=r {
            for z in -r..=r {
                if x * x + z * z <= r * r + r {
                    world.set(x, y, z, id);
                }
            }
        }
    };
    disc(63, 14, id_of("grass"));
    disc(62, 14, id_of("dirt"));
    disc(61, 13, id_of("dirt"));
    disc(60, 11, id_of("stone"));
    disc(59, 9, id_of("stone"));
    disc(58, 7, id_of("stone"));
    disc(57, 5, id_of("stone"));
    disc(56, 3, id_of("stone"));
    disc(55, 1, id_of("stone"));
    let stone = id_of("stone");
    for (px, pz) in [(8, 8), (-8, 8), (8, -8), (-8, -8)] {
        for y in 64..=66 {
            world.set(px, y, pz, stone);
        }
    }
    let spawn = id_of("spawn");
    for x in -1..=1 {
        for z in -1..=1 {
            world.set(x, 79, z, spawn);
        }
    }
}
