use rand::Rng;
use std::collections::{HashMap, VecDeque};

use crate::blocks::{id_of, sound_of};
use crate::config::*;
use crate::physics::{move_entity, overlaps_solid, player_box, Vec3};
use crate::raycast::{ray_box, raycast_blocks};
use crate::world::{build_sky, World};

fn gauss() -> f64 {
    let mut r = rand::thread_rng();
    let s: f64 = (0..6).map(|_| r.gen::<f64>()).sum();
    (s - 3.0) * 1.414
}

#[derive(Clone, Default)]
pub struct Input {
    pub fwd: f64,
    pub strafe: f64,
    pub jump: bool,
    pub sneak: bool,
}

#[derive(Clone, Default)]
pub struct Actions {
    pub attack: bool,
    pub use_held: bool,
    pub sprint_tap: bool,
    pub use_pending: bool,
}

#[derive(Clone)]
pub struct InputRec {
    pub seq: i64,
    pub fwd: f64,
    pub strafe: f64,
    pub jump: bool,
    pub sneak: bool,
    pub yaw: f64,
    pub pitch: f64,
    pub slot: usize,
    pub sprint: bool,
    pub stop_sprint: bool,
    pub attack: bool,
    pub use_held: bool,
    pub use_click: bool,
    pub place_seq: i64,
    pub target: Option<BlockTarget>,
}

#[derive(Clone, Copy, serde::Serialize)]
pub struct BlockTarget {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub nx: i32,
    pub ny: i32,
    pub nz: i32,
}

#[derive(Clone, serde::Serialize)]
pub struct PlayerStats {
    pub kills: i64,
    pub deaths: i64,
    #[serde(rename = "maxKillStreak")]
    pub max_kill_streak: i64,
    #[serde(rename = "deathStreak")]
    pub death_streak: i64,
    #[serde(rename = "pearlsThrown")]
    pub pearls_thrown: i64,
    #[serde(rename = "blocksPlaced")]
    pub blocks_placed: i64,
}

impl Default for PlayerStats {
    fn default() -> Self {
        PlayerStats { kills: 0, deaths: 0, max_kill_streak: 0, death_streak: 0, pearls_thrown: 0, blocks_placed: 0 }
    }
}

pub struct Player {
    pub id: u64,
    pub name: String,
    pub is_bot: bool,
    pub pos: Vec3,
    pub prev: Vec3,
    pub vel: Vec3,
    pub yaw: f64,
    pub pitch: f64,
    pub prev_yaw: f64,
    pub prev_pitch: f64,
    pub on_ground: bool,
    pub h_collide: bool,
    pub sprinting: bool,
    pub want_sprint: bool,
    pub sneaking: bool,
    pub input: Input,
    pub act: Actions,
    pub slot: usize,
    pub hotbar: [&'static str; 9],
    pub block: u8,
    pub jump_ticks: i32,
    pub step_distance: f64,
    pub hurt_time: i64,
    pub hurt_anim: i32,
    pub kills: i64,
    pub deaths: i64,
    pub kill_streak: i64,
    pub death_streak: i64,
    pub stats: PlayerStats,
    pub pearls: i32,
    pub arrows: i32,
    pub plate: Option<u64>,
    pub bow_ticks: i32,
    pub use_delay: i32,
    pub swing_tick: i64,
    pub last_attacker: Option<u64>,
    pub last_attack_time: i64,
    pub alive: bool,
    pub respawn_at: i64,
    pub action_target: Option<BlockTarget>,
    pub pending_target: Option<BlockTarget>,
    pub queue: VecDeque<InputRec>,
    pub input_ack: i64,
    pub starved: u32,
    pub place_seq: i64,
    pub place_ack: i64,
    pub ping_at: Option<f64>,
    pub ping: f64,
}

impl Player {
    pub fn new(id: u64, name: String, is_bot: bool) -> Self {
        Player {
            id,
            name,
            is_bot,
            pos: Vec3 { x: 0.0, y: 0.0, z: 0.0 },
            prev: Vec3 { x: 0.0, y: 0.0, z: 0.0 },
            vel: Vec3 { x: 0.0, y: 0.0, z: 0.0 },
            yaw: 0.0,
            pitch: 0.0,
            prev_yaw: 0.0,
            prev_pitch: 0.0,
            on_ground: false,
            h_collide: false,
            sprinting: false,
            want_sprint: false,
            sneaking: false,
            input: Input::default(),
            act: Actions::default(),
            slot: 0,
            hotbar: DEFAULT_HOTBAR,
            block: id_of(PLACE_BLOCK),
            jump_ticks: 0,
            step_distance: 0.0,
            hurt_time: 0,
            hurt_anim: 0,
            kills: 0,
            deaths: 0,
            kill_streak: 0,
            death_streak: 0,
            stats: PlayerStats::default(),
            pearls: START_PEARLS,
            arrows: START_ARROWS,
            plate: None,
            bow_ticks: -1,
            use_delay: 0,
            swing_tick: -100,
            last_attacker: None,
            last_attack_time: -1000,
            alive: true,
            respawn_at: 0,
            action_target: None,
            pending_target: None,
            queue: VecDeque::new(),
            input_ack: 0,
            starved: 0,
            place_seq: 0,
            place_ack: 0,
            ping_at: None,
            ping: 0.0,
        }
    }

    pub fn eye(&self) -> Vec3 {
        Vec3 { x: self.pos.x, y: self.pos.y + if self.sneaking { 1.54 } else { 1.62 }, z: self.pos.z }
    }

    pub fn look(&self) -> Vec3 {
        let cp = self.pitch.cos();
        Vec3 { x: -self.yaw.sin() * cp, y: -self.pitch.sin(), z: self.yaw.cos() * cp }
    }
}

pub struct Plate {
    pub id: u64,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub owner: u64,
    pub expire: i64,
}

pub struct Projectile {
    pub id: u64,
    pub pos: Vec3,
    pub prev: Vec3,
    pub vel: Vec3,
    pub owner: u64,
    pub age: i64,
    pub stuck: bool,
    pub stuck_ticks: i64,
}

#[derive(Clone, Default, serde::Serialize)]
pub struct GameEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub victim: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub killer: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(rename = "victimName", skip_serializing_if = "Option::is_none")]
    pub victim_name: Option<String>,
    #[serde(rename = "killerName", skip_serializing_if = "Option::is_none")]
    pub killer_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
}

impl GameEvent {
    fn simple(kind: &str, id: u64) -> Self {
        GameEvent { kind: kind.to_string(), id: Some(id), victim: None, killer: None, sound: None, power: None, text: None, ..Default::default() }
    }
}

pub struct Spawn {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub struct Game {
    pub world: World,
    pub spawn: Spawn,
    pub players: HashMap<u64, Player>,
    pub arrows: Vec<Projectile>,
    pub pearls: Vec<Projectile>,
    pub plates: Vec<Plate>,
    pub placed: HashMap<(i32, i32, i32), i64>,
    pub time: i64,
    pub events: Vec<GameEvent>,
    next_id: u64,
    next_entity_id: u64,
}

impl Game {
    pub fn new() -> Self {
        let mut world = World::new();
        build_sky(&mut world);
        Game {
            world,
            spawn: Spawn { x: 0.5, y: 101.0, z: 0.5 },
            players: HashMap::new(),
            arrows: Vec::new(),
            pearls: Vec::new(),
            plates: Vec::new(),
            placed: HashMap::new(),
            time: 0,
            events: Vec::new(),
            next_id: 1,
            next_entity_id: 1,
        }
    }

    pub fn add_player(&mut self, name: String) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let mut p = Player::new(id, name.clone(), false);
        self.respawn(&mut p);
        self.players.insert(id, p);
        self.events.push(GameEvent { kind: "chat".to_string(), id: None, victim: None, killer: None, sound: None, power: None, text: Some(format!("\u{a7}e{} joined the game", name)), ..Default::default() });
        id
    }

    pub fn remove_player(&mut self, id: u64) {
        if let Some(p) = self.players.remove(&id) {
            self.events.push(GameEvent { kind: "chat".to_string(), id: None, victim: None, killer: None, sound: None, power: None, text: Some(format!("\u{a7}e{} left the game", p.name)), ..Default::default() });
        }
    }

    pub fn set_slot(&mut self, id: u64, n: usize) {
        if let Some(p) = self.players.get_mut(&id) {
            if p.slot != n {
                p.bow_ticks = -1;
            }
            p.slot = n;
            p.act.use_pending = false;
            p.pending_target = None;
        }
    }

    fn respawn(&mut self, p: &mut Player) {
        let mut r = rand::thread_rng();
        p.pos.x = self.spawn.x + (r.gen::<f64>() - 0.5) * 1.6;
        p.pos.y = self.spawn.y;
        p.pos.z = self.spawn.z + (r.gen::<f64>() - 0.5) * 1.6;
        p.prev = p.pos;
        p.vel = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
        p.yaw = p.pos.x.atan2(-p.pos.z);
        p.pitch = 0.0;
        p.prev_yaw = p.yaw;
        p.prev_pitch = 0.0;
        p.alive = true;
        p.on_ground = false;
        p.hurt_time = 0;
        p.hurt_anim = 0;
        p.pearls = START_PEARLS;
        p.arrows = START_ARROWS;
        p.bow_ticks = -1;
        p.want_sprint = false;
        p.sprinting = false;
        p.step_distance = 0.0;
        p.last_attacker = None;
        p.slot = 0;
        self.events.push(GameEvent::simple("respawn", p.id));
    }

    pub fn update(&mut self) {
        self.time += 1;
        let ids: Vec<u64> = self.players.keys().copied().collect();
        for id in ids {
            let alive = self.players.get(&id).map(|p| p.alive).unwrap_or(false);
            if !alive {
                let due = {
                    let p = self.players.get_mut(&id).unwrap();
                    if let Some(last) = p.queue.back() {
                        p.input_ack = last.seq;
                        p.queue.clear();
                    }
                    self.time >= p.respawn_at
                };
                if due {
                    let mut p = self.players.remove(&id).unwrap();
                    self.respawn(&mut p);
                    self.players.insert(id, p);
                }
                continue;
            }
            let mut n = {
                let p = self.players.get_mut(&id).unwrap();
                p.prev = p.pos;
                p.prev_yaw = p.yaw;
                p.prev_pitch = p.pitch;
                if p.queue.len() > 4 { 2 } else { 1 }
            };
            let mut stepped = false;
            while n > 0 {
                n -= 1;
                let rec = {
                    let p = self.players.get_mut(&id).unwrap();
                    if !p.alive {
                        break;
                    }
                    p.queue.pop_front()
                };
                let rec = match rec {
                    Some(r) => r,
                    None => break,
                };
                stepped = true;
                self.apply_input(id, rec);
                self.actions(id);
                self.mv(id);
                let void = self.players.get(&id).map(|p| p.pos.y < VOID_Y).unwrap_or(false);
                if void {
                    self.kill(id);
                }
            }
            let idle_step = {
                let p = self.players.get_mut(&id).unwrap();
                if stepped {
                    p.starved = 0;
                    false
                } else if !p.alive {
                    false
                } else {
                    p.starved += 1;
                    p.starved >= 3 || p.hurt_time > HURT_RESISTANT / 2
                }
            };
            if idle_step {
                {
                    let p = self.players.get_mut(&id).unwrap();
                    p.input.fwd = 0.0;
                    p.input.strafe = 0.0;
                    p.input.jump = false;
                }
                self.mv(id);
                let void = self.players.get(&id).map(|p| p.pos.y < VOID_Y).unwrap_or(false);
                if void {
                    self.kill(id);
                }
            }
        }
        self.update_plates();
        self.update_arrows();
        self.update_pearls();
        self.expire();
    }

    fn apply_input(&mut self, id: u64, r: InputRec) {
        {
            let p = self.players.get_mut(&id).unwrap();
            p.input.fwd = r.fwd;
            p.input.strafe = r.strafe;
            p.input.jump = r.jump;
            p.input.sneak = r.sneak;
            p.yaw = r.yaw;
            p.pitch = r.pitch;
        }
        let slot = self.players.get(&id).unwrap().slot;
        if r.slot != slot {
            self.set_slot(id, r.slot);
        }
        let p = self.players.get_mut(&id).unwrap();
        if r.stop_sprint {
            p.want_sprint = false;
        }
        if r.sprint {
            p.act.sprint_tap = true;
        }
        if r.attack {
            p.act.attack = true;
        }
        p.action_target = r.target;
        if r.use_click {
            p.act.use_pending = true;
            p.pending_target = r.target;
        }
        p.act.use_held = r.use_held;
        p.place_seq = r.place_seq;
        p.input_ack = r.seq;
    }

    fn actions(&mut self, id: u64) {
        let (attack, use_held, use_pending, slot, bow_ticks) = {
            let p = self.players.get(&id).unwrap();
            (p.act.attack, p.act.use_held, p.act.use_pending, p.slot, p.bow_ticks)
        };
        if self.players.get(&id).unwrap().use_delay > 0 {
            self.players.get_mut(&id).unwrap().use_delay -= 1;
        }
        if attack {
            self.players.get_mut(&id).unwrap().act.attack = false;
            let t = self.time;
            self.players.get_mut(&id).unwrap().swing_tick = t;
            if let Some(target) = self.pick_player(id) {
                self.melee(id, target);
            }
        }

        let hotbar_type = self.players.get(&id).unwrap().hotbar[slot.min(8)];
        let use_delay = self.players.get(&id).unwrap().use_delay;

        if hotbar_type == "bow" {
            if use_held && (bow_ticks >= 0 || self.players.get(&id).unwrap().arrows > 0) {
                let p = self.players.get_mut(&id).unwrap();
                p.bow_ticks = if p.bow_ticks < 0 { 0 } else { p.bow_ticks + 1 };
            } else if bow_ticks >= 0 {
                self.shoot(id);
                self.players.get_mut(&id).unwrap().bow_ticks = -1;
            }
        } else {
            self.players.get_mut(&id).unwrap().bow_ticks = -1;
            let mut waiting = (use_held || use_pending) && use_delay > 0;
            if (use_held || use_pending) && use_delay == 0 {
                {
                    let p = self.players.get_mut(&id).unwrap();
                    if use_pending {
                        if let Some(t) = p.pending_target {
                            p.action_target = Some(t);
                        }
                    }
                    p.act.use_pending = false;
                    p.pending_target = None;
                }
                match hotbar_type {
                    "block" => {
                        waiting = false;
                        {
                            let p = self.players.get_mut(&id).unwrap();
                            p.use_delay = 4;
                            p.place_ack = p.place_seq;
                        }
                        if self.place_block(id) {
                            let t = self.time;
                            self.players.get_mut(&id).unwrap().swing_tick = t;
                        }
                    }
                    "pearl" => {
                        self.players.get_mut(&id).unwrap().use_delay = 4;
                        self.throw_pearl(id);
                    }
                    "plate" => {
                        self.players.get_mut(&id).unwrap().use_delay = 4;
                        self.place_plate(id);
                    }
                    _ => {}
                }
            }
            if hotbar_type != "block" || !waiting {
                let p = self.players.get_mut(&id).unwrap();
                p.place_ack = p.place_seq;
            }
        }
    }

    fn mv(&mut self, id: u64) {
        let p = self.players.get_mut(&id).unwrap();
        let inp = p.input.clone();
        p.sneaking = inp.sneak;
        if p.hurt_time > 0 {
            p.hurt_time -= 1;
        }
        if p.hurt_anim > 0 {
            p.hurt_anim -= 1;
        }
        if p.act.sprint_tap && inp.fwd > 0.0 && !p.sneaking {
            p.want_sprint = true;
        }
        p.act.sprint_tap = false;
        if inp.fwd <= 0.0 || p.sneaking {
            p.want_sprint = false;
        }
        if p.want_sprint && p.h_collide {
            p.want_sprint = false;
        }
        p.sprinting = p.want_sprint;
        if p.vel.x.abs() < 0.005 {
            p.vel.x = 0.0;
        }
        if p.vel.y.abs() < 0.005 {
            p.vel.y = 0.0;
        }
        if p.vel.z.abs() < 0.005 {
            p.vel.z = 0.0;
        }
        if p.jump_ticks > 0 {
            p.jump_ticks -= 1;
        }
        if inp.jump {
            if p.on_ground && p.jump_ticks == 0 {
                p.vel.y = JUMP_VY;
                self.events.push(GameEvent::simple("jump", id));
                if p.sprinting {
                    p.vel.x -= p.yaw.sin() * 0.2;
                    p.vel.z += p.yaw.cos() * 0.2;
                }
                p.jump_ticks = 10;
            }
        } else {
            p.jump_ticks = 0;
        }

        let mut strafe = inp.strafe * 0.98;
        let mut fwd = inp.fwd * 0.98;
        if p.sneaking {
            strafe *= 0.3;
            fwd *= 0.3;
        }
        let f4 = if p.on_ground { 0.546 } else { 0.91 };
        let base = 0.1 * if p.sprinting { 1.3 } else { 1.0 };
        let accel = if p.on_ground {
            (base * 0.16277136) / (f4 * f4 * f4)
        } else if p.sprinting {
            0.026
        } else {
            0.02
        };
        let mut d = strafe * strafe + fwd * fwd;
        if d >= 1e-4 {
            d = d.sqrt();
            if d < 1.0 {
                d = 1.0;
            }
            d = accel / d;
            strafe *= d;
            fwd *= d;
            let sin = p.yaw.sin();
            let cos = p.yaw.cos();
            p.vel.x += strafe * cos - fwd * sin;
            p.vel.z += fwd * cos + strafe * sin;
        }

        let sneaking = p.sneaking;
        let on_ground_prev = p.on_ground;
        let (vx, vy, vz) = (p.vel.x, p.vel.y, p.vel.z);
        let res = move_entity(&self.world, &mut p.pos, sneaking, on_ground_prev, vx, vy, vz);
        p.on_ground = res.on_ground;
        p.h_collide = res.h_collide;
        if res.stopped_x {
            p.vel.x = 0.0;
        }
        if res.stopped_y {
            p.vel.y = 0.0;
        }
        if res.stopped_z {
            p.vel.z = 0.0;
        }

        let walked = ((p.pos.x - p.prev.x).powi(2) + (p.pos.z - p.prev.z).powi(2)).sqrt();
        if p.on_ground && walked > 0.0 {
            p.step_distance += walked;
            if p.step_distance >= 0.55 {
                p.step_distance %= 0.55;
                self.events.push(GameEvent::simple("step", id));
            }
        }

        p.vel.y = (p.vel.y - 0.08) * 0.98;
        p.vel.x *= f4;
        p.vel.z *= f4;
    }

    fn pick_player(&self, id: u64) -> Option<u64> {
        let p = self.players.get(&id)?;
        let e = p.eye();
        let d = p.look();
        let bh = raycast_blocks(&self.world, e.x, e.y, e.z, d.x, d.y, d.z, REACH_ATTACK);
        let mut bt = bh.map(|h| h.t).unwrap_or(REACH_ATTACK);
        let mut best = None;
        for (qid, q) in &self.players {
            if *qid == id || !q.alive {
                continue;
            }
            if let Some(t) = ray_box(e.x, e.y, e.z, d.x, d.y, d.z, &player_box(&q.pos, 0.1), bt) {
                if t <= bt {
                    best = Some(*qid);
                    bt = t;
                }
            }
        }
        best
    }

    fn is_spawn_protected(&self, pos: &Vec3) -> bool {
        let s = &self.spawn;
        (pos.x - s.x).abs() <= 2.0 && (pos.z - s.z).abs() <= 2.0 && pos.y >= s.y - 1.0 && pos.y <= s.y + 2.0
    }

    fn hit(&mut self, victim: u64, attacker: u64) -> bool {
        let (vpos, apos) = {
            let v = self.players.get(&victim).unwrap();
            let a = self.players.get(&attacker).unwrap();
            (v.pos, a.pos)
        };
        if self.is_spawn_protected(&vpos) || self.is_spawn_protected(&apos) {
            return false;
        }
        let v = self.players.get_mut(&victim).unwrap();
        if v.hurt_time > HURT_RESISTANT / 2 {
            return false;
        }
        v.hurt_time = HURT_RESISTANT;
        v.hurt_anim = 10;
        v.last_attacker = Some(attacker);
        v.last_attack_time = self.time;
        let mut dx = apos.x - vpos.x;
        let mut dz = apos.z - vpos.z;
        let mut r = rand::thread_rng();
        while dx * dx + dz * dz < 1e-4 {
            dx = (r.gen::<f64>() - 0.5) * 0.02;
            dz = (r.gen::<f64>() - 0.5) * 0.02;
        }
        let f = (dx * dx + dz * dz).sqrt();
        v.vel.x = v.vel.x / 2.0 - (dx / f) * 0.4;
        v.vel.y = v.vel.y / 2.0 + 0.4;
        v.vel.z = v.vel.z / 2.0 - (dz / f) * 0.4;
        if v.vel.y > 0.4 {
            v.vel.y = 0.4;
        }
        self.events.push(GameEvent { kind: "hurt".to_string(), id: Some(victim), angle: Some(dz.atan2(dx).to_degrees()), ..Default::default() });
        true
    }

    fn melee(&mut self, id: u64, target: u64) {
        if !self.hit(target, id) {
            return;
        }
        self.events.push(GameEvent::simple("melee_hit", id));
        let (is_stick, sprinting, yaw) = {
            let p = self.players.get(&id).unwrap();
            (p.hotbar[p.slot.min(8)] == "stick", p.sprinting, p.yaw)
        };
        let kb = (if is_stick { KB_LEVEL } else { 0.0 }) + if sprinting { 1.0 } else { 0.0 };
        if kb > 0.0 {
            {
                let t = self.players.get_mut(&target).unwrap();
                t.vel.x += -yaw.sin() * kb * 0.5;
                t.vel.y += 0.1;
                t.vel.z += yaw.cos() * kb * 0.5;
            }
            let p = self.players.get_mut(&id).unwrap();
            p.vel.x *= 0.6;
            p.vel.z *= 0.6;
            p.want_sprint = false;
            p.sprinting = false;
        }
    }

    fn target(&mut self, id: u64) -> Option<crate::raycast::RayHit> {
        let (e, d, claimed) = {
            let p = self.players.get_mut(&id)?;
            (p.eye(), p.look(), p.action_target.take())
        };
        let hit = raycast_blocks(&self.world, e.x, e.y, e.z, d.x, d.y, d.z, REACH_BLOCK);
        let claimed = match claimed {
            Some(c) => c,
            None => return hit,
        };
        if claimed.nx.abs() + claimed.ny.abs() + claimed.nz.abs() != 1 {
            return hit;
        }
        if let Some(h) = &hit {
            if h.x == claimed.x && h.y == claimed.y && h.z == claimed.z {
                return Some(crate::raycast::RayHit { x: h.x, y: h.y, z: h.z, nx: claimed.nx, ny: claimed.ny, nz: claimed.nz, t: h.t });
            }
        }
        if !self.world.is_solid(claimed.x, claimed.y, claimed.z) {
            return hit;
        }
        let cx = claimed.x as f64 + 0.5 - e.x;
        let cy = claimed.y as f64 + 0.5 - e.y;
        let cz = claimed.z as f64 + 0.5 - e.z;
        let dist = (cx * cx + cy * cy + cz * cz).sqrt();
        if dist > REACH_BLOCK + 1.0 {
            return hit;
        }
        let los = raycast_blocks(&self.world, e.x, e.y, e.z, cx / dist, cy / dist, cz / dist, dist + 0.5);
        match los {
            Some(l) if l.x == claimed.x && l.y == claimed.y && l.z == claimed.z => {
                Some(crate::raycast::RayHit { x: claimed.x, y: claimed.y, z: claimed.z, nx: claimed.nx, ny: claimed.ny, nz: claimed.nz, t: dist })
            }
            _ => hit,
        }
    }

    fn can_place(&self, x: i32, y: i32, z: i32) -> bool {
        if !self.world.in_bounds(x, y, z) || y > BUILD_MAX_Y || in_ad_zone(x, y, z) || self.world.get(x, y, z) != 0 {
            return false;
        }
        if self.plates.iter().any(|pl| pl.x == x && pl.y == y && pl.z == z) {
            return false;
        }
        for q in self.players.values() {
            if !q.alive {
                continue;
            }
            let b = player_box(&q.pos, 0.0);
            if b.min_x < (x + 1) as f64 && b.max_x > x as f64 && b.min_y < (y + 1) as f64 && b.max_y > y as f64 && b.min_z < (z + 1) as f64 && b.max_z > z as f64 {
                return false;
            }
        }
        true
    }

    fn place_block(&mut self, id: u64) -> bool {
        let hit = match self.target(id) {
            Some(h) => h,
            None => return false,
        };
        let x = hit.x + hit.nx;
        let y = hit.y + hit.ny;
        let z = hit.z + hit.nz;
        let pos = Vec3 { x: x as f64 + 0.5, y: y as f64, z: z as f64 + 0.5 };
        if !self.can_place(x, y, z) || self.is_spawn_protected(&pos) {
            return false;
        }
        let block_id = self.players.get(&id).unwrap().block;
        self.world.set(x, y, z, block_id);
        self.placed.insert((x, y, z), self.time + BLOCK_LIFETIME);
        let p = self.players.get_mut(&id).unwrap();
        p.stats.blocks_placed += 1;
        self.events.push(GameEvent {
            kind: "block_place".to_string(),
            id: Some(id),
            victim: None,
            killer: None,
            sound: Some(sound_of(block_id).to_string()),
            power: None,
            text: None,
            ..Default::default()
        });
        true
    }

    fn place_plate(&mut self, id: u64) {
        if self.players.get(&id).unwrap().plate.is_some() {
            self.events.push(GameEvent::simple("plate_cd", id));
            return;
        }
        let hit = match self.target(id) {
            Some(h) if h.ny == 1 => h,
            _ => return,
        };
        let (x, y, z) = (hit.x, hit.y + 1, hit.z);
        if in_ad_zone(x, y, z) || self.world.get(x, y, z) != 0 || self.plates.iter().any(|pl| pl.x == x && pl.y == y && pl.z == z) {
            return;
        }
        let plate_id = self.next_entity_id;
        self.next_entity_id += 1;
        self.plates.push(Plate { id: plate_id, x, y, z, owner: id, expire: self.time + PLATE_LIFETIME });
        let p = self.players.get_mut(&id).unwrap();
        p.plate = Some(plate_id);
        p.swing_tick = self.time;
        self.events.push(GameEvent::simple("plate_place", id));
    }

    fn update_plates(&mut self) {
        let mut i = self.plates.len();
        while i > 0 {
            i -= 1;
            let (px, py, pz, expire, owner, plate_id) = {
                let pl = &self.plates[i];
                (pl.x, pl.y, pl.z, pl.expire, pl.owner, pl.id)
            };
            if self.time >= expire || !self.world.is_solid(px, py - 1, pz) {
                self.plates.remove(i);
                if let Some(o) = self.players.get_mut(&owner) {
                    if o.plate == Some(plate_id) {
                        o.plate = None;
                    }
                }
                continue;
            }
            let mut launched = Vec::new();
            for (qid, q) in &self.players {
                if !q.alive {
                    continue;
                }
                let b = player_box(&q.pos, 0.0);
                if b.min_x < px as f64 + 0.875
                    && b.max_x > px as f64 + 0.125
                    && b.min_z < pz as f64 + 0.875
                    && b.max_z > pz as f64 + 0.125
                    && b.min_y < py as f64 + 0.25
                    && b.max_y > py as f64
                {
                    launched.push(*qid);
                }
            }
            for qid in launched {
                let q = self.players.get_mut(&qid).unwrap();
                q.vel.y = PLATE_LAUNCH_VY;
                q.on_ground = false;
                self.events.push(GameEvent::simple("launch", qid));
            }
        }
    }

    fn shoot(&mut self, id: u64) {
        let (bow_ticks, arrows, yaw, eye, look) = {
            let p = self.players.get(&id).unwrap();
            (p.bow_ticks, p.arrows, p.yaw, p.eye(), p.look())
        };
        let mut f = bow_ticks as f64 / 20.0;
        f = (f * f + f * 2.0) / 3.0;
        if f < 0.1 {
            return;
        }
        if f > 1.0 {
            f = 1.0;
        }
        if !INFINITE_ARROWS {
            if arrows <= 0 {
                return;
            }
            self.players.get_mut(&id).unwrap().arrows -= 1;
        }
        let sp = f * 3.0;
        let pos = Vec3 { x: eye.x - yaw.cos() * 0.16, y: eye.y - 0.1, z: eye.z - yaw.sin() * 0.16 };
        let vel = Vec3 {
            x: (look.x + gauss() * 0.0075) * sp,
            y: (look.y + gauss() * 0.0075) * sp,
            z: (look.z + gauss() * 0.0075) * sp,
        };
        let eid = self.next_entity_id;
        self.next_entity_id += 1;
        self.arrows.push(Projectile { id: eid, pos, prev: pos, vel, owner: id, age: 0, stuck: false, stuck_ticks: 0 });
        self.events.push(GameEvent { kind: "bow_shoot".to_string(), id: Some(id), victim: None, killer: None, sound: None, power: Some(f), text: None, ..Default::default() });
        self.players.get_mut(&id).unwrap().swing_tick = self.time;
    }

    fn throw_pearl(&mut self, id: u64) {
        let (pearls, yaw, eye, look) = {
            let p = self.players.get(&id).unwrap();
            (p.pearls, p.yaw, p.eye(), p.look())
        };
        if pearls <= 0 {
            return;
        }
        self.players.get_mut(&id).unwrap().pearls -= 1;
        let pos = Vec3 { x: eye.x - yaw.cos() * 0.16, y: eye.y - 0.1, z: eye.z - yaw.sin() * 0.16 };
        let vel = Vec3 {
            x: (look.x + gauss() * 0.0075) * 1.5,
            y: (look.y + gauss() * 0.0075) * 1.5,
            z: (look.z + gauss() * 0.0075) * 1.5,
        };
        let eid = self.next_entity_id;
        self.next_entity_id += 1;
        self.pearls.push(Projectile { id: eid, pos, prev: pos, vel, owner: id, age: 0, stuck: false, stuck_ticks: 0 });
        let p = self.players.get_mut(&id).unwrap();
        p.stats.pearls_thrown += 1;
        p.swing_tick = self.time;
        self.events.push(GameEvent::simple("pearl_throw", id));
    }

    fn sweep(&self, pr: &Projectile, sp: f64, dx: f64, dy: f64, dz: f64) -> (Option<crate::raycast::RayHit>, f64, Option<u64>) {
        let bh = raycast_blocks(&self.world, pr.pos.x, pr.pos.y, pr.pos.z, dx, dy, dz, sp);
        let mut bt = bh.as_ref().map(|h| h.t).unwrap_or(sp);
        let mut who = None;
        for (qid, q) in &self.players {
            if !q.alive || (*qid == pr.owner && pr.age < 5) {
                continue;
            }
            if let Some(t) = ray_box(pr.pos.x, pr.pos.y, pr.pos.z, dx, dy, dz, &player_box(&q.pos, 0.3), bt) {
                if t <= bt {
                    who = Some(*qid);
                    bt = t;
                }
            }
        }
        (bh, bt, who)
    }

    fn update_arrows(&mut self) {
        let mut i = self.arrows.len();
        while i > 0 {
            i -= 1;
            self.arrows[i].prev = self.arrows[i].pos;
            if self.arrows[i].stuck {
                self.arrows[i].stuck_ticks += 1;
                if self.arrows[i].stuck_ticks > ARROW_STAY_TICKS {
                    self.arrows.remove(i);
                }
                continue;
            }
            self.arrows[i].age += 1;
            let v = self.arrows[i].vel;
            let sp = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt();
            if sp < 1e-6 {
                let a = &mut self.arrows[i];
                a.stuck = true;
                a.vel = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
                continue;
            }
            let (dx, dy, dz) = (v.x / sp, v.y / sp, v.z / sp);
            let (bh, bt, who) = self.sweep(&self.arrows[i], sp, dx, dy, dz);
            if let Some(w) = who {
                let owner = self.arrows[i].owner;
                self.hit(w, owner);
                self.arrows.remove(i);
                continue;
            }
            if let Some(h) = bh {
                let a = &mut self.arrows[i];
                a.pos.x += dx * bt;
                a.pos.y += dy * bt;
                a.pos.z += dz * bt;
                a.stuck = true;
                a.vel = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
                let owner = a.owner;
                let _ = h;
                self.events.push(GameEvent::simple("arrow_hit", owner));
                continue;
            }
            let a = &mut self.arrows[i];
            a.pos.x += a.vel.x;
            a.pos.y += a.vel.y;
            a.pos.z += a.vel.z;
            a.vel.x *= 0.99;
            a.vel.y = a.vel.y * 0.99 - 0.05;
            a.vel.z *= 0.99;
            if a.pos.y < VOID_Y - 30.0 {
                self.arrows.remove(i);
            }
        }
    }

    fn update_pearls(&mut self) {
        let mut i = self.pearls.len();
        while i > 0 {
            i -= 1;
            self.pearls[i].prev = self.pearls[i].pos;
            self.pearls[i].age += 1;
            let v = self.pearls[i].vel;
            let sp = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt();
            if sp < 1e-6 {
                self.pearls.remove(i);
                continue;
            }
            let (dx, dy, dz) = (v.x / sp, v.y / sp, v.z / sp);
            let (bh, bt, who) = self.sweep(&self.pearls[i], sp, dx, dy, dz);
            if who.is_some() || bh.is_some() {
                let owner = self.pearls[i].owner;
                let pos = self.pearls[i].pos;
                let pt = Vec3 { x: pos.x + dx * bt, y: pos.y + dy * bt, z: pos.z + dz * bt };
                if let Some(w) = who {
                    if w != owner {
                        self.hit(w, owner);
                    }
                }
                let alive = self.players.get(&owner).map(|o| o.alive).unwrap_or(false);
                if alive {
                    let normal = if who.is_none() { bh.map(|h| (h.nx, h.ny, h.nz)) } else { None };
                    self.teleport(owner, pt, normal);
                }
                self.pearls.remove(i);
                continue;
            }
            let pr = &mut self.pearls[i];
            pr.pos.x += pr.vel.x;
            pr.pos.y += pr.vel.y;
            pr.pos.z += pr.vel.z;
            pr.vel.x *= 0.99;
            pr.vel.y = pr.vel.y * 0.99 - 0.03;
            pr.vel.z *= 0.99;
            if pr.pos.y < VOID_Y - 40.0 || pr.age > 300 {
                self.pearls.remove(i);
            }
        }
    }

    fn teleport(&mut self, id: u64, pt: Vec3, n: Option<(i32, i32, i32)>) {
        let mut x = pt.x;
        let mut y = pt.y;
        let mut z = pt.z;
        if let Some((nx, ny, nz)) = n {
            if (ny as f64).abs() < 0.5 {
                x += nx as f64 * 0.31;
                z += nz as f64 * 0.31;
            } else if ny < 0 {
                y -= 1.8;
            }
        }
        let p = self.players.get_mut(&id).unwrap();
        p.pos.x = x;
        p.pos.y = y;
        p.pos.z = z;
        for _ in 0..80 {
            if !overlaps_solid(&self.world, &player_box(&p.pos, 0.0)) {
                break;
            }
            p.pos.y += 0.1;
        }
        p.prev = p.pos;
        self.events.push(GameEvent::simple("teleport", id));
    }

    fn kill(&mut self, id: u64) {
        let (last_attacker, last_attack_time) = {
            let p = self.players.get(&id).unwrap();
            (p.last_attacker, p.last_attack_time)
        };
        let mut killer = None;
        if let Some(a) = last_attacker {
            if self.time - last_attack_time <= KILL_CREDIT_TICKS && a != id && self.players.contains_key(&a) {
                killer = Some(a);
            }
        }
        if let Some(k) = killer {
            let kp = self.players.get_mut(&k).unwrap();
            kp.kills += 1;
            kp.kill_streak += 1;
            kp.death_streak = 0;
            kp.pearls += PEARL_PER_KILL;
        }
        let p = self.players.get_mut(&id).unwrap();
        p.deaths += 1;
        p.kill_streak = 0;
        p.death_streak += 1;
        p.alive = false;
        p.respawn_at = self.time + RESPAWN_TICKS;
        p.bow_ticks = -1;
        let victim_name = self.players.get(&id).map(|p| p.name.clone());
        let killer_name = killer.and_then(|k| self.players.get(&k).map(|p| p.name.clone()));
        self.events.push(GameEvent { kind: "death".to_string(), id: None, victim: Some(id), killer, victim_name, killer_name, ..Default::default() });
    }

    fn expire(&mut self) {
        let expired: Vec<(i32, i32, i32)> = self.placed.iter().filter(|(_, &t)| self.time >= t).map(|(&k, _)| k).collect();
        for (x, y, z) in expired {
            self.world.set(x, y, z, 0);
            self.placed.remove(&(x, y, z));
        }
    }

    fn chat_event(&mut self, text: String) {
        self.events.push(GameEvent { kind: "chat".to_string(), id: None, victim: None, killer: None, sound: None, power: None, text: Some(text), ..Default::default() });
    }

    pub fn command(&mut self, id: u64, text: &str) {
        let msg: String = text.trim().chars().filter(|c| *c != '\u{a7}').collect();
        if msg.is_empty() {
            return;
        }
        if !msg.starts_with('/') {
            let name = self.players.get(&id).map(|p| p.name.clone()).unwrap_or_else(|| "Player".to_string());
            self.chat_event(format!("<{}> {}", name, msg));
            return;
        }
        let cmd = msg.split_whitespace().next().unwrap_or("").to_lowercase();
        if cmd == "/bot" {
            self.chat_event("Bots are not available on this server.".to_string());
            return;
        }
        self.chat_event("\u{a7}cUnknown or incomplete command, see below for error".to_string());
        self.chat_event(format!("\u{a7}c\u{a7}n{}\u{a7}r\u{a7}c\u{a7}o<--[HERE]", &msg[1..]));
    }
}

pub const DEFAULT_HOTBAR: [&str; 9] = ["stick", "bow", "block", "pearl", "plate", "", "", "", ""];

const BLOCK_CHOICES: &[&str] = &[
    "stone", "cobblestone", "dirt", "oak_planks", "spruce_planks", "birch_planks", "sandstone", "red_sandstone", "bricks",
    "stone_bricks", "white_wool", "red_wool", "blue_wool", "netherrack", "obsidian", "coal_block", "iron_block", "gold_block",
    "diamond_block", "emerald_block", "lapis_block", "clay", "terracotta", "glowstone", "bookshelf", "oak_log", "end_stone",
];

pub fn parse_hotbar(s: &str) -> Option<[&'static str; 9]> {
    let mut out = [""; 9];
    let mut n = 0;
    for part in s.split(',') {
        if n >= 9 {
            return None;
        }
        let item = match part {
            "stick" => "stick",
            "bow" => "bow",
            "block" => "block",
            "pearl" => "pearl",
            "plate" => "plate",
            "" => "",
            _ => return None,
        };
        if !item.is_empty() && out.contains(&item) {
            return None;
        }
        out[n] = item;
        n += 1;
    }
    if n == 9 { Some(out) } else { None }
}

pub fn choose_block(name: &str) -> Option<u8> {
    if BLOCK_CHOICES.contains(&name) { Some(id_of(name)) } else { None }
}
