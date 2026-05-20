// boss.js - AI for Commander Picket
// boss.js
class Boss extends Enemy {
    constructor(x, y) {
        super(x, y);
        this.hp = 3500;
        this.maxHp = 3500;
        this.speed = 0.5; // Slow, menacing walk
        this.damage = 45;
        this.isBoss = true;

        // Special Attack Timers
        this.bombTimer = 0;
        this.minionTimer = 0;

        // Visuals
        this.container.scale.set(2.0);
        const nameText = new PIXI.Text("Commander Picket", {
            fontFamily: "Arial",
            fontSize: 18,
            fill: 0xff4444,
            dropShadow: true,
            dropShadowColor: 0x000000,
            dropShadowDistance: 2,
        });
        nameText.anchor.set(0.5, 1);
        nameText.position.set(0, -50);
        this.container.addChild(nameText);
    }

    update(delta) {
        if (this._downed) return super.update(delta);

        // 1. Throw Bombs (Every 5 seconds)
        this.bombTimer += delta;
        if (this.bombTimer > 300) {
            // ~5 seconds at 60fps
            this.throwBomb();
            this.bombTimer = 0;
        }

        // 2. Spawn Minions (Every 8 seconds)
        this.minionTimer += delta;
        if (this.minionTimer > 480) {
            this.spawnReinforcements();
            this.minionTimer = 0;
        }

        return super.update(delta);
    }

    throwBomb() {
        if (!state.player) return;
        const angle = Math.atan2(
            state.player.container.y - this.container.y,
            state.player.container.x - this.container.x,
        );

        // Use existing Grenade class from main.js
        const bomb = new Grenade(
            this.container.x,
            this.container.y,
            angle,
            true, // isEnemyGrenade flag
        );
        state.grenades.push(bomb);
        playSound("explosion", 0.3); // Telegraph the throw
    }

    spawnReinforcements() {
        // Spawn 3 basic confederate soldiers around the boss
        for (let i = 0; i < 3; i++) {
            const rx = this.container.x + (Math.random() - 0.5) * 200;
            const ry = this.container.y + (Math.random() - 0.5) * 200;
            const minion = new Enemy(rx, ry);
            minion.hp = 50; // Weaker minions
            state.enemies.push(minion);
        }

        // Visual indicator for spawning
        spawnSmokePuff(this.container.x, this.container.y, 5);
    }
}
