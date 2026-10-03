mod blocks;
mod config;
mod game;
mod physics;
mod raycast;
mod serialize;
mod stats;
mod world;

use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};

use game::Game;
use stats::{SavedStats, StatsStore};

const VALID_NAME_MAX: usize = 16;

fn valid_name(name: &str) -> bool {
    if name.is_empty() || name.len() > VALID_NAME_MAX {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

struct MapEntry {
    id: String,
    name: String,
    game: Mutex<Game>,
}

struct ClientSession {
    map_index: usize,
    player_id: u64,
}

struct Server {
    root: PathBuf,
    maps: Vec<MapEntry>,
    clients: Mutex<HashMap<u64, ClientSession>>,
    outboxes: Mutex<HashMap<u64, mpsc::UnboundedSender<Value>>>,
    stats: Arc<StatsStore>,
    next_conn_id: AtomicU64,
}

impl Server {
    fn list_servers(&self) -> Value {
        let list: Vec<Value> = self
            .maps
            .iter()
            .map(|m| {
                let g = m.game.try_lock();
                let players = g.map(|g| g.players.len()).unwrap_or(0);
                json!({ "id": m.id, "name": m.name, "players": players })
            })
            .collect();
        json!(list)
    }

    async fn public_stats(&self, name: &str) -> SavedStats {
        let mut data = self.stats.data.lock().await;
        data.entry(name.to_lowercase()).or_insert_with(SavedStats::default).clone()
    }

    async fn online_names(&self) -> std::collections::HashSet<String> {
        let mut online = std::collections::HashSet::new();
        for m in &self.maps {
            let g = m.game.lock().await;
            for p in g.players.values() {
                online.insert(p.name.to_lowercase());
            }
        }
        online
    }

    async fn all_stats(&self) -> Value {
        let online = self.online_names().await;
        let data = self.stats.data.lock().await;
        let list: Vec<Value> = data
            .iter()
            .map(|(name, st)| {
                json!({
                    "name": name,
                    "online": online.contains(name),
                    "kills": st.kills,
                    "deaths": st.deaths,
                    "maxKillStreak": st.max_kill_streak,
                    "deathStreak": st.death_streak,
                    "pearlsThrown": st.pearls_thrown,
                    "blocksPlaced": st.blocks_placed
                })
            })
            .collect();
        json!(list)
    }
}

async fn handle_ws(server: Arc<Server>, ws_stream: tokio_tungstenite::WebSocketStream<hyper_util::rt::TokioIo<hyper::upgrade::Upgraded>>) {
    let (mut write, mut read) = ws_stream.split();
    let conn_id = server.next_conn_id.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    server.outboxes.lock().await.insert(conn_id, tx.clone());

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(tokio_tungstenite::tungstenite::Message::Text(msg.to_string())).await.is_err() {
                break;
            }
        }
    });

    let _ = tx.send(json!({ "type": "servers", "servers": server.list_servers() }));

    while let Some(Ok(msg)) = read.next().await {
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let m: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            handle_message(&server, conn_id, &tx, m).await;
        }
    }

    let mut clients = server.clients.lock().await;
    if let Some(session) = clients.remove(&conn_id) {
        let map = &server.maps[session.map_index];
        map.game.lock().await.remove_player(session.player_id);
    }
    server.outboxes.lock().await.remove(&conn_id);
    drop(send_task);
}

async fn handle_message(server: &Arc<Server>, conn_id: u64, tx: &mpsc::UnboundedSender<Value>, m: Value) {
    let mtype = m.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if mtype == "list" {
        let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let stats = if !name.is_empty() && valid_name(name) {
            Some(server.public_stats(name).await)
        } else {
            None
        };
        let _ = tx.send(json!({ "type": "servers", "servers": server.list_servers(), "stats": stats }));
        return;
    }

    if mtype == "all_stats" {
        let _ = tx.send(json!({ "type": "all_stats", "players": server.all_stats().await }));
        return;
    }

    if mtype == "join" {
        let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !valid_name(&name) {
            let _ = tx.send(json!({ "type": "error", "message": "Name must start with a letter and use only letters, numbers, or _." }));
            return;
        }
        let server_id = m.get("server").and_then(|v| v.as_str()).unwrap_or("");
        let map_index = match server.maps.iter().position(|mp| mp.id == server_id) {
            Some(i) => i,
            None => {
                let _ = tx.send(json!({ "type": "error", "message": "That server is unavailable." }));
                return;
            }
        };
        {
            let map = &server.maps[map_index];
            let g = map.game.lock().await;
            if g.players.values().any(|p| p.name.to_lowercase() == name.to_lowercase()) {
                let _ = tx.send(json!({ "type": "error", "message": "That name is already playing on this server. Use another name." }));
                return;
            }
        }
        {
            let mut clients = server.clients.lock().await;
            if let Some(prev) = clients.remove(&conn_id) {
                let prev_map = &server.maps[prev.map_index];
                prev_map.game.lock().await.remove_player(prev.player_id);
            }
        }
        let saved = server.public_stats(&name).await;
        let player_id = {
            let map = &server.maps[map_index];
            let mut g = map.game.lock().await;
            let id = g.add_player(name.clone());
            if let Some(p) = g.players.get_mut(&id) {
                p.stats.kills = saved.kills;
                p.stats.deaths = saved.deaths;
                p.stats.max_kill_streak = saved.max_kill_streak;
                p.stats.death_streak = saved.death_streak;
                p.stats.pearls_thrown = saved.pearls_thrown;
                p.stats.blocks_placed = saved.blocks_placed;
                p.kills = saved.kills;
                p.deaths = saved.deaths;
                p.death_streak = saved.death_streak;
            }
            id
        };
        server.clients.lock().await.insert(conn_id, ClientSession { map_index, player_id });
        let _ = tx.send(json!({ "type": "joined", "server": server.maps[map_index].id, "playerId": player_id, "stats": saved }));
        return;
    }

    let session = {
        let clients = server.clients.lock().await;
        match clients.get(&conn_id) {
            Some(s) => (s.map_index, s.player_id),
            None => return,
        }
    };
    let (map_index, player_id) = session;
    let map = &server.maps[map_index];
    let mut g = map.game.lock().await;
    let p = match g.players.get_mut(&player_id) {
        Some(p) => p,
        None => return,
    };

    if mtype == "input" {
        let fwd = m.get("fwd").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(-1.0, 1.0);
        let strafe = m.get("strafe").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(-1.0, 1.0);
        p.input.fwd = fwd;
        p.input.strafe = strafe;
        p.input.jump = m.get("jump").and_then(|v| v.as_bool()).unwrap_or(false);
        p.input.sneak = m.get("sneak").and_then(|v| v.as_bool()).unwrap_or(false);
        if let Some(yaw) = m.get("yaw").and_then(|v| v.as_f64()) {
            if yaw.is_finite() {
                p.yaw = yaw;
            }
        }
        if let Some(pitch) = m.get("pitch").and_then(|v| v.as_f64()) {
            if pitch.is_finite() {
                p.pitch = pitch.clamp(-std::f64::consts::PI / 2.0, std::f64::consts::PI / 2.0);
            }
        }
        if let Some(slot) = m.get("slot").and_then(|v| v.as_i64()) {
            if (0..9).contains(&slot) {
                let n = slot as usize;
                drop(g);
                g = map.game.lock().await;
                g.set_slot(player_id, n);
            }
        }
        if m.get("stopSprint").and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Some(p) = g.players.get_mut(&player_id) {
                p.want_sprint = false;
            }
        }
        if m.get("sprint").and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Some(p) = g.players.get_mut(&player_id) {
                p.act.sprint_tap = true;
            }
        }
    }

    if mtype == "action" {
        if let Some(p) = g.players.get_mut(&player_id) {
            if let Some(yaw) = m.get("yaw").and_then(|v| v.as_f64()) {
                if yaw.is_finite() {
                    p.yaw = yaw;
                }
            }
            if let Some(pitch) = m.get("pitch").and_then(|v| v.as_f64()) {
                if pitch.is_finite() {
                    p.pitch = pitch.clamp(-std::f64::consts::PI / 2.0, std::f64::consts::PI / 2.0);
                }
            }
            let target = m.get("target");
            p.action_target = match target {
                Some(t) if t.is_object() => {
                    let x = t.get("x").and_then(|v| v.as_i64());
                    let y = t.get("y").and_then(|v| v.as_i64());
                    let z = t.get("z").and_then(|v| v.as_i64());
                    match (x, y, z) {
                        (Some(x), Some(y), Some(z)) => Some(game::BlockTarget { x: x as i32, y: y as i32, z: z as i32 }),
                        _ => None,
                    }
                }
                _ => None,
            };
            if m.get("attack").and_then(|v| v.as_bool()).unwrap_or(false) {
                p.act.attack = true;
            }
            p.act.use_held = m.get("useHeld").and_then(|v| v.as_bool()).unwrap_or(false);
        }
    }

    if mtype == "chat" {
        if let Some(text) = m.get("text").and_then(|v| v.as_str()) {
            let truncated: String = text.chars().take(100).collect();
            g.command(player_id, &truncated);
        }
    }
}

async fn serve_static(root: PathBuf, req: Request<hyper::body::Incoming>) -> Result<Response<Full<Bytes>>, std::io::Error> {
    let url_path = req.uri().path();
    let rel = if url_path == "/" { "index.html" } else { url_path.trim_start_matches('/') };
    let decoded = percent_decode(rel);
    let mut file = root.join("dist").join(&decoded);
    let dist_root = root.join("dist");
    if !file.starts_with(&dist_root) {
        return Ok(Response::builder().status(403).body(Full::new(Bytes::new())).unwrap());
    }
    if !file.exists() {
        file = dist_root.join("index.html");
    }
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            Ok(Response::builder().status(200).header("content-type", mime.to_string()).body(Full::new(Bytes::from(bytes))).unwrap())
        }
        // A missing dist/ (client not built, or root resolved wrong) now
        // surfaces as a real 404 instead of a silent 200 with an empty
        // body, which is what showed up as a blank white page.
        Err(_) => Ok(Response::builder().status(404).body(Full::new(Bytes::from("dist/ not found - run npm run build in kbffa/"))).unwrap()),
    }
}

fn percent_decode(s: &str) -> String {
    let path_only = s.split('?').next().unwrap_or(s);
    match urlencoding_decode(path_only) {
        Some(d) => d,
        None => path_only.to_string(),
    }
}

fn urlencoding_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let byte = u8::from_str_radix(hex, 16).ok()?;
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[tokio::main]
async fn main() {
    // The server is normally launched via `cargo run` from `server-rs/`, but
    // static assets (`dist/`) and saved stats (`data/`) live in the parent
    // `kbffa/` directory. Resolving against current_dir() alone silently
    // served nothing (200 OK, empty body -> blank white page) whenever the
    // process's cwd wasn't already `kbffa/`. Anchor on the exe's own path
    // instead, which is stable regardless of where it's launched from.
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));
    let root = exe_dir
        .map(|dir| dir.join("../../..")) // target/release -> server-rs -> kbffa
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    let stats = StatsStore::load(&root).await;
    stats.spawn_save_loop();

    let server_names = ["Apple Arena", "Mango Mayhem", "Berry Brawl"];
    let maps: Vec<MapEntry> = server_names
        .iter()
        .enumerate()
        .map(|(i, name)| MapEntry { id: format!("fruit-{}", i), name: name.to_string(), game: Mutex::new(Game::new()) })
        .collect();

    let server = Arc::new(Server {
        root: root.clone(),
        maps,
        clients: Mutex::new(HashMap::new()),
        outboxes: Mutex::new(HashMap::new()),
        stats,
        next_conn_id: AtomicU64::new(1),
    });

    {
        let server = server.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(config::TICK_MS));
            loop {
                interval.tick().await;
                for (map_idx, map) in server.maps.iter().enumerate() {
                    let snapshot_value;
                    {
                        let mut g = map.game.lock().await;
                        g.update();
                        for p in g.players.values_mut() {
                            p.stats.kills = p.kills;
                            p.stats.deaths = p.deaths;
                            if p.kill_streak > p.stats.max_kill_streak {
                                p.stats.max_kill_streak = p.kill_streak;
                            }
                            p.stats.death_streak = p.death_streak;
                        }
                        {
                            let mut data = server.stats.data.lock().await;
                            for p in g.players.values() {
                                let entry = data.entry(p.name.to_lowercase()).or_insert_with(SavedStats::default);
                                *entry = SavedStats {
                                    kills: p.stats.kills,
                                    deaths: p.stats.deaths,
                                    max_kill_streak: p.stats.max_kill_streak,
                                    death_streak: p.stats.death_streak,
                                    pearls_thrown: p.stats.pearls_thrown,
                                    blocks_placed: p.stats.blocks_placed,
                                };
                            }
                        }
                        snapshot_value = serialize::serialize_snapshot(&g);
                        g.events.clear();
                    }
                    server.stats.mark_dirty();

                    let clients = server.clients.lock().await;
                    let outboxes = server.outboxes.lock().await;
                    for (conn_id, session) in clients.iter() {
                        if session.map_index != map_idx {
                            continue;
                        }
                        if let Some(tx) = outboxes.get(conn_id) {
                            let g = map.game.lock().await;
                            let player_stats = g.players.get(&session.player_id).map(|p| p.stats.clone());
                            drop(g);
                            let mut payload = snapshot_value.clone();
                            if let Value::Object(ref mut obj) = payload {
                                obj.insert("type".to_string(), json!("snapshot"));
                                obj.insert("stats".to_string(), json!(player_stats));
                            }
                            let _ = tx.send(payload);
                        }
                    }
                }
            }
        });
    }

    let addr: SocketAddr = format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or_else(|_| "3000".to_string())).parse().unwrap();
    let listener = TcpListener::bind(addr).await.unwrap();
    println!("KBFFA multiplayer server listening on http://localhost:{}", addr.port());

    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let io = TokioIo::new(stream);
        let server = server.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req: Request<hyper::body::Incoming>| {
                let server = server.clone();
                async move {
                    if req.uri().path() == "/ws" && hyper_tungstenite::is_upgrade_request(&req) {
                        match hyper_tungstenite::upgrade(req, None) {
                            Ok((response, ws_fut)) => {
                                let server = server.clone();
                                tokio::spawn(async move {
                                    if let Ok(ws_stream) = ws_fut.await {
                                        handle_ws(server, ws_stream).await;
                                    }
                                });
                                Ok::<_, std::io::Error>(response.map(|_| Full::new(Bytes::new())))
                            }
                            Err(_) => Ok(Response::builder().status(400).body(Full::new(Bytes::new())).unwrap()),
                        }
                    } else {
                        serve_static(server.root.clone(), req).await
                    }
                }
            });
            let _ = http1::Builder::new().serve_connection(io, service).with_upgrades().await;
        });
    }
}
