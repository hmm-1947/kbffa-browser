use crate::config::*;
use crate::world::World;

#[derive(Clone, Copy)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Copy)]
pub struct Aabb {
    pub min_x: f64,
    pub min_y: f64,
    pub min_z: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub max_z: f64,
}

pub fn player_box(pos: &Vec3, pad: f64) -> Aabb {
    let h = PW / 2.0 + pad;
    Aabb {
        min_x: pos.x - h,
        min_y: pos.y - pad,
        min_z: pos.z - h,
        max_x: pos.x + h,
        max_y: pos.y + PH + pad,
        max_z: pos.z + h,
    }
}

pub fn overlaps_solid(world: &World, b: &Aabb) -> bool {
    let x0 = b.min_x.floor() as i32;
    let x1 = b.max_x.ceil() as i32 - 1;
    let y0 = b.min_y.floor() as i32;
    let y1 = b.max_y.ceil() as i32 - 1;
    let z0 = b.min_z.floor() as i32;
    let z1 = b.max_z.ceil() as i32 - 1;
    for x in x0..=x1 {
        for y in y0..=y1 {
            for z in z0..=z1 {
                if world.is_solid(x, y, z) {
                    return true;
                }
            }
        }
    }
    false
}

fn offset(b: &Aabb, x: f64, y: f64, z: f64) -> Aabb {
    Aabb {
        min_x: b.min_x + x,
        min_y: b.min_y + y,
        min_z: b.min_z + z,
        max_x: b.max_x + x,
        max_y: b.max_y + y,
        max_z: b.max_z + z,
    }
}

fn reduce(v: f64, s: f64) -> f64 {
    if v > -s && v < s {
        0.0
    } else if v > 0.0 {
        v - s
    } else {
        v + s
    }
}

pub struct MoveResult {
    pub on_ground: bool,
    pub h_collide: bool,
    pub stopped_x: bool,
    pub stopped_y: bool,
    pub stopped_z: bool,
}

pub fn move_entity(
    world: &World,
    pos: &mut Vec3,
    sneaking: bool,
    on_ground_prev: bool,
    mut dx: f64,
    mut dy: f64,
    mut dz: f64,
) -> MoveResult {
    let mut box_ = player_box(pos, 0.0);

    if sneaking && on_ground_prev {
        let s = 0.05;
        while dx != 0.0 && !overlaps_solid(world, &offset(&box_, dx, -1.0, 0.0)) {
            dx = reduce(dx, s);
        }
        while dz != 0.0 && !overlaps_solid(world, &offset(&box_, 0.0, -1.0, dz)) {
            dz = reduce(dz, s);
        }
        while dx != 0.0 && dz != 0.0 && !overlaps_solid(world, &offset(&box_, dx, -1.0, dz)) {
            dx = reduce(dx, s);
            dz = reduce(dz, s);
        }
    }

    let ox = dx;
    let oy = dy;
    let oz = dz;

    let x0 = (box_.min_x + dx.min(0.0)).floor() as i32;
    let x1 = (box_.max_x + dx.max(0.0)).ceil() as i32 - 1;
    let y0 = (box_.min_y + dy.min(0.0)).floor() as i32;
    let y1 = (box_.max_y + dy.max(0.0)).ceil() as i32 - 1;
    let z0 = (box_.min_z + dz.min(0.0)).floor() as i32;
    let z1 = (box_.max_z + dz.max(0.0)).ceil() as i32 - 1;

    let mut cells = Vec::new();
    for x in x0..=x1 {
        for y in y0..=y1 {
            for z in z0..=z1 {
                if world.is_solid(x, y, z) {
                    cells.push((x, y, z));
                }
            }
        }
    }

    // Y axis first (matches vanilla / original JS ordering).
    for &(cx, cy, cz) in &cells {
        let cx = cx as f64;
        let cy = cy as f64;
        let cz = cz as f64;
        if box_.max_x <= cx || box_.min_x >= cx + 1.0 || box_.max_z <= cz || box_.min_z >= cz + 1.0 {
            continue;
        }
        if dy > 0.0 && box_.max_y <= cy {
            dy = dy.min(cy - box_.max_y);
        } else if dy < 0.0 && box_.min_y >= cy + 1.0 {
            dy = dy.max(cy + 1.0 - box_.min_y);
        }
    }
    box_.min_y += dy;
    box_.max_y += dy;

    // X axis, re-checked against the box's post-Y-move vertical extent.
    for &(cx, cy, cz) in &cells {
        let cx = cx as f64;
        let cy = cy as f64;
        let cz = cz as f64;
        if box_.max_y <= cy || box_.min_y >= cy + 1.0 || box_.max_z <= cz || box_.min_z >= cz + 1.0 {
            continue;
        }
        if dx > 0.0 && box_.max_x <= cx {
            dx = dx.min(cx - box_.max_x);
        } else if dx < 0.0 && box_.min_x >= cx + 1.0 {
            dx = dx.max(cx + 1.0 - box_.min_x);
        }
    }
    box_.min_x += dx;
    box_.max_x += dx;

    // Z axis, re-checked against the box's post-X-move horizontal extent too.
    for &(cx, cy, cz) in &cells {
        let cx = cx as f64;
        let cy = cy as f64;
        let cz = cz as f64;
        if box_.max_y <= cy || box_.min_y >= cy + 1.0 || box_.max_x <= cx || box_.min_x >= cx + 1.0 {
            continue;
        }
        if dz > 0.0 && box_.max_z <= cz {
            dz = dz.min(cz - box_.max_z);
        } else if dz < 0.0 && box_.min_z >= cz + 1.0 {
            dz = dz.max(cz + 1.0 - box_.min_z);
        }
    }
    box_.min_z += dz;
    box_.max_z += dz;

    pos.x = (box_.min_x + box_.max_x) / 2.0;
    pos.y = box_.min_y;
    pos.z = (box_.min_z + box_.max_z) / 2.0;

    MoveResult {
        on_ground: oy != dy && oy < 0.0,
        h_collide: ox != dx || oz != dz,
        stopped_x: ox != dx,
        stopped_y: oy != dy,
        stopped_z: oz != dz,
    }
}
