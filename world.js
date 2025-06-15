import * as THREE from 'three';
import { CONFIG, BLOCK_TYPES } from './config.js';
import { PerlinNoise } from './utils.js';

/**
 * Singleton instance of the PerlinNoise generator used for world terrain.
 * The seed '42' ensures consistent noise patterns across game sessions.
 * Exported for potential use in other modules (e.g., enemy placement, biome-specific logic).
 */
export const noise = new PerlinNoise(42);

/**
 * A collection of THREE.Material instances used for rendering different block types.
 * Each key corresponds to a value in the `BLOCK_TYPES` enum.
 */
export const blockMaterials = {
    [BLOCK_TYPES.GRASS]: new THREE.MeshLambertMaterial({ color: 0x4a7c49 }),
    [BLOCK_TYPES.DIRT]: new THREE.MeshLambertMaterial({ color: 0x8B4513 }),
    [BLOCK_TYPES.STONE]: new THREE.MeshLambertMaterial({ color: 0x696969 }),
    /** Water material is transparent to allow visibility through it. */
    [BLOCK_TYPES.WATER]: new THREE.MeshLambertMaterial({ color: 0x4169E1, transparent: true, opacity: 0.7 }),
    [BLOCK_TYPES.SAND]: new THREE.MeshLambertMaterial({ color: 0xF4A460 }),
    [BLOCK_TYPES.SNOW]: new THREE.MeshLambertMaterial({ color: 0xFFFAFA }),
    [BLOCK_TYPES.TREE]: new THREE.MeshLambertMaterial({ color: 0x228B22 }) // Could represent trunk or leaves
};

/**
 * Manages the voxel-based game world, including procedural chunk generation,
 * terrain shaping using Perlin noise, and efficient rendering via instanced meshes.
 */
class VoxelWorld {
    /**
     * Initializes the VoxelWorld.
     */
    constructor() {
        /**
         * A map storing generated chunks, acting as a cache.
         * Keys are chunk coordinates (e.g., "0,0"), values are THREE.Group objects representing the chunk.
         * @type {Map<string, THREE.Group>}
         */
        this.chunks = new Map();
        /**
         * Shared THREE.BoxGeometry instance for all blocks.
         * Using a single geometry instance is crucial for performance with InstancedMesh.
         * @type {THREE.BoxGeometry}
         */
        this.blockGeometry = new THREE.BoxGeometry(CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE);
    }

    /**
     * Determines the type of block at the given world coordinates (x, y, z).
     * This function uses multiple Perlin noise layers to simulate varied terrain features,
     * including elevation, biomes (via moisture and temperature), and special features like trees.
     * @param {number} x - The world x-coordinate.
     * @param {number} y - The world y-coordinate (height).
     * @param {number} z - The world z-coordinate.
     * @returns {number} The block type ID from `BLOCK_TYPES`.
     */
    getBlockType(x, y, z) {
        // Primary terrain elevation determined by heightNoise
        const heightNoise = noise.octaveNoise(x, z, 4, 0.5, 0.01);
        // Secondary noises for biome differentiation or feature placement
        const moistureNoise = noise.octaveNoise(x, z, 3, 0.6, 0.02); // Example: influences sand/snow vs grass
        const temperatureNoise = noise.octaveNoise(x, z, 2, 0.4, 0.015); // Example: influences snow vs other types

        // Calculate base terrain height at this (x,z) position
        const baseHeight = Math.floor(20 + heightNoise * 20); // Base height around y=20, varying by noise
        const waterLevel = 15; // Fixed water level for the world

        // Air blocks above a certain threshold over the terrain
        if (y > baseHeight + 10) return BLOCK_TYPES.AIR;

        // Water blocks if y is at or below waterLevel but still above the calculated terrain height for that point
        // This allows water to fill depressions in the terrain.
        if (y <= waterLevel && y > baseHeight) return BLOCK_TYPES.WATER;

        // Deep stone layer, always present below a certain depth
        if (y <= 5) return BLOCK_TYPES.STONE;

        // Logic for blocks at or below the calculated surface height
        if (y <= baseHeight) {
            // Example biome logic:
            // Hot and dry areas become sand
            if (temperatureNoise > 0.3 && moistureNoise < -0.2 && y === baseHeight) return BLOCK_TYPES.SAND;
            // Cold areas become snow (on the surface)
            if (temperatureNoise < -0.3 && y === baseHeight) return BLOCK_TYPES.SNOW;

            // Standard surface blocks
            if (y === baseHeight) return BLOCK_TYPES.GRASS; // Topmost layer is grass
            if (y > baseHeight - 3) return BLOCK_TYPES.DIRT;  // Layer of dirt beneath grass

            return BLOCK_TYPES.STONE; // Default to stone if other conditions aren't met
        }

        // Tree generation: small chance to place a tree trunk on a grass block if not too cold
        if (y === baseHeight + 1 && this.getBlockType(x,y-1,z) === BLOCK_TYPES.GRASS && Math.random() < 0.01 && temperatureNoise > -0.2) {
            return BLOCK_TYPES.TREE; // Represents a tree trunk block
        }

        // Default to air if no other block type is determined
        return BLOCK_TYPES.AIR;
    }

    /**
     * Generates or retrieves a chunk for the given chunk coordinates.
     * If the chunk already exists in the cache, it's returned directly.
     * Otherwise, a new chunk is generated, consisting of InstancedMesh objects for each block type present.
     * @param {number} chunkX - The x-coordinate of the chunk (in chunk units).
     * @param {number} chunkZ - The z-coordinate of the chunk (in chunk units).
     * @returns {THREE.Group} A THREE.Group containing InstancedMeshes for the chunk's blocks.
     */
    generateChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        // Attempt to retrieve the chunk from cache
        if (this.chunks.has(chunkKey)) {
            return this.chunks.get(chunkKey);
        }

        const chunkGroup = new THREE.Group();
        // Store matrices for each block type to create InstancedMeshes
        const blockInstances = new Map();

        // Initialize map for storing matrices per block type
        Object.values(BLOCK_TYPES).forEach(blockType => {
            if (blockType !== BLOCK_TYPES.AIR) { // Air is not rendered
                blockInstances.set(blockType, []);
            }
        });

        // Iterate over all block positions within this chunk
        for (let localX = 0; localX < CONFIG.CHUNK_SIZE; localX++) {
            for (let localZ = 0; localZ < CONFIG.CHUNK_SIZE; localZ++) {
                for (let localY = 0; localY < CONFIG.WORLD_HEIGHT; localY++) {
                    // Convert local chunk coordinates to world coordinates
                    const worldX = chunkX * CONFIG.CHUNK_SIZE + localX;
                    const worldZ = chunkZ * CONFIG.CHUNK_SIZE + localZ;
                    // localY is already worldY in this context as chunks are full height columns

                    const blockType = this.getBlockType(worldX, localY, worldZ);

                    if (blockType !== BLOCK_TYPES.AIR) {
                        const matrix = new THREE.Matrix4();
                        matrix.setPosition(worldX, localY, worldZ); // Set position for this instance
                        blockInstances.get(blockType).push(matrix);
                    }
                }
            }
        }

        // Create an InstancedMesh for each block type that has instances in this chunk
        blockInstances.forEach((matrices, blockType) => {
            if (matrices.length > 0) {
                const material = blockMaterials[blockType];
                const instancedMesh = new THREE.InstancedMesh(
                    this.blockGeometry, // Shared geometry
                    material,           // Material for this block type
                    matrices.length     // Number of instances
                );

                matrices.forEach((matrix, i) => {
                    instancedMesh.setMatrixAt(i, matrix);
                });

                instancedMesh.instanceMatrix.needsUpdate = true; // Important for Three.js to pick up matrix changes
                instancedMesh.castShadow = true;
                instancedMesh.receiveShadow = true;
                chunkGroup.add(instancedMesh);
            }
        });

        // Cache the generated chunk group
        this.chunks.set(chunkKey, chunkGroup);
        return chunkGroup;
    }
}

/**
 * Singleton instance of the VoxelWorld class, providing the main interface
 * for accessing and managing world data and chunks.
 */
export const voxelWorld = new VoxelWorld();

/**
 * Re-exporting BLOCK_TYPES from config.js via world.js for convenience,
 * as it's often used in conjunction with voxelWorld instance or blockMaterials.
 * This can simplify imports in other modules that interact with the world.
 */
export { BLOCK_TYPES };
