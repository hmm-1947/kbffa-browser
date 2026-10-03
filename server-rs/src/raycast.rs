use crate::physics::Aabb;
use crate::world::World;

pub struct RayHit {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub nx: i32,
    pub ny: i32,
    pub nz: i32,
    pub t: f64,
}

pub fn raycast_blocks(
    world: &World,
    ox: f64,
    oy: f64,
    oz: f64,
    dx: f64,
    dy: f64,
    dz: f64,
    max_dist: f64,
) -> Option<RayHit> {
    let mut x = ox.floor() as i32;
    let mut y = oy.floor() as i32;
    let mut z = oz.floor() as i32;
    let sx: i32 = if dx > 0.0 { 1 } else { -1 };
    let sy: i32 = if dy > 0.0 { 1 } else { -1 };
    let sz: i32 = if dz > 0.0 { 1 } else { -1 };
    let tdx = if dx != 0.0 { (1.0 / dx).abs() } else { f64::INFINITY };
    let tdy = if dy != 0.0 { (1.0 / dy).abs() } else { f64::INFINITY };
    let tdz = if dz != 0.0 { (1.0 / dz).abs() } else { f64::INFINITY };
    let mut tx = if dx > 0.0 {
        (x as f64 + 1.0 - ox) * tdx
    } else if dx < 0.0 {
        (ox - x as f64) * tdx
    } else {
        f64::INFINITY
    };
    let mut ty = if dy > 0.0 {
        (y as f64 + 1.0 - oy) * tdy
    } else if dy < 0.0 {
        (oy - y as f64) * tdy
    } else {
        f64::INFINITY
    };
    let mut tz = if dz > 0.0 {
        (z as f64 + 1.0 - oz) * tdz
    } else if dz < 0.0 {
        (oz - z as f64) * tdz
    } else {
        f64::INFINITY
    };
    let mut nx = 0;
    let mut ny = 0;
    let mut nz = 0;
    let mut t;

    if world.is_solid(x, y, z) {
        return Some(RayHit { x, y, z, nx, ny, nz, t: 0.0 });
    }
    if !dx.is_finite() || !dy.is_finite() || !dz.is_finite() {
        return None;
    }
    // Bound iterations defensively so a pathological input can never hang
    // the caller: one step per unit of max_dist is always enough headroom.
    let mut guard = (max_dist.ceil() as i64) * 3 + 8;

    loop {
        guard -= 1;
        if guard < 0 {
            return None;
        }
        if tx <= ty && tx <= tz {
            t = tx;
            if t > max_dist {
                return None;
            }
            x += sx;
            tx += tdx;
            nx = -sx;
            ny = 0;
            nz = 0;
        } else if ty <= tz {
            t = ty;
            if t > max_dist {
                return None;
            }
            y += sy;
            ty += tdy;
            nx = 0;
            ny = -sy;
            nz = 0;
        } else {
            t = tz;
            if t > max_dist {
                return None;
            }
            z += sz;
            tz += tdz;
            nx = 0;
            ny = 0;
            nz = -sz;
        }
        if world.is_solid(x, y, z) {
            return Some(RayHit { x, y, z, nx, ny, nz, t });
        }
    }
}

pub fn ray_box(ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, b: &Aabb, max_t: f64) -> Option<f64> {
    let mut tmin = 0.0;
    let mut tmax = max_t;
    let o = [ox, oy, oz];
    let d = [dx, dy, dz];
    let lo = [b.min_x, b.min_y, b.min_z];
    let hi = [b.max_x, b.max_y, b.max_z];
    for i in 0..3 {
        if d[i].abs() < 1e-9 {
            if o[i] < lo[i] || o[i] > hi[i] {
                return None;
            }
            continue;
        }
        let mut t1 = (lo[i] - o[i]) / d[i];
        let mut t2 = (hi[i] - o[i]) / d[i];
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        if t1 > tmin {
            tmin = t1;
        }
        if t2 < tmax {
            tmax = t2;
        }
        if tmin > tmax {
            return None;
        }
    }
    Some(tmin)
}
