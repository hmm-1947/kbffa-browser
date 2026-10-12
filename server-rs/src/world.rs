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

const MAP: &[u8] = include_bytes!("../data/map.bin");

pub fn build_sky(world: &mut World) {
    let mut at = 0usize;
    for chunk in MAP.chunks_exact(5) {
        let count = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as usize;
        let id = chunk[4];
        if id != 0 {
            world.data[at..at + count].fill(id);
        }
        at += count;
    }
}
