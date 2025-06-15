import * as THREE from 'three';
import { CONFIG, BLOCK_TYPES } from './config.js'; // BLOCK_TYPES needed for bullet collision
import { camera } from './player.js'; // For weapon attachment and bullet origin
import { voxelWorld } from './world.js'; // For bullet-terrain collision

// Note: scene, gameState, and updateUI are injected via WeaponSystem.init() by main.js
// This avoids circular dependencies if WeaponSystem needed to import from main.js for these.

/**
 * Represents a projectile fired by a weapon.
 * Manages its own movement, collision detection (enemies and terrain), and lifecycle.
 * Designed to be pooled via the WeaponSystem.
 */
class Bullet {
    /**
     * Creates a new Bullet instance.
     * Note: The bullet is inactive and not in the scene upon construction.
     * Call `init()` to activate and position it.
     * @param {WeaponSystem} weaponSystemRef - A reference to the WeaponSystem for accessing shared resources (scene, gameState) and for releasing the bullet back to the pool.
     */
    constructor(weaponSystemRef) {
        this.weaponSystem = weaponSystemRef;
        this.velocity = new THREE.Vector3();
        this.damage = 0;
        this.life = 0; // Remaining lifespan in seconds
        this.active = false; // Whether the bullet is currently active in the game world

        // Create the bullet's visual representation (mesh)
        const geometry = new THREE.SphereGeometry(0.05, 6, 4); // Small sphere, simple geometry
        const material = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Bright yellow
        this.mesh = new THREE.Mesh(geometry, material);

        // Properties for refined collision detection (interpolated path checking)
        this.previousPosition = new THREE.Vector3(); // Position in the previous frame
        this._bulletPath = new THREE.Vector3();       // Vector representing movement in the current frame
        this._checkPoint = new THREE.Vector3();      // Temporary vector for checking points along the path
    }

    /**
     * Initializes and activates the bullet, preparing it for launch.
     * @param {THREE.Vector3} position - The starting world position of the bullet.
     * @param {THREE.Vector3} direction - The normalized direction vector in which the bullet should travel.
     * @param {number} damage - The amount of damage this bullet inflicts upon hitting an enemy.
     */
    init(position, direction, damage) {
        this.mesh.position.copy(position);
        this.previousPosition.copy(this.mesh.position); // Set previous position for first update's collision check
        this.velocity.copy(direction).multiplyScalar(CONFIG.BULLET_SPEED); // Set initial velocity
        this.damage = damage;
        this.life = 3; // Bullet lifespan in seconds (e.g., 3 seconds)
        this.active = true;

        // Add to scene and active bullets list (via weaponSystem references)
        if (this.weaponSystem.scene) {
            this.weaponSystem.scene.add(this.mesh);
        }
        if (this.weaponSystem.gameState) {
            this.weaponSystem.gameState.bullets.push(this);
        }
    }

    /**
     * Updates the bullet's state each frame (movement, collision detection, lifetime).
     * @param {number} delta - The time elapsed since the last frame, in seconds.
     */
    update(delta) {
        if (!this.active) return; // Do nothing if the bullet is not active

        // Store current position before movement for interpolated collision check
        this.previousPosition.copy(this.mesh.position);
        // Apply velocity to move the bullet
        this.mesh.position.addScaledVector(this.velocity, delta);

        // --- Collision Detection ---
        // 1. Enemy Collision
        if (this.weaponSystem.gameState && this.weaponSystem.gameState.enemies) {
            for (const enemy of this.weaponSystem.gameState.enemies) {
                // Basic AABB (sphere vs sphere for simplicity here) collision with enemy
                if (enemy.mesh && this.mesh.position.distanceTo(enemy.mesh.position) < 1.0) { // Assuming enemy radius ~0.5, bullet ~0.05
                    enemy.takeDamage(this.damage); // Enemy handles its own damage
                    this.deactivate(); // Deactivate bullet upon impact
                    return;
                }
            }
        }

        // 2. Refined Terrain Collision (Interpolated Path Check)
        this._bulletPath.subVectors(this.mesh.position, this.previousPosition);
        const pathLength = this._bulletPath.length();

        if (pathLength > 0) { // Only check if the bullet actually moved
            // Determine number of steps for interpolation based on bullet travel distance.
            // This ensures faster bullets or longer frames get more checks.
            // Check roughly every 0.75 block units.
            const steps = Math.max(1, Math.ceil(pathLength / (CONFIG.BLOCK_SIZE * 0.75)));
            this._bulletPath.normalize(); // Normalize for scaling step by step along the path

            let collidedWithTerrain = false;
            for (let i = 1; i <= steps; i++) {
                const stepLength = (pathLength / steps) * i;
                this._checkPoint.copy(this.previousPosition).addScaledVector(this._bulletPath, stepLength);

                const blockType = voxelWorld.getBlockType(
                    Math.floor(this._checkPoint.x),
                    Math.floor(this._checkPoint.y),
                    Math.floor(this._checkPoint.z)
                );

                // Consider collision if block is not AIR or WATER
                if (blockType !== BLOCK_TYPES.AIR && blockType !== BLOCK_TYPES.WATER) {
                    this.deactivate(); // Deactivate bullet
                    collidedWithTerrain = true;
                    break; // Exit loop once collision is detected
                }
            }
            if (collidedWithTerrain) return; // Bullet was deactivated, stop further processing
        } else {
            // If pathLength is 0 (e.g., bullet spawned inside a block, or delta is zero),
            // check current position directly.
            const blockType = voxelWorld.getBlockType(
                Math.floor(this.mesh.position.x),
                Math.floor(this.mesh.position.y),
                Math.floor(this.mesh.position.z)
            );
            if (blockType !== BLOCK_TYPES.AIR && blockType !== BLOCK_TYPES.WATER) {
                this.deactivate();
                return;
            }
        }

        // --- Lifetime Check ---
        this.life -= delta;
        if (this.life <= 0) {
            this.deactivate(); // Deactivate if lifetime expires
            return;
        }
    }

    /**
     * Deactivates the bullet, removing it from the game world and returning it to the object pool.
     */
    deactivate() {
        this.active = false;
        // Remove mesh from scene (if scene reference is valid)
        if (this.weaponSystem.scene) {
            this.weaponSystem.scene.remove(this.mesh);
        }
        // Remove this bullet instance from the active bullets list in gameState
        if (this.weaponSystem.gameState) {
            const index = this.weaponSystem.gameState.bullets.indexOf(this);
            if (index > -1) {
                this.weaponSystem.gameState.bullets.splice(index, 1);
            }
        }
        // Release the bullet back to the WeaponSystem's pool
        if (this.weaponSystem && this.weaponSystem.releaseBullet) {
            this.weaponSystem.releaseBullet(this);
        }
    }
}

/**
 * Manages weapon functionalities including different weapon types, firing, reloading,
 * and pooling of bullets and muzzle flash effects to optimize performance.
 */
export class WeaponSystem {
    /**
     * Constructs a new WeaponSystem.
     * Initializes weapon definitions, object pools, and default states.
     */
    constructor() {
        this.weapons = {
            pistol: { damage: 25, fireRate: 300, accuracy: 0.95, ammoCapacity: 12, reloadTime: 1500 },
            rifle: { damage: 40, fireRate: 150, accuracy: 0.85, ammoCapacity: 30, reloadTime: 2000 },
            shotgun: { damage: 80, fireRate: 800, accuracy: 0.6, ammoCapacity: 6, reloadTime: 2500, pellets: 5}
        };
        this.currentWeapon = 'rifle'; // Default weapon
        this.lastShot = 0; // Timestamp of the last shot, for fire rate control
        this.isReloading = false; // Flag to indicate if reloading is in progress

        /** Bullet object pool. @type {{available: Bullet[], capacity: number, created: number}} */
        this.bulletPool = { available: [], capacity: 50, created: 0 };
        /** Muzzle flash (PointLight) object pool. @type {{available: THREE.PointLight[], capacity: number, created: number}} */
        this.muzzleFlashPool = { available: [], capacity: 10, created: 0 };

        // Dependencies to be injected by main.js using the init() method
        this.scene = null;
        this.gameState = null;
        this.updateUI = null; // Function to call for HUD updates

        this.createWeaponMesh(); // Create and attach the visual weapon model to the camera
    }

    /**
     * Initializes the WeaponSystem with essential external dependencies.
     * This should be called once from main.js after the game setup.
     * @param {THREE.Scene} sceneRef - Reference to the main Three.js scene.
     * @param {object} gameStateRef - Reference to the global game state object.
     * @param {function} updateUIRef - Reference to the UI update function.
     */
    init(sceneRef, gameStateRef, updateUIRef) {
        this.scene = sceneRef;
        this.gameState = gameStateRef;
        this.updateUI = updateUIRef;
    }

    /**
     * Creates the visual 3D model for the weapon and attaches it to the player's camera.
     * @private
     */
    createWeaponMesh() {
        const weaponGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.8); // Simple box shape
        const weaponMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 }); // Dark grey
        this.weaponMesh = new THREE.Mesh(weaponGeometry, weaponMaterial);
        // Position and orient the weapon model relative to the camera
        this.weaponMesh.position.set(0.3, -0.2, -0.5);
        this.weaponMesh.rotation.y = THREE.MathUtils.degToRad(5); // Slight angle
        camera.add(this.weaponMesh); // Attach to the player's camera (imported from player.js)
    }

    /**
     * Acquires a Bullet instance from the pool, or creates a new one if the pool is empty.
     * @returns {Bullet} An inactive Bullet instance ready for initialization.
     * @private
     */
    acquireBullet() {
        let bullet;
        if (this.bulletPool.available.length > 0) {
            bullet = this.bulletPool.available.pop();
        } else {
            bullet = new Bullet(this); // Pass reference to this WeaponSystem for callback
            this.bulletPool.created++;
        }
        return bullet;
    }

    /**
     * Releases a deactivated Bullet instance back to the pool.
     * If the pool is at capacity, the bullet's resources are disposed of.
     * @param {Bullet} bullet - The bullet to release.
     * @private
     */
    releaseBullet(bullet) {
        if (this.bulletPool.available.length < this.bulletPool.capacity) {
            this.bulletPool.available.push(bullet);
        } else {
            // Pool is full, dispose of the bullet's Three.js resources to free memory
            if (bullet.mesh) {
                if (bullet.mesh.geometry) bullet.mesh.geometry.dispose();
                if (bullet.mesh.material) bullet.mesh.material.dispose();
            }
        }
    }

    /**
     * Acquires a PointLight instance for a muzzle flash from the pool.
     * @returns {THREE.PointLight} A PointLight instance.
     * @private
     */
    acquireMuzzleFlash() {
        let flash;
        if (this.muzzleFlashPool.available.length > 0) {
            flash = this.muzzleFlashPool.available.pop();
        } else {
            flash = new THREE.PointLight(0xffff00, 0, 10); // Color, initial intensity (0), distance
            flash.castShadow = false; // Performance: muzzle flashes don't need to cast shadows
            this.muzzleFlashPool.created++;
        }
        return flash;
    }

    /**
     * Releases a muzzle flash PointLight back to the pool.
     * Removes it from the scene and resets its intensity.
     * @param {THREE.PointLight} flash - The PointLight to release.
     * @private
     */
    releaseMuzzleFlash(flash) {
        if (this.scene) this.scene.remove(flash);
        flash.intensity = 0; // Reset intensity for reuse
        if (this.muzzleFlashPool.available.length < this.muzzleFlashPool.capacity) {
            this.muzzleFlashPool.available.push(flash);
        }
        // No complex disposal needed for PointLight itself, Three.js handles it when removed.
    }

    /**
     * Checks if the current weapon can be fired.
     * @returns {boolean} True if shooting is allowed, false otherwise.
     */
    canShoot() {
        if (!this.gameState) return false; // Ensure gameState is initialized
        const weapon = this.weapons[this.currentWeapon];
        return !this.isReloading &&
               this.gameState.ammo > 0 &&
               (Date.now() - this.lastShot > weapon.fireRate); // Fire rate check
    }

    /**
     * Fires the current weapon. This involves:
     * - Selecting weapon properties (damage, accuracy, etc.).
     * - Acquiring and initializing a bullet from the pool.
     * - Applying spread/accuracy.
     * - Simulating recoil and creating a muzzle flash.
     * - Consuming ammunition and updating the UI.
     * @returns {boolean} True if a shot was fired, false otherwise.
     */
    fireWeapon() {
        if (!this.canShoot() || !this.scene || !this.gameState || !this.updateUI) return false;

        const weaponData = this.weapons[this.currentWeapon];
        this.lastShot = Date.now(); // Update last shot timestamp

        const weaponWorldPosition = new THREE.Vector3();
        this.weaponMesh.getWorldPosition(weaponWorldPosition); // Get muzzle position from weapon model

        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection); // Get player's look direction

        const pelletCount = weaponData.pellets || 1; // For shotguns
        const damagePerPellet = weaponData.damage / pelletCount;

        for (let i = 0; i < pelletCount; i++) {
            const bulletDirection = cameraDirection.clone(); // Start with camera direction
            // Apply spread based on weapon accuracy
            const spread = (1 - weaponData.accuracy) * 0.1; // Spread factor
            bulletDirection.x += (Math.random() - 0.5) * spread;
            bulletDirection.y += (Math.random() - 0.5) * spread;
            bulletDirection.z += (Math.random() - 0.5) * spread;
            bulletDirection.normalize(); // Ensure direction is a unit vector

            const bullet = this.acquireBullet(); // Get from pool
            bullet.init(weaponWorldPosition, bulletDirection, damagePerPellet); // Activate and launch
        }

        // Weapon recoil animation (simple visual effect)
        this.weaponMesh.position.z -= 0.05;
        setTimeout(() => { if(this.weaponMesh) this.weaponMesh.position.z += 0.05; }, 50);

        this.createMuzzleFlash(weaponWorldPosition); // Create visual effect for firing

        this.gameState.ammo--; // Consume ammo
        this.updateUI(); // Update HUD
        return true;
    }

    /**
     * Creates and displays a muzzle flash effect at the given position.
     * Uses an object pool for the PointLight effect.
     * @param {THREE.Vector3} position - The world position to create the muzzle flash.
     * @private
     */
    createMuzzleFlash(position) {
        if (!this.scene) return;
        const flash = this.acquireMuzzleFlash();
        flash.position.copy(position);
        flash.intensity = 2.5; // Set brightness
        this.scene.add(flash);
        // Automatically release the flash after a short duration
        setTimeout(() => this.releaseMuzzleFlash(flash), 60);
    }

    /**
     * Initiates the weapon reload process.
     * Handles reload timing and updates ammunition counts from total reserves.
     */
    reload() {
        if (!this.gameState || !this.updateUI) return; // Ensure dependencies are available
        // Prevent reloading if already reloading, no reserve ammo, or clip is full
        if (this.isReloading || this.gameState.totalAmmo <= 0 || this.gameState.ammo === CONFIG.AMMO_CAPACITY) return;

        this.isReloading = true;
        const weaponData = this.weapons[this.currentWeapon];

        setTimeout(() => {
            const needed = CONFIG.AMMO_CAPACITY - this.gameState.ammo; // Ammo needed to fill clip
            const available = Math.min(needed, this.gameState.totalAmmo); // Ammo available from reserves

            this.gameState.ammo += available;
            this.gameState.totalAmmo -= available;
            this.isReloading = false;
            this.updateUI(); // Update HUD
        }, weaponData.reloadTime);
    }
}

/**
 * Singleton instance of the WeaponSystem.
 * This instance is imported and used by other modules (e.g., main.js).
 */
export const weaponSystem = new WeaponSystem();
