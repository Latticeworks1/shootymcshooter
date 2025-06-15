const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Serve static files from current directory
app.use(express.static(__dirname));

// Game configuration (aligned with client)
const CONFIG = {
    CHUNK_SIZE: 32,
    WORLD_HEIGHT: 64,
    PLAYER_SPEED: 8,
    PLAYER_HEIGHT: 1.8,
    JUMP_VELOCITY: 12,
    GRAVITY: -25,
    BULLET_SPEED: 50,
    BULLET_DAMAGE: 25,
    BULLET_GRAVITY: -15,
    BULLET_BOUNCE_DAMPENING: 0.4,
    BULLET_MAX_BOUNCES: 3,
    TICK_RATE: 60,
    AMMO_CAPACITY: 30,
    TOTAL_AMMO: 120,
    MAX_HEALTH: 100
};

// Perlin Noise Implementation (server-side terrain validation)
class PerlinNoise {
    constructor(seed = 12345) {
        this.seed = seed;
        this.permutation = this.generatePermutation();
    }

    generatePermutation() {
        const p = [];
        for (let i = 0; i < 256; i++) p[i] = i;
        let rng = this.seed;
        for (let i = 255; i > 0; i--) {
            rng = (rng * 9301 + 49297) % 233280;
            const j = Math.floor((rng / 233280) * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }
        return p.concat(p);
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y, z = 0) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);
        const A = this.permutation[X] + Y;
        const AA = this.permutation[A] + Z;
        const AB = this.permutation[A + 1] + Z;
        const B = this.permutation[X + 1] + Y;
        const BA = this.permutation[B] + Z;
        const BB = this.permutation[B + 1] + Z;
        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad(this.permutation[AA], x, y, z),
                             this.grad(this.permutation[BA], x - 1, y, z)),
                this.lerp(u, this.grad(this.permutation[AB], x, y - 1, z),
                             this.grad(this.permutation[BB], x - 1, y - 1, z))),
            this.lerp(v,
                this.lerp(u, this.grad(this.permutation[AA + 1], x, y, z - 1),
                             this.grad(this.permutation[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.permutation[AB + 1], x, y - 1, z - 1),
                             this.grad(this.permutation[BB + 1], x - 1, y - 1, z - 1))));
    }

    octaveNoise(x, y, octaves = 4, persistence = 0.5, scale = 0.01) {
        let value = 0;
        let amplitude = 1;
        let frequency = scale;
        let maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            value += this.noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }
        return value / maxValue;
    }
}

const noise = new PerlinNoise(42);

// Block Types (aligned with client)
const BLOCK_TYPES = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WATER: 4,
    SAND: 5,
    SNOW: 6,
    TREE: 7,
    GLASS: 8
};

// Server-side terrain height calculation
function getTerrainHeight(x, z) {
    const heightNoise = noise.octaveNoise(x, z, 4, 0.5, 0.01);
    const baseHeight = Math.floor(20 + heightNoise * 20);
    return baseHeight + 1; // Player stands on top of highest block
}

// Game state
const gameState = {
    players: new Map(),
    bullets: new Map(),
    enemies: new Map(),
    worldSeed: 42,
    lastUpdate: Date.now(),
    bulletIdCounter: 0
};

class ServerPlayer {
    constructor(id, socketId) {
        this.id = id;
        this.socketId = socketId;
        this.position = { x: 0, y: getTerrainHeight(0, 0) + CONFIG.PLAYER_HEIGHT, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.health = CONFIG.MAX_HEALTH;
        this.ammo = CONFIG.AMMO_CAPACITY;
        this.totalAmmo = CONFIG.TOTAL_AMMO;
        this.lastShot = 0;
        this.isAlive = true;
        this.inputSequence = 0;
        this.lastInputTime = Date.now();
        this.isGrounded = false;
    }

    update(delta) {
        // Apply gravity
        this.velocity.y += CONFIG.GRAVITY * delta;
        
        // Update position
        this.position.x += this.velocity.x * delta;
        this.position.y += this.velocity.y * delta;
        this.position.z += this.velocity.z * delta;
        
        // Ground collision using terrain height
        const terrainHeight = getTerrainHeight(this.position.x, this.position.z);
        if (this.position.y <= terrainHeight + CONFIG.PLAYER_HEIGHT) {
            this.position.y = terrainHeight + CONFIG.PLAYER_HEIGHT;
            this.velocity.y = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }
        
        // Apply friction to horizontal movement when grounded
        if (this.isGrounded) {
            this.velocity.x *= 0.85;
            this.velocity.z *= 0.85;
        }
    }

    takeDamage(damage, sourceId) {
        this.health -= damage;
        if (this.health <= 0) {
            this.isAlive = false;
            this.health = 0;
        }
        return !this.isAlive;
    }
}

class ServerBullet {
    constructor(id, position, velocity, damage, ownerId) {
        this.id = id;
        this.position = { ...position };
        this.velocity = { ...velocity };
        this.damage = damage;
        this.ownerId = ownerId;
        this.life = 5.0;
        this.bounceCount = 0;
        this.isActive = true;
    }

    update(delta) {
        if (!this.isActive) return false;

        // Apply gravity
        this.velocity.y += CONFIG.BULLET_GRAVITY * delta;
        
        // Update position
        this.position.x += this.velocity.x * delta;
        this.position.y += this.velocity.y * delta;
        this.position.z += this.velocity.z * delta;
        
        // Ground collision
        const terrainHeight = getTerrainHeight(this.position.x, this.position.z);
        if (this.position.y < terrainHeight) {
            if (this.bounceCount < CONFIG.BULLET_MAX_BOUNCES) {
                this.position.y = terrainHeight;
                this.velocity.y = -this.velocity.y * CONFIG.BULLET_BOUNCE_DAMPENING;
                this.bounceCount++;
            } else {
                this.isActive = false;
                return false;
            }
        }
        
        // Bounds checking
        if (this.position.y > CONFIG.WORLD_HEIGHT + 50) {
            this.isActive = false;
            return false;
        }
        
        // Decrease life
        this.life -= delta;
        if (this.life <= 0) {
            this.isActive = false;
            return false;
        }
        
        // Check player collisions
        for (let [playerId, player] of gameState.players) {
            if (playerId === this.ownerId || !player.isAlive) continue;
            
            const distance = Math.sqrt(
                Math.pow(this.position.x - player.position.x, 2) +
                Math.pow(this.position.y - player.position.y, 2) +
                Math.pow(this.position.z - player.position.z, 2)
            );
            
            if (distance < 1.0) {
                const killed = player.takeDamage(this.damage, this.ownerId);
                this.isActive = false;
                
                // Broadcast hit
                io.emit('player-hit', {
                    targetId: playerId,
                    shooterId: this.ownerId,
                    damage: this.damage,
                    position: this.position,
                    killed: killed
                });
                
                return false;
            }
        }
        
        return true;
    }
}

// Socket connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Create new player
    const player = new ServerPlayer(socket.id, socket.id);
    gameState.players.set(socket.id, player);
    
    // Send initial game state
    socket.emit('game-state', {
        playerId: socket.id,
        players: Array.from(gameState.players.entries()).map(([id, p]) => ({
            id,
            position: p.position,
            rotation: p.rotation,
            health: p.health,
            isAlive: p.isAlive
        })),
        worldSeed: gameState.worldSeed
    });
    
    // Broadcast new player to others
    socket.broadcast.emit('player-joined', {
        id: socket.id,
        position: player.position,
        rotation: player.rotation,
        health: player.health
    });
    
    // Handle player input
    socket.on('player-input', (data) => {
        const player = gameState.players.get(socket.id);
        if (!player || !player.isAlive) return;
        
        const { input, position, rotation, sequence, timestamp } = data;
        
        // Rate limiting
        const now = Date.now();
        if (now - player.lastInputTime < 16) return; // ~60 FPS max
        player.lastInputTime = now;
        
        // Update rotation
        if (rotation) {
            player.rotation = rotation;
        }
        
        // Calculate movement direction based on rotation
        const yaw = player.rotation.y;
        let moveX = 0;
        let moveZ = 0;
        
        if (input.forward) {
            moveX -= Math.sin(yaw);
            moveZ -= Math.cos(yaw);
        }
        if (input.backward) {
            moveX += Math.sin(yaw);
            moveZ += Math.cos(yaw);
        }
        if (input.left) {
            moveX -= Math.cos(yaw);
            moveZ += Math.sin(yaw);
        }
        if (input.right) {
            moveX += Math.cos(yaw);
            moveZ -= Math.sin(yaw);
        }
        
        // Normalize movement vector to prevent faster diagonal movement
        const magnitude = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (magnitude > 0) {
            moveX = (moveX / magnitude) * CONFIG.PLAYER_SPEED;
            moveZ = (moveZ / magnitude) * CONFIG.PLAYER_SPEED;
        }
        
        // Apply movement
        player.velocity.x = moveX;
        player.velocity.z = moveZ;
        
        // Handle jump
        if (input.jump && player.isGrounded) {
            player.velocity.y = CONFIG.JUMP_VELOCITY;
            player.isGrounded = false;
        }
        
        player.inputSequence = sequence;
    });
    
    // Handle shooting
    socket.on('player-shoot', (data) => {
        const player = gameState.players.get(socket.id);
        if (!player || !player.isAlive || player.ammo <= 0) return;
        
        const now = Date.now();
        if (now - player.lastShot < 150) return; // Fire rate limiting
        
        player.lastShot = now;
        player.ammo--;
        
        // Create bullet
        gameState.bulletIdCounter++;
        const bulletId = `bullet_${socket.id}_${gameState.bulletIdCounter}`;
        const bullet = new ServerBullet(
            bulletId,
            data.position,
            data.velocity,
            CONFIG.BULLET_DAMAGE,
            socket.id
        );
        
        gameState.bullets.set(bulletId, bullet);
        
        // Broadcast shot
        io.emit('player-shot', {
            playerId: socket.id,
            bulletId: bulletId,
            position: data.position,
            velocity: data.velocity,
            timestamp: now
        });
    });
    
    // Handle reload
    socket.on('player-reload', () => {
        const player = gameState.players.get(socket.id);
        if (!player || player.ammo >= CONFIG.AMMO_CAPACITY || player.totalAmmo <= 0) return;
        
        const needed = CONFIG.AMMO_CAPACITY - player.ammo;
        const available = Math.min(needed, player.totalAmmo);
        
        player.ammo += available;
        player.totalAmmo -= available;
        
        socket.emit('player-reloaded', {
            ammo: player.ammo,
            totalAmmo: player.totalAmmo
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        gameState.players.delete(socket.id);
        socket.broadcast.emit('player-left', socket.id);
    });
});

// Game loop
function gameLoop() {
    const now = Date.now();
    const delta = (now - gameState.lastUpdate) / 1000;
    gameState.lastUpdate = now;
    
    // Update players
    for (let [id, player] of gameState.players) {
        player.update(delta);
    }
    
    // Update bullets
    for (let [id, bullet] of gameState.bullets) {
        if (!bullet.update(delta)) {
            gameState.bullets.delete(id);
        }
    }
    
    // Broadcast game state
    const gameStateData = {
        players: Array.from(gameState.players.entries()).map(([id, p]) => ({
            id,
            position: p.position,
            rotation: p.rotation,
            velocity: p.velocity,
            health: p.health,
            isAlive: p.isAlive,
            inputSequence: p.inputSequence
        })),
        bullets: Array.from(gameState.bullets.entries()).map(([id, b]) => ({
            id,
            position: b.position,
            velocity: b.velocity,
            isActive: b.isActive
        })),
        timestamp: now
    };
    
    io.emit('game-update', gameStateData);
}

// Start game loop
setInterval(gameLoop, 1000 / CONFIG.TICK_RATE);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        players: gameState.players.size,
        bullets: gameState.bullets.size,
        uptime: process.uptime()
    });
});

// Serve the game
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3009;
server.listen(PORT, () => {
    console.log(`🎮 Multiplayer Voxel FPS Server running on port ${PORT}`);
    console.log(`🌐 WebSocket transports: websocket, polling`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🚀 Game: http://localhost:${PORT}`);
});

module.exports = { app, server, io };
