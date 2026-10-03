use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct SavedStats {
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

pub struct StatsStore {
    path: PathBuf,
    pub data: Mutex<HashMap<String, SavedStats>>,
    dirty: std::sync::atomic::AtomicBool,
}

impl StatsStore {
    pub async fn load(root: &std::path::Path) -> Arc<Self> {
        let path = root.join("data").join("stats.json");
        let data = match fs::read_to_string(&path).await {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        Arc::new(StatsStore { path, data: Mutex::new(data), dirty: std::sync::atomic::AtomicBool::new(false) })
    }

    pub fn mark_dirty(&self) {
        self.dirty.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn spawn_save_loop(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_millis(250)).await;
                if me.dirty.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    let snapshot = me.data.lock().await.clone();
                    if let Some(parent) = me.path.parent() {
                        let _ = fs::create_dir_all(parent).await;
                    }
                    if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
                        let _ = fs::write(&me.path, text).await;
                    }
                }
            }
        });
    }
}
