// Three Days at Gettysburg — Union Edition

const container = document.getElementById("canvas-container");
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x315a8a,
    antialias: true,
});

// War-era colour grade
const colorMatrix = new PIXI.ColorMatrixFilter();
app.stage.filters = [colorMatrix];
colorMatrix.sepia();
colorMatrix.brightness(0.85);

container.appendChild(app.view);

// ─── Game State ───────────────────────────────────────────────────────────────
const state = {
    keys: {},
    player: null,
    enemies: [],
    flags: [],
    world: null,
    ui: null,
    bullets: [],
    grenades: [],
    terrain: [],
    gameStarted: false,
    paused: false,
    soundEnabled: true,
    showGrid: true,
    score: 0,
    wave: 0,
    act: 1,
    waveCountdown: 0,
    isWaveActive: false,
    objective: null,
    shake: 0,
    particles: [],
    lootBodies: [],   // bodies waiting to be looted
    dayTransition: null,
    pendingWaveAfterTransition: false,
    endlessMode: false,
};

const MAX_WAVES_PER_ACT = {
    1: 4,
    2: 5,
    3: 7,
};

const HISTORY_NOTES = [
    "Gettysburg, July 1863: Union troops held Cemetery Ridge against repeated Confederate assaults.",
    "Springfield muskets, Colt 1860 Army revolvers and Spencer repeating rifles defined the battlefield.",
    "Artillery and cavalry shaped the war; spiking enemy guns is a classic Civil War mission.",
    "Wounded men were evacuated while Union brigades fought to keep the high ground."
];

// ─── Audio System ─────────────────────────────────────────────────────────────
const sfx = {};
const musicTracks = {};
let activeMusic = null;

function loadAudio() {
    const files = {
        musket:    'assets/musket.mp3',
        explosion: 'assets/explosion.mp3',
        sword:     'assets/sword.mp3',
        death:     'assets/death.mp3',
        reload:    'assets/reload.mp3',
        empty:     'assets/empty_gun.mp3',
    };
    Object.entries(files).forEach(([key, src]) => {
        const audio = new Audio(src);
        audio.preload = 'auto';
        sfx[key] = audio;
    });

    musicTracks.battleCry = new Audio('assets/US March_ Battle Cry of Freedom (Instrumental).mp3');
    musicTracks.battleCry.loop = true;
    musicTracks.battleCry.volume = 0.45;
    musicTracks.battleCry.preload = 'auto';

    musicTracks.overture = new Audio('assets/Tchaikovsky - 1812 Overture (Full with Cannons) 4.mp3');
    musicTracks.overture.loop = true;
    musicTracks.overture.volume = 0.42;
    musicTracks.overture.preload = 'auto';
}

// Play a sound effect, allowing overlapping instances
function playSound(key, volume = 1.0, pitchVariance = 0) {
    if (!state.soundEnabled) return;
    const original = sfx[key];
    if (!original) return;
    // Clone so sounds can overlap
    const clone = original.cloneNode();
    clone.volume = Math.min(1, Math.max(0, volume));
    if (pitchVariance > 0) {
        // Slight pitch randomisation via playbackRate for variety
        clone.playbackRate = 1 + (Math.random() - 0.5) * pitchVariance;
    }
    clone.play().catch(() => {}); // Silently ignore autoplay policy errors

    // Cap all sound effects at 7 seconds so long audio assets don't keep playing forever.
    setTimeout(() => {
        if (!clone.paused && !clone.ended) {
            clone.pause();
            clone.currentTime = 0;
        }
    }, 7000);
}

function playMusic(key) {
    if (!musicTracks[key]) return;
    if (activeMusic && activeMusic !== musicTracks[key]) {
        activeMusic.pause();
        activeMusic.currentTime = 0;
    }
    activeMusic = musicTracks[key];
    activeMusic.play().catch(() => {});
}

function stopMusic() {
    if (activeMusic) {
        activeMusic.pause();
        activeMusic.currentTime = 0;
        activeMusic = null;
    }
}

// ─── Sprite Asset Registry ────────────────────────────────────────────────────
const UNION_WEAPON_SPRITES = [
    'assets/union_musket.png',    // 0 – Musket
    'assets/union_flintlock.png', // 1 – Flintlock
    'assets/union_granade.png',   // 2 – Grenades
    'assets/union_sword.png',     // 3 – Officer's Sword
    'assets/union_musket.png', // 4 – Lever Action Rifle
    'assets/union_flintlock.png', // 5 – Flintlock Pistol
    'assets/union_musket.png', // 6 – Repeater Rifle
    'assets/union_musket.png'  // 7 – Shotgun
];
const CONFED_SOLDIER_SPRITE = 'assets/confederate_musket.png';
const WOUNDED_SOLDIER_SPRITE = 'assets/wounded_union.png';
const textures = {};

function loadUnionTextures(onComplete) {
    let loaded = 0;
    const textureSources = [...UNION_WEAPON_SPRITES, CONFED_SOLDIER_SPRITE, WOUNDED_SOLDIER_SPRITE];
    const total = textureSources.length;
    textureSources.forEach((path) => {
        const tex = PIXI.Texture.from(path);
        const onLoad = () => { textures[path] = tex; if (++loaded === total && onComplete) onComplete(); };
        if (tex.baseTexture.valid) { onLoad(); }
        else { tex.baseTexture.on('loaded', onLoad); tex.baseTexture.on('error', onLoad); }
    });
    if (loaded === total && onComplete) onComplete();
}

function createFlagTextures() {
    // Union Flag
    const unionFlag = PIXI.Texture.from('assets/36-star-us-flag.webp');
    textures['union_flag'] = unionFlag;

    // Confederate Flag - simple version
    const confedGraphics = new PIXI.Graphics();
    confedGraphics.beginFill(0xC8102E); // Red
    confedGraphics.drawRect(0, 0, 64, 32);
    confedGraphics.endFill();
    confedGraphics.beginFill(0x002868); // Blue
    confedGraphics.drawRect(0, 0, 32, 32);
    confedGraphics.endFill();
    // Simple cross
    confedGraphics.beginFill(0xFFFFFF); // White
    confedGraphics.drawRect(8, 12, 16, 8);
    confedGraphics.drawRect(12, 8, 8, 16);
    confedGraphics.endFill();
    textures['confed_flag'] = app.renderer.generateTexture(confedGraphics);
}

// ─── Input ────────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
    state.keys[e.code] = true;
    if (!state.gameStarted) return;
    if (e.code === 'Escape') {
        if (!state.paused) state.ui.openPauseMenu();
        else if (state.ui.optionsMenu && state.ui.optionsMenu.visible) state.ui.showPauseMenu();
        else state.ui.closePauseMenu();
        return;
    }
    if (state.paused) return;
    if (e.code === 'Digit1') state.player.switchWeapon(state.player.getActiveWeaponIndex('rifle'));
    if (e.code === 'Digit2') state.player.switchWeapon(state.player.getActiveWeaponIndex('pistol'));
    if (e.code === 'Digit3') state.player.switchWeapon(2);
    if (e.code === 'Digit4') state.player.switchWeapon(3);
    if (e.code === 'Digit5') state.player.switchWeapon(4);
    if (e.code === 'Digit6') state.player.switchWeapon(5);
    if (e.code === 'Digit7') state.player.switchWeapon(6);
    if (e.code === 'Digit8') state.player.switchWeapon(7);
    if (e.code === 'KeyQ')   state.player.useAbility(0);
    if (e.code === 'KeyE')   state.player.useAbility(1);
    if (e.code === 'KeyF')   state.player.useAbility(2);
    if (e.code === 'KeyR')   state.player.reload();
    if (e.code === 'KeyG')   state.player.tryLoot();
});
window.addEventListener("keyup", (e) => state.keys[e.code] = false);
window.addEventListener("mousedown", () => { if (state.gameStarted && !state.paused && state.player) state.player.fire(); });
window.addEventListener("wheel", (e) => {
    if (!state.gameStarted || state.paused || !state.player) return;
    state.player.cycleWeapon(e.deltaY > 0 ? 1 : -1);
});

// ─── Utils ────────────────────────────────────────────────────────────────────
function checkTerrainCollision(x, y) {
    for (const t of state.terrain) {
        if ((t.type === 'fence') &&
            x > t.x && x < t.x + t.w && y > t.y && y < t.y + t.h) return true;
    }
    return false;
}

function spawnParticles(x, y, color, count = 5) {
    for (let i = 0; i < count; i++) {
        const p = new PIXI.Graphics();
        p.beginFill(color);
        p.drawRect(-1, -1, 2 + Math.random() * 2, 2 + Math.random() * 2);
        p.endFill();
        p.x = x; p.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.life = 30 + Math.random() * 20;
        worldContainer.addChild(p);
        state.particles.push(p);
    }
}

// ── Tiny 2D Perlin noise (Ken Perlin classic, compact) ───────────────────────
const _perlin = (() => {
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
    const grad = (h, x, y) => {
        const u = (h & 1) === 0 ? x : -x;
        const v = (h & 2) === 0 ? y : -y;
        return u + v;
    };
    return (x, y) => {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        const u = fade(x), v = fade(y);
        const A = perm[X] + Y, B = perm[X + 1] + Y;
        return lerp(
            lerp(grad(perm[A],     x,     y    ), grad(perm[B],     x - 1, y    ), u),
            lerp(grad(perm[A + 1], x,     y - 1), grad(perm[B + 1], x - 1, y - 1), u),
            v
        );
    };
})();

function spawnSmokePuff(x, y, count = 1) {
    for (let i = 0; i < count; i++) {
        const p = new PIXI.Graphics();
        // White or one grey only — no random in-between shades
        const shade = Math.random() < 0.5 ? 0xffffff : 0xb8b8b8;
        // Cluster of overlapping circles — they 'stick together' to form a soft cloud silhouette
        const baseR = 5 + Math.random() * 2;
        p.beginFill(shade, 1.0);
        p.drawCircle(0, 0, baseR);
        p.drawCircle( baseR * 0.7,  baseR * 0.2, baseR * 0.8);
        p.drawCircle(-baseR * 0.6,  baseR * 0.35, baseR * 0.75);
        p.drawCircle( baseR * 0.1, -baseR * 0.7, baseR * 0.7);
        p.drawCircle(-baseR * 0.2,  baseR * 0.7, baseR * 0.65);
        p.endFill();
        // Spawn jitter so multiple puffs cluster but don't perfectly stack
        p.x = x + (Math.random() - 0.5) * 4;
        p.y = y + (Math.random() - 0.5) * 4;
        // Slow upward drift + slight horizontal — outward expansion comes from scale, not velocity
        p.vx = (Math.random() - 0.5) * 0.5;
        p.vy = -0.45 - Math.random() * 0.35;
        p.life = 110 + Math.random() * 60;
        p.maxLife = p.life;
        p.isSmoke = true;
        // Random rotation + slow spin (angular speed)
        p.rotation = Math.random() * Math.PI * 2;
        p.angularVel = (Math.random() - 0.5) * 0.012;
        // Expand outward over lifetime: small → large (10–20px → ~100–150px effective)
        p.startScale = 0.35 + Math.random() * 0.25;
        p.endScale   = 2.4  + Math.random() * 1.4;
        p.scale.set(p.startScale);
        // Alpha starts ~0.5 and fades to 0
        p.baseAlpha = 0.45 + Math.random() * 0.15;
        p.alpha = 0;
        // Light friction so the puff keeps drifting rather than churning in place
        p.friction = 0.99;
        // Subtle noise so the cloud has organic motion
        p.noiseSeedX = Math.random() * 1000;
        p.noiseSeedY = Math.random() * 1000;
        p.noiseStrength = 0.010 + Math.random() * 0.010;
        worldContainer.addChild(p);
        state.particles.push(p);
    }
}

// ── Bleeding (DOT) helpers ───────────────────────────────────────────────────
function applyBleed(target, dmg) {
    if (!target) return;
    // Refresh duration to ~3 seconds, scale tick dmg by hit severity (small)
    const newTickDmg = Math.max(0.6, dmg * 0.04);
    target.bleedDmgPerTick = Math.max(target.bleedDmgPerTick || 0, newTickDmg);
    target.bleedDuration = 180;
    if (!target.bleedTickTimer || target.bleedTickTimer <= 0) target.bleedTickTimer = 30;
}

function spawnBleedDrip(x, y) {
    // Tiny, brief blood splatter to telegraph the DOT tick
    spawnBloodSplatter(
        x + (Math.random() - 0.5) * 6,
        y + 4 + Math.random() * 4,
        4,
        { spread: Math.PI * 1.6, baseAngle: Math.PI / 2 }
    );
}

// ── Fire particles (explosion core: white/yellow → orange → red → smoke) ─────
function spawnFireParticle(x, y, opts = {}) {
    const p = new PIXI.Graphics();
    const radius = (opts.radius || 4) + Math.random() * 3;
    p.beginFill(0xffffff, 1.0);
    p.drawCircle(0, 0, radius);
    p.endFill();
    p.x = x + (Math.random() - 0.5) * 6;
    p.y = y + (Math.random() - 0.5) * 6;
    const angle = (opts.angle != null ? opts.angle : Math.random() * Math.PI * 2);
    const speed = (opts.speed || 2) + Math.random() * (opts.speedJitter || 3);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = (opts.life || 35) + Math.random() * 25;
    p.maxLife = p.life;
    p.isFire = true;
    p.baseRadius = radius;
    p.startScale = 1.0;
    p.endScale = 1.6 + Math.random() * 0.8;
    p.scale.set(p.startScale);
    p.friction = 0.93 + Math.random() * 0.04;
    p.rotation = Math.random() * Math.PI * 2;
    p.angularVel = (Math.random() - 0.5) * 0.06;
    p.gravity = (opts.gravity != null ? opts.gravity : -0.02); // slight buoyancy
    worldContainer.addChild(p);
    state.particles.push(p);
    return p;
}

// ── Sparks (bright tiny streaks; gravity + heavy friction; very short life) ──
function spawnSparkParticle(x, y, opts = {}) {
    const p = new PIXI.Graphics();
    const len = 3 + Math.random() * 4;
    const color = opts.color != null ? opts.color : (Math.random() < 0.5 ? 0xffeebb : 0xffffff);
    p.beginFill(color, 1.0);
    p.drawRect(-len/2, -0.6, len, 1.2);
    p.endFill();
    p.x = x; p.y = y;
    const angle = (opts.angle != null ? opts.angle : Math.random() * Math.PI * 2);
    const speed = (opts.speed || 4) + Math.random() * (opts.speedJitter || 6);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.rotation = angle;
    p.angularVel = 0;
    p.life = (opts.life || 18) + Math.random() * 12;
    p.maxLife = p.life;
    p.isSpark = true;
    p.friction = 0.90 + Math.random() * 0.04;
    p.gravity = (opts.gravity != null ? opts.gravity : 0.12);
    worldContainer.addChild(p);
    state.particles.push(p);
    return p;
}

// ── Debris chunks (heavy: gravity, rotation, friction) ───────────────────────
function spawnDebrisParticle(x, y, opts = {}) {
    const p = new PIXI.Graphics();
    const w = 2 + Math.random() * 3;
    const h = 2 + Math.random() * 4;
    const palette = opts.palette || [0x3a2c20, 0x5a4630, 0x70604a, 0x222222];
    const color = palette[Math.floor(Math.random() * palette.length)];
    p.beginFill(color, 1.0);
    p.drawRect(-w/2, -h/2, w, h);
    p.endFill();
    p.x = x; p.y = y;
    const angle = (opts.angle != null ? opts.angle : Math.random() * Math.PI * 2);
    const speed = (opts.speed || 3) + Math.random() * 4;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.rotation = Math.random() * Math.PI * 2;
    p.angularVel = (Math.random() - 0.5) * 0.3;
    p.life = (opts.life || 50) + Math.random() * 30;
    p.maxLife = p.life;
    p.isDebris = true;
    p.friction = 0.94;
    p.gravity = (opts.gravity != null ? opts.gravity : 0.22);
    worldContainer.addChild(p);
    state.particles.push(p);
    return p;
}

// ── Blood droplets (elongated ellipse blobs; gravity + friction) ─────────────
function spawnBloodSplatter(x, y, count = 60, opts = {}) {
    const baseAngle = opts.baseAngle != null ? opts.baseAngle : -Math.PI / 2;
    const spread    = opts.spread    != null ? opts.spread    : Math.PI;
    for (let i = 0; i < count; i++) {
        const p = new PIXI.Graphics();
        const shade = [0x5a0000, 0x7a0a0a, 0x8a1313, 0x3a0000][Math.floor(Math.random()*4)];
        const rx = 1.4 + Math.random() * 2.0;
        const ry = 0.5 + Math.random() * 0.9;
        p.beginFill(shade, 1.0);
        p.drawEllipse(0, 0, rx, ry);
        p.endFill();
        p.x = x + (Math.random() - 0.5) * 4;
        p.y = y + (Math.random() - 0.5) * 4;
        const angle = baseAngle + (Math.random() - 0.5) * spread;
        const speed = 1.5 + Math.random() * 4.5;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.rotation = angle;
        p.angularVel = (Math.random() - 0.5) * 0.05;
        p.life = 35 + Math.random() * 35;
        p.maxLife = p.life;
        p.isBlood = true;
        p.friction = 0.93 + Math.random() * 0.04;
        p.gravity  = 0.30 + Math.random() * 0.10;
        worldContainer.addChild(p);
        state.particles.push(p);
    }
}

// ── Muzzle flash burst ───────────────────────────────────────────────────────
function spawnMuzzleFlash(x, y, angle, intensity = 1) {
    // Bright core flash that fades out fast
    const flash = new PIXI.Graphics();
    const r = 6 + 4 * intensity;
    flash.beginFill(0xfff5cc, 1.0); flash.drawCircle(0, 0, r); flash.endFill();
    flash.beginFill(0xffffff, 0.95); flash.drawCircle(0, 0, r * 0.55); flash.endFill();
    flash.x = x; flash.y = y; flash.rotation = angle;
    flash.vx = Math.cos(angle) * 0.6;
    flash.vy = Math.sin(angle) * 0.6;
    flash.life = 7;
    flash.maxLife = 7;
    flash.isFire = true;
    flash.startScale = 1.0;
    flash.endScale = 1.4;
    flash.scale.set(1);
    flash.friction = 0.85;
    flash.angularVel = 0;
    flash.gravity = 0;
    worldContainer.addChild(flash);
    state.particles.push(flash);
    // Forward fire burst
    const cone = 0.55;
    for (let i = 0; i < 6 + Math.floor(4 * intensity); i++) {
        spawnFireParticle(x, y, {
            angle: angle + (Math.random() - 0.5) * cone,
            speed: 2.5 + 2 * intensity,
            speedJitter: 2.0,
            life: 14,
            radius: 2 + Math.random() * 2,
            gravity: -0.01,
        });
    }
    // Sparks shooting forward
    for (let i = 0; i < 5 + Math.floor(3 * intensity); i++) {
        spawnSparkParticle(x, y, {
            angle: angle + (Math.random() - 0.5) * cone * 0.8,
            speed: 6,
            speedJitter: 5,
            life: 10,
            gravity: 0.05,
        });
    }
    // A tiny smoke wisp
    spawnSmokePuff(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6, 1);
}

// ── HSV→RGB helper for fire colour interpolation ─────────────────────────────
function _lerpFireColor(t) {
    // t: 0 (birth, white) → 1 (death, dark gray smoke)
    // Stops: white → yellow → orange → red → dark gray
    const stops = [
        [0.00, [255, 255, 240]],
        [0.18, [255, 230, 110]],
        [0.40, [255, 150,  40]],
        [0.65, [200,  50,  20]],
        [1.00, [ 50,  50,  50]],
    ];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const span = b[0] - a[0] || 1;
    const k = (t - a[0]) / span;
    const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * k);
    const g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * k);
    const bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * k);
    return (r << 16) | (g << 8) | bl;
}

function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx*dx + dy*dy); }

function isInBush(x, y) {
    return state.terrain.some(t => t.type === 'bush' && x > t.x && x < t.x+t.w && y > t.y && y < t.y+t.h);
}

// ─── Layers ───────────────────────────────────────────────────────────────────
const worldContainer = new PIXI.Container();
const uiContainer    = new PIXI.Container();
const dayOverlay     = new PIXI.Graphics();
app.stage.addChild(worldContainer);
app.stage.addChild(dayOverlay);
app.stage.addChild(uiContainer);

// ─── World / Terrain ─────────────────────────────────────────────────────────
class World {
    constructor() {
        this.width = 1800; this.height = 1800;
        // Water (lake) background — extends beyond world bounds so it's visible at edges
        this.waterMargin = 2400;
        this.waterBase = new PIXI.Graphics();
        this.waterBase.beginFill(0x2f5b8a, 1.0);
        this.waterBase.drawRect(
            -this.waterMargin, -this.waterMargin,
            this.width + this.waterMargin * 2, this.height + this.waterMargin * 2
        );
        this.waterBase.endFill();
        worldContainer.addChild(this.waterBase);
        this.waterAnim = new PIXI.Graphics();
        worldContainer.addChild(this.waterAnim);
        this.waterTime = 0;

        // Grass background
        const grassTex = PIXI.Texture.from('assets/grass-background-texture-turf-lawn-season-ground-pattern-yard-eco_165079-188.avif');
        grassTex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        this.grassBg = new PIXI.TilingSprite(grassTex, this.width, this.height);
        this.grassBg.x = 0; this.grassBg.y = 0;
        worldContainer.addChild(this.grassBg);
        this.graphics = new PIXI.Graphics();
        worldContainer.addChild(this.graphics);
        this.lakeWidth = 60;
        this.spawnTerrain();
    }

    spawnTerrain() {
        const placeOutsideLake = (w, h) => {
            let x, y;
            do {
                x = Math.random() * (this.width - w);
                y = Math.random() * (this.height - h);
            } while (this.isInLake(x, y, w, h));
            return { x, y };
        };

        state.terrain.forEach(t => {
            if (t.sprite) worldContainer.removeChild(t.sprite);
        });
        state.terrain = [];
        const act = state.act;
        if (act === 1) {
            for (let i = 0; i < 20; i++) {
                const w = 90 + Math.random() * 80;
                const h = 10;
                const pos = placeOutsideLake(w, h);
                state.terrain.push({ x: pos.x, y: pos.y, w, h, type:'fence', hp:3 });
            }
            for (let i = 0; i < 18; i++) {
                const w = 80 + Math.random() * 80;
                const h = 80 + Math.random() * 80;
                const pos = placeOutsideLake(w, h);
                state.terrain.push({ x: pos.x, y: pos.y, w, h, type:'bush' });
            }
            state.flags.push(new Flag(900, 900, 'union'));
        } else if (act === 2) {
            for (let i = 0; i < 18; i++) {
                const w = 100 + Math.random() * 120;
                const h = 100 + Math.random() * 80;
                const pos = placeOutsideLake(w, h);
                state.terrain.push({ x: pos.x, y: pos.y, w, h, type:'bush' });
            }
            for (let i = 0; i < 8; i++) {
                const w = 80 + Math.random() * 60;
                const h = 80 + Math.random() * 60;
                const pos = placeOutsideLake(w, h);
                state.terrain.push({ x: pos.x, y: pos.y, w, h, type:'bush' });
            }
            // Confederate flag removed; only terrain remains in this act
        } else {
            for (let i = 0; i < 5; i++) {
                const w = 80;
                const h = 10;
                const pos = placeOutsideLake(w, h);
                state.terrain.push({ x: pos.x, y: pos.y, w, h, type:'fence', hp:3 });
            }
        }
        this.render();
    }

    isInLake(x, y, w = 0, h = 0) {
        return x < this.lakeWidth || y < this.lakeWidth || x + w > this.width - this.lakeWidth || y + h > this.height - this.lakeWidth;
    }

    updateWater(delta) {
        this.waterTime += delta * 0.02;
        const t = this.waterTime;
        const g = this.waterAnim;
        g.clear();

        // Get visible water area around the camera so we only draw what's on screen
        const cx = -worldContainer.x + app.screen.width  / 2;
        const cy = -worldContainer.y + app.screen.height / 2;
        const halfW = app.screen.width  / 2 + 200;
        const halfH = app.screen.height / 2 + 200;
        const x0 = cx - halfW, x1 = cx + halfW;
        const y0 = cy - halfH, y1 = cy + halfH;

        // Helper: is a point in the water area (outside the grass rectangle)?
        const inWater = (x, y) => x < 0 || y < 0 || x > this.width || y > this.height;

        // Slow undulating colour bands that shift across the surface
        const bandStep = 26;
        for (let yy = Math.floor(y0 / bandStep) * bandStep; yy < y1; yy += bandStep) {
            const wave = Math.sin(yy * 0.012 + t * 1.4);
            const shade = 0x365f8c + Math.floor(wave * 12) * 0x010101;
            const phase = Math.sin(yy * 0.02 + t * 0.6) * 6;
            for (let xx = Math.floor(x0 / 60) * 60; xx < x1; xx += 60) {
                if (!inWater(xx + 30, yy + bandStep / 2)) continue;
                g.beginFill(shade, 0.35);
                g.drawRect(xx + phase, yy, 60, bandStep);
                g.endFill();
            }
        }

        // Wave crest lines: short white-ish horizontal segments riding sine waves
        const crestSpacing = 70;
        g.lineStyle(1.2, 0xc0d8e8, 0.55);
        for (let yy = Math.floor(y0 / crestSpacing) * crestSpacing; yy < y1; yy += crestSpacing) {
            for (let xx = Math.floor(x0 / 90) * 90; xx < x1; xx += 90) {
                const wy = yy + Math.sin(xx * 0.025 + t * 1.8 + yy * 0.01) * 6;
                if (!inWater(xx + 20, wy)) continue;
                g.moveTo(xx, wy);
                g.lineTo(xx + 36, wy + Math.sin((xx + 36) * 0.025 + t * 1.8 + yy * 0.01) * 6 - Math.sin(xx * 0.025 + t * 1.8 + yy * 0.01) * 6);
            }
        }

        // Sparse glints / sparkle dots
        for (let i = 0; i < 24; i++) {
            const sx = x0 + ((i * 197 + Math.floor(t * 60)) % (x1 - x0));
            const sy = y0 + ((i * 313 + Math.floor(t * 40 + i * 11)) % (y1 - y0));
            if (!inWater(sx, sy)) continue;
            const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 4 + i));
            g.beginFill(0xffffff, twinkle * 0.55);
            g.drawCircle(sx, sy, 1.2 + Math.sin(t * 3 + i) * 0.4);
            g.endFill();
        }
    }

    render() {
        this.graphics.clear();
        // Ground grid
        if (state.showGrid) {
            this.graphics.lineStyle(1.5, 0x2d3423, 0.4);
            for (let i = 0; i <= this.width;  i += 200) { this.graphics.moveTo(i, 0); this.graphics.lineTo(i, this.height); }
            for (let i = 0; i <= this.height; i += 200) { this.graphics.moveTo(0, i); this.graphics.lineTo(this.width, i); }
        }
        // Terrain
        state.terrain.forEach(t => {
            if      (t.type === 'wheat')  { this.graphics.beginFill(0x8a7a3a, 0.45); this.graphics.drawRect(t.x, t.y, t.w, t.h); }
            else if (t.type === 'fence')  { this.graphics.beginFill(0x4a3728);        this.graphics.drawRect(t.x, t.y, t.w, t.h); }
            else if (t.type === 'bush')   { /* rendered as sprite below */ }
            else                          { this.graphics.beginFill(0x333333); this.graphics.lineStyle(2, 0x111111); this.graphics.drawRect(t.x, t.y, t.w, t.h); }
        });
        // Render bush sprites
        state.terrain.forEach(t => {
            if (t.type === 'bush') {
                if (t.sprite) { worldContainer.removeChild(t.sprite); }
                const bushTex = PIXI.Texture.from('assets/bush.png');
                const s = new PIXI.Sprite(bushTex);
                s.x = t.x; s.y = t.y;
                s.width = t.w; s.height = t.h;
                const grassIdx = worldContainer.children.indexOf(this.grassBg);
                worldContainer.addChildAt(s, grassIdx + 1);
                t.sprite = s;
            }
        });
        this.graphics.endFill();
    }
}

// ─── Projectiles ──────────────────────────────────────────────────────────────
class Bullet {
    constructor(x, y, rotation, speed, damage, life, owner) {
        this.sprite = new PIXI.Graphics();
        this.sprite.beginFill(0xffff77); this.sprite.drawRect(-3, -1.5, 6, 3); this.sprite.endFill();
        this.sprite.x = x; this.sprite.y = y; this.sprite.rotation = rotation;
        this.vx = Math.cos(rotation) * speed;
        this.vy = Math.sin(rotation) * speed;
        this.life = life; this.damage = damage; this.owner = owner;
        worldContainer.addChild(this.sprite);
    }
    update(delta) {
        const nx = this.sprite.x + this.vx * delta;
        const ny = this.sprite.y + this.vy * delta;
        if (checkTerrainCollision(nx, ny)) {
            const hitAngle = Math.atan2(-this.vy, -this.vx);
            for (let s = 0; s < 6; s++) {
                spawnSparkParticle(nx, ny, { angle: hitAngle + (Math.random() - 0.5) * 1.2, speed: 4, speedJitter: 4, life: 12 });
            }
            for (let s = 0; s < 5; s++) {
                spawnDebrisParticle(nx, ny, { angle: hitAngle + (Math.random() - 0.5) * 1.4, speed: 1.5, life: 35, palette: [0x8a8a8a, 0xa8a8a8, 0x707070] });
            }
            this.destroy(); return false;
        }
        if (this.owner === state.player) {
            for (const e of state.enemies) {
                if (dist(e.container.x, e.container.y, nx, ny) < 22) {
                    e.takeDamage(this.damage);
                    spawnBloodSplatter(nx, ny, 55, { baseAngle: Math.atan2(this.vy, this.vx), spread: Math.PI * 0.9 });
                    this.destroy(); return false;
                }
            }
        } else {
            if (dist(state.player.container.x, state.player.container.y, nx, ny) < 20) {
                state.player.takeDamage(this.damage);
                state.shake = 10;
                spawnBloodSplatter(nx, ny, 50, { baseAngle: Math.atan2(this.vy, this.vx), spread: Math.PI * 0.9 });
                this.destroy(); return false;
            }
        }
        this.sprite.x = nx; this.sprite.y = ny;
        this.life -= delta;
        if (this.life <= 0) { this.destroy(); return false; }
        return true;
    }
    destroy() { worldContainer.removeChild(this.sprite); }
}

class Grenade {
    constructor(x, y, rotation, speed, targetX = null, targetY = null, longRange = false) {
        this.sprite = new PIXI.Graphics();
        this.sprite.beginFill(0x1a3a1a); this.sprite.drawCircle(0, 0, 6); this.sprite.endFill();
        this.sprite.x = x; this.sprite.y = y;
        if (targetX !== null && targetY !== null) {
            this.targetX = targetX;
            this.targetY = targetY;
            this.isTargeted = true;
            this.speed = speed || 12;
        } else {
            this.isTargeted = false;
            this.vx = Math.cos(rotation) * speed;
            this.vy = Math.sin(rotation) * speed;
            this.life = longRange ? 130 : 90;
        }
        this.damage = 110;
        worldContainer.addChild(this.sprite);
    }
    update(delta) {
        if (this.isTargeted) {
            const dx = this.targetX - this.sprite.x;
            const dy = this.targetY - this.sprite.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            if (d < 5) {
                this.explode();
                return false;
            }
            const nx = this.sprite.x + (dx / d) * this.speed * delta;
            const ny = this.sprite.y + (dy / d) * this.speed * delta;
            if (checkTerrainCollision(nx, ny)) {
                this.explode();
                return false;
            }
            this.sprite.x = nx;
            this.sprite.y = ny;
        } else {
            const nx = this.sprite.x + this.vx * delta;
            const ny = this.sprite.y + this.vy * delta;
            if (checkTerrainCollision(nx, ny)) { this.vx *= -0.5; this.vy *= -0.5; }
            else { this.sprite.x = nx; this.sprite.y = ny; }
            this.vx *= 0.96; this.vy *= 0.96;
            this.life -= delta;
            if (this.life <= 0) { this.explode(); return false; }
        }
        return true;
    }
    explode() {
        playSound('explosion', 0.9, 0.06);
        const x = this.sprite.x;
        const y = this.sprite.y;

        // Bright initial blast — large yellow core, layered orange rings, white hot center
        const core = new PIXI.Graphics();
        core.beginFill(0xffe488, 1.0).drawCircle(0, 0, 30).endFill();
        core.beginFill(0xffaa44, 0.85).drawCircle(0, 0, 18).endFill();
        const ring = new PIXI.Graphics();
        ring.lineStyle(12, 0xffaa33, 0.95).drawCircle(0, 0, 64);
        const ring2 = new PIXI.Graphics();
        ring2.lineStyle(6, 0xffd066, 0.7).drawCircle(0, 0, 90);
        const flash = new PIXI.Graphics();
        flash.beginFill(0xffffff, 1.0).drawCircle(0, 0, 18).endFill();

        const explosion = new PIXI.Container();
        explosion.x = x; explosion.y = y;
        explosion.addChild(core, ring, ring2, flash);
        worldContainer.addChild(explosion);

        const shards = [];
        for (let i = 0; i < 14; i++) {
            const shard = new PIXI.Graphics();
            shard.beginFill(0xffdd88); shard.drawRect(-2, -10, 4, 18); shard.endFill();
            shard.x = x; shard.y = y;
            shard.rotation = i * (Math.PI * 2 / 14);
            shard.vx = Math.cos(shard.rotation) * (4 + Math.random() * 4);
            shard.vy = Math.sin(shard.rotation) * (4 + Math.random() * 4);
            shard.alpha = 0.95;
            worldContainer.addChild(shard);
            shards.push(shard);
        }

        // ── Bright burst (the classic look): orange + yellow particles ───────
        spawnParticles(x, y, 0xff5522, 40);
        spawnParticles(x, y, 0xffee88, 22);
        // Fire particles (white→yellow→orange→red→smoke as they age)
        for (let k = 0; k < 45; k++) {
            spawnFireParticle(x, y, {
                angle: Math.random() * Math.PI * 2,
                speed: 3 + Math.random() * 5,
                speedJitter: 3,
                life: 28 + Math.random() * 22,
                radius: 4 + Math.random() * 4,
                gravity: -0.05 + Math.random() * 0.06,
            });
        }
        // Sparks fly outward fast then arc down
        for (let k = 0; k < 28; k++) {
            spawnSparkParticle(x, y, {
                angle: Math.random() * Math.PI * 2,
                speed: 6,
                speedJitter: 8,
                life: 16 + Math.random() * 12,
            });
        }
        // A bit of tumbling debris (lighter than before so the bright burst still reads)
        for (let k = 0; k < 12; k++) {
            spawnDebrisParticle(x, y, {
                angle: Math.random() * Math.PI * 2,
                speed: 2 + Math.random() * 4,
                life: 60 + Math.random() * 40,
            });
        }
        // Smoke plume billowing up after the blast — staggered so it reads after the flash
        for (let k = 0; k < 18; k++) {
            const sa = Math.random() * Math.PI * 2;
            const sd = Math.random() * 14;
            spawnSmokePuff(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd, 1);
        }
        for (let k = 0; k < 22; k++) {
            setTimeout(() => {
                const sa = Math.random() * Math.PI * 2;
                const sd = Math.random() * 22;
                spawnSmokePuff(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd - 6, 1);
            }, 80 + Math.random() * 240);
        }
        state.shake = 24;

        [state.player, ...state.enemies].forEach(t => {
            if (!t) return;
            const d = dist(t.container.x, t.container.y, x, y);
            if (d < 130) {
                const dmg = this.damage * (1 - d / 130);
                if (t === state.player) t.takeDamage(dmg);
                else t.takeDamage(dmg);
            }
        });

        let life = 28;
        const tick = (delta) => {
            life -= delta;
            const ratio = Math.max(0, life / 28);
            explosion.scale.set(1 + 0.85 * (1 - ratio));
            explosion.alpha = ratio;
            ring.alpha = ratio * 0.95;
            ring2.alpha = ratio * 0.75;
            flash.alpha = ratio * 1.0;
            shards.forEach(shard => {
                shard.x += shard.vx * delta;
                shard.y += shard.vy * delta;
                shard.alpha = ratio;
                shard.scale.set(0.6 + 0.4 * ratio);
            });
            if (life <= 0) {
                app.ticker.remove(tick);
                worldContainer.removeChild(explosion);
                shards.forEach(s => worldContainer.removeChild(s));
            }
        };
        app.ticker.add(tick);
        worldContainer.removeChild(this.sprite);
    }
}

class SwordSwing {
    constructor(player) {
        this.sprite = new PIXI.Graphics();
        this.sprite.lineStyle(5, 0xdddddd, 0.9);
        this.sprite.arc(0, 0, 55, -Math.PI / 3, Math.PI / 3);
        this.player = player; this.life = 12;
        player.container.addChild(this.sprite);
    }
    update(delta) {
        this.life -= delta;
        if (this.life <= 0) { this.player.container.removeChild(this.sprite); return false; }
        return true;
    }
}

// ─── Loot Body ────────────────────────────────────────────────────────────────
class LootBody {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.life = 20 * 60; // 20 seconds at 60fps
        const tex = PIXI.Texture.from('assets/ammo_box.png');
        this.graphic = new PIXI.Sprite(tex);
        this.graphic.anchor.set(0.5);
        this.graphic.width = 48;
        this.graphic.height = 48;
        this.graphic.x = x;
        this.graphic.y = y - 16;
        worldContainer.addChild(this.graphic);
    }
    update(delta) {
        this.life -= delta;
        if (this.life <= 0) { this.destroy(); return false; }
        return true;
    }
    loot() {
        const roll = Math.random();
        let msg;
        if (roll < 0.50) {       // Common – ammo
            state.player.weapons.forEach(w => {
                if (w.category === 'rifle') {
                    w.reserve = Math.min(w.reserve + 8, 80);
                }
                if (w.category === 'pistol') {
                    w.reserve = Math.min(w.reserve + 6, 60);
                }
            });
            const grenade = state.player.weapons.find(w => w.type === 'grenade');
            if (grenade) {
                grenade.mag = Math.min(grenade.mag + 2, grenade.magSize);
            }
            msg = "+Ammo & Grenades";
        } else {                   // Rare – medkit or ability cooldown reset
            if (Math.random() < 0.5) {
                state.player.hp = Math.min(state.player.maxHp, state.player.hp + 30);
                msg = "+30 HP";
            } else {
                state.player.abilities.forEach(a => { a.current = Math.max(0, a.current - a.cooldown * 0.4); });
                msg = "Ability Cooldowns -40%";
            }
        }
        showFloatText(this.x, this.y, msg, 0xffee22);
        state.score += 50;
        this.destroy();
    }
    destroy() { worldContainer.removeChild(this.graphic); }
}

// ─── Flag ────────────────────────────────────────────────────────────────────
class Flag {
    constructor(x, y, type) {
        this.type = type; // 'union' or 'confed'
        this.x = x; this.y = y;
        this.graphic = new PIXI.Sprite(textures[type + '_flag']);
        this.graphic.anchor.set(0.5);
        this.graphic.x = x; this.graphic.y = y;
        worldContainer.addChild(this.graphic);
    }
    update(delta) {
        const dx = state.player.container.x - this.x;
        const dy = state.player.container.y - this.y;
        if (Math.sqrt(dx*dx + dy*dy) < 50) {
            this.collect();
            return false;
        }
        return true;
    }
    collect() {
        if (this.graphic) {
            worldContainer.removeChild(this.graphic);
            this.graphic.destroy();
            this.graphic = null;
        }
        showFloatText(this.x, this.y, "FLAG COLLECTED", 0xffee22);
        state.score += this.type === 'union' ? 500 : 300;
        if (state.objective && typeof state.objective === 'object') {
            state.objective.text = 'FLAG COLLECTED';
            state.objective.completed = true;
            if (state.objective.graphic) {
                worldContainer.removeChild(state.objective.graphic);
                state.objective.graphic = null;
            }
        } else {
            state.objective = { type: 'flag', text: 'FLAG COLLECTED', completed: true };
        }
    }
}
function showFloatText(x, y, msg, color = 0xffffff) {
    const t = new PIXI.Text(msg, { fontFamily: 'Georgia, serif', fontSize: 18, fill: color, stroke: 0x000000, strokeThickness: 3 });
    t.anchor.set(0.5); t.x = x; t.y = y - 30;
    worldContainer.addChild(t);
    let life = 80;
    const tick = () => {
        t.y -= 0.5; t.alpha = life / 80; life--;
        if (life <= 0) { worldContainer.removeChild(t); app.ticker.remove(tick); }
    };
    app.ticker.add(tick);
}

// ─── Player ───────────────────────────────────────────────────────────────────
class Player {
    constructor(x, y) {
        this.container = new PIXI.Container();
        this.container.x = x; this.container.y = y;
        this.hp = 100; this.maxHp = 100;
        // Bleeding (DOT): set when damaged. Ticks small dmg over a few seconds.
        this.bleedDuration = 0;
        this.bleedTickTimer = 0;
        this.bleedDmgPerTick = 0;
        this.fireCooldown = 0;
        this.reloadTimer = 0;
        this.isReloading = false;
        this.meleeRef = null;
        this.spriteNode = null;
        this.shadowNode = null;
        this.lootProgress = 0;
        this.lootTarget   = null;

        // ── Weapons (balanced) ──
        this.weapons = [
            { name: "Springfield Model 1861", mag: 1, magSize: 1, reserve: 60, color: 0x4a3728, cooldown: 42, reloadTime: 190, speed: 20, damage: 115, type: 'bullet', immobileReload: true, category: 'rifle', waveUnlock: 1, active: true, available: true },
            { name: "Flintlock Pistol", mag: 1, magSize: 1, reserve: 32, color: 0x3a2f23, cooldown: 22, reloadTime: 120, speed: 14, damage: 85, type: 'bullet', immobileReload: false, category: 'pistol', waveUnlock: 1, active: true, available: true },
            { name: "Colt 1860 Army Revolver", mag: 6, magSize: 6, reserve: 48, color: 0x2a2a2a, cooldown: 18, reloadTime: 110, speed: 15, damage: 42, type: 'bullet', immobileReload: false, category: 'pistol', waveUnlock: 2, active: false, available: false },
            { name: "Ketchum Hand Grenade", mag: 4, magSize: 6, reserve: 0, color: 0x1a3a1a, cooldown: 65, reloadTime: 0, speed: 16, damage: 110, type: 'grenade', immobileReload: false, category: 'utility', waveUnlock: 1, active: true, available: true, longRange: true },
            { name: "Model 1860 Light Cavalry Saber", mag: 99, magSize: 99, reserve: 999, color: 0xaaaaaa, cooldown: 28, reloadTime: 0, speed: 0, damage: 55, type: 'melee', immobileReload: false, category: 'melee', waveUnlock: 1, active: true, available: true },
            { name: "Sharps New Model 1859", mag: 5, magSize: 8, reserve: 28, color: 0x5f3d24, cooldown: 28, reloadTime: 160, speed: 21, damage: 60, type: 'bullet', immobileReload: true, category: 'rifle', waveUnlock: 2, active: false, available: false },
            { name: "Converted Model 1842 Pistol", mag: 8, magSize: 8, reserve: 40, color: 0x3c3c3c, cooldown: 15, reloadTime: 100, speed: 18, damage: 58, type: 'bullet', immobileReload: false, category: 'pistol', waveUnlock: 2, active: false, available: false },
            { name: "Spencer Repeating Rifle", mag: 12, magSize: 12, reserve: 40, color: 0x3f3d33, cooldown: 12, reloadTime: 130, speed: 20, damage: 34, type: 'bullet', immobileReload: false, category: 'rifle', waveUnlock: 3, active: false, available: false },
            { name: "Blunderbuss", mag: 2, magSize: 2, reserve: 12, color: 0x6a4f34, cooldown: 42, reloadTime: 150, speed: 16, damage: 28, type: 'shotgun', immobileReload: true, pellets: 6, spread: 0.1, category: 'rifle', waveUnlock: 3, active: false, available: false }
            ];


        // ── Union Abilities ──
        this.abilities = [
            { name: "Artillery Strike", cooldown: 1100, current: 0, type: 'aoe'   },
            { name: "Smoke",            cooldown: 900,  current: 0, type: 'smoke' },
            { name: "Volley Fire",      cooldown: 550,  current: 0, type: 'rapid' },
        ];

        // Field Smoke state (cigarette puff heal)
        this.smokeDuration  = 0;            // frames remaining
        this.smokeTotal     = 240;          // ~4 seconds at 60fps
        this.smokeHealRate  = 55 / 240;     // total heal ~55 HP
        this.smokePuffTimer = 0;

        this.currentWeaponIndex = 0;
        this.baseSpeed = 2.5;

        worldContainer.addChild(this.container);
        this._buildSprite(0);
    }

    // ── Sprite management ─────────────────────────────────────────────────────
    _buildSprite(idx) {
        if (this.shadowNode) { this.container.removeChild(this.shadowNode); this.shadowNode = null; }
        if (this.spriteNode) { this.container.removeChild(this.spriteNode); this.spriteNode = null; }

        const weapon = this.weapons[idx];
        const path = weapon
            ? weapon.type === 'grenade' ? 'assets/union_granade.png'
            : weapon.type === 'melee' ? 'assets/union_sword.png'
            : weapon.type === 'shotgun' ? 'assets/union_musket.png'
            : weapon.category === 'pistol' ? 'assets/union_flintlock.png'
            : weapon.category === 'rifle' ? 'assets/union_musket.png'
            : UNION_WEAPON_SPRITES[idx]
            : null;
        const tex  = path ? textures[path] : null;

        if (tex && tex.valid) {
            const shadow = new PIXI.Graphics();
            shadow.beginFill(0x000000, 0.25);
            shadow.drawEllipse(4, 6, 22, 10);
            shadow.endFill();
            this.container.addChild(shadow);
            this.shadowNode = shadow;

            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5, 0.5);
            const targetSize = 64;
            const scale = targetSize / Math.max(sprite.texture.width, sprite.texture.height);
            sprite.scale.set(scale);

            const offsets = [
                { x:  2, y:  4 },
                { x:  0, y:  2 },
                { x: -4, y:  2 },
                { x:  0, y:  2 },
                { x:  2, y:  2 },
                { x:  0, y:  2 },
                { x:  0, y:  2 },
                { x:  0, y:  4 },
                { x:  0, y:  4 },
            ];
            sprite.x = offsets[idx].x;
            sprite.y = offsets[idx].y;
            this.container.addChild(sprite);
            this.spriteNode = sprite;
        } else if (weapon && weapon.type === 'shotgun') {
            const g = new PIXI.Graphics();
            g.beginFill(0x5a3d1f);
            g.drawRoundedRect(-24, -10, 48, 20, 6);
            g.beginFill(0x422f1a);
            g.drawRect(10, -8, 18, 16);
            g.endFill();
            this.container.addChild(g);
            this.spriteNode = g;
        } else {
            // Fallback circle
            const g = new PIXI.Graphics();
            g.beginFill(0x2b3d5b); g.lineStyle(2, 0x000000); g.drawCircle(0, 0, 16); g.endFill();
            const w = this.weapons[idx];
            g.lineStyle(4, w.color); g.moveTo(0, 0); g.lineTo(w.type === 'grenade' ? 12 : 30, 0);
            this.container.addChild(g);
            this.spriteNode = g;
        }
    }

    getActiveWeaponIndices() {
        return this.weapons.map((w, i) => (w.active && w.available) ? i : -1).filter(i => i >= 0);
    }

    getActiveWeaponIndex(category) {
        const idx = this.weapons.findIndex(w => w.category === category && w.active && w.available);
        return idx >= 0 ? idx : this.currentWeaponIndex;
    }

    updateAvailableWeapons() {
        if (!state.player) return;
        const nextWave = state.waveCountdown > 0 ? Math.max(1, state.wave + 1) : Math.max(1, state.wave || 1);
        this.weapons.forEach(w => {
            w.available = nextWave >= (w.waveUnlock || 1);
            if (!w.available) w.active = false;
        });
        ['pistol', 'rifle'].forEach(cat => {
            const active = this.weapons.filter(w => w.category === cat && w.active && w.available);
            if (active.length === 0) {
                const first = this.weapons.find(w => w.category === cat && w.available);
                if (first) first.active = true;
            }
        });
        if (!this.weapons[this.currentWeaponIndex]?.active || !this.weapons[this.currentWeaponIndex]?.available) {
            const active = this.getActiveWeaponIndices();
            if (active.length) this.switchWeapon(active[0]);
        }
    }

    cycleWeapon(dir) {
        if (this.isReloading) return;
        const active = this.getActiveWeaponIndices();
        if (active.length === 0) return;
        let idx = active.indexOf(this.currentWeaponIndex);
        if (idx === -1) idx = 0;
        idx = (idx + dir + active.length) % active.length;
        this.switchWeapon(active[idx]);
    }

    switchWeapon(index) {
        if (this.isReloading) return;
        const active = this.getActiveWeaponIndices();
        if (active.length === 0) return;
        if (!this.weapons[index] || !this.weapons[index].active) index = active[0];
        this.currentWeaponIndex = index;
        this._buildSprite(index);
        if (state.ui) state.ui.update();
    }

    reload() {
        const w = this.weapons[this.currentWeaponIndex];
        if (w.mag === w.magSize || w.reserve <= 0 || w.type === 'grenade' || w.type === 'melee') return;
        this.isReloading = true; this.reloadTimer = w.reloadTime;
        if (w.name && w.name.includes('Springfield')) {
            playSound('reload', 0.6, 0.08);
        }
    }

    tryLoot() {
        if (this.lootTarget) return; // already looting
        let closest = null; let closestDist = 80;
        for (const b of state.lootBodies) {
            const d = dist(this.container.x, this.container.y, b.x, b.y);
            if (d < closestDist) { closestDist = d; closest = b; }
        }
        if (closest) {
            this.lootTarget   = closest;
            this.lootProgress = 0;
            showFloatText(this.container.x, this.container.y, "Looting…", 0xffee22);
        }
    }

    useAbility(index) {
        const abi = this.abilities[index];
        if (abi.current > 0) return;

        if (abi.type === 'aoe') {
            // Artillery Strike – delayed cannon volley
            const mouse = app.renderer.events.pointer.global;
            const tx = mouse.x - worldContainer.x;
            const ty = mouse.y - worldContainer.y;
            // Warning marker
            const warn = new PIXI.Graphics();
            warn.lineStyle(3, 0xff3300, 0.8); warn.drawCircle(tx, ty, 260);
            worldContainer.addChild(warn);
            showFloatText(tx, ty, "ARTILLERY INBOUND!", 0xff3300);
            setTimeout(() => {
                worldContainer.removeChild(warn);
                // Launch grenades to target area
                for (let i = 0; i < 5; i++) {
                    const angle = (i / 5) * Math.PI * 2;
                    const tx = mouse.x - worldContainer.x + Math.cos(angle) * 100;
                    const ty = mouse.y - worldContainer.y + Math.sin(angle) * 100;
                    state.grenades.push(new Grenade(this.container.x, this.container.y, null, null, tx, ty));
                }
            }, 1200);

        } else if (abi.type === 'rapid') {
            // Volley Fire – 3 rapid shots in tight spread
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    playSound('musket', 0.65, 0.1);
                    const spread = (i - 1) * 0.12;
                    state.bullets.push(new Bullet(
                        this.container.x + Math.cos(this.container.rotation) * 35,
                        this.container.y + Math.sin(this.container.rotation) * 35,
                        this.container.rotation + spread, 22, 75, 110, state.player));
                }, i * 90);
            }
        } else if (abi.type === 'smoke') {
            // Field Smoke – light a cigarette and heal slowly while puffing
            this.smokeDuration  = this.smokeTotal;
            this.smokePuffTimer = 0;
            showFloatText(this.container.x, this.container.y, "*lights cigarette*", 0xdddddd);
        }

        abi.current = abi.cooldown;
        if (state.ui) state.ui.update();
    }

    fire() {
        if (this.fireCooldown > 0 || this.isReloading) return;
        const w = this.weapons[this.currentWeaponIndex];
        if (w.mag <= 0 && w.type !== 'melee') {
            if (w.reserve > 0) {
                playSound('empty', 0.6, 0.04);
                this.reload();
            } else {
                playSound('empty', 0.6, 0.04);
            }
            return;
        }
        if (w.type !== 'melee') w.mag--;
        this.fireCooldown = w.cooldown;

        if (w.type === 'bullet') {
            state.bullets.push(new Bullet(
                this.container.x + Math.cos(this.container.rotation) * 35,
                this.container.y + Math.sin(this.container.rotation) * 35,
                this.container.rotation, w.speed, w.damage, 105, state.player));
            spawnMuzzleFlash(
                this.container.x + Math.cos(this.container.rotation) * 38,
                this.container.y + Math.sin(this.container.rotation) * 38,
                this.container.rotation,
                w.category === 'rifle' ? 1.2 : 0.8);
            state.shake = 3;
            if (w.category === 'pistol') {
                playSound('flintlock', 0.7, 0.12);
            } else if (w.category === 'rifle') {
                playSound('musket', 0.85, 0.08);
            } else {
                playSound('musket', 0.8, 0.1);
            }
        } else if (w.type === 'shotgun') {
            state.shake = 4;
            for (let i = 0; i < w.pellets; i++) {
                const spread = (i - (w.pellets - 1) / 2) * w.spread;
                state.bullets.push(new Bullet(
                    this.container.x + Math.cos(this.container.rotation) * 28,
                    this.container.y + Math.sin(this.container.rotation) * 28,
                    this.container.rotation + spread, w.speed, w.damage, 75, state.player));
            }
            spawnMuzzleFlash(
                this.container.x + Math.cos(this.container.rotation) * 30,
                this.container.y + Math.sin(this.container.rotation) * 30,
                this.container.rotation, 1.6);
            playSound('musket', 0.95, 0.06);
        } else if (w.type === 'grenade') {
            state.grenades.push(new Grenade(
                this.container.x + Math.cos(this.container.rotation) * 22,
                this.container.y + Math.sin(this.container.rotation) * 22,
                this.container.rotation, w.speed, null, null, w.longRange));
        } else if (w.type === 'melee') {
            playSound('sword', 0.75, 0.15);
            this.meleeRef = new SwordSwing(this);
            state.enemies.forEach(e => {
                const dx = e.container.x - this.container.x;
                const dy = e.container.y - this.container.y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(dy, dx);
                const diff  = Math.abs(angle - this.container.rotation);
                if (d < 65 && (diff < 1.1 || diff > Math.PI*2 - 1.1)) {
                    e.takeDamage(w.damage);
                }
            });
        }
        if (state.ui) state.ui.update();
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        applyBleed(this, dmg);
    }

    update(delta) {
        if (this.fireCooldown > 0) this.fireCooldown -= delta;
        this.abilities.forEach(a => { if (a.current > 0) a.current -= delta; });

        // Bleeding tick — small DOT after taking damage, lasts a few seconds
        if (this.bleedDuration > 0) {
            this.bleedDuration -= delta;
            this.bleedTickTimer -= delta;
            if (this.bleedTickTimer <= 0) {
                this.hp -= this.bleedDmgPerTick;
                spawnBleedDrip(this.container.x, this.container.y);
                this.bleedTickTimer = 30;
            }
            if (this.bleedDuration <= 0) {
                this.bleedDuration = 0;
                this.bleedDmgPerTick = 0;
            }
        }

        // Field Smoke: light a cigarette — heal slowly and emit small puffs
        if (this.smokeDuration > 0) {
            this.smokeDuration -= delta;
            this.hp = Math.min(this.maxHp, this.hp + this.smokeHealRate * delta);
            this.smokePuffTimer -= delta;
            if (this.smokePuffTimer <= 0) {
                // Emit from the mouth, slightly forward in the facing direction
                const cx = this.container.x + Math.cos(this.container.rotation) * 10;
                const cy = this.container.y + Math.sin(this.container.rotation) * 10 - 12;
                spawnSmokePuff(cx, cy, 1);
                this.smokePuffTimer = 1.5;
            }
            if (this.smokeDuration <= 0) {
                this.smokeDuration = 0;
                showFloatText(this.container.x, this.container.y, "+Healed", 0x88ff88);
            }
        }

        if (this.isReloading) {
            this.reloadTimer -= delta;
            if (this.reloadTimer <= 0) {
                const w = this.weapons[this.currentWeaponIndex];
                const needed = w.magSize - w.mag;
                const take   = Math.min(needed, w.reserve);
                w.mag += take; w.reserve -= take;
                this.isReloading = false;
                if (state.ui) state.ui.update();
            }
        }

        if (this.meleeRef && !this.meleeRef.update(delta)) this.meleeRef = null;

        // Loot progress (hold G near body, ~1.5s)
        if (this.lootTarget) {
            const d = dist(this.container.x, this.container.y, this.lootTarget.x, this.lootTarget.y);
            if (d > 80 || !state.keys['KeyG']) {
                this.lootTarget = null; this.lootProgress = 0;
            } else {
                this.lootProgress += delta;
                if (this.lootProgress >= 90) {
                    this.lootTarget.loot();
                    const idx = state.lootBodies.indexOf(this.lootTarget);
                    if (idx !== -1) state.lootBodies.splice(idx, 1);
                    this.lootTarget = null; this.lootProgress = 0;
                }
            }
        }

        // Aim at mouse
        const mouse = app.renderer.events.pointer.global;
        const tx = mouse.x - worldContainer.x;
        const ty = mouse.y - worldContainer.y;
        this.container.rotation = Math.atan2(ty - this.container.y, tx - this.container.x);

        // Speed modifiers
        let speed = this.baseSpeed;
        if (this.isReloading && this.weapons[this.currentWeaponIndex].immobileReload) speed *= 0.25; // slow but not stopped
        if (this.lootTarget) speed *= 0.3; // slow while looting
        let inWheat = false;
        state.terrain.forEach(t => {
            if (t.type === 'wheat' &&
                this.container.x > t.x && this.container.x < t.x+t.w &&
                this.container.y > t.y && this.container.y < t.y+t.h) inWheat = true;
        });
        if (inWheat) speed *= 0.6;
        const inBush = isInBush(this.container.x, this.container.y);
        if (inBush) { speed *= 0.75; this.container.alpha = 0.55; }
        else { this.container.alpha = 1.0; }
        if (state.keys['ShiftLeft']) speed *= 1.4;
        if (state.keys['KeyC'])      speed *= 0.45;

        // Movement
        let mvX = 0, mvY = 0;
        if (state.keys['KeyW']) mvY -= 1;
        if (state.keys['KeyS']) mvY += 1;
        if (state.keys['KeyA']) mvX -= 1;
        if (state.keys['KeyD']) mvX += 1;

        if (mvX !== 0 || mvY !== 0) {
            const len = Math.sqrt(mvX*mvX + mvY*mvY);
            const nx = this.container.x + (mvX/len)*speed*delta;
            const ny = this.container.y + (mvY/len)*speed*delta;
            if (!checkTerrainCollision(nx, this.container.y)) this.container.x = nx;
            if (!checkTerrainCollision(this.container.x, ny)) this.container.y = ny;
        }

        this.container.x = Math.max(20, Math.min(state.world.width  - 20, this.container.x));
        this.container.y = Math.max(20, Math.min(state.world.height - 20, this.container.y));

        // Last-stand slow-mo at sub-10%
        const frac = this.hp / this.maxHp;
        app.ticker.speed = frac < 0.1 ? 0.45 : 1;

        if (this.hp <= 0) {
            app.ticker.speed = 1;
            state.gameStarted = false;
            state.shake = 30;
            playSound('death', 1.0);
            state.ui.showDeathScreen(state.score);
        }
    }
}

// ─── Enemy ────────────────────────────────────────────────────────────────────
class Enemy {
    constructor(x, y, type = 'infantry') {
        this.type = type;  // 'infantry' | 'sharpshooter' | 'officer'
        this.container = new PIXI.Container();
        this.container.x = x; this.container.y = y;
        this.stunned = 0;
        this.body = new PIXI.Container();
        this.sprite = null;
        this.lastBayonetDamage = 0;

        // Stats by type
        if (type === 'sharpshooter') {
            this.hp = 65; this.maxHp = 65;
            this.speed = 0.6 + Math.random() * 0.4;
            this.fireRange = 500; this.fireCooldown = 200; this.fireCooldownBase = 200;
            this.damage = 22; this.bulletSpeed = 18;
        } else if (type === 'officer') {
            this.hp = 130; this.maxHp = 130;
            this.speed = 1.2 + Math.random() * 0.5;
            this.fireRange = 320; this.fireCooldown = 80; this.fireCooldownBase = 80;
            this.damage = 12; this.bulletSpeed = 11;
            this.auraRadius = 180;
        } else {                                   // infantry
            this.hp = 80; this.maxHp = 80;
            this.speed = 1.2 + Math.random() * 0.9;
            this.fireRange = 370; this.fireCooldown = 300; this.fireCooldownBase = 300;
            this.damage = 14; this.bulletSpeed = 11;
        }

        this.draw();
        this.container.addChild(this.body);

        // HP bar
        this.hpBar = new PIXI.Graphics();
        this.container.addChild(this.hpBar);

        worldContainer.addChild(this.container);
    }

    draw() {
        this.body.removeChildren();

        if (this.type === 'infantry') {
            const tex = textures[CONFED_SOLDIER_SPRITE];
            if (tex && tex.valid) {
                const spr = new PIXI.Sprite(tex);
                spr.anchor.set(0.5);
                const scale = 86 / Math.max(spr.texture.width, spr.texture.height);
                spr.scale.set(scale);
                this.body.addChild(spr);
                this.sprite = spr;
                return;
            }
        }

        const g = new PIXI.Graphics();
        if (this.type === 'officer') {
            g.beginFill(0x8a5c2a); g.lineStyle(3, 0xffcc44); g.drawCircle(0, 0, 18); g.endFill();
        } else if (this.type === 'sharpshooter') {
            g.beginFill(0x555555); g.lineStyle(2, 0x222222); g.drawCircle(0, 0, 14); g.endFill();
        } else {
            g.beginFill(0x7a7a7a); g.lineStyle(2, 0x333333); g.drawCircle(0, 0, 15); g.endFill();
        }
        // Weapon barrel line
        g.lineStyle(3, 0x4a3728);
        g.moveTo(0, 0);
        g.lineTo(this.type === 'sharpshooter' ? 32 : 22, 0);
        this.body.addChild(g);
    }

    drawHpBar() {
        this.hpBar.clear();
        if (this.hp >= this.maxHp) return;
        const w = 30; const h = 4;
        this.hpBar.beginFill(0x330000); this.hpBar.drawRect(-w/2, -26, w, h); this.hpBar.endFill();
        this.hpBar.beginFill(0xaa0000); this.hpBar.drawRect(-w/2, -26, w * (this.hp / this.maxHp), h); this.hpBar.endFill();
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        spawnBloodSplatter(this.container.x, this.container.y, 18, { spread: Math.PI * 1.2 });
        applyBleed(this, dmg);
    }

    update(delta) {
        if (this.stunned > 0) { this.stunned -= delta; this.drawHpBar(); return this.hp > 0; }

        // Bleeding tick — DOT after being damaged
        if (this.bleedDuration && this.bleedDuration > 0) {
            this.bleedDuration -= delta;
            this.bleedTickTimer -= delta;
            if (this.bleedTickTimer <= 0) {
                this.hp -= this.bleedDmgPerTick;
                spawnBleedDrip(this.container.x, this.container.y);
                this.bleedTickTimer = 30;
                if (this.hp <= 0) { this.die && this.die(); return false; }
            }
            if (this.bleedDuration <= 0) {
                this.bleedDuration = 0;
                this.bleedDmgPerTick = 0;
            }
        }

        // Confederate infantry shoot every 5 seconds
        if (this.type === 'infantry') {
            this.fireCooldownBase = 300;
        }

        // Bush stealth: if player is in a bush, enemies lose sight at range > 300
        const playerHidden = isInBush(state.player.container.x, state.player.container.y);
        const dx = state.player.container.x - this.container.x;
        const dy = state.player.container.y - this.container.y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        const effectiveRange = playerHidden ? Math.min(this.fireRange,120
        ) : this.fireRange;

        this.container.rotation = Math.atan2(dy, dx);

        // Officer aura buffs nearby enemies
        if (this.type === 'officer') {
            state.enemies.forEach(e => {
                if (e !== this && dist(e.container.x, e.container.y, this.container.x, this.container.y) < this.auraRadius) {
                    e.fireCooldownBase = Math.max(60, e.fireCooldownBase - 0.02 * delta);
                    e.speed = Math.min(e.speed + 0.001 * delta, 2.5);
                }
            });
        }

        // AI state machine
        if (!this.aiState) this.aiState = 'advance';
        if (!this.aiTimer)  this.aiTimer  = 0;
        this.aiTimer -= delta;

        // Suppression: if recently shot at (stunned briefly), hunker
        const lowHp = this.hp / this.maxHp < 0.4;

        if (lowHp && this.aiState !== 'retreat' && Math.random() < 0.003 * delta) {
            this.aiState = 'retreat';
            this.aiTimer = 120 + Math.random() * 90;
        }

        if (d <= effectiveRange) {
            // Can see/reach player
            if (this.aiState === 'advance') {
                // Decide: flank, suppress, or hold
                const roll = Math.random();
                if (roll < 0.35 && this.aiTimer <= 0) {
                    this.aiState = 'flank';
                    this.flankDir = (Math.random() < 0.5) ? 1 : -1;
                    this.aiTimer = 90 + Math.random() * 80;
                } else if (roll < 0.65 && this.aiTimer <= 0) {
                    this.aiState = 'suppress';
                    this.aiTimer = 60 + Math.random() * 60;
                }
            }

            // Bayonet attack when the infantry gets close
            if (this.type === 'infantry' && d < 30 && Date.now() - this.lastBayonetDamage > 500) {
                playSound('sword', 0.4, 0.2);
                state.player.takeDamage(18);
                state.shake = 6;
                spawnBloodSplatter(state.player.container.x, state.player.container.y, 40, { spread: Math.PI * 1.4 });
                this.lastBayonetDamage = Date.now();
            }

            // Always try to fire when in range and not retreating
            if (this.aiState !== 'retreat' && d >= 30) {
                this.fireCooldown -= delta;
                if (this.fireCooldown <= 0) {
                    // Confederate musket SFX
                    playSound('musket', 0.45 + Math.random()*0.2, 0.15);
                    const spread = this.type === 'sharpshooter' ? 0.03 : (Math.random()-0.5)*0.28;
                    state.bullets.push(new Bullet(
                        this.container.x, this.container.y,
                        this.container.rotation + spread,
                        this.bulletSpeed, this.damage, 120, this));
                    this.fireCooldown = this.fireCooldownBase + Math.random()*60;
                }
            }
        }

        // Movement by AI state
        let mvX = 0, mvY = 0;
        if (this.aiState === 'advance' && d > effectiveRange * 0.6) {
            mvX = dx / d; mvY = dy / d;
        } else if (this.aiState === 'flank') {
            // Move perpendicular to player direction
            const perp = { x: -dy/d, y: dx/d };
            mvX = (dx/d) * 0.4 + perp.x * this.flankDir * 0.9;
            mvY = (dy/d) * 0.4 + perp.y * this.flankDir * 0.9;
            if (this.aiTimer <= 0) { this.aiState = 'advance'; this.aiTimer = 60; }
        } else if (this.aiState === 'suppress') {
            // Strafe slightly while firing
            const perp = { x: -dy/d, y: dx/d };
            mvX = perp.x * (Math.sin(Date.now()*0.003) > 0 ? 1 : -1) * 0.5;
            mvY = perp.y * (Math.sin(Date.now()*0.003) > 0 ? 1 : -1) * 0.5;
            if (this.aiTimer <= 0) { this.aiState = 'advance'; this.aiTimer = 40; }
        } else if (this.aiState === 'retreat') {
            mvX = -(dx / Math.max(d,1)); mvY = -(dy / Math.max(d,1));
            if (this.aiTimer <= 0 || d > this.fireRange * 1.5) { this.aiState = 'advance'; this.aiTimer = 60; }
        }

        if (mvX !== 0 || mvY !== 0) {
            const len = Math.sqrt(mvX*mvX + mvY*mvY) || 1;
            const nx = this.container.x + (mvX/len)*this.speed*delta;
            const ny = this.container.y + (mvY/len)*this.speed*delta;
            if (!checkTerrainCollision(nx, this.container.y)) this.container.x = nx;
            if (!checkTerrainCollision(this.container.x, ny)) this.container.y = ny;
        }

        this.container.x = Math.max(10, Math.min(state.world.width-10,  this.container.x));
        this.container.y = Math.max(10, Math.min(state.world.height-10, this.container.y));

        this.drawHpBar();

        if (this.hp <= 0) {
            this.die();
            state.score += this.type === 'officer' ? 300 : (this.type === 'sharpshooter' ? 200 : 100);
            return false;
        }
        return true;
    }

    die() {
        playSound('death', 0.5 + Math.random()*0.3, 0.2);
        spawnBloodSplatter(this.container.x, this.container.y, 80, { spread: Math.PI * 1.7 });
        worldContainer.removeChild(this.container);
        // Spawn loot body
        const body = new LootBody(this.container.x, this.container.y);
        state.lootBodies.push(body);
    }
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
class HUD {
    constructor() {
        this.c = uiContainer;

        this.bar        = new PIXI.Graphics(); this.c.addChild(this.bar);
        this.healthFill = new PIXI.Graphics(); this.c.addChild(this.healthFill);
        this.lootBar    = new PIXI.Graphics(); this.c.addChild(this.lootBar);

        const tStyle = (sz, col) => ({ fontFamily: 'Georgia, serif', fontSize: sz, fill: col, stroke: 0x000000, strokeThickness: 3 });

        this.weaponText  = new PIXI.Text("", tStyle(22, 0xffffff)); this.c.addChild(this.weaponText);
        this.abilityText = new PIXI.Text("", tStyle(17, 0xaaccff)); this.c.addChild(this.abilityText);
        this.waveText    = new PIXI.Text("", { fontFamily:'Georgia,serif', fontSize:18, fill:0xffffff, fontWeight:'bold' });
        this.waveText.anchor.set(0); this.c.addChild(this.waveText);
        this.historyText = new PIXI.Text("", { fontFamily:'Georgia,serif', fontSize:16, fill:0xdcd0b0, stroke:0x000000, strokeThickness:2, wordWrap:true, wordWrapWidth: 360 });
        this.historyText.anchor.set(0); this.c.addChild(this.historyText);
        this.objText     = new PIXI.Text("", tStyle(20, 0xffff44));
        this.objText.anchor.set(0); this.c.addChild(this.objText);
        this.reloadHint  = new PIXI.Text("— RELOADING —", { fontFamily:'Arial', fontSize:28, fill:0xffff00, fontWeight:'bold', stroke:0x000000, strokeThickness:4 });
        this.reloadHint.anchor.set(0.5); this.reloadHint.visible = false; this.c.addChild(this.reloadHint);
        this.lootHint    = new PIXI.Text("", tStyle(16, 0xffee22));
        this.lootHint.anchor.set(0.5); this.c.addChild(this.lootHint);

        this.weaponSelectOverlay = new PIXI.Graphics();
        this.weaponSelectOverlay.alpha = 0.68;
        this.weaponSelectOverlay.interactive = false;
        this.weaponSelectOverlay.visible = false;
        this.c.addChild(this.weaponSelectOverlay);

        this.weaponSelect = new PIXI.Container();
        this.weaponSelectBg = new PIXI.Graphics();
        this.weaponSelect.addChild(this.weaponSelectBg);
        this.weaponSelectLabel = new PIXI.Text("SELECT ONE PISTOL AND ONE RIFLE", tStyle(18, 0xffffff));
        this.weaponSelectLabel.anchor.set(0.5);
        this.weaponSelectLabel.y = 34;
        this.weaponSelect.addChild(this.weaponSelectLabel);

        this.weaponSelectBlur = (PIXI.filters && PIXI.filters.BlurFilter) ? new PIXI.filters.BlurFilter(6) : null;

        const titleStyle = { fontFamily: 'Georgia, serif', fontSize: 16, fill: 0xaaccff, stroke: 0x000000, strokeThickness: 3 };
        const pistolHeader = new PIXI.Text("PISTOLS", titleStyle);
        pistolHeader.anchor.set(0.5); pistolHeader.x = 0; pistolHeader.y = 70; this.weaponSelect.addChild(pistolHeader);
        const rifleHeader = new PIXI.Text("RIFLES", titleStyle);
        rifleHeader.anchor.set(0.5); rifleHeader.x = 0; rifleHeader.y = 140; this.weaponSelect.addChild(rifleHeader);

        this.weaponButtons = [];
        const selectableIndices = [1, 2, 6, 0, 5, 7, 8];
        selectableIndices.forEach((weaponIdx, index) => {
            const btn = new PIXI.Container();
            const btnBg = new PIXI.Graphics();
            btn.addChild(btnBg);

            const label = new PIXI.Text("", { fontFamily:'Georgia,serif', fontSize:14, fill:0xffffff, stroke:0x000000, strokeThickness:3, wordWrap:true, wordWrapWidth: 300 });
            label.anchor.set(0.5); label.y = -4;
            btn.addChild(label);

            const note = new PIXI.Text("", { fontFamily:'Arial', fontSize:12, fill:0xcccccc });
            note.anchor.set(0.5); note.y = 22;
            btn.addChild(note);

            const pistolCount = 3;
            if (index < pistolCount) {
                btn.x = (index - 1) * 280;
                btn.y = 100;
            } else {
                const itemInRow = index - pistolCount;
                btn.x = itemInRow * 225 - 345;
                btn.y = 190;
            }
            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            btn.on('pointerdown', () => {
                if (!state.player) return;
                const weapon = state.player.weapons[weaponIdx];
                if (!weapon || !weapon.available) return;
                if (weapon.category === 'utility' || weapon.category === 'melee') return;

                const sameCategory = state.player.weapons.filter(w => w.category === weapon.category && w.available);
                sameCategory.forEach(w => { if (w !== weapon) w.active = false; });
                weapon.active = true;

                if (!state.player.weapons[state.player.currentWeaponIndex].active) {
                    const active = state.player.getActiveWeaponIndices();
                    state.player.switchWeapon(active[0] || state.player.currentWeaponIndex);
                }
                this.refreshWeaponButtons();
            });

            this.weaponButtons.push({ btn, bg: btnBg, label, note, weaponIdx });
            this.weaponSelect.addChild(btn);
        });

        this.weaponDoneButton = new PIXI.Container();
        this.weaponDoneButtonBg = new PIXI.Graphics();
        this.weaponDoneButton.addChild(this.weaponDoneButtonBg);
        this.weaponDoneButtonText = new PIXI.Text("DONE", { fontFamily:'Georgia, serif', fontSize:16, fill:0xffffff, stroke:0x000000, strokeThickness:3 });
        this.weaponDoneButtonText.anchor.set(0.5);
        this.weaponDoneButton.addChild(this.weaponDoneButtonText);
        this.weaponDoneButton.y = 270;
        this.weaponDoneButton.eventMode = 'static';
        this.weaponDoneButton.cursor = 'pointer';
        this.weaponDoneButton.on('pointerdown', () => {
            if (!state.gameStarted) return;
            state.waveCountdown = 0;
            if (!state.isWaveActive) spawnWave();
        });
        this.weaponDoneButton.on('pointerover', () => { this.weaponDoneButtonBg.tint = 0xbbddff; });
        this.weaponDoneButton.on('pointerout', () => { this.weaponDoneButtonBg.tint = 0xffffff; });
        this.weaponSelect.addChild(this.weaponDoneButton);

        this.c.addChild(this.weaponSelect);

        this.hintText = new PIXI.Text("", { fontFamily:'Arial', fontSize:12, fill:0xbbbbbb });
        this.c.addChild(this.hintText);

        this._buildMenu();
        this._buildDeathScreen();
        this.resize();
        this.hintText.text = "ESC: Pause";
    }

    _buildMenu() {
        this.menu = new PIXI.Container();
        const overlay = new PIXI.Graphics();
        overlay.beginFill(0x000000, 0.88); overlay.drawRect(0, 0, window.innerWidth, window.innerHeight);
        this.menu.addChild(overlay);

        const title = new PIXI.Text("THREE DAYS AT GETTYSBURG", {
            fontFamily:'Georgia,serif', fontSize:50, fill:0xddddcc, fontWeight:'bold'
        });
        title.anchor.set(0.5); title.x = window.innerWidth/2; title.y = window.innerHeight/2 - 170;
        this.menu.addChild(title);

        this.menuSubText = new PIXI.Text("Fight for the Union · Day 1 of 3", {
            fontFamily:'Georgia,serif', fontSize:22, fill:0x8888aa, fontStyle:'italic'
        });
        this.menuSubText.anchor.set(0.5); this.menuSubText.x = window.innerWidth/2; this.menuSubText.y = window.innerHeight/2 - 115;
        this.menu.addChild(this.menuSubText);

        const info = new PIXI.Text("Pick one pistol and one rifle for the next wave. Grenades stay available.", {
            fontFamily:'Georgia,serif', fontSize:18, fill:0xccccee
        });
        info.anchor.set(0.5); info.x = window.innerWidth/2; info.y = window.innerHeight/2 - 65;
        this.menu.addChild(info);

        const historyInfo = new PIXI.Text(
            "Historic weapons: Springfield musket, Colt 1860 Army revolver,\nSpencer repeating rifle. Objectives reflect Gettysburg 1863.",
            { fontFamily:'Arial', fontSize:16, fill:0xbbbbbb, align:'center', wordWrap:true, wordWrapWidth:560 }
        );
        historyInfo.anchor.set(0.5); historyInfo.x = window.innerWidth/2; historyInfo.y = window.innerHeight/2 - 20;
        this.menu.addChild(historyInfo);

        const endlessBtn = new PIXI.Container();
        const endlessBg  = new PIXI.Graphics();
        endlessBg.beginFill(0x2b3d5b); endlessBg.drawRoundedRect(-170, -28, 340, 56, 14);
        endlessBtn.eventMode = 'static'; endlessBtn.cursor = 'pointer'; endlessBtn.addChild(endlessBg);
        this.endlessLabel = new PIXI.Text("ENDLESS MODE: OFF", { fontSize:18, fill:0xffffff, fontFamily:'Georgia,serif' });
        this.endlessLabel.anchor.set(0.5);
        endlessBtn.addChild(this.endlessLabel);
        endlessBtn.x = window.innerWidth/2; endlessBtn.y = window.innerHeight/2 + 40;
        endlessBtn.on('pointerover', () => { endlessBg.tint = 0xbbddff; });
        endlessBtn.on('pointerout',  () => { endlessBg.tint = 0xffffff; });
        endlessBtn.on('pointerdown', () => {
            state.endlessMode = !state.endlessMode;
            this.endlessLabel.text = state.endlessMode ? "ENDLESS MODE: ON" : "ENDLESS MODE: OFF";
            this.menuSubText.text = state.endlessMode ? "Fight forever: Day 3 never ends." : "Fight for the Union · Day 1 of 3";
        });
        this.menu.addChild(endlessBtn);

        const btn = new PIXI.Container();
        const bg  = new PIXI.Graphics();
        bg.beginFill(0x2b3d5b); bg.drawRoundedRect(-170, -40, 340, 80, 18);
        btn.eventMode = 'static'; btn.cursor = 'pointer'; btn.addChild(bg);
        const bt = new PIXI.Text("⚔  DEPLOY WITH THE UNION", { fontSize:20, fill:0xffffff, fontFamily:'Georgia,serif', lineHeight:22, align:'center' });
        bt.anchor.set(0.5); btn.addChild(bt);
        btn.x = window.innerWidth/2; btn.y = window.innerHeight/2 + 230;
        btn.on('pointerover', () => { bg.tint = 0xbbddff; });
        btn.on('pointerout',  () => { bg.tint = 0xffffff; });
        btn.on('pointerdown', () => startGame());
        this.menu.addChild(btn);

        // ── MULTIPLAYER button ───────────────────────────────────────────────
        const mpBtn = new PIXI.Container();
        const mpBg  = new PIXI.Graphics();
        mpBg.beginFill(0x6b0f0f); mpBg.drawRoundedRect(-170, -34, 340, 68, 16);
        mpBg.beginFill(0x9b2020, 0.5); mpBg.drawRoundedRect(-168, -32, 336, 32, 14);
        mpBtn.addChild(mpBg);
        const mpLabel = new PIXI.Text('⚔  MULTIPLAYER', { fontFamily:'Georgia,serif', fontSize:22, fill:0xffffff, fontWeight:'bold', stroke:0x000000, strokeThickness:3 });
        mpLabel.anchor.set(0.5); mpLabel.y = -8;
        mpBtn.addChild(mpLabel);
        const mpSub = new PIXI.Text('Local · Online · PvP · Co-op', { fontFamily:'Georgia,serif', fontSize:12, fill:0xffcccc, fontStyle:'italic' });
        mpSub.anchor.set(0.5); mpSub.y = 16;
        mpBtn.addChild(mpSub);
        mpBtn.x = window.innerWidth/2; mpBtn.y = window.innerHeight/2 + 135;
        mpBtn.eventMode = 'static'; mpBtn.cursor = 'pointer';
        mpBtn.on('pointerover', () => { mpBg.tint = 0xffcccc; });
        mpBtn.on('pointerout',  () => { mpBg.tint = 0xffffff; });
        mpBtn.on('pointerdown', () => { if (window.openMultiplayerLobby) window.openMultiplayerLobby(); });
        this.menu.addChild(mpBtn);
        // Expose reference so multiplayer.js can update it if needed
        this.mpMenuBtn = mpBtn;

        this.c.addChild(this.menu);
    }

    _buildDeathScreen() {
        this.deathScreen = new PIXI.Container();
        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.92); ov.drawRect(0, 0, window.innerWidth, window.innerHeight);
        this.deathScreen.addChild(ov);
        this.deathTitle = new PIXI.Text("FALLEN IN BATTLE", {
            fontFamily:'Georgia,serif', fontSize:64, fill:0xaa0000, fontWeight:'bold'
        });
        this.deathTitle.anchor.set(0.5); this.deathTitle.x = window.innerWidth/2; this.deathTitle.y = window.innerHeight/2 - 100;
        this.deathScreen.addChild(this.deathTitle);
        this.scoreText = new PIXI.Text("", { fontFamily:'Georgia,serif', fontSize:32, fill:0xffffff });
        this.scoreText.anchor.set(0.5); this.scoreText.x = window.innerWidth/2; this.scoreText.y = window.innerHeight/2;
        this.deathScreen.addChild(this.scoreText);
        const retryBtn = new PIXI.Container();
        const rb = new PIXI.Graphics();
        rb.beginFill(0x444444); rb.drawRoundedRect(-100, -28, 200, 56, 10);
        retryBtn.eventMode = 'static'; retryBtn.cursor = 'pointer'; retryBtn.addChild(rb);
        const rt = new PIXI.Text("RETRY", { fontSize:26, fill:0xffffff, fontFamily:'Georgia,serif' });
        rt.anchor.set(0.5); retryBtn.addChild(rt);
        retryBtn.x = window.innerWidth/2; retryBtn.y = window.innerHeight/2 + 100;
        retryBtn.on('pointerdown', () => location.reload());
        this.deathScreen.addChild(retryBtn);
        this.deathScreen.visible = false;
        this.c.addChild(this.deathScreen);
        this._buildPauseMenu();
    }

    _buildPauseMenu() {
        this.pauseMenu = new PIXI.Container();
        const overlay = new PIXI.Graphics();
        overlay.beginFill(0x000000, 0.8).drawRect(0, 0, window.innerWidth, window.innerHeight);
        this.pauseMenu.addChild(overlay);

        const title = new PIXI.Text("PAUSED", {
            fontFamily:'Georgia,serif', fontSize:62, fill:0xffffff, stroke:0x000000, strokeThickness:6
        });
        title.anchor.set(0.5);
        title.x = window.innerWidth/2; title.y = 120;
        this.pauseMenu.addChild(title);

        const subtitle = new PIXI.Text("Press ESC to resume or use the menu below", {
            fontFamily:'Georgia,serif', fontSize:18, fill:0xccddff, stroke:0x000000, strokeThickness:3
        });
        subtitle.anchor.set(0.5);
        subtitle.x = window.innerWidth/2; subtitle.y = 170;
        this.pauseMenu.addChild(subtitle);

        const makeButton = (label, y) => {
            const btn = new PIXI.Container();
            const bg  = new PIXI.Graphics();
            bg.beginFill(0x2b3d5b); bg.drawRoundedRect(-150, -28, 300, 56, 14);
            btn.addChild(bg);
            const text = new PIXI.Text(label, { fontFamily:'Georgia,serif', fontSize:24, fill:0xffffff });
            text.anchor.set(0.5); btn.addChild(text);
            btn.eventMode = 'static'; btn.cursor = 'pointer';
            btn.x = window.innerWidth/2; btn.y = y;
            btn.bg = bg; btn.label = text;
            btn.on('pointerover', () => { bg.tint = 0xbbddff; });
            btn.on('pointerout',  () => { bg.tint = 0xffffff; });
            return btn;
        };

        const resumeBtn = makeButton("RESUME", window.innerHeight/2 - 30);
        resumeBtn.on('pointerdown', () => this.closePauseMenu());
        this.pauseMenu.addChild(resumeBtn);

        const optionsBtn = makeButton("OPTIONS", window.innerHeight/2 + 50);
        optionsBtn.on('pointerdown', () => this.showOptionsMenu());
        this.pauseMenu.addChild(optionsBtn);

        const quitBtn = makeButton("QUIT TO DESKTOP", window.innerHeight/2 + 130);
        quitBtn.on('pointerdown', () => location.reload());
        this.pauseMenu.addChild(quitBtn);

        this.pauseMenu.visible = false;
        this.c.addChild(this.pauseMenu);

        this.optionsMenu = new PIXI.Container();
        const overlay2 = new PIXI.Graphics();
        overlay2.beginFill(0x000000, 0.9).drawRect(0, 0, window.innerWidth, window.innerHeight);
        this.optionsMenu.addChild(overlay2);

        const optTitle = new PIXI.Text("OPTIONS", {
            fontFamily:'Georgia,serif', fontSize:52, fill:0xffffff, stroke:0x000000, strokeThickness:6
        });
        optTitle.anchor.set(0.5);
        optTitle.x = window.innerWidth/2; optTitle.y = 120;
        this.optionsMenu.addChild(optTitle);

        const soundBtn = makeButton(`Sound: ${state.soundEnabled ? 'ON' : 'OFF'}`, window.innerHeight/2 - 20);
        soundBtn.on('pointerdown', () => {
            state.soundEnabled = !state.soundEnabled;
            soundBtn.label.text = `Sound: ${state.soundEnabled ? 'ON' : 'OFF'}`;
        });
        this.optionsMenu.addChild(soundBtn);

        const gridBtn = makeButton(`Grid: ${state.showGrid ? 'ON' : 'OFF'}`, window.innerHeight/2 + 60);
        gridBtn.on('pointerdown', () => {
            state.showGrid = !state.showGrid;
            gridBtn.label.text = `Grid: ${state.showGrid ? 'ON' : 'OFF'}`;
        });
        this.optionsMenu.addChild(gridBtn);

        const backBtn = makeButton("BACK", window.innerHeight/2 + 140);
        backBtn.on('pointerdown', () => this.showPauseMenu());
        this.optionsMenu.addChild(backBtn);

        this.optionsMenu.visible = false;
        this.c.addChild(this.optionsMenu);
    }

    showPauseMenu() {
        state.paused = true;
        this.pauseMenu.visible = true;
        this.optionsMenu.visible = false;
        this.hintText.text = "ESC: Resume";
    }

    closePauseMenu() {
        state.paused = false;
        this.pauseMenu.visible = false;
        this.optionsMenu.visible = false;
        this.hintText.text = "ESC: Pause";
    }

    openPauseMenu() {
        this.showPauseMenu();
    }

    showOptionsMenu() {
        state.paused = true;
        this.pauseMenu.visible = false;
        this.optionsMenu.visible = true;
        this.hintText.text = "ESC: Back";
    }

    update() {
        if (!state.player || state.player.hp <= 0) return;
        const p  = state.player;
        const hw = window.innerWidth;
        const hh = window.innerHeight;

        // Bottom bar background
        this.bar.clear();
        this.bar.beginFill(0x000000, 0.65);
        this.bar.drawRect(hw/2 - 310, hh - 95, 620, 86);

        // HP bar
        this.healthFill.clear();
        this.healthFill.beginFill(0x330000); this.healthFill.drawRect(hw/2 - 290, hh - 38, 580, 22); this.healthFill.endFill();
        this.healthFill.beginFill(0xaa0000); this.healthFill.drawRect(hw/2 - 290, hh - 38, (p.hp / p.maxHp) * 580, 22); this.healthFill.endFill();

        // Loot progress bar
        this.lootBar.clear();
        if (p.lootTarget && p.lootProgress > 0) {
            this.lootBar.beginFill(0xffee22, 0.9);
            this.lootBar.drawRect(hw/2 - 100, hh - 180, (p.lootProgress / 90) * 200, 10);
        }

        // Weapon text
        const w = p.weapons[p.currentWeaponIndex];
        const ammo = w.type === 'grenade' ? `${w.mag} grenades` : (w.type === 'melee' ? '∞' : `${w.mag} / ${w.reserve}`);
        const slotNumber = w.category === 'rifle' ? 1 : w.category === 'pistol' ? 2 : (p.currentWeaponIndex + 1);
        this.weaponText.text  = `[${slotNumber}] ${w.name.toUpperCase()}  —  ${ammo}`;
        this.weaponText.x     = hw/2 - 290; this.weaponText.y = hh - 84;

        // Ability text
        const abiStr = p.abilities.map((a, i) => {
            const key = ['Q','E','F'][i];
            const cd  = a.current > 0 ? `${Math.ceil(a.current/60)}s` : '✓';
            return `${key}:${a.name.split(' ')[0]} ${cd}`;
        }).join('  |  ');
        this.abilityText.text = abiStr;
        this.abilityText.x = hw/2 - 290; this.abilityText.y = hh - 58;

        // Wave/objective info
        if (state.waveCountdown > 0) {
            this.waveText.text = `DAY ${state.act}  ·  WAVE ${state.wave + 1} IN ${Math.ceil(state.waveCountdown/60)}s`;
        } else if (state.isWaveActive) {
            this.waveText.text = `DAY ${state.act}  ·  WAVE ${state.wave}  ·  ENEMIES: ${state.enemies.length}`;
        } else {
            this.waveText.text = "WAVE COMPLETE — REPOSITIONING…";
        }
        this.waveText.x = 20; this.waveText.y = 20;

        const noteIndex = (state.wave - 1 + state.act - 1) % HISTORY_NOTES.length;
        this.historyText.text = HISTORY_NOTES[noteIndex];
        this.historyText.x = 20;
        this.historyText.y = 44;

        if (state.objective) {
            this.objText.text = `OBJECTIVE: ${state.objective.text}  (${state.objective.completed ? '✓ DONE' : 'INCOMPLETE'})`;
        } else {
            this.objText.text = "";
        }
        this.objText.x = 20; this.objText.y = 48;
        this.historyText.x = 20;
        this.historyText.y = 74;

        this.reloadHint.visible = p.isReloading;
        this.weaponSelect.visible = state.waveCountdown > 0 && state.gameStarted;
        if (this.weaponSelect.visible) {
            this.weaponSelectOverlay.visible = true;
            this.weaponSelectOverlay.clear();
            this.weaponSelectOverlay.beginFill(0x000000, 0.55).drawRect(0, 0, hw, hh);
            if (this.weaponSelectBlur) worldContainer.filters = [this.weaponSelectBlur];
            this.refreshWeaponButtons();
        } else {
            this.weaponSelectOverlay.visible = false;
            if (this.weaponSelectBlur) worldContainer.filters = null;
        }

        // Loot hint
        let nearBody = false;
        for (const b of state.lootBodies) {
            if (dist(p.container.x, p.container.y, b.x, b.y) < 80) { nearBody = true; break; }
        }
        this.lootHint.text    = nearBody && !p.lootTarget ? "Hold G to Loot" : "";
        this.lootHint.x = hw/2; this.lootHint.y = hh - 120;
    }

    resize() {
        this.hintText.x = 10; this.hintText.y = window.innerHeight - 22;
        this.reloadHint.x = window.innerWidth/2; this.reloadHint.y = window.innerHeight - 160;
        this.lootHint.x   = window.innerWidth/2; this.lootHint.y   = window.innerHeight - 120;
        if (this.waveText) { this.waveText.x = 20; this.waveText.y = 20; }
        if (this.objText)  { this.objText.x  = 20; this.objText.y  = 48; }
        if (this.historyText) { this.historyText.x = 20; this.historyText.y = 74; }
        if (this.weaponSelect) {
            this.weaponSelectOverlay.clear();
            this.weaponSelectOverlay.beginFill(0x000000, 0.55).drawRect(0, 0, window.innerWidth, window.innerHeight);
            this.weaponSelectOverlay.visible = this.weaponSelect.visible;
            this.weaponSelectBg.clear();
            this.weaponSelectBg.beginFill(0x000000, 0.92).drawRoundedRect(-590, 0, 1180, 360, 18);
            this.weaponSelect.x = window.innerWidth / 2;
            this.weaponSelect.y = window.innerHeight / 2 - 180;
            this.weaponSelectLabel.x = 0;
            this.weaponDoneButton.x = 0;
            this.weaponDoneButtonText.x = 0;
            this.weaponDoneButtonText.y = 0;
            const doneWidth = this.weaponDoneButtonText.width + 36;
            this.weaponDoneButtonBg.clear();
            this.weaponDoneButtonBg.beginFill(0x2b3d5b); this.weaponDoneButtonBg.drawRoundedRect(-doneWidth / 2, -22, doneWidth, 44, 12);
            this.refreshWeaponButtons();
        }
    }

    refreshWeaponButtons() {
        if (!state.player) return;
        this.weaponButtons.forEach((entry) => {
            const weapon = state.player.weapons[entry.weaponIdx];
            const available = weapon.available;
            const active = weapon.active;
            entry.label.text = weapon.name;
            entry.label.style.fill = active ? 0x99ff99 : (available ? 0xffffff : 0x999999);
            entry.note.text = available ? (active ? "SELECTED" : "CLICK TO SELECT") : `UNLOCKS WAVE ${weapon.waveUnlock}`;
            entry.note.style.fill = available ? 0xcccccc : 0x888888;

            const contentWidth = Math.max(entry.label.width, entry.note.width) + 28;
            const buttonWidth = Math.max(contentWidth, 220);
            const buttonHeight = 48;

            entry.bg.clear();
            entry.bg.beginFill(available ? (active ? 0x264422 : 0x222222) : 0x111111, 0.92);
            entry.bg.lineStyle(2, available ? (active ? 0x66ff66 : 0x8888aa) : 0x444444, 0.95);
            entry.bg.drawRoundedRect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight, 10);
            entry.label.y = -8;
            entry.note.y = 18;
        });
    }

    hideMenu() { this.menu.visible = false; }

    showDeathScreen(score) {
        stopMusic();
        this.bar.visible = false; this.healthFill.visible = false;
        this.weaponText.visible = false; this.reloadHint.visible = false; this.hintText.visible = false;
        this.scoreText.text = `TOTAL SCORE: ${score}`;
        this.deathScreen.visible = true;
    }
}

// ─── Game flow ────────────────────────────────────────────────────────────────
function startGame() {
    state.gameStarted = true;
    state.paused = false;
    state.act  = 1; state.wave = 0; state.score = 0;
    state.enemies = []; state.flags = []; state.bullets = []; state.grenades = [];
    state.lootBodies = []; state.particles = [];
    state.player = new Player(state.world.width / 2, state.world.height / 2);
    state.world.spawnTerrain();
    if (state.player) state.player.updateAvailableWeapons();
    playMusic('battleCry');
    startWaveCountdown();
    state.ui.closePauseMenu();
    state.ui.hideMenu(); state.ui.update();
}

function startWaveCountdown() { state.waveCountdown = 300; state.isWaveActive = false; if (state.player) state.player.updateAvailableWeapons(); }

function getMaxWavesForCurrentAct() {
    return state.endlessMode && state.act === 3 ? Number.MAX_SAFE_INTEGER : MAX_WAVES_PER_ACT[state.act];
}

function startDayTransition() {
    state.dayTransition = {
        stage: 'dusk',
        timer: 0,
        duration: 180,
        hold: 180,
        dawnDuration: 180,
        maxAlpha: 0.62,
        stars: Array.from({ length: 34 }, () => ({
            x: Math.random() * app.screen.width,
            y: Math.random() * app.screen.height,
            size: 1 + Math.random() * 1.5,
            phase: Math.random() * Math.PI * 2,
        })),
    };
    state.pendingWaveAfterTransition = true;
    drawDayOverlay(0);
}

function drawDayOverlay(alpha) {
    dayOverlay.clear();
    if (alpha <= 0) return;
    dayOverlay.beginFill(0x081c38, alpha);
    dayOverlay.drawRect(0, 0, app.screen.width, app.screen.height);
    dayOverlay.endFill();

    const starAlpha = Math.max(0, (alpha - 0.2) / 0.8);
    if (state.dayTransition && starAlpha > 0) {
        for (const star of state.dayTransition.stars) {
            const twinkle = 0.5 + 0.5 * Math.sin(star.phase + state.dayTransition.timer * 0.08);
            dayOverlay.beginFill(0xffffff, starAlpha * twinkle);
            dayOverlay.drawCircle(star.x, star.y, star.size);
            dayOverlay.endFill();
        }
    }
}

function updateDayTransition(delta) {
    if (!state.dayTransition) return;
    const t = state.dayTransition;
    t.timer += delta;

    if (t.stage === 'dusk') {
        const progress = Math.min(1, t.timer / t.duration);
        drawDayOverlay(progress * t.maxAlpha);
        if (t.timer >= t.duration) {
            t.stage = 'night';
            t.timer = 0;
        }
    } else if (t.stage === 'night') {
        drawDayOverlay(t.maxAlpha);
        if (t.timer >= t.hold) {
            t.stage = 'dawn';
            t.timer = 0;
        }
    } else if (t.stage === 'dawn') {
        const progress = Math.min(1, t.timer / t.dawnDuration);
        drawDayOverlay((1 - progress) * t.maxAlpha);
        if (t.timer >= t.dawnDuration) {
            dayOverlay.clear();
            state.dayTransition = null;
            if (state.pendingWaveAfterTransition) {
                state.pendingWaveAfterTransition = false;
                spawnWave();
            }
        }
    }
}

function spawnWave() {
    state.wave++;
    if (state.player) state.player.updateAvailableWeapons();
    const maxWaves = getMaxWavesForCurrentAct();
    if (state.wave > maxWaves) {
        state.wave = 1;
        if (!state.endlessMode || state.act < 3) {
            state.act++;
            if (state.act > 3) {
                showVictoryScreen(); return;
            }
            state.world.spawnTerrain();
            // Heal player a bit between acts
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 30);
            startDayTransition();
            return;
        }
    }
    if (state.act > 3) {
        showVictoryScreen(); return;
    }

    playMusic(state.act === 1 ? 'battleCry' : 'overture');
    state.isWaveActive = true; state.waveCountdown = 0;

    // Objective
    const objectives = [
        { type:'flag',    text:'HOLD CEMETERY RIDGE',                 x: Math.random()*1200+300, y: Math.random()*1200+300, completed:false },
        { type:'soldier', text:'REACH THE WOUNDED UNION SOLDIER',    x: Math.random()*1200+300, y: Math.random()*1200+300, completed:false },
        { type:'cannon',  text:'SPIKE THE BATTERY',                   x: Math.random()*1200+300, y: Math.random()*1200+300, completed:false },
    ];
    state.objective = objectives[(state.wave - 1) % 3];

    const og = new PIXI.Graphics();
    og.lineStyle(4, 0xffff00);
    if      (state.objective.type === 'flag')    {
        const flagSprite = new PIXI.Sprite(textures['union_flag']);
        flagSprite.anchor.set(0.5); flagSprite.width = 64; flagSprite.height = 32;
        og.addChild(flagSprite);
    }
    else if (state.objective.type === 'soldier') {
        const soldierTex = textures[WOUNDED_SOLDIER_SPRITE] || PIXI.Texture.from('assets/wounded_union_soldier.png');
        const soldierSprite = new PIXI.Sprite(soldierTex);
        soldierSprite.anchor.set(0.5);
        soldierSprite.width = 52;
        soldierSprite.height = 52;
        og.addChild(soldierSprite);
    }
    else                                         {
                                            const cannonTex = PIXI.Texture.from('assets/cannon.png');
                                            const csp = new PIXI.Sprite(cannonTex);
                                            csp.anchor.set(0.5); csp.width = 64; csp.height = 32;
                                            og.addChild(csp);
                                         }
    og.endFill();
    og.x = state.objective.x; og.y = state.objective.y;
    state.objective.graphic = og;
    worldContainer.addChild(og);

    // Enemy composition for this wave: only infantry confederates, with counts 3, 5, 7...
    const infantryCount = 3 + (state.wave - 1) * 2;
    const spawnEnemy = (type) => {
        let x, y;
        do {
            x = Math.random() * state.world.width;
            y = Math.random() * state.world.height;
        } while (dist(x, y, state.player.container.x, state.player.container.y) < 350);
        state.enemies.push(new Enemy(x, y, type));
    };

    for (let i = 0; i < infantryCount; i++) spawnEnemy('infantry');
}

function showVictoryScreen() {
    const ov = new PIXI.Graphics();
    ov.beginFill(0x000000, 0.92); ov.drawRect(0, 0, window.innerWidth, window.innerHeight);
    uiContainer.addChild(ov);
    const t = new PIXI.Text("UNION VICTORY!\nGETTYSBURG IS HELD!", {
        fontFamily:'Georgia,serif', fontSize:52, fill:0x88aaff, fontWeight:'bold', align:'center'
    });
    t.anchor.set(0.5); t.x = window.innerWidth/2; t.y = window.innerHeight/2 - 60;
    stopMusic();
    uiContainer.addChild(t);
    const sc = new PIXI.Text(`FINAL SCORE: ${state.score}`, {
        fontFamily:'Georgia,serif', fontSize:32, fill:0xffffff
    });
    sc.anchor.set(0.5); sc.x = window.innerWidth/2; sc.y = window.innerHeight/2 + 60;
    uiContainer.addChild(sc);
    const rb = new PIXI.Container();
    const rbg = new PIXI.Graphics();
    rbg.beginFill(0x444444); rbg.drawRoundedRect(-120,-30,240,60,10);
    rb.eventMode='static'; rb.cursor='pointer'; rb.addChild(rbg);
    const rbt = new PIXI.Text("PLAY AGAIN", { fontSize:24, fill:0xffffff, fontFamily:'Georgia,serif' });
    rbt.anchor.set(0.5); rb.addChild(rbt);
    rb.x = window.innerWidth/2; rb.y = window.innerHeight/2 + 140;
    rb.on('pointerdown', () => location.reload());
    uiContainer.addChild(rb);
    state.gameStarted = false;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
state.world = new World();
loadAudio();

loadUnionTextures(() => {
    createFlagTextures();
    state.ui = new HUD();

    app.ticker.add((delta) => {
        if (state.world && state.world.updateWater) state.world.updateWater(delta);
        updateDayTransition(delta);
        if (!state.gameStarted || state.paused) return;
        if (state.player) state.player.update(delta);

        // Wave-complete check
        if (state.isWaveActive && state.objective && state.objective.completed) {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 15);
            if (state.objective.graphic) {
                worldContainer.removeChild(state.objective.graphic);
                state.objective.graphic = null;
            }
            state.objective = null;
            startWaveCountdown();
        }

        // Objective proximity check
        if (state.objective && !state.objective.completed) {
            const d = dist(state.player.container.x, state.player.container.y, state.objective.x, state.objective.y);
            if (d < 55) { state.objective.completed = true; state.score += 500; }
        }

        for (let i = state.bullets.length  - 1; i >= 0; i--) { if (!state.bullets[i].update(delta))  state.bullets.splice(i,1); }
        for (let i = state.grenades.length - 1; i >= 0; i--) { if (!state.grenades[i].update(delta)) state.grenades.splice(i,1); }
        for (let i = state.enemies.length  - 1; i >= 0; i--) { if (!state.enemies[i].update(delta))  state.enemies.splice(i,1); }
        for (let i = state.flags.length - 1; i >= 0; i--) { if (!state.flags[i].update(delta)) state.flags.splice(i,1); }
        for (let i = state.lootBodies.length - 1; i >= 0; i--) { if (!state.lootBodies[i].update(delta)) state.lootBodies.splice(i,1); }

        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i];
            if (p.isSmoke) {
                const t = (p.maxLife - p.life) * 0.02;
                const n = _perlin(p.x * 0.012 + p.noiseSeedX, p.y * 0.012 + p.noiseSeedY + t);
                const swirlAngle = n * Math.PI * 2;
                p.vx += Math.cos(swirlAngle) * p.noiseStrength * delta;
                p.vy += Math.sin(swirlAngle) * p.noiseStrength * delta;
                p.vy -= 0.008 * delta;
                const f = Math.pow(p.friction, delta);
                p.vx *= f; p.vy *= f;
                p.x += p.vx * delta; p.y += p.vy * delta;
                // Slow random spin (cloud tumbling), not velocity-aligned
                p.rotation += p.angularVel * delta;
                p.life -= delta;
                const lifeRatio = Math.max(0, p.life / p.maxLife);
                const aged = 1 - lifeRatio;
                // Expand outward: small → large over lifetime
                p.scale.set(p.startScale + (p.endScale - p.startScale) * aged);
                const fadeIn  = Math.min(1, aged / 0.12);
                const fadeOut = Math.min(1, lifeRatio / 0.60);
                p.alpha = p.baseAlpha * fadeIn * fadeOut;
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            } else if (p.isFire) {
                // Fire: white/yellow → orange → red → dark gray; expands; gentle buoyancy; friction
                const f = Math.pow(p.friction, delta);
                p.vx *= f; p.vy *= f;
                p.vy += (p.gravity || 0) * delta;
                p.x += p.vx * delta; p.y += p.vy * delta;
                p.rotation += (p.angularVel || 0) * delta;
                p.life -= delta;
                const lifeRatio = Math.max(0, p.life / p.maxLife);
                const aged = 1 - lifeRatio;
                p.scale.set(p.startScale + (p.endScale - p.startScale) * aged);
                p.tint = _lerpFireColor(aged);
                const fadeIn  = Math.min(1, aged / 0.10);
                const fadeOut = Math.min(1, lifeRatio / 0.40);
                p.alpha = fadeIn * fadeOut;
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            } else if (p.isSpark) {
                const f = Math.pow(p.friction, delta);
                p.vx *= f; p.vy *= f;
                p.vy += (p.gravity || 0) * delta;
                p.x += p.vx * delta; p.y += p.vy * delta;
                p.rotation = Math.atan2(p.vy, p.vx);
                p.life -= delta;
                p.alpha = Math.max(0, p.life / p.maxLife);
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            } else if (p.isDebris) {
                const f = Math.pow(p.friction, delta);
                p.vx *= f; p.vy *= f;
                p.vy += (p.gravity || 0) * delta;
                p.x += p.vx * delta; p.y += p.vy * delta;
                p.rotation += (p.angularVel || 0) * delta;
                p.life -= delta;
                p.alpha = Math.min(1, (p.life / p.maxLife) * 1.6);
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            } else if (p.isBlood) {
                const f = Math.pow(p.friction, delta);
                p.vx *= f; p.vy *= f;
                p.vy += (p.gravity || 0) * delta;
                p.x += p.vx * delta; p.y += p.vy * delta;
                // Orient blob along velocity direction; stretch slightly if moving fast
                const sp = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
                if (sp > 0.05) p.rotation = Math.atan2(p.vy, p.vx);
                p.life -= delta;
                p.alpha = Math.min(1, (p.life / p.maxLife) * 1.4);
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            } else {
                p.x += p.vx * delta; p.y += p.vy * delta;
                p.life -= delta;
                if (p.life <= 0) { worldContainer.removeChild(p); state.particles.splice(i,1); }
            }
        }

        state.ui.update();

        // Camera
        const camX = -state.player.container.x + app.screen.width / 2;
        const camY = -state.player.container.y + app.screen.height / 2;
        worldContainer.x += (camX - worldContainer.x) * 0.1;
        worldContainer.y += (camY - worldContainer.y) * 0.1;

        if (state.shake > 0) {
            worldContainer.x += (Math.random() - 0.5) * state.shake * 2;
            worldContainer.y += (Math.random() - 0.5) * state.shake * 2;
            state.shake -= delta;
        }
    });
});

window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    if (state.ui) state.ui.resize();
});