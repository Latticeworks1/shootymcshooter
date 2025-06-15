/**
 * Global game configuration settings.
 * These constants define the core parameters of the game world, player mechanics,
 * and other system behaviors.
 */
export const CONFIG = {
    /** Size of each dimension (width, depth) of a cubic chunk in blocks. World height is separate. */
    CHUNK_SIZE: 32,
    /** Maximum height of the world in blocks. */
    WORLD_HEIGHT: 64,
    /** Render distance in chunks around the player (e.g., 3 means a (2*3+1)x(2*3+1) = 7x7 area of chunks is loaded). */
    RENDER_DISTANCE: 3,
    /** The size of a single block in world units (e.g., 1 means 1x1x1 world units). */
    BLOCK_SIZE: 1,
    /** The height of the player character in world units. */
    PLAYER_HEIGHT: 1.8,
    /** Base movement speed of the player in world units per second. */
    PLAYER_SPEED: 8,
    /** Initial vertical velocity applied to the player when jumping. */
    JUMP_VELOCITY: 12,
    /** Gravitational acceleration applied to the player in world units per second squared. */
    GRAVITY: -25,
    /** Speed of bullets in world units per second. */
    BULLET_SPEED: 100,
    /** Damage inflicted by a single bullet. */
    BULLET_DAMAGE: 25,
    /** Maximum health of the player. */
    MAX_HEALTH: 100,
    /** Maximum number of bullets a weapon can hold in a single clip/magazine. */
    AMMO_CAPACITY: 30,
    /** Initial total ammunition the player starts with, excluding the loaded clip. */
    TOTAL_AMMO: 120
};

/**
 * Enumeration of block types and their corresponding numeric ID values.
 * These IDs are used in world generation and rendering to determine the appearance
 * and behavior of different blocks.
 */
export const BLOCK_TYPES = {
    /** Represents empty space; not rendered and allows passage. */
    AIR: 0,
    /** Represents a grass block, typically found on the surface of terrain. */
    GRASS: 1,
    /** Represents a dirt block, typically found beneath grass. */
    DIRT: 2,
    /** Represents a stone block, found deeper underground or forming mountains. */
    STONE: 3,
    /** Represents a water block, typically found at a certain world level. Player can pass but may be affected. */
    WATER: 4,
    /** Represents a sand block, often found near water or in desert-like biomes. */
    SAND: 5,
    /** Represents a snow block, found in colder biomes or at high altitudes. */
    SNOW: 6,
    /** Represents a tree trunk block (or could be leaves depending on context). Part of tree structures. */
    TREE: 7
};
