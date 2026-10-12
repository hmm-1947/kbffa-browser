use serde::Serialize;
use serde_json::{json, Value};

use crate::game::Game;

#[derive(Serialize)]
struct Vec3Out {
    x: f64,
    y: f64,
    z: f64,
}

pub fn serialize_snapshot(game: &Game) -> Value {
    let blocks: Vec<Value> = game
        .placed
        .keys()
        .map(|&(x, y, z)| {
            json!({ "x": x, "y": y, "z": z, "id": game.world.get(x, y, z) })
        })
        .collect();

    let plates: Vec<Value> = game
        .plates
        .iter()
        .map(|pl| json!({ "id": format!("plate-{}", pl.id), "x": pl.x, "y": pl.y, "z": pl.z, "owner": pl.owner, "expire": pl.expire }))
        .collect();

    let arrows: Vec<Value> = game
        .arrows
        .iter()
        .map(|a| {
            json!({
                "id": format!("arrow-{}", a.id),
                "pos": Vec3Out { x: a.pos.x, y: a.pos.y, z: a.pos.z },
                "prev": Vec3Out { x: a.prev.x, y: a.prev.y, z: a.prev.z },
                "vel": Vec3Out { x: a.vel.x, y: a.vel.y, z: a.vel.z },
                "owner": a.owner,
                "stuck": a.stuck
            })
        })
        .collect();

    let pearls: Vec<Value> = game
        .pearls
        .iter()
        .map(|pr| {
            json!({
                "id": format!("pearl-{}", pr.id),
                "pos": Vec3Out { x: pr.pos.x, y: pr.pos.y, z: pr.pos.z },
                "prev": Vec3Out { x: pr.prev.x, y: pr.prev.y, z: pr.prev.z },
                "vel": Vec3Out { x: pr.vel.x, y: pr.vel.y, z: pr.vel.z },
                "owner": pr.owner
            })
        })
        .collect();

    let players: Vec<Value> = game
        .players
        .values()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "pos": Vec3Out { x: p.pos.x, y: p.pos.y, z: p.pos.z },
                "prev": Vec3Out { x: p.prev.x, y: p.prev.y, z: p.prev.z },
                "vel": Vec3Out { x: p.vel.x, y: p.vel.y, z: p.vel.z },
                "yaw": p.yaw,
                "pitch": p.pitch,
                "prevYaw": p.prev_yaw,
                "prevPitch": p.prev_pitch,
                "alive": p.alive,
                "sneaking": p.sneaking,
                "sprinting": p.sprinting,
                "slot": p.slot,
                "pearls": p.pearls,
                "arrows": p.arrows,
                "kills": p.kills,
                "deaths": p.deaths,
                "hurtAnim": p.hurt_anim,
                "swingTick": p.swing_tick,
                "onGround": p.on_ground,
                "stats": p.stats,
                "pingAt": p.ping_at,
                "inputAck": p.input_ack,
                "placeAck": p.place_ack,
                "sim": { "ws": p.want_sprint, "jt": p.jump_ticks, "hc": p.h_collide }
            })
        })
        .collect();

    json!({
        "time": game.time,
        "blocks": blocks,
        "plates": plates,
        "arrows": arrows,
        "pearls": pearls,
        "players": players,
        "events": game.events
    })
}
