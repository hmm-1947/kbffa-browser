pub const TPS: u64 = 20;
pub const TICK_MS: u64 = 1000 / TPS;

pub const WORLD_SX: i32 = 192;
pub const WORLD_SY: i32 = 160;
pub const WORLD_SZ: i32 = 192;
pub const WORLD_OX: i32 = 96;
pub const WORLD_OZ: i32 = 96;

pub const JUMP_VY: f64 = 0.42;
pub const REACH_ATTACK: f64 = 3.0;
pub const REACH_BLOCK: f64 = 5.0;
pub const KB_LEVEL: f64 = 4.0;
pub const HURT_RESISTANT: i64 = 20;
pub const VOID_Y: f64 = -48.0;
pub const RESPAWN_TICKS: i64 = 10;
pub const KILL_CREDIT_TICKS: i64 = 200;
pub const BLOCK_LIFETIME: i64 = 200;
pub const PLATE_LIFETIME: i64 = 200;
pub const PLATE_LAUNCH_VY: f64 = 2.0;
pub const BUILD_MAX_Y: i32 = 110;
pub const START_PEARLS: i32 = 1;
pub const PEARL_PER_KILL: i32 = 1;
pub const START_ARROWS: i32 = 64;
pub const INFINITE_ARROWS: bool = true;
pub const ARROW_STAY_TICKS: i64 = 40;
pub const PLACE_BLOCK: &str = "sandstone";
pub const PROTECT_MAP_BLOCKS: bool = true;

pub const PW: f64 = 0.6;
pub const PH: f64 = 1.8;
pub const AD_X: f64 = 0.0;
pub const AD_Y: f64 = 150.0;
pub const AD_Z: f64 = -75.0;
pub const AD_W: f64 = 36.0;
pub const AD_H: f64 = 30.0;
pub const AD_ZONE: f64 = 10.0;

pub fn in_ad_zone(x: i32, y: i32, z: i32) -> bool {
    (x as f64 + 0.5 - AD_X).abs() <= AD_W / 2.0 + 1.0 + AD_ZONE
        && (y as f64 + 0.5 - AD_Y).abs() <= AD_H / 2.0 + 4.0 + AD_ZONE
        && (z as f64 + 0.5 - AD_Z).abs() <= AD_ZONE + 1.0
}
