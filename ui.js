import * as THREE from 'three'; // Used by minimap for THREE.Vector3
import { CONFIG } from './config.js'; // Used by minimap and other UI functions

// --- Module-scoped variables for dependencies injected by initUISystem ---
/** @type {object} Reference to the global game state. */
let gameState;
/** @type {THREE.PerspectiveCamera} Reference to the player's camera. */
let camera;
/** @type {function(number, number): number} Reference to a function that gets terrain height. */
let playerGetTerrainHeight;
// Note: `playerGetTerrainHeight` is named from player's perspective but might be `world.getTerrainHeight`.

/**
 * Initializes the UI system with essential dependencies from the main game context.
 * This function should be called once when the game starts.
 * @param {object} mainGameState - The global game state object.
 * @param {THREE.PerspectiveCamera} playerCamera - The player's camera instance.
 * @param {function(number, number): number} terrainHeightGetter - Function to get terrain height at (x,z).
 * @param {object} gameCONFIG - The global game configuration object.
 */
export function initUISystem(mainGameState, playerCamera, terrainHeightGetter, gameCONFIG) {
    gameState = mainGameState;
    camera = playerCamera;
    playerGetTerrainHeight = terrainHeightGetter;
    // CONFIG is already imported, but if specific parts of CONFIG were needed only after init,
    // they could be passed and stored from gameCONFIG. Here, we mainly ensure minimap gets it.

    if (minimap && minimap.init) {
        // Pass necessary references to the minimap's own init method.
        minimap.init(gameState, camera, playerGetTerrainHeight, gameCONFIG); // Pass gameCONFIG to minimap
    }
}

// --- HUD Update Functions ---

/**
 * Updates the player's health bar display on the HUD.
 * Reads current health from `gameState` and `CONFIG.MAX_HEALTH`.
 */
export function updateHealthBar() {
    if (!gameState) return; // Ensure gameState is initialized
    const healthFillEl = document.getElementById('health-fill'); // The dynamic "fill" part of the health bar
    if (!healthFillEl) return; // Element might not be in DOM if HUD is hidden or during setup

    const healthPercent = Math.max(0, gameState.health / CONFIG.MAX_HEALTH);
    healthFillEl.style.width = `${healthPercent * 100}%`; // Set width as a percentage

    // Note: Game over logic (e.g., alert, screen change) is handled in main.js,
    // which calls this function to update the visual display.
}

/**
 * Updates general UI elements like ammo count, enemy count, and score on the HUD.
 * Reads relevant data from `gameState`.
 */
export function updateUI() {
    if (!gameState) return; // Ensure gameState is initialized

    // DOM element selectors (cached selectors at module scope could be a micro-optimization if called extremely frequently)
    const ammoEl = document.getElementById('ammo');                 // Span for current clip ammo
    const totalAmmoEl = document.getElementById('total-ammo');       // Span for total reserve ammo
    const enemyCountEl = document.getElementById('enemy-count');     // Span for remaining enemy count
    const scoreEl = document.getElementById('score');               // Span for player's score

    if (ammoEl) ammoEl.textContent = gameState.ammo;
    if (totalAmmoEl) totalAmmoEl.textContent = gameState.totalAmmo;
    if (enemyCountEl) enemyCountEl.textContent = gameState.enemies ? gameState.enemies.length : 0;
    if (scoreEl) scoreEl.textContent = gameState.score;
}

// --- Performance and Debug Stats ---
let frameCount = 0; // Counter for frames within the current second
let lastTime = performance.now(); // Timestamp of the last stats update

/**
 * Updates performance statistics (FPS) and debug information (chunk count, player position) on the HUD.
 * Calculates FPS based on time elapsed and frames rendered since the last update.
 */
export function updateStats() {
    if (!camera || !gameState) return; // Ensure dependencies are initialized

    const currentTime = performance.now();
    frameCount++;

    // Update stats display approximately once per second
    if (currentTime - lastTime >= 1000) {
        const fpsEl = document.getElementById('fps');
        const chunksEl = document.getElementById('chunks');
        const positionEl = document.getElementById('position');

        if (fpsEl) {
            const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
            fpsEl.textContent = `FPS: ${fps}`;
        }
        if (chunksEl && gameState.loadedChunks) { // Check if loadedChunks is available
            chunksEl.textContent = `Chunks: ${gameState.loadedChunks.size}`;
        }
        if (positionEl) {
            positionEl.textContent =
                `Position: ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`;
        }

        frameCount = 0; // Reset frame counter for the next second
        lastTime = currentTime; // Update timestamp of the last stats calculation
    }
}

/**
 * Creates and manages the minimap display.
 * This internal function sets up the canvases and returns an object with `init` and `update` methods.
 * @returns {object} Minimap object with `init` and `update` methods.
 * @private
 */
function createMinimapInternal() {
    const minimapSize = 150; // Diameter of the circular minimap in pixels

    // Main visible canvas for the minimap
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = minimapSize;
    minimapCanvas.height = minimapSize;
    minimapCanvas.style.position = 'absolute';
    minimapCanvas.style.top = '20px';
    minimapCanvas.style.right = '200px';
    minimapCanvas.style.border = '2px solid white';
    minimapCanvas.style.borderRadius = '50%'; // Circular appearance
    minimapCanvas.style.background = 'rgba(0,0,0,0.7)'; // Semi-transparent background

    const hud = document.getElementById('hud'); // Assumes an element with id="hud" exists
    if (hud) {
        hud.appendChild(minimapCanvas);
    } else {
        // This error is useful for developers if the HTML structure is incorrect.
        console.error("HUD element not found for minimap. Minimap will not be displayed.");
        // Return a stub object to prevent errors if update is called
        return { canvas: null, ctx: null, update: () => {}, init: () => {} };
    }

    const ctx = minimapCanvas.getContext('2d'); // Context for drawing on the visible minimap

    // Offscreen canvas for caching the terrain layer of the minimap
    const terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = minimapSize;
    terrainCanvas.height = minimapSize;
    const terrainCtx = terrainCanvas.getContext('2d'); // Context for the offscreen terrain cache

    // Variables to track player's chunk position for cache invalidation
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;

    // Store references to dependencies received via init
    let minimapGameState, minimapCamera, minimapTerrainHeightGetter, minimapCONFIG;

    return {
        canvas: minimapCanvas,
        ctx: ctx,
        /**
         * Initializes the minimap with necessary game references.
         * @param {object} mGameState - Global game state.
         * @param {THREE.PerspectiveCamera} mCamera - Player's camera.
         * @param {function} mTerrainHeightGetter - Function to get terrain height.
         * @param {object} mCONFIG - Global game configuration.
         */
        init: function(mGameState, mCamera, mTerrainHeightGetter, mCONFIG) {
            minimapGameState = mGameState;
            minimapCamera = mCamera;
            minimapTerrainHeightGetter = mTerrainHeightGetter;
            minimapCONFIG = mCONFIG;
        },
        /**
         * Updates the minimap display. Called every frame.
         * Redraws the terrain cache if the player moves to a new chunk.
         * Draws dynamic elements (enemies, player icon) every frame.
         */
        update: function() {
            // Ensure all dependencies are initialized before proceeding
            if (!this.ctx || !minimapGameState || !minimapCamera || !minimapTerrainHeightGetter || !minimapCONFIG) return;

            // Determine player's current chunk coordinates
            const currentChunkX = Math.floor(minimapCamera.position.x / minimapCONFIG.CHUNK_SIZE);
            const currentChunkZ = Math.floor(minimapCamera.position.z / minimapCONFIG.CHUNK_SIZE);

            // --- Terrain Cache Update (if player changed chunk) ---
            if (currentChunkX !== lastPlayerChunkX || currentChunkZ !== lastPlayerChunkZ) {
                terrainCtx.clearRect(0, 0, minimapSize, minimapSize);
                terrainCtx.fillStyle = 'rgba(0,0,0,0.7)'; // Background for the terrain cache
                terrainCtx.fillRect(0, 0, minimapSize, minimapSize);

                const scale = 2; // Pixels per world unit on the minimap
                const centerX = minimapSize / 2; // Center of the minimap canvas
                const centerY = minimapSize / 2;
                // Calculate the range of world units to draw from the center to fill the minimap
                const range = Math.floor(minimapSize / (2 * scale));

                // Iterate over a grid around the player's current world position
                for (let x = -range; x < range; x++) {
                    for (let z = -range; z < range; z++) {
                        const worldX = Math.floor(minimapCamera.position.x) + x;
                        const worldZ = Math.floor(minimapCamera.position.z) + z;

                        const height = minimapTerrainHeightGetter(worldX, worldZ);

                        // Convert world offset to pixel offset on minimap
                        const pixelX = centerX + x * scale;
                        const pixelY = centerY + z * scale;

                        // Determine color based on terrain height
                        const heightRatio = Math.min(1, Math.max(0, height / (minimapCONFIG.WORLD_HEIGHT * 0.75))); // Normalize height
                        let hue = 100 - (heightRatio * 100); // Green (100) towards Red (0) for lower terrain
                        let saturation = 60 + (heightRatio * 20);
                        let lightness = 30 + (heightRatio * 20);

                        // Special colors for water and snow/high altitude
                        if (height < 16) { // Assuming waterLevel around 15 from world.js
                             hue = 200 + (heightRatio*20) ; saturation = 70; lightness = 35 + (heightRatio*10) ; // Blues
                        } else if (height > minimapCONFIG.WORLD_HEIGHT * 0.6) {
                            hue = 180; saturation = 20 - (heightRatio*10) ; lightness = 70 + (heightRatio*20); // Light blues/whites
                        }

                        terrainCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
                        terrainCtx.fillRect(pixelX, pixelY, Math.ceil(scale), Math.ceil(scale)); // Use Math.ceil to avoid gaps
                    }
                }
                // Update last known chunk coordinates
                lastPlayerChunkX = currentChunkX;
                lastPlayerChunkZ = currentChunkZ;
            }

            // --- Main Minimap Canvas Drawing (every frame) ---
            this.ctx.clearRect(0, 0, minimapSize, minimapSize); // Clear the visible minimap
            this.ctx.drawImage(terrainCanvas, 0, 0); // Draw the cached terrain layer

            // Draw enemies
            this.ctx.fillStyle = 'red';
            const minimapDrawScale = 2; // Scale used for drawing dynamic elements
            if (minimapGameState.enemies) {
                minimapGameState.enemies.forEach(enemy => {
                    if (!enemy.mesh) return; // Skip if enemy is already destroyed
                    // Calculate enemy position relative to player, then scale for minimap
                    const relX = enemy.mesh.position.x - minimapCamera.position.x;
                    const relZ = enemy.mesh.position.z - minimapCamera.position.z;

                    // Check if enemy is within minimap display bounds
                    if (Math.abs(relX * minimapDrawScale) < minimapSize / 2 && Math.abs(relZ * minimapDrawScale) < minimapSize / 2) {
                        const pixelX = (minimapSize / 2) + relX * minimapDrawScale;
                        const pixelY = (minimapSize / 2) + relZ * minimapDrawScale;
                        this.ctx.fillRect(pixelX - 2, pixelY - 2, 4, 4); // Draw enemy as a small square
                    }
                });
            }

            // Draw player icon (blue square at the center)
            this.ctx.fillStyle = 'blue';
            this.ctx.fillRect((minimapSize / 2) - 3, (minimapSize / 2) - 3, 6, 6);

            // Draw player direction line
            const playerDir = new THREE.Vector3(); // Reusable vector could be at module scope if preferred
            minimapCamera.getWorldDirection(playerDir); // Get camera's forward direction
            this.ctx.strokeStyle = 'blue';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(minimapSize / 2, minimapSize / 2); // Start line from center
            // End line based on player's XZ direction (Y component of direction is ignored for 2D map)
            this.ctx.lineTo((minimapSize / 2) + playerDir.x * 15, (minimapSize / 2) + playerDir.z * 15); // Line length 15
            this.ctx.stroke();
        }
    };
}

/**
 * Exported minimap object, contains `init` and `update` methods.
 * `init` should be called by `initUISystem` to provide necessary game context.
 * `update` should be called every frame in the main game loop.
 */
export const minimap = createMinimapInternal();
