/**
 * A class to generate Perlin noise values, often used for
 * procedural content generation like terrain, textures, etc.
 * This implementation is based on Ken Perlin's improved noise algorithm.
 */
export class PerlinNoise {
    /**
     * Initializes the Perlin noise generator.
     * @param {number} [seed=12345] - The seed for the pseudo-random number generator used to create
     *                                 the permutation table. Providing the same seed will consistently
     *                                 produce the same noise pattern.
     */
    constructor(seed = 12345) {
        this.seed = seed;
        /**
         * The permutation table, an array of 256 pseudo-randomly ordered numbers from 0 to 255.
         * It is duplicated (length 512) to avoid modulo operations when indexing, improving performance.
         * @type {number[]}
         * @private
         */
        this.permutation = this.generatePermutation();
    }

    /**
     * Generates and shuffles the permutation table based on the provided seed.
     * The shuffling uses a simple linear congruential generator (LCG) derived from the seed.
     * The table is then duplicated to handle wrapping and avoid modulo operations during noise calculation.
     * @returns {number[]} The generated and shuffled permutation table of length 512.
     * @private
     */
    generatePermutation() {
        const p = [];
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle the array using a seed-based pseudo-random number generator
        let rng = this.seed;
        for (let i = 255; i > 0; i--) {
            // Basic LCG for pseudo-randomness: rng = (a * rng + c) % m
            // These specific numbers are common in simple PRNGs.
            rng = (rng * 9301 + 49297) % 233280;
            const j = Math.floor((rng / 233280) * (i + 1)); // Scale to current range
            [p[i], p[j]] = [p[j], p[i]]; // Swap elements
        }

        return p.concat(p); // Duplicate the array to avoid modulo operations later
    }

    /**
     * The fade function as defined by Ken Perlin (6t^5 - 15t^4 + 10t^3).
     * This easing curve is applied to the fractional coordinates to smooth the interpolation,
     * removing visual artifacts and producing more natural-looking noise.
     * @param {number} t - The input value, typically a fractional coordinate component in the range [0, 1].
     * @returns {number} The eased value.
     * @private
     */
    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /**
     * Performs linear interpolation between two values.
     * @param {number} t - The interpolation factor, typically in the range [0, 1].
     * @param {number} a - The first value.
     * @param {number} b - The second value.
     * @returns {number} The interpolated value: a + t * (b - a).
     * @private
     */
    lerp(t, a, b) {
        return a + t * (b - a);
    }

    /**
     * Selects a pseudo-random gradient vector based on a hash value.
     * The hash value (derived from the permutation table) determines one of 12 (or 16 for 3D) predefined directions.
     * These gradients are vectors from the corners of the surrounding unit cube towards the point being evaluated.
     * @param {number} hash - An integer hash value (usually from the permutation table).
     * @param {number} x - The fractional x-coordinate within the unit cube.
     * @param {number} y - The fractional y-coordinate within the unit cube.
     * @param {number} z - The fractional z-coordinate within the unit cube.
     * @returns {number} The dot product of the selected gradient vector and the vector (x, y, z).
     * @private
     */
    grad(hash, x, y, z) {
        const h = hash & 15;      // Take the lower 4 bits of the hash to select one of 16 gradients
        const u = h < 8 ? x : y;  // If h<8, u is x, else y
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z); // If h<4, v is y, else if h is 12 or 14, v is x, else v is z
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v); // Combine u and v components with signs based on h
    }

    /**
     * Generates a 3D Perlin noise value for the given coordinates (x, y, z).
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     * @param {number} [z=0] - The z-coordinate. Defaults to 0 for 2D noise.
     * @returns {number} The Perlin noise value, typically in the range [-1, 1] (though not strictly guaranteed without normalization).
     */
    noise(x, y, z = 0) {
        // Find the unit cube that contains the point
        const X = Math.floor(x) & 255; // Integer part of x, masked to 0-255
        const Y = Math.floor(y) & 255; // Integer part of y, masked to 0-255
        const Z = Math.floor(z) & 255; // Integer part of z, masked to 0-255

        // Find relative x, y, z of point in cube
        x -= Math.floor(x); // Fractional part of x
        y -= Math.floor(y); // Fractional part of y
        z -= Math.floor(z); // Fractional part of z

        // Compute fade curves for each of x, y, z
        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);

        // Hash coordinates of the 8 cube corners
        const p = this.permutation;
        const A = p[X] + Y;
        const AA = p[A] + Z;
        const AB = p[A + 1] + Z;
        const B = p[X + 1] + Y;
        const BA = p[B] + Z;
        const BB = p[B + 1] + Z;

        // Add blended results from 8 corners of the cube
        // Interpolate along z-axis
        return this.lerp(w,
            // Interpolate along y-axis (at z=0 plane)
            this.lerp(v,
                // Interpolate along x-axis (at y=0, z=0 corner)
                this.lerp(u, this.grad(p[AA], x, y, z),
                             this.grad(p[BA], x - 1, y, z)),
                // Interpolate along x-axis (at y=1, z=0 corner)
                this.lerp(u, this.grad(p[AB], x, y - 1, z),
                             this.grad(p[BB], x - 1, y - 1, z))),
            // Interpolate along y-axis (at z=1 plane)
            this.lerp(v,
                // Interpolate along x-axis (at y=0, z=1 corner)
                this.lerp(u, this.grad(p[AA + 1], x, y, z - 1),
                             this.grad(p[BA + 1], x - 1, y, z - 1)),
                // Interpolate along x-axis (at y=1, z=1 corner)
                this.lerp(u, this.grad(p[AB + 1], x, y - 1, z - 1),
                             this.grad(p[BB + 1], x - 1, y - 1, z - 1))));
    }

    /**
     * Generates fractal noise (often called Fractional Brownian Motion or FBM)
     * by summing multiple layers (octaves) of Perlin noise with varying frequencies and amplitudes.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     * @param {number} [octaves=4] - The number of noise layers to sum. More octaves add more detail.
     * @param {number} [persistence=0.5] - The factor by which the amplitude of each successive octave is reduced.
     *                                     Typically between 0 and 1.
     * @param {number} [scale=0.01] - The initial scaling factor for the coordinates, affecting the base frequency.
     *                                Smaller values result in "larger" features.
     * @returns {number} The normalized fractal noise value, typically in the range [0, 1] (or [-1,1] if original noise range is kept).
     */
    octaveNoise(x, y, octaves = 4, persistence = 0.5, scale = 0.01) {
        let totalValue = 0;
        let currentAmplitude = 1;
        let currentFrequency = scale;
        let maxPossibleValue = 0; // Used for normalization

        for (let i = 0; i < octaves; i++) {
            totalValue += this.noise(x * currentFrequency, y * currentFrequency) * currentAmplitude;
            maxPossibleValue += currentAmplitude;
            currentAmplitude *= persistence; // Decrease amplitude for subsequent octaves
            currentFrequency *= 2;           // Increase frequency for subsequent octaves
        }

        // Normalize the value to be roughly between -1 and 1 (or 0 and 1 if noise() output is shifted)
        // Given that this.noise can output values roughly in [-1, 1], maxPossibleValue estimates the max sum.
        return totalValue / maxPossibleValue;
    }
}
