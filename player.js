import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from './config.js';
import { voxelWorld, BLOCK_TYPES as WORLD_BLOCK_TYPES } from './world.js';

// --- Module-Scoped Reusable THREE.js Objects ---
/** Temporary vector for calculating forward/backward movement direction. @type {THREE.Vector3} */
const _moveDirection = new THREE.Vector3();
/** Temporary vector for calculating strafe (left/right) movement direction. @type {THREE.Vector3} */
const _strafeDirection = new THREE.Vector3();
/** Temporary vector for storing the player's potential new position for collision checks. @type {THREE.Vector3} */
const _newPlayerPosition = new THREE.Vector3();
/** Temporary vector for storing the player's position at the start of an update cycle. @type {THREE.Vector3} */
const _oldPlayerPosition = new THREE.Vector3();
/** Temporary vector for checking potential head collision. @type {THREE.Vector3} */
const _headPosition = new THREE.Vector3();
/** Temporary vector for collision sliding logic. @type {THREE.Vector3} */
const _tempPlayerPos = new THREE.Vector3();

/** Reusable Box3 for block collision checking. @type {THREE.Box3} */
const _blockBox = new THREE.Box3();
/** Reusable Sphere for player collision checking. @type {THREE.Sphere} */
const _playerSphere = new THREE.Sphere();


// --- Camera and Controls ---
/**
 * The main game camera.
 * Exported to be used by other modules (e.g., main.js for rendering, enemy.js for AI)
 * @type {THREE.PerspectiveCamera}
 */
export const camera = new THREE.PerspectiveCamera(
    75, // Field of View (degrees)
    window.innerWidth / window.innerHeight, // Aspect ratio
    0.1, // Near clipping plane
    1000 // Far clipping plane
);

/**
 * PointerLockControls instance for FPS-style mouse look.
 * Exported to be managed and accessed by main.js.
 * @type {PointerLockControls}
 */
export let controls;

/**
 * Initializes the PointerLockControls for the player.
 * @param {HTMLCanvasElement} rendererDomElement - The canvas element used by the WebGL renderer.
 * @returns {PointerLockControls} The initialized controls instance.
 */
export function initPlayerControls(rendererDomElement) {
    controls = new PointerLockControls(camera, rendererDomElement);
    // Initial camera position (can be overridden by world initialization logic)
    camera.position.set(0, CONFIG.WORLD_HEIGHT / 2, 0);
    return controls;
}

// --- Player State ---
/**
 * Object holding the current state of player movement inputs.
 * @property {boolean} forward - True if player is trying to move forward.
 * @property {boolean} backward - True if player is trying to move backward.
 * @property {boolean} left - True if player is trying to strafe left.
 * @property {boolean} right - True if player is trying to strafe right.
 * @property {boolean} jump - True if player is attempting to jump (transient).
 * @property {boolean} canJump - True if the player is currently able to jump (e.g., on ground).
 */
export const moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false, // Currently not directly used in updatePlayerMovement, jump is instant via velocity
    canJump: false
};

/**
 * Player's current velocity vector in world units per second.
 * Updated by physics (gravity, input) and used to move the player.
 * @type {THREE.Vector3}
 */
export const velocity = new THREE.Vector3();

/**
 * Player's current input direction vector (normalized).
 * Based on WASD keys, indicates desired horizontal movement direction.
 * @type {THREE.Vector3}
 */
export const direction = new THREE.Vector3();

// Raycaster (placeholder for more advanced interaction if needed)
/** @type {THREE.Raycaster} */
export const raycaster = new THREE.Raycaster();
/** Pre-defined down vector for potential raycasting. @type {THREE.Vector3} */
export const downVector = new THREE.Vector3(0, -1, 0);


// --- Terrain Interaction ---
/**
 * Calculates the Y-coordinate of the topmost solid block at the given world (x, z) coordinates.
 * Iterates downwards from world height until a non-AIR block is found.
 * @param {number} x - The world x-coordinate.
 * @param {number} z - The world z-coordinate.
 * @returns {number} The y-coordinate of the terrain surface, or 0 if no solid block is found.
 */
export function getTerrainHeight(x, z) {
    for (let y = CONFIG.WORLD_HEIGHT - 1; y >= 0; y--) {
        if (voxelWorld.getBlockType(Math.floor(x), y, Math.floor(z)) !== WORLD_BLOCK_TYPES.AIR) {
            return y + 1; // Return top surface of the block
        }
    }
    return 0; // Should ideally not happen in a solid world
}

/**
 * Checks for collision between the player (represented as a sphere) and nearby solid terrain blocks.
 * It iterates through a 3x3x3 grid of blocks around the player's current integer coordinates.
 * Uses pre-allocated `_playerSphere` and `_blockBox` for efficiency.
 * @param {THREE.Vector3} position - The world position of the player (center of the collision sphere).
 * @param {number} [radius=0.5] - The radius of the player's collision sphere.
 * @returns {boolean} True if a collision is detected, false otherwise.
 */
export function checkTerrainCollision(position, radius = 0.5) {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);

    _playerSphere.set(position, radius); // Update player's collision sphere

    // Check a 3x3x3 cube of blocks centered around the player's integer coordinates
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const checkX = x + dx;
                const checkY = y + dy;
                const checkZ = z + dz;
                const blockType = voxelWorld.getBlockType(checkX, checkY, checkZ);

                // Consider any block that is not AIR or WATER as solid for collision
                if (blockType !== WORLD_BLOCK_TYPES.AIR && blockType !== WORLD_BLOCK_TYPES.WATER) {
                    // Define the AABB for the current block
                    _blockBox.min.set(checkX, checkY, checkZ);
                    _blockBox.max.set(checkX + 1, checkY + 1, checkZ + 1);

                    // Check for intersection between player sphere and block AABB
                    if (_blockBox.intersectsSphere(_playerSphere)) {
                        return true; // Collision detected
                    }
                }
            }
        }
    }
    return false; // No collision detected
}

/**
 * Updates the player's position and velocity based on input, physics (gravity), and collisions.
 * This function is called every frame in the game loop.
 * @param {number} delta - The time elapsed since the last frame, in seconds.
 */
export function updatePlayerMovement(delta) {
    if (!controls.isLocked) {
        // If pointer is not locked, do not process movement or physics.
        // Optionally, could apply strong damping or reset horizontal velocity here.
        return;
    }

    const playerObject = controls.getObject(); // The camera is the core of the player object
    _oldPlayerPosition.copy(playerObject.position); // Store position before this frame's movement

    // --- Apply Gravity ---
    velocity.y += CONFIG.GRAVITY * delta;

    // --- Process Input and Calculate Horizontal Velocity ---
    // Get normalized input direction (WASD)
    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize(); // Ensures consistent speed regardless of diagonal movement

    let targetVelocityX = 0;
    let targetVelocityZ = 0;

    // Calculate forward/backward movement vector relative to camera
    if (direction.z !== 0) {
        camera.getWorldDirection(_moveDirection); // Gets the Z-axis of camera
        _moveDirection.y = 0; // Project onto XZ plane
        _moveDirection.normalize();
        _moveDirection.multiplyScalar(direction.z * CONFIG.PLAYER_SPEED); // Scale by speed and input direction
        targetVelocityX += _moveDirection.x;
        targetVelocityZ += _moveDirection.z;
    }

    // Calculate strafe (left/right) movement vector relative to camera
    if (direction.x !== 0) {
        camera.getWorldDirection(_strafeDirection); // Gets the Z-axis of camera
        _strafeDirection.cross(camera.up); // Get the X-axis of camera (right vector)
        _strafeDirection.y = 0; // Project onto XZ plane
        _strafeDirection.normalize();
        _strafeDirection.multiplyScalar(direction.x * CONFIG.PLAYER_SPEED); // Scale by speed and input direction
        targetVelocityX += _strafeDirection.x;
        targetVelocityZ += _strafeDirection.z;
    }

    // Apply damping if no horizontal input, otherwise set velocity to calculated target
    if (direction.z === 0 && direction.x === 0) {
        velocity.x -= velocity.x * 10.0 * delta; // Apply damping factor (10.0 is arbitrary)
        velocity.z -= velocity.z * 10.0 * delta;
    } else {
        // Set horizontal velocity directly based on input.
        // For smoother movement, acceleration/lerping could be applied here.
        velocity.x = targetVelocityX;
        velocity.z = targetVelocityZ;
    }

    // --- Apply Horizontal Movement and Handle Collisions ---
    _newPlayerPosition.copy(_oldPlayerPosition); // Start with old position
    _newPlayerPosition.x += velocity.x * delta;   // Apply horizontal velocity component
    _newPlayerPosition.z += velocity.z * delta;   // Apply horizontal velocity component

    // Check for XZ collision at the new potential position
    if (checkTerrainCollision(_newPlayerPosition)) {
        // Collision detected, attempt to slide along walls by checking X and Z movement separately
        _tempPlayerPos.copy(_oldPlayerPosition);
        _tempPlayerPos.x += velocity.x * delta; // Try moving only along X
        if (!checkTerrainCollision(_tempPlayerPos)) {
            playerObject.position.x = _tempPlayerPos.x; // Move if no X-collision
        }
        _tempPlayerPos.copy(_oldPlayerPosition);
        _tempPlayerPos.z += velocity.z * delta; // Try moving only along Z
        if (!checkTerrainCollision(_tempPlayerPos)) {
            playerObject.position.z = _tempPlayerPos.z; // Move if no Z-collision
        }
    } else {
        // No collision, apply full XZ movement
        playerObject.position.x = _newPlayerPosition.x;
        playerObject.position.z = _newPlayerPosition.z;
    }

    // --- Apply Vertical Movement and Handle Ground/Ceiling Collisions ---
    playerObject.position.y += velocity.y * delta; // Apply vertical velocity (gravity/jump)

    // Ground collision
    const terrainHeight = getTerrainHeight(playerObject.position.x, playerObject.position.z);
    if (playerObject.position.y < terrainHeight + CONFIG.PLAYER_HEIGHT) {
        playerObject.position.y = terrainHeight + CONFIG.PLAYER_HEIGHT; // Place player on ground
        velocity.y = 0; // Stop vertical movement
        moveState.canJump = true; // Player is on ground, can jump
    } else {
        moveState.canJump = false; // Player is in air
    }

    // Ceiling collision
    _headPosition.copy(playerObject.position);
    _headPosition.y += CONFIG.PLAYER_HEIGHT * 0.5; // Approximate head position
    // First, a quick check against the block type directly above the player's head.
    if (voxelWorld.getBlockType(Math.floor(_headPosition.x), Math.floor(_headPosition.y), Math.floor(_headPosition.z)) !== WORLD_BLOCK_TYPES.AIR) {
        // If the direct check indicates a solid block, perform a more precise sphere collision check for the head.
        if (checkTerrainCollision(_headPosition, 0.3)) { // Using a smaller radius for head collision
             // If collision, revert Y position only if player was moving up into it.
             // This prevents sticking if already slightly inside a block due to other movements.
             if (playerObject.position.y > _oldPlayerPosition.y) {
                 playerObject.position.y = _oldPlayerPosition.y;
             }
             velocity.y = Math.min(0, velocity.y); // Stop upward velocity, allow falling if already moving down
        }
    }
}

// --- Event Handlers ---
/**
 * Handles key down events for player actions.
 * Exported to be attached by main.js.
 * @param {KeyboardEvent} event - The keyboard event.
 * @param {object} weaponSystem - Reference to the weapon system for reloading.
 */
export const onKeyDown = function(event, weaponSystem) {
    switch(event.code) {
        case 'KeyW': moveState.forward = true; break; // Move forward
        case 'KeyA': moveState.left = true; break;    // Strafe left
        case 'KeyS': moveState.backward = true; break;// Move backward
        case 'KeyD': moveState.right = true; break;   // Strafe right
        case 'Space':
            event.preventDefault(); // Prevent page scroll if space is pressed
            if (moveState.canJump) {
                velocity.y = CONFIG.JUMP_VELOCITY; // Apply jump velocity
                moveState.canJump = false;         // Prevent double-jumping in same airtime
            }
            break;
        case 'KeyR': // Reload weapon
            if (weaponSystem) weaponSystem.reload();
            break;
    }
};

/**
 * Handles key up events to stop player actions.
 * Exported to be attached by main.js.
 * @param {KeyboardEvent} event - The keyboard event.
 */
export const onKeyUp = function(event) {
    switch(event.code) {
        case 'KeyW': moveState.forward = false; break; // Stop moving forward
        case 'KeyA': moveState.left = false; break;    // Stop strafing left
        case 'KeyS': moveState.backward = false; break;// Stop moving backward
        case 'KeyD': moveState.right = false; break;   // Stop strafing right
    }
};
