// ============================================================
// Silk Road Protocol — Contract & Object IDs (testnet_utopia)
// Replace placeholders with real IDs before testing.
// ============================================================

export const SILK_ROAD_PACKAGE_ID =
  '0x8aefac157dd2b35b05ceb9c9fa67815a34af9c058bc3ae736943ab73a7101d98';

// Original (v1) package ID — Sui uses this for struct type indexing even after upgrades
export const SILK_ROAD_ORIGINAL_ID =
  '0x5e9b4582d440403ad7a6de9ac1ffad9d155ef926d371602537cd163c27cb6f3c';

export const FOUNDATION_TREASURY_ID =
  '0x37dc73e19be7da77ed7c8503d4b75107249bae29da55f100571598f4b48b6166';

// World package (v0.0.21, testnet_utopia)
export const WORLD_PACKAGE_ID =
  '0x07e6b810c2dff6df56ea7fbad9ff32f4d84cbee53e496267515887b712924bd1';

// Character package (contains PlayerProfile, Character types)
export const CHARACTER_PACKAGE_ID =
  '0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75';

// EnergyConfig — global shared object from world package
// Query: GraphQL objects(filter:{type:"<world_original_id>::energy::EnergyConfig"})
// testnet_utopia original-id: 0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75
export const ENERGY_CONFIG_ID = '0x9285364e8104c04380d9cc4a001bbdfc81a554aad441c2909c2d3bd52a0c9c62';

// ── Game objects owned by the player (fill in after game setup) ──
export const GATE_CAP_ID      = '0xa4bdcdab52d668e1aa7258cee28936a47155d8868316fece20f6b30410ce189c'; // OwnerCap<Gate>
export const GATE_ID          = '0xd767bd67804c9e7bcb4db90be84fc7fcfe881d0ef44cad9b12298a3090ac960b'; // Gate object
export const NETWORK_NODE_ID  = '0xc15f3b596b8dce9a30140a7232ef3839851a4161cb9976ce23d03481e2ee9c2a'; // NetworkNode object

// EVE token — native game currency (testnet_utopia)
export const EVE_PACKAGE_ID = '0xf0446b93345c1118f21239d7ac58fb82d005219b2016e100f074e4d17162a465';
export const EVE_COIN_TYPE  = `${EVE_PACKAGE_ID}::EVE::EVE`;

// Clock — Sui system shared object (constant across all networks)
export const CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';
