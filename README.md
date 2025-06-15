# Voxel FPS Game

## Introduction

This is a simple first-person shooter (FPS) game built with JavaScript and [Three.js](https://threejs.org/). It features a procedurally generated voxel world where players can navigate, shoot targets, and interact with basic enemy AI.

## Features

*   **Procedural Voxel World:** Infinite terrain generated using Perlin noise.
*   **Chunk-Based Loading:** The world is loaded and unloaded in chunks based on player proximity to manage performance.
*   **Weapon System:** Includes a rifle with ammo, recoil, and muzzle flash effects.
*   **Basic Enemy AI:** Enemies will follow and attack the player.
*   **Player Mechanics:** Standard FPS controls including movement (WASD), jumping (Space), and mouse-look.
*   **HUD:** Displays health, ammo, score, enemy count, FPS, player position, and loaded chunks.
*   **Minimap:** Provides a top-down view of the nearby area, showing terrain and enemies.
*   **Object Pooling:** Implemented for bullets and muzzle flashes to improve performance.
*   **Optimized Rendering:** Includes various optimizations like mesh caching and efficient vector usage.

## Controls

*   **WASD:** Move Forward / Left / Backward / Right
*   **Mouse:** Look around
*   **Left Click:** Shoot
*   **Spacebar:** Jump
*   **R:** Reload Weapon
*   **Escape (Esc):** Unlock mouse pointer from the game window. Click on the game to lock again.

## Quick Start / How to Run

This game is a client-side web application and runs entirely in your browser.

1.  **Get the Code:**
    *   Clone this repository: `git clone <repository-url>`
    *   Alternatively, download the ZIP file and extract it.

2.  **Navigate to Directory:**
    *   Open your terminal or command prompt and change to the directory where you cloned/extracted the files.

3.  **Serve the Files (Recommended):**
    While you might be able to open `index.html` directly in some browsers, it's highly recommended to serve the files using a local HTTP server. This avoids potential issues with browser security restrictions (especially for ES6 Modules) and ensures the game runs as intended.

    *   **Using Python (if Python is installed):**
        *   Python 3.x: `python -m http.server`
        *   Python 2.x: `python -m SimpleHTTPServer`
        This will typically serve the files on `http://localhost:8000`.

    *   **Using Node.js (if Node.js and npm are installed):**
        *   Install `http-server` globally (if you haven't already): `npm install -g http-server`
        *   Run the server: `http-server .`
        This will serve files on `http://localhost:8080` (or another available port).

4.  **Open in Browser:**
    *   Open your web browser (e.g., Chrome, Firefox, Edge, Safari) and navigate to the local server address (e.g., `http://localhost:8000` or `http://localhost:8080`).
    *   The `index.html` page should load, and the game will start.

    *If you are not using a local server, you can try opening the `index.html` file directly in your browser. However, this might not work correctly due to browser security policies for ES6 modules loaded via `file:///` URLs.*

## Project Structure

*   `index.html`: The main HTML file that sets up the game canvas and loads the JavaScript modules.
*   `main.js`: The entry point for the game. Initializes the scene, game state, and manages the main game loop.
*   `config.js`: Contains global game configuration constants (e.g., chunk size, player speed).
*   `utils.js`: Utility classes, currently includes the `PerlinNoise` generator.
*   `world.js`: Handles voxel world generation (`VoxelWorld` class), block types, and chunk management.
*   `player.js`: Manages player controls, camera, movement physics, and collision detection.
*   `weapon.js`: Implements the `WeaponSystem` (shooting, reloading) and `Bullet` logic.
*   `enemy.js`: Defines the `Enemy` class, including basic AI behavior and interactions.
*   `ui.js`: Manages all HUD elements, including the minimap, stats display, health bar, and ammo counter.
*   `README.md`: This file.

## Technologies Used

*   **JavaScript (ES6+ Modules)**
*   **Three.js (r161)**

## Potential Future Enhancements

*   Sound effects for shooting, footsteps, etc.
*   More diverse enemy types and behaviors.
*   Advanced pathfinding for enemies.
*   More weapon types.
*   Saving/loading game state.
*   Persistent world changes (block breaking/placing).
*   Improved graphics and visual effects.
