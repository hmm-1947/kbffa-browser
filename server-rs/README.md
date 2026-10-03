# KBFFA Rust server

Feature-equivalent Rust port of `../server.js` + `../src/game.js` (and physics/raycast/world/blocks). Same wire protocol, same 3 fruit-named maps, same 20 TPS tick, same `data/stats.json` persistence.

Fixes vs the Node version:
- `target()` no longer trusts the client-reported block coordinate on distance alone; it must match the server's own eye/look raycast hit exactly.
- Client reconciliation snap threshold lowered from 3 blocks to 0.35, so predicted drift through a wall is corrected within one tick instead of persisting under the old 3-block dead zone.

## Setup (not yet installed on this machine)

Install Rust: https://rustup.rs

## Build & run

```
cd kbffa/server-rs
cargo build --release
cargo run --release
```

Serves the same `../dist` static build the Node server uses, on `/ws` for the socket and `PORT` env var (default 3000). Build the client first with `npm run build` from `kbffa/`, or point the Node dev server at Vite separately during development.
-
