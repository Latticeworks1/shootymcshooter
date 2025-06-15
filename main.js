import * as THREE from 'three';
// PointerLockControls is imported for direct use in initializing player controls.
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- Module Imports ---
// Configuration: Core game settings and block type definitions.
import { CONFIG, BLOCK_TYPES } from './config.js';

// World: Manages voxel terrain, chunk generation, and provides world data.
import { voxelWorld } from './world.js';

// Player: Handles camera, controls, movement physics, and interactions.
import {
    camera,
    initPlayerControls,
    // moveState, // moveState is internal to player.js after refactor
    // velocity as playerVelocity, // velocity is internal to player.js
    // direction as playerDirection, // direction is internal to player.js
    updatePlayerMovement,
    onKeyDown as playerOnKeyDown, // Renamed to avoid conflict if main.js had its own onKeyDown
    onKeyUp as playerOnKeyUp,     // Renamed for clarity
    getTerrainHeight as playerGetTerrainHeight, // Function to get terrain height, used for initialization
    // checkTerrainCollision as playerCheckTerrainCollision // Collision is internal to player.js
} from './player.js';
/** @type {PointerLockControls} Will hold the initialized PointerLockControls instance. */
let controls;

// Weapon: Manages weapon systems, firing, reloading, and bullet pooling.
import { weaponSystem } from './weapon.js';

// Enemy: Defines enemy behavior, AI, and interactions.
import { Enemy, initEnemySystem } from './enemy.js';

// UI: Manages HUD updates, minimap, and other UI elements.
import {
    updateHealthBar,
    updateUI,
    updateStats,
    minimap,
    initUISystem
} from './ui.js';

// --- Global Game State ---
/**
 * Central object holding the dynamic state of the game.
 * Exported to be accessible and modifiable by other modules (though direct modification should be minimized).
 * @property {number} health - Player's current health.
 * @property {number} ammo - Current ammo in player's weapon clip.
 * @property {number} totalAmmo - Player's total reserve ammunition.
 * @property {number} score - Player's current score.
 * @property {Enemy[]} enemies - Array of active enemy instances.
 * @property {Bullet[]} bullets - Array of active bullet instances.
 * @property {Map<string, THREE.Group>} chunks - Deprecated here; voxelWorld.chunks is the source of truth. This might be for game logic state if different.
 * @property {Set<string>} loadedChunks - Set of chunk keys (e.g., "x,z") currently loaded and added to the scene.
 */
export const gameState = {
    health: CONFIG.MAX_HEALTH,
    ammo: CONFIG.AMMO_CAPACITY,
    totalAmmo: CONFIG.TOTAL_AMMO,
    score: 0,
    enemies: [],
    bullets: [], // Managed by WeaponSystem pool; this array holds active bullets in the scene.
    // chunks: new Map(), // This was noted as potentially redundant; voxelWorld.chunks is the primary cache.
    loadedChunks: new Set()
};

// --- Scene Setup ---
/**
 * The main Three.js scene graph. Exported for modules that need to add/remove objects.
 * @type {THREE.Scene}
 */
export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 50, CONFIG.RENDER_DISTANCE * CONFIG.CHUNK_SIZE * 0.8); // Fog adjusted slightly

/**
 * The Three.js WebGL renderer instance.
 * @type {THREE.WebGLRenderer}
 */
const renderer = new THREE.WebGLRenderer({
    antialias: true, // Enables antialiasing for smoother edges
    powerPreference: "high-performance" // Requests high performance GPU if available
});

/**
 * Configures and initializes the WebGL renderer and appends its canvas to the DOM.
 */
function setupRenderer() {
    renderer.setSize(window.innerWidth, window.innerHeight); // Set to full window size
    renderer.shadowMap.enabled = true; // Enable shadow mapping
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadow edges (performance cost)
    renderer.setClearColor(0x87ceeb, 1); // Sky blue background color
    document.getElementById('container').appendChild(renderer.domElement); // Add canvas to HTML
}

/**
 * Sets up the lighting for the scene (ambient and directional).
 */
function setupLighting() {
    // Ambient light provides overall, non-directional illumination
    const ambientLight = new THREE.AmbientLight(0x606060, 0.8); // Slightly brighter ambient
    scene.add(ambientLight);

    // Directional light simulates sunlight and casts shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); // Slightly softer sunlight
    directionalLight.position.set(150, 200, 100); // Positioned to cast angled shadows
    directionalLight.castShadow = true;
    // Configure shadow properties for quality and performance
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500; // Should encompass visible area
    const shadowCamSize = CONFIG.RENDER_DISTANCE * CONFIG.CHUNK_SIZE * 0.75; // Adjust shadow camera frustum
    directionalLight.shadow.camera.left = -shadowCamSize;
    directionalLight.shadow.camera.right = shadowCamSize;
    directionalLight.shadow.camera.top = shadowCamSize;
    directionalLight.shadow.camera.bottom = -shadowCamSize;
    scene.add(directionalLight);
    // scene.add(new THREE.CameraHelper(directionalLight.shadow.camera)); // Uncomment to debug shadow camera
}

// --- Event Handlers ---
/**
 * Handles mouse down events, primarily for firing the weapon.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseDown(event) {
    // Fire weapon if pointer is locked and left mouse button (0) is pressed
    if (controls && controls.isLocked && event.button === 0) {
        weaponSystem.fireWeapon();
    }
}

/**
 * Handles window resize events to adjust camera aspect ratio and renderer size.
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Game Logic Functions ---
/**
 * Spawns a new enemy at a random position around the player.
 * Enemy instances are created and added to the `gameState.enemies` array.
 */
function spawnEnemy() {
    // Calculate a random spawn position within a certain range from the player
    const angle = Math.random() * Math.PI * 2;
    const minSpawnDist = CONFIG.CHUNK_SIZE; // Minimum distance to spawn
    const maxSpawnDist = CONFIG.CHUNK_SIZE * (CONFIG.RENDER_DISTANCE - 0.5); // Max distance, within loaded area
    const distance = minSpawnDist + Math.random() * (maxSpawnDist - minSpawnDist);

    const x = camera.position.x + Math.cos(angle) * distance;
    const z = camera.position.z + Math.sin(angle) * distance;

    const enemy = new Enemy(x, z); // Create new enemy instance
    gameState.enemies.push(enemy); // Add to global list
    updateUI(); // Update HUD (e.g., enemy count)
}

/**
 * Manages dynamic loading and unloading of world chunks based on player position.
 * Ensures that chunks within `CONFIG.RENDER_DISTANCE` are loaded and visible,
 * while chunks outside this range are removed from the scene (but kept in cache).
 */
function updateChunks() {
    const playerChunkX = Math.floor(camera.position.x / CONFIG.CHUNK_SIZE);
    const playerChunkZ = Math.floor(camera.position.z / CONFIG.CHUNK_SIZE);

    const requiredChunks = new Set(); // Set of chunk keys that should be loaded

    // Identify all chunks that should be currently visible
    for (let x = playerChunkX - CONFIG.RENDER_DISTANCE; x <= playerChunkX + CONFIG.RENDER_DISTANCE; x++) {
        for (let z = playerChunkZ - CONFIG.RENDER_DISTANCE; z <= playerChunkZ + CONFIG.RENDER_DISTANCE; z++) {
            const chunkKey = `${x},${z}`;
            requiredChunks.add(chunkKey);

            // If a required chunk is not currently loaded, generate/retrieve from cache and add to scene
            if (!gameState.loadedChunks.has(chunkKey)) {
                const chunk = voxelWorld.generateChunk(x, z);
                scene.add(chunk);
                gameState.loadedChunks.add(chunkKey);
            }
        }
    }

    // Unload chunks that are no longer required
    gameState.loadedChunks.forEach(chunkKey => {
        if (!requiredChunks.has(chunkKey)) {
            const chunk = voxelWorld.chunks.get(chunkKey); // Get from VoxelWorld's cache
            if (chunk) {
                scene.remove(chunk); // Remove from scene
                // Note: InstancedMesh children's geometry/material are shared and should not be disposed here.
            }
            gameState.loadedChunks.delete(chunkKey); // Remove from active set
            // Chunk remains in voxelWorld.chunks for future reuse (caching)
        }
    });
}

/**
 * Asynchronously initializes the game world.
 * Loads initial chunks, positions the player, spawns initial enemies, and updates loading screen.
 */
async function initializeWorld() {
    const loadingEl = document.getElementById('loading');
    const progressEl = document.getElementById('progress');

    const totalChunksToLoad = (CONFIG.RENDER_DISTANCE * 2 + 1) ** 2;
    let chunksLoadedCount = 0;

    // Load initial set of chunks around the origin (0,0) or player's starting chunk
    for (let x = -CONFIG.RENDER_DISTANCE; x <= CONFIG.RENDER_DISTANCE; x++) {
        for (let z = -CONFIG.RENDER_DISTANCE; z <= CONFIG.RENDER_DISTANCE; z++) {
            const chunk = voxelWorld.generateChunk(x, z);
            scene.add(chunk);
            gameState.loadedChunks.add(`${x},${z}`);

            chunksLoadedCount++;
            if (progressEl) { // Update loading progress on UI
                 progressEl.textContent = `${Math.round((chunksLoadedCount / totalChunksToLoad) * 100)}%`;
            }
            // Yield to browser briefly to allow UI updates during intensive chunk loading
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    // Position the player correctly on the terrain after initial chunks are loaded
    const initialPlayerY = playerGetTerrainHeight(0, 0) + CONFIG.PLAYER_HEIGHT;
    camera.position.set(0, initialPlayerY, 0);
    if(controls) controls.getObject().position.set(0, initialPlayerY, 0); // Sync controls object position

    // Spawn a few initial enemies with a slight delay
    for (let i = 0; i < 5; i++) {
        setTimeout(() => spawnEnemy(), i * 1500 + 1000);
    }

    if (loadingEl) loadingEl.style.display = 'none'; // Hide loading screen
    updateUI(); // Perform initial UI update (ammo, score, etc.)

    console.log('Voxel world initialized by main.js with', gameState.loadedChunks.size, 'chunks.');
}

/**
 * Checks if the player is in a block type that causes environmental damage (e.g., water).
 * If so, applies damage and updates the health bar.
 * This function is called periodically from the main game loop.
 */
function checkEnvironmentalDamage() {
    const playerPos = camera.position;
    // Check block type at player's approximate feet position
    const blockAtFeet = voxelWorld.getBlockType(
        Math.floor(playerPos.x),
        Math.floor(playerPos.y - CONFIG.PLAYER_HEIGHT + 0.1), // Check just above feet ground contact
        Math.floor(playerPos.z)
    );

    if (blockAtFeet === BLOCK_TYPES.WATER) {
        if (gameState.health > 0) {
            gameState.health -= 0.5; // Apply small damage for being in water
            updateHealthBar(); // Update health display
            if (gameState.health <=0) { // Check for death
                 handlePlayerDeath();
            }
        }
    }
}

/**
 * Handles the player's death. Unlocks controls, shows a game over message, and reloads the page.
 * This could be expanded for a more sophisticated game over sequence.
 */
function handlePlayerDeath() {
    if (controls) controls.unlock(); // Release pointer lock
    alert('Game Over! Final Score: ' + gameState.score);
    location.reload(); // Simple way to restart the game
}

// --- Main Game Loop (`animate`) ---
/** Stores the key of the chunk the player was last in, to trigger `updateChunks` on change. */
let lastPlayerChunkKey = "";
/** Accumulator for time since last environmental damage check. */
let timeSinceLastEnvDamageCheck = 0;
/** Interval (in seconds) for checking environmental damage. */
const envDamageCheckInterval = 1.0;

/**
 * The main game loop, called every frame using `requestAnimationFrame`.
 * Updates game logic, player movement, AI, physics, UI, and renders the scene.
 * @param {number} [timestamp] - Timestamp provided by `requestAnimationFrame` (not used if fixed delta).
 */
function animate(timestamp) { // timestamp can be used with THREE.Clock for variable delta
    requestAnimationFrame(animate); // Schedule next frame
    const delta = 0.0166; // Fixed delta time, approximating 60 FPS

    // --- Periodic Game Logic ---
    // Environmental damage check, runs at `envDamageCheckInterval`
    timeSinceLastEnvDamageCheck += delta;
    if (timeSinceLastEnvDamageCheck >= envDamageCheckInterval) {
        checkEnvironmentalDamage();
        timeSinceLastEnvDamageCheck = 0; // Reset timer
    }

    // --- Core Updates ---
    updatePlayerMovement(delta); // Update player position, physics, collisions

    // Dynamic chunk loading/unloading based on player's current chunk
    const currentChunkX = Math.floor(camera.position.x / CONFIG.CHUNK_SIZE);
    const currentChunkZ = Math.floor(camera.position.z / CONFIG.CHUNK_SIZE);
    const playerChunkKey = `${currentChunkX},${currentChunkZ}`;
    if (playerChunkKey !== lastPlayerChunkKey) {
        updateChunks();
        lastPlayerChunkKey = playerChunkKey;
    }

    // Update all active enemies
    gameState.enemies.forEach(enemy => {
        // Ensure enemy is still valid (hasn't been destroyed and removed from scene elsewhere)
        if (enemy.mesh && enemy.mesh.parent === scene) {
            enemy.update(delta, camera.position);
        }
    });

    // Update all active bullets
    // Loop backwards for safe removal from array if a bullet deactivates itself during update
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        gameState.bullets[i].update(delta);
    }

    // --- Gameplay Event Triggers ---
    // Periodically spawn new enemies if count is below threshold
    if (Math.random() < 0.002 && gameState.enemies.length < 15) {
        spawnEnemy();
    }

    // Auto-reload weapon if out of ammo and has reserves
    if (gameState.ammo === 0 && gameState.totalAmmo > 0 && !weaponSystem.isReloading) {
        setTimeout(() => weaponSystem.reload(), 500);
    }

    // --- UI Updates & Rendering ---
    minimap.update(); // Update minimap display
    updateStats();    // Update FPS counter and other stats
    renderer.render(scene, camera); // Render the scene
}

// --- Initialization Sequence ---
/**
 * Main entry point for the game. Waits for the DOM to be fully loaded,
 * then sets up the renderer, lighting, player controls, event listeners,
 * and initializes all game systems before starting the main animation loop.
 */
document.addEventListener('DOMContentLoaded', () => {
    setupRenderer(); // Initialize renderer and append to DOM
    setupLighting(); // Add lights to the scene

    // Initialize player controls and add player object (camera) to the scene
    controls = initPlayerControls(renderer.domElement);
    scene.add(controls.getObject());

    // --- Setup Global Event Listeners ---
    document.addEventListener('keydown', (event) => playerOnKeyDown(event, weaponSystem));
    document.addEventListener('keyup', playerOnKeyUp);
    document.addEventListener('mousedown', onMouseDown); // Handles shooting
    window.addEventListener('resize', onWindowResize);   // Handles window resizing

    // Pointer Lock specific event listeners for UI feedback or state changes
    renderer.domElement.addEventListener('click', () => {
        if (controls && !controls.isLocked) { // Check if controls exists before trying to lock
            controls.lock();
        }
    });
    if(controls) { // Ensure controls are initialized before adding listeners
        controls.addEventListener('lock', () => { console.log('Pointer locked'); });
        controls.addEventListener('unlock', () => { console.log('Pointer unlocked'); });
    }

    // --- Initialize Game System Modules ---
    // These calls inject shared dependencies like scene, gameState, camera into other modules.
    weaponSystem.init(scene, gameState, updateUI);
    initEnemySystem(scene, gameState, updateHealthBar, updateUI);
    initUISystem(gameState, camera, playerGetTerrainHeight, CONFIG);

    // Start the world initialization process (async)
    initializeWorld().then(() => {
        animate(); // Start the main game loop after world is ready
        console.log('Enhanced Voxel FPS Game initialized by main.js successfully!');
        console.log('Features: Procedural world generation, weapon system, enemy AI, minimap, modular JS.');
        console.log('Click to lock controls, WASD to move, mouse to look, click to shoot, R to reload.');
    }).catch(error => {
        // Handle errors during critical initialization
        console.error("Critical error during world initialization:", error);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.textContent = "Error loading world. See console for details.";
    });
});

// Informative log that main.js has been parsed and is awaiting DOMContentLoaded.
console.log("main.js loaded and awaiting DOMContentLoaded.");
