pub struct BlockDef {
    pub name: &'static str,
    pub sound: &'static str,
}

pub const BLOCK_DEFS: &[BlockDef] = &[
    BlockDef { name: "air", sound: "" },
    BlockDef { name: "grass", sound: "grass" },
    BlockDef { name: "dirt", sound: "stone" },
    BlockDef { name: "stone", sound: "stone" },
    BlockDef { name: "bedrock", sound: "stone" },
    BlockDef { name: "sandstone", sound: "stone" },
    BlockDef { name: "spawn", sound: "stone" },
    BlockDef { name: "cobblestone", sound: "stone" },
    BlockDef { name: "oak_planks", sound: "stone" },
    BlockDef { name: "oak_log", sound: "stone" },
    BlockDef { name: "oak_leaves", sound: "grass" },
    BlockDef { name: "spruce_planks", sound: "stone" },
    BlockDef { name: "spruce_log", sound: "stone" },
    BlockDef { name: "spruce_leaves", sound: "grass" },
    BlockDef { name: "birch_planks", sound: "stone" },
    BlockDef { name: "birch_log", sound: "stone" },
    BlockDef { name: "birch_leaves", sound: "grass" },
    BlockDef { name: "sand", sound: "stone" },
    BlockDef { name: "gravel", sound: "stone" },
    BlockDef { name: "bricks", sound: "stone" },
    BlockDef { name: "stone_bricks", sound: "stone" },
    BlockDef { name: "glass", sound: "stone" },
    BlockDef { name: "gold_block", sound: "stone" },
    BlockDef { name: "iron_block", sound: "stone" },
    BlockDef { name: "diamond_block", sound: "stone" },
    BlockDef { name: "emerald_block", sound: "stone" },
    BlockDef { name: "coal_block", sound: "stone" },
    BlockDef { name: "redstone_block", sound: "stone" },
    BlockDef { name: "lapis_block", sound: "stone" },
    BlockDef { name: "obsidian", sound: "stone" },
    BlockDef { name: "white_wool", sound: "grass" },
    BlockDef { name: "red_wool", sound: "grass" },
    BlockDef { name: "blue_wool", sound: "grass" },
    BlockDef { name: "black_wool", sound: "grass" },
    BlockDef { name: "yellow_wool", sound: "grass" },
    BlockDef { name: "green_wool", sound: "grass" },
    BlockDef { name: "orange_wool", sound: "grass" },
    BlockDef { name: "netherrack", sound: "stone" },
    BlockDef { name: "snow", sound: "grass" },
    BlockDef { name: "ice", sound: "stone" },
    BlockDef { name: "clay", sound: "stone" },
    BlockDef { name: "mud", sound: "grass" },
];

pub fn id_of(name: &str) -> u8 {
    BLOCK_DEFS.iter().position(|d| d.name == name).unwrap_or(0) as u8
}

pub fn sound_of(id: u8) -> &'static str {
    BLOCK_DEFS.get(id as usize).map(|d| d.sound).unwrap_or("stone")
}
