import * as THREE from 'three';
import { noise } from './world.js'; // Instance of PerlinNoise for terrain height calculation
import { camera } from './player.js'; // For health bar orientation and AI targeting

// Module-scoped variables to be injected by initEnemySystem from main.js
// These provide access to the global scene, game state, and UI update functions.
let scene;
let gameState;
let updatePlayerHealthBar; // Function to call when player's health UI needs updating
let updateGameScore;       // Function to call when game score UI needs updating (e.g., after enemy defeat)

/**
 * Initializes the enemy system with essential dependencies from the main game context.
 * This function should be called once when the game starts.
 * @param {THREE.Scene} mainScene - The main Three.js scene.
 * @param {object} mainGameState - The global game state object.
 * @param {function} mainUpdatePlayerHealthBar - Function to update the player's health display.
 * @param {function} mainUpdateGameScore - Function to update the game score display.
 */
export function initEnemySystem(mainScene, mainGameState, mainUpdatePlayerHealthBar, mainUpdateGameScore) {
    scene = mainScene;
    gameState = mainGameState;
    updatePlayerHealthBar = mainUpdatePlayerHealthBar;
    updateGameScore = mainUpdateGameScore;
}

/**
 * Represents an enemy entity in the game.
 * Enemies have AI-driven movement to follow the player, can attack, take damage,
 * and manage their own health and visual representation (including a health bar).
 */
export class Enemy {
    /**
     * Creates a new Enemy instance.
     * @param {number} x - The initial world x-coordinate for the enemy.
     * @param {number} z - The initial world z-coordinate for the enemy.
     */
    constructor(x, z) {
        /** Current health of the enemy. @type {number} */
        this.health = 50;
        /** Maximum health of the enemy. @type {number} */
        this.maxHealth = 50;
        /** Movement speed of the enemy in world units per second. @type {number} */
        this.speed = 2;
        /** Damage inflicted by the enemy's attack. @type {number} */
        this.damage = 20;
        /** Timestamp of the last attack, used for attack cooldown. @type {number} */
        this.lastAttack = 0;
        /** Cooldown period between attacks in milliseconds. @type {number} */
        this.attackCooldown = 2000;

        // Create the 3D mesh for the enemy
        const geometry = new THREE.BoxGeometry(1, 2, 1); // Simple box shape (width, height, depth)
        const material = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red color
        /** The Three.js mesh representing the enemy. @type {THREE.Mesh} */
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true; // Enemy casts shadows

        // Position the enemy on the terrain
        const yPos = this.getTerrainHeight(x, z) + 1; // Place enemy 1 unit above terrain
        this.mesh.position.set(x, yPos, z);

        this.createEnemyHealthBar(); // Create and attach the health bar

        // Add enemy mesh to the main scene (if scene is initialized)
        if (scene) {
            scene.add(this.mesh);
        }

        // --- Reusable vectors for AI and movement, specific to this enemy instance ---
        /** Target position for smoother interpolated movement. @type {THREE.Vector3} */
        this.targetPosition = this.mesh.position.clone();
        /** Temporary vector to store direction towards the player. @type {THREE.Vector3} */
        this._aiDirection = new THREE.Vector3();
        /** Temporary vector for calculating the lookAt target to ensure enemy remains upright. @type {THREE.Vector3} */
        this._lookAtPosition = new THREE.Vector3();
    }

    /**
     * Calculates the terrain height at given world (x,z) coordinates using Perlin noise.
     * This is used to position the enemy correctly on the ground.
     * @param {number} x - The world x-coordinate.
     * @param {number} z - The world z-coordinate.
     * @returns {number} The y-coordinate of the terrain surface.
     * @private
     */
    getTerrainHeight(x, z) {
        // Uses the global 'noise' instance imported from world.js
        const heightNoiseVal = noise.octaveNoise(x, z, 4, 0.5, 0.01);
        // Calculation should ideally match terrain generation for consistency
        return Math.floor(20 + heightNoiseVal * 20);
    }

    /**
     * Creates the health bar mesh and attaches it as a child to the enemy's main mesh.
     * @private
     */
    createEnemyHealthBar() {
        const healthBarGeometry = new THREE.PlaneGeometry(1.5, 0.2); // Simple plane for the health bar
        const healthBarMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00, // Initial color (green for full health)
            transparent: true, // Allows seeing through if needed, though not strictly necessary here
            side: THREE.DoubleSide // Ensures visibility from all angles
        });
        /** The Three.js mesh for the enemy's health bar. @type {THREE.Mesh} */
        this.healthBar = new THREE.Mesh(healthBarGeometry, healthBarMaterial);
        this.healthBar.position.set(0, 1.5, 0); // Position it above the enemy's mesh center
        this.mesh.add(this.healthBar); // Attach as a child
    }

    /**
     * Updates the enemy's state each frame, including AI behavior, movement, and attacks.
     * @param {number} delta - The time elapsed since the last frame, in seconds.
     * @param {THREE.Vector3} playerPosition - The current world position of the player.
     */
    update(delta, playerPosition) {
        // Defensive checks: ensure enemy and its dependencies are valid
        if (!gameState || !scene || !this.mesh || !this.mesh.parent) return;

        // --- AI Behavior: Movement ---
        // Calculate direction vector from enemy to player
        this._aiDirection.subVectors(playerPosition, this.mesh.position).normalize();

        // Update target position based on AI direction and speed
        // addScaledVector is equivalent to: targetPosition.add(vector.multiplyScalar(scalar))
        this.targetPosition.addScaledVector(this._aiDirection, this.speed * delta);
        // Ensure enemy stays on top of terrain
        const terrainY = this.getTerrainHeight(this.targetPosition.x, this.targetPosition.z) + 1;
        this.targetPosition.y = terrainY;

        // Smoothly interpolate current mesh position towards the target position
        this.mesh.position.lerp(this.targetPosition, 0.1); // 0.1 is the lerp factor (adjust for faster/slower following)

        // --- AI Behavior: Orientation ---
        // Make enemy look at the player, but only rotate around its Y-axis (to stay upright)
        this._lookAtPosition.set(playerPosition.x, this.mesh.position.y, playerPosition.z);
        this.mesh.lookAt(this._lookAtPosition);

        // --- AI Behavior: Attack ---
        const distanceToPlayer = this.mesh.position.distanceTo(playerPosition);
        // Check if player is within attack range and attack cooldown has passed
        if (distanceToPlayer < 2.5 && (Date.now() - this.lastAttack > this.attackCooldown)) {
            this.attackPlayer();
            this.lastAttack = Date.now(); // Reset attack cooldown timer
        }

        // --- Visual Updates ---
        this.updateEnemyHealthBarVisual(); // Update health bar scale and color

        // Orient health bar to always face the camera
        if (camera) { // Ensure camera (imported from player.js) is available
            this.healthBar.quaternion.copy(camera.quaternion);
        }
    }

    /**
     * Performs an attack on the player.
     * Reduces player's health in `gameState` and triggers a UI update.
     * @private
     */
    attackPlayer() {
        if (!gameState || !updatePlayerHealthBar) return; // Ensure dependencies are available
        gameState.health -= this.damage; // Reduce player health
        updatePlayerHealthBar(); // Call the injected function to update player's health HUD
    }

    /**
     * Called when the enemy receives damage.
     * Reduces enemy's health, updates health bar, provides visual feedback,
     * and handles enemy death if health drops to zero.
     * @param {number} damageAmount - The amount of damage to inflict.
     * @returns {boolean} True if the enemy died as a result of this damage, false otherwise.
     */
    takeDamage(damageAmount) {
        if (!gameState) return false; // Cannot take damage if gameState is not set
        this.health -= damageAmount;
        this.updateEnemyHealthBarVisual();

        // Visual feedback: flash white briefly (original was white, let's keep it)
        if (this.mesh && this.mesh.material) { // Check mesh and material exist
            const originalColor = this.mesh.material.color.clone();
            this.mesh.material.color.setHex(0xffffff); // Flash white
            setTimeout(() => {
                // Ensure mesh and material still exist before reverting color (enemy might be destroyed quickly)
                if (this.mesh && this.mesh.material) {
                     this.mesh.material.color.copy(originalColor);
                }
            }, 100); // Duration of the flash
        }

        // Check for death
        if (this.health <= 0) {
            this.destroy(); // Handle self-destruction (cleanup, removal)
            gameState.score += 100; // Increase player score
            if (updateGameScore) { // Ensure UI update function is available
                updateGameScore(); // Update score display on HUD
            }
            return true; // Enemy died
        }
        return false; // Enemy survived
    }

    /**
     * Updates the visual representation of the enemy's health bar (scale and color).
     * @private
     */
    updateEnemyHealthBarVisual() {
        if (!this.healthBar) return; // Ensure health bar exists
        const healthPercent = Math.max(0, this.health / this.maxHealth); // Clamp between 0 and 1
        this.healthBar.scale.x = healthPercent; // Scale width of the health bar
        // Change color from green (full health) to red (low health)
        this.healthBar.material.color.setHSL((healthPercent * 120) / 360, 1, 0.5); // Hue: 0 (red) to 120 (green)
    }

    /**
     * Cleans up the enemy's resources and removes it from the game.
     * This includes disposing of Three.js geometries and materials to free memory,
     * removing the mesh from the scene, and removing the enemy from the global enemies list.
     */
    destroy() {
        if (this.mesh) {
            // Dispose of health bar resources (which is a child of the mesh)
            if (this.healthBar) {
                if (this.healthBar.geometry) this.healthBar.geometry.dispose();
                if (this.healthBar.material) this.healthBar.material.dispose();
                // No need to explicitly remove healthBar from mesh if mesh itself is removed.
            }

            // Dispose of enemy mesh resources
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();

            // Remove mesh from the scene (if scene is available)
            if (scene) {
                scene.remove(this.mesh);
            }
        }

        // Remove this enemy instance from the global enemies list (if gameState is available)
        if (gameState) {
            const index = gameState.enemies.indexOf(this);
            if (index > -1) {
                gameState.enemies.splice(index, 1);
            }
        }

        // Nullify references to help garbage collection
        this.mesh = null;
        this.healthBar = null;
        // Other properties like _aiDirection, _lookAtPosition are part of the instance and will be GC'd with it.
    }
}
