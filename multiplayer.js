// ═══════════════════════════════════════════════════════════════════════════════
//  THREE DAYS AT GETTYSBURG — MULTIPLAYER v2.0
//
//  Features:
//    • Dedicated multiplayer lobby screen with big "MULTIPLAYER" button on main menu
//    • LOCAL  — same keyboard, P1=WASD+Mouse, P2=IJKL+Arrows+U/O/P
//    • ONLINE — PeerJS WebRTC (CDN), Room Code host/join, no server required
//    • PvP modes: Best of 5 Rounds | Timed Deathmatch (3 min) | Capture the Flag
//    • CO-OP — both local and online variants
//
//  Drop alongside main.js. Requires PeerJS CDN in index.html:
//    <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
//    <script src="multiplayer.js"></script>
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────────────────
    const COLORS = {
        UNION:    0x4a90d9,
        CONFED:   0xc0392b,
        GOLD:     0xf0c040,
        DARK:     0x1a1a2e,
        PANEL:    0x16213e,
        BTN:      0x0f3460,
        BTN_HOV:  0x1a4a8a,
        GREEN:    0x27ae60,
        RED:      0xc0392b,
        SEPIA:    0x8b6914,
    };

    const DEATHMATCH_DURATION = 180; // seconds
    const CTF_SCORE_TO_WIN    = 3;
    const BO5_WINS_TO_WIN     = 3;

    // ─── Multiplayer State ───────────────────────────────────────────────────
    const mp = {
        // Connection type
        connectionType: 'none',   // 'none' | 'local' | 'online'
        isHost:         false,
        peer:           null,
        conn:           null,

        // Game config
        mode:           'none',   // 'none' | 'coop' | 'pvp_bo5' | 'pvp_dm' | 'pvp_ctf'
        pvpSubMode:     'bo5',    // 'bo5' | 'dm' | 'ctf'

        // Players
        player2:        null,
        p2AimAngle:     Math.PI,

        // Scores & rounds
        p1Wins:         0,
        p2Wins:         0,
        p1Score:        0,
        p2Score:        0,
        roundNum:       0,
        roundOver:      false,
        matchOver:      false,

        // Deathmatch timer
        dmTimer:        0,
        dmKills1:       0,
        dmKills2:       0,

        // CTF
        ctfFlags:       [],
        ctfScore1:      0,
        ctfScore2:      0,

        // Online sync
        remoteInput:    { up:false, down:false, left:false, right:false, aimX:0, aimY:0, fire:false, reload:false, melee:false },
        localInput:     { up:false, down:false, left:false, right:false, aimX:0, aimY:0, fire:false, reload:false, melee:false },
        syncTick:       0,
    };
    window.mp = mp;

    // P2 key bindings (local)
    const P2_KEYS = {
        up:      'KeyI',
        down:    'KeyK',
        left:    'KeyJ',
        right:   'KeyL',
        aimUp:   'ArrowUp',
        aimDown: 'ArrowDown',
        aimLeft: 'ArrowLeft',
        aimRight:'ArrowRight',
        fire:    'KeyU',
        reload:  'KeyO',
        melee:   'KeyP',
    };

    // ─── Boot ────────────────────────────────────────────────────────────────
    // Expose immediately (hoisted function) so main.js button works on first click
    window.openMultiplayerLobby = openMultiplayerLobby;

    function waitForBoot(cb) {
        const check = setInterval(() => {
            if (window.state && window.state.ui && window.app && window.worldContainer) {
                clearInterval(check);
                cb();
            }
        }, 80);
    }
    waitForBoot(init);

    // ─── Initialise ──────────────────────────────────────────────────────────
    function init() {
        patchStartGame();
        patchGameLoop();
        patchBulletHitChecks();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MAIN MENU — inject "MULTIPLAYER" button
    // ═════════════════════════════════════════════════════════════════════════
    function injectMainMenuButton() {
        const ui   = window.state.ui;
        const menu = ui.menu;
        const W    = window.innerWidth;
        const H    = window.innerHeight;

        // Push the existing "DEPLOY WITH THE UNION" button (at H/2+140) further down
        // and the Endless Mode button (at H/2+40) slightly up to create space
        menu.children.forEach(c => {
            // Endless Mode sits at H/2 + 40 — nudge it up a little
            if (c.y && Math.round(c.y) === Math.round(H / 2 + 40)) {
                c.y = H / 2 + 20;
            }
            // Deploy button sits at H/2 + 140 — push it down
            if (c.y && Math.round(c.y) === Math.round(H / 2 + 140)) {
                c.y = H / 2 + 220;
            }
        });

        // ── Big MULTIPLAYER button, slotted between Endless and Deploy ───────
        const mpBtn = new PIXI.Container();
        const mpBg  = new PIXI.Graphics();

        // Gradient-style layered rect for visual weight
        mpBg.beginFill(0x6b0f0f);
        mpBg.drawRoundedRect(-180, -34, 360, 68, 16);
        mpBg.beginFill(0x9b2020, 0.6);
        mpBg.drawRoundedRect(-178, -32, 356, 32, 14);
        mpBtn.addChild(mpBg);

        const mpLabel = new PIXI.Text('⚔  MULTIPLAYER', {
            fontFamily: 'Georgia,serif', fontSize: 24,
            fill: 0xffffff, fontWeight: 'bold',
            stroke: 0x000000, strokeThickness: 3,
        });
        mpLabel.anchor.set(0.5);
        mpBtn.addChild(mpLabel);

        const mpSub = new PIXI.Text('Local · Online · PvP · Co-op', {
            fontFamily: 'Georgia,serif', fontSize: 13,
            fill: 0xffcccc, fontStyle: 'italic',
        });
        mpSub.anchor.set(0.5);
        mpSub.y = 20;
        mpBtn.addChild(mpSub);

        mpBtn.x = W / 2;
        mpBtn.y = H / 2 + 120;   // sits between endless (H/2+20) and deploy (H/2+220)
        mpBtn.eventMode = 'static';
        mpBtn.cursor = 'pointer';

        mpBtn.on('pointerover', () => {
            mpBg.tint = 0xffcccc;
            mpLabel.style.fill = 0xffeeee;
        });
        mpBtn.on('pointerout', () => {
            mpBg.tint = 0xffffff;
            mpLabel.style.fill = 0xffffff;
        });
        mpBtn.on('pointerdown', () => openMultiplayerLobby());

        menu.addChild(mpBtn);

        // Subtle separator line above the button
        const sep = new PIXI.Graphics();
        sep.lineStyle(1, 0x664422, 0.5);
        sep.moveTo(W / 2 - 200, H / 2 + 78);
        sep.lineTo(W / 2 + 200, H / 2 + 78);
        menu.addChild(sep);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MULTIPLAYER LOBBY SCREEN
    // ═════════════════════════════════════════════════════════════════════════
    function openMultiplayerLobby() {
        // Guard: if game hasn't finished booting yet, retry in 100ms
        if (!window.state || !window.state.ui || !window.uiContainer) {
            setTimeout(openMultiplayerLobby, 100);
            return;
        }

        const ui   = window.state.ui;
        const c    = window.uiContainer;

        // Hide main menu
        ui.menu.visible = false;

        // ── Lobby container ─────────────────────────────────────────────────
        const lobby = new PIXI.Container();
        const W = window.innerWidth, H = window.innerHeight;

        // Background overlay
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.96);
        bg.drawRect(0, 0, W, H);
        lobby.addChild(bg);

        // Decorative border
        const border = new PIXI.Graphics();
        border.lineStyle(3, COLORS.SEPIA, 0.7);
        border.drawRoundedRect(40, 40, W - 80, H - 80, 18);
        lobby.addChild(border);

        // Title
        const title = new PIXI.Text('MULTIPLAYER COMMAND', {
            fontFamily: 'Georgia,serif', fontSize: 44, fill: COLORS.GOLD,
            fontWeight: 'bold', stroke: 0x000000, strokeThickness: 4
        });
        title.anchor.set(0.5);
        title.x = W / 2; title.y = 90;
        lobby.addChild(title);

        const subtitle = new PIXI.Text('Choose your battle configuration', {
            fontFamily: 'Georgia,serif', fontSize: 18, fill: 0x9999bb, fontStyle: 'italic'
        });
        subtitle.anchor.set(0.5);
        subtitle.x = W / 2; subtitle.y = 140;
        lobby.addChild(subtitle);

        // ── Section panels ──────────────────────────────────────────────────
        const MID = H / 2 + 10;

        // Left panel — Connection Type
        _drawPanel(lobby, 60, 165, W / 2 - 80, H - 240);
        const connLabel = new PIXI.Text('CONNECTION', {
            fontFamily: 'Georgia,serif', fontSize: 20, fill: COLORS.GOLD
        });
        connLabel.anchor.set(0.5);
        connLabel.x = 60 + (W / 2 - 80) / 2; connLabel.y = 195;
        lobby.addChild(connLabel);

        // Local button
        const localBtn = _makeBtn('🎮  LOCAL', connLabel.x, 250, 260, 60, COLORS.BTN);
        localBtn.on('pointerdown', () => selectConnection('local', localBtn, onlineBtn));
        lobby.addChild(localBtn);

        // Online button
        const onlineBtn = _makeBtn('🌐  ONLINE (PeerJS)', connLabel.x, 330, 260, 60, COLORS.BTN);
        onlineBtn.on('pointerdown', () => selectConnection('online', onlineBtn, localBtn));
        lobby.addChild(onlineBtn);

        // Online sub-panel (hidden initially)
        const onlinePanel = new PIXI.Container();
        onlinePanel.visible = false;
        lobby.addChild(onlinePanel);

        const roomCodeLabel = new PIXI.Text('', {
            fontFamily: 'Georgia,serif', fontSize: 15, fill: 0xccddff, align: 'center', wordWrap: true, wordWrapWidth: 280
        });
        roomCodeLabel.anchor.set(0.5);
        roomCodeLabel.x = connLabel.x; roomCodeLabel.y = 415;
        onlinePanel.addChild(roomCodeLabel);

        const hostBtn = _makeBtn('HOST GAME', connLabel.x, 475, 200, 50, COLORS.GREEN);
        hostBtn.on('pointerdown', () => hostGame(roomCodeLabel, joinInput, joinBtn));
        onlinePanel.addChild(hostBtn);

        const orLabel = new PIXI.Text('— or —', {
            fontFamily: 'Georgia,serif', fontSize: 14, fill: 0x666666
        });
        orLabel.anchor.set(0.5);
        orLabel.x = connLabel.x; orLabel.y = 535;
        onlinePanel.addChild(orLabel);

        // Join input (HTML element over canvas)
        let joinInput = null;
        let joinBtn = null;

        const joinInputPlaceholder = new PIXI.Text('Enter Room Code to join…', {
            fontFamily: 'Georgia,serif', fontSize: 14, fill: 0x888888
        });
        joinInputPlaceholder.anchor.set(0.5);
        joinInputPlaceholder.x = connLabel.x; joinInputPlaceholder.y = 578;
        onlinePanel.addChild(joinInputPlaceholder);

        joinBtn = _makeBtn('JOIN', connLabel.x, 625, 180, 48, COLORS.BTN);
        onlinePanel.addChild(joinBtn);

        // Actual HTML input for room code
        const htmlInput = document.createElement('input');
        htmlInput.type = 'text';
        htmlInput.placeholder = 'Room Code';
        htmlInput.maxLength = 10;
        Object.assign(htmlInput.style, {
            position: 'absolute',
            left: '50%',
            top: '0px',
            transform: 'translateX(-50%)',
            width: '200px',
            padding: '8px 12px',
            background: '#1a1a2e',
            color: '#ffffff',
            border: '2px solid #4a90d9',
            borderRadius: '8px',
            fontFamily: 'Georgia,serif',
            fontSize: '15px',
            textAlign: 'center',
            outline: 'none',
            display: 'none',
            zIndex: '1000',
        });
        document.getElementById('canvas-container').appendChild(htmlInput);
        joinInput = htmlInput;

        joinBtn.on('pointerdown', () => {
            const code = htmlInput.value.trim().toUpperCase();
            if (code.length < 3) {
                roomCodeLabel.text = '⚠ Enter a valid Room Code';
                return;
            }
            joinGame(code, roomCodeLabel);
        });

        // Right panel — Game Mode
        _drawPanel(lobby, W / 2 - 5, 165, W / 2 - 55, H - 240);
        const modeLabel = new PIXI.Text('GAME MODE', {
            fontFamily: 'Georgia,serif', fontSize: 20, fill: COLORS.GOLD
        });
        modeLabel.anchor.set(0.5);
        modeLabel.x = W / 2 - 5 + (W / 2 - 55) / 2; modeLabel.y = 195;
        lobby.addChild(modeLabel);

        const modeX = modeLabel.x;

        // Mode buttons
        const coopBtn  = _makeBtn('🤝  CO-OP', modeX, 260, 260, 56, COLORS.BTN);
        const bo5Btn   = _makeBtn('🏆  PvP — Best of 5', modeX, 330, 260, 56, COLORS.BTN);
        const dmBtn    = _makeBtn('⏱  PvP — Deathmatch (3 min)', modeX, 400, 260, 56, COLORS.BTN);
        const ctfBtn   = _makeBtn('🚩  PvP — Capture the Flag', modeX, 470, 260, 56, COLORS.BTN);

        coopBtn.on ('pointerdown', () => selectMode('coop',   coopBtn,  [bo5Btn, dmBtn, ctfBtn]));
        bo5Btn.on  ('pointerdown', () => selectMode('pvp_bo5', bo5Btn,  [coopBtn, dmBtn, ctfBtn]));
        dmBtn.on   ('pointerdown', () => selectMode('pvp_dm',  dmBtn,   [coopBtn, bo5Btn, ctfBtn]));
        ctfBtn.on  ('pointerdown', () => selectMode('pvp_ctf', ctfBtn,  [coopBtn, bo5Btn, dmBtn]));

        lobby.addChild(coopBtn);
        lobby.addChild(bo5Btn);
        lobby.addChild(dmBtn);
        lobby.addChild(ctfBtn);

        // Mode description
        const modeDesc = new PIXI.Text('', {
            fontFamily: 'Georgia,serif', fontSize: 14, fill: 0xaaaacc,
            align: 'center', wordWrap: true, wordWrapWidth: W / 2 - 80
        });
        modeDesc.anchor.set(0.5);
        modeDesc.x = modeX; modeDesc.y = 555;
        lobby.addChild(modeDesc);

        // Controls hint
        const ctrlHint = new PIXI.Text(
            'P1: WASD + Mouse   |   P2 (local): IJKL move · Arrow Keys aim · U fire · O reload · P melee',
            { fontFamily: 'Arial', fontSize: 12, fill: 0x666677, align: 'center' }
        );
        ctrlHint.anchor.set(0.5);
        ctrlHint.x = W / 2; ctrlHint.y = H - 80;
        lobby.addChild(ctrlHint);

        // Status line
        const statusText = new PIXI.Text('', {
            fontFamily: 'Georgia,serif', fontSize: 16, fill: 0x88ff88, align: 'center'
        });
        statusText.anchor.set(0.5);
        statusText.x = W / 2; statusText.y = H - 55;
        lobby.addChild(statusText);

        // ── Deploy button ────────────────────────────────────────────────────
        const deployBtn = _makeBtn('⚔  DEPLOY', W / 2, H - 100, 300, 72, 0x8b1a1a);
        deployBtn.alpha = 0.35;
        deployBtn.eventMode = 'none';
        lobby.addChild(deployBtn);

        // Back button
        const backBtn = _makeSmallBtn('← BACK', 120, 50);
        backBtn.on('pointerdown', () => {
            htmlInput.remove();
            c.removeChild(lobby);
            ui.menu.visible = true;
            cleanupPeer();
        });
        lobby.addChild(backBtn);

        c.addChild(lobby);

        // ── Internal helpers ─────────────────────────────────────────────────
        let selectedConn = 'none';
        let selectedMode = 'none';

        function selectConnection(type, activeBtn, inactiveBtn) {
            selectedConn = type;
            _highlightBtn(activeBtn, true);
            _highlightBtn(inactiveBtn, false);
            onlinePanel.visible = (type === 'online');
            htmlInput.style.display = (type === 'online') ? 'block' : 'none';
            // Position input below canvas center
            const rect = window.app.view.getBoundingClientRect();
            htmlInput.style.top = (rect.top + 570) + 'px';
            htmlInput.style.left = (rect.left + W / 4 + (W / 2 - 80) / 2) + 'px';
            htmlInput.style.transform = 'translateX(-50%)';
            checkReady();
        }

        function selectMode(mode, activeBtn, otherBtns) {
            selectedMode = mode;
            _highlightBtn(activeBtn, true);
            otherBtns.forEach(b => _highlightBtn(b, false));
            const descs = {
                coop:    'Fight together against Confederate waves. Shared health packs and objectives.',
                pvp_bo5: 'First to 3 round wins takes the field. Last soldier standing wins each round.',
                pvp_dm:  '3-minute deathmatch. Most kills when time expires wins the battle.',
                pvp_ctf: `First to ${CTF_SCORE_TO_WIN} flag captures wins. Grab the enemy flag and return it to your base.`,
            };
            modeDesc.text = descs[mode] || '';
            checkReady();
        }

        function checkReady() {
            const localReady  = (selectedConn === 'local' && selectedMode !== 'none');
            const onlineReady = (selectedConn === 'online' && mp.connectionType === 'online' && selectedMode !== 'none');
            if (localReady || onlineReady) {
                deployBtn.alpha = 1;
                deployBtn.eventMode = 'static';
                deployBtn.cursor = 'pointer';
                if (!deployBtn._hasListener) {
                    deployBtn._hasListener = true;
                    deployBtn.on('pointerdown', () => {
                        mp.connectionType = selectedConn;
                        mp.mode = selectedMode;
                        htmlInput.remove();
                        c.removeChild(lobby);
                        launchMultiplayer();
                    });
                }
            }
        }

        function hostGame(label, input, joinBtn) {
            label.text = '⏳ Starting PeerJS…';
            loadPeerJS(() => {
                const code = _randomCode();
                mp.isHost = true;
                try {
                    mp.peer = new Peer(code, { debug: 0 });
                } catch(e) {
                    label.text = '❌ PeerJS unavailable. Use Local mode.';
                    return;
                }
                mp.peer.on('open', (id) => {
                    label.text = `Your Room Code:\n\n${id}\n\nShare with Player 2!`;
                    label.style.fill = 0x88ff88;
                    statusText.text = '⏳ Waiting for Player 2 to join…';
                });
                mp.peer.on('connection', (conn) => {
                    mp.conn = conn;
                    setupPeerConnection(conn, statusText, checkReady);
                    mp.connectionType = 'online';
                    statusText.text = '✅ Player 2 connected! Choose a mode and Deploy.';
                    checkReady();
                });
                mp.peer.on('error', (err) => {
                    label.text = `❌ ${err.type}`;
                });
            });
        }

        function joinGame(code, label) {
            label.text = '⏳ Connecting to host…';
            loadPeerJS(() => {
                mp.isHost = false;
                try {
                    mp.peer = new Peer({ debug: 0 });
                } catch(e) {
                    label.text = '❌ PeerJS unavailable. Use Local mode.';
                    return;
                }
                mp.peer.on('open', () => {
                    const conn = mp.peer.connect(code);
                    mp.conn = conn;
                    setupPeerConnection(conn, statusText, checkReady);
                });
                mp.peer.on('error', (err) => {
                    label.text = `❌ ${err.type} — check code and retry`;
                });
            });
        }
    }

    function setupPeerConnection(conn, statusText, checkReady) {
        conn.on('open', () => {
            if (statusText) statusText.text = '✅ Connected! Choose a mode and Deploy.';
            mp.connectionType = 'online';
            if (checkReady) checkReady();
        });
        conn.on('data', handleRemoteData);
        conn.on('close', () => {
            if (statusText) statusText.text = '⚠ Connection lost';
            mp.connectionType = 'none';
        });
        conn.on('error', (err) => {
            if (statusText) statusText.text = '❌ ' + err;
        });
    }

    function handleRemoteData(data) {
        if (data.type === 'input') {
            Object.assign(mp.remoteInput, data.input);
        } else if (data.type === 'config') {
            // Guest receives host config
            mp.mode = data.mode;
        }
    }

    function sendInput() {
        if (mp.conn && mp.conn.open) {
            mp.conn.send({ type: 'input', input: mp.localInput });
        }
    }

    function cleanupPeer() {
        if (mp.peer) { try { mp.peer.destroy(); } catch(e){} mp.peer = null; }
        mp.conn = null;
        mp.connectionType = 'none';
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  LAUNCH — start the game in multiplayer mode
    // ═════════════════════════════════════════════════════════════════════════
    function launchMultiplayer() {
        // Reset round counters
        mp.p1Wins = 0; mp.p2Wins = 0;
        mp.p1Score = 0; mp.p2Score = 0;
        mp.roundNum = 0;
        mp.roundOver = false; mp.matchOver = false;
        mp.dmKills1 = 0; mp.dmKills2 = 0;
        mp.ctfScore1 = 0; mp.ctfScore2 = 0;

        // If online host, send config to guest
        if (mp.connectionType === 'online' && mp.isHost && mp.conn && mp.conn.open) {
            mp.conn.send({ type: 'config', mode: mp.mode });
        }

        window.startGame();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PATCH startGame — also spawn P2
    // ═════════════════════════════════════════════════════════════════════════
    function patchStartGame() {
        const orig = window.startGame;
        window.startGame = function () {
            if (mp.mode === 'none') { orig(); return; }

            mp.player2    = null;
            mp.roundOver  = false;
            mp.p2AimAngle = Math.PI;

            orig();

            if (mp.mode !== 'none') {
                const wx = window.state.world.width;
                const wy = window.state.world.height;
                // P1 spawns left-centre, P2 spawns right-centre
                spawnPlayer2(wx * 0.65, wy / 2);

                // Tint players for identification
                _tintSprites(window.state.player, COLORS.UNION);
                _addLabel(window.state.player, 'P1', COLORS.UNION);

                // In PvP: disable waves and enemies
                if (isPvP()) {
                    window.state.isWaveActive = false;
                    // Clear any enemies
                    window.state.enemies.forEach(e => e.container && worldContainer.removeChild(e.container));
                    window.state.enemies = [];
                    window.state.objective = null;
                    if (mp.mode === 'pvp_dm') startDeathmatch();
                    if (mp.mode === 'pvp_ctf') spawnCTFFlags();
                }
            }
        };
    }

    function isPvP() {
        return mp.mode === 'pvp_bo5' || mp.mode === 'pvp_dm' || mp.mode === 'pvp_ctf';
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PLAYER 2 CLASS
    // ═════════════════════════════════════════════════════════════════════════
    class Player2 {
        constructor(x, y) {
            this.container = new PIXI.Container();
            this.container.x = x;
            this.container.y = y;
            this.hp          = 100;
            this.maxHp       = 100;
            this.dead        = false;
            this.speed       = 2.5;

            this.fireCooldown    = 0;
            this.reloadTimer     = 0;
            this.isReloading     = false;
            this.bleedDuration   = 0;
            this.bleedTickTimer  = 0;
            this.bleedDmgPerTick = 0;

            this.weapons = [
                { name: "Enfield 1853",    mag:1,  magSize:1,  reserve:60,  color:0x8b1a1a, cooldown:44,  reloadTime:195, speed:19, damage:110, type:'bullet',  immobileReload:true,  category:'rifle',   active:true },
                { name: "Le Mat Revolver", mag:9,  magSize:9,  reserve:36,  color:0x4a1a1a, cooldown:20,  reloadTime:115, speed:14, damage:38,  type:'bullet',  immobileReload:false, category:'pistol',  active:true },
                { name: "Rains Grenade",   mag:4,  magSize:6,  reserve:0,   color:0x1a1a3a, cooldown:65,  reloadTime:0,   speed:16, damage:110, type:'grenade', immobileReload:false, category:'utility', active:true, longRange:true },
                { name: "Bowie Knife",     mag:99, magSize:99, reserve:999, color:0xddddaa, cooldown:28,  reloadTime:0,   speed:0,  damage:55,  type:'melee',   immobileReload:false, category:'melee',   active:true },
            ];
            this.currentWeaponIndex = 0;
            this.meleeRef = null;

            this._buildSprite();
            this._buildHpBar();
            this._buildLabel();
            window.worldContainer.addChild(this.container);
        }

        _buildSprite() {
            const g = new PIXI.Graphics();
            g.beginFill(COLORS.CONFED);
            g.drawCircle(0, 0, 14);
            g.endFill();
            g.beginFill(0x8b0000);
            g.drawRect(-4, -12, 8, 8);
            g.endFill();
            // Hat brim
            g.beginFill(0x5a0000);
            g.drawRect(-10, -16, 20, 4);
            g.endFill();
            this.sprite = g;
            this.container.addChild(g);
        }

        _buildHpBar() {
            this.hpBarBg   = new PIXI.Graphics();
            this.hpBarFill = new PIXI.Graphics();
            this.hpBarBg.beginFill(0x330000); this.hpBarBg.drawRect(-20, 22, 40, 6); this.hpBarBg.endFill();
            this.container.addChild(this.hpBarBg);
            this.container.addChild(this.hpBarFill);
            this._drawHpBar();
        }

        _buildLabel() {
            this.nameLabel = new PIXI.Text('P2', {
                fontFamily: 'Georgia,serif', fontSize: 12,
                fill: COLORS.CONFED, stroke: 0x000000, strokeThickness: 2
            });
            this.nameLabel.anchor.set(0.5);
            this.nameLabel.y = -32;
            this.container.addChild(this.nameLabel);
        }

        _drawHpBar() {
            const pct = Math.max(0, this.hp / this.maxHp);
            const col = pct > 0.6 ? 0x44dd44 : pct > 0.3 ? 0xdddd22 : 0xdd3322;
            this.hpBarFill.clear();
            this.hpBarFill.beginFill(col);
            this.hpBarFill.drawRect(-20, 22, 40 * pct, 6);
            this.hpBarFill.endFill();
        }

        get currentWeapon() { return this.weapons[this.currentWeaponIndex]; }

        cycleWeapon(dir) {
            const n = this.weapons.length;
            this.currentWeaponIndex = (this.currentWeaponIndex + dir + n) % n;
        }

        reload() {
            const w = this.currentWeapon;
            if (this.isReloading || w.mag === w.magSize || w.reserve <= 0 || w.type === 'melee') return;
            this.isReloading = true;
            this.reloadTimer = w.reloadTime;
        }

        fire() {
            if (this.dead || this.fireCooldown > 0 || this.isReloading) return;
            const w = this.currentWeapon;
            if (w.mag <= 0) { this.reload(); return; }
            w.mag--;
            this.fireCooldown = w.cooldown;

            if (w.type === 'bullet') {
                const b = new window.Bullet(
                    this.container.x + Math.cos(mp.p2AimAngle) * 18,
                    this.container.y + Math.sin(mp.p2AimAngle) * 18,
                    mp.p2AimAngle, w.speed, w.damage, 220, this
                );
                window.state.bullets.push(b);
                window.spawnMuzzleFlash && window.spawnMuzzleFlash(
                    this.container.x + Math.cos(mp.p2AimAngle) * 18,
                    this.container.y + Math.sin(mp.p2AimAngle) * 18,
                    mp.p2AimAngle, 1.0
                );
            } else if (w.type === 'grenade') {
                const g = new window.Grenade(
                    this.container.x, this.container.y,
                    mp.p2AimAngle, w.speed, null, null, w.longRange || false
                );
                window.state.grenades.push(g);
            } else if (w.type === 'melee') {
                this._doMelee();
            }
        }

        _doMelee() {
            const range = 50;
            if (mp.mode === 'coop') {
                window.state.enemies.forEach(e => {
                    if (window.dist(e.container.x, e.container.y, this.container.x, this.container.y) < range) {
                        e.takeDamage(55);
                    }
                });
            } else if (isPvP()) {
                const p1 = window.state.player;
                if (p1 && window.dist(p1.container.x, p1.container.y, this.container.x, this.container.y) < range) {
                    p1.takeDamage(55);
                }
            }
        }

        takeDamage(dmg) {
            if (this.dead) return;
            this.hp -= dmg;
            this._drawHpBar();
            window.spawnBloodSplatter && window.spawnBloodSplatter(this.container.x, this.container.y, 30);
            if (this.hp <= 0) this._die();
        }

        _die() {
            this.dead = true;
            this.hp = 0;
            this._drawHpBar();
            this.container.alpha = 0.3;

            if (mp.mode === 'pvp_dm') {
                mp.dmKills1++;
                updateDMDisplay();
                respawnP2();
            } else if (isPvP()) {
                handleRoundEnd('p1wins');
            }
        }

        update(delta) {
            if (this.dead) return;

            // Get input (local or remote)
            let input;
            if (mp.connectionType === 'local') {
                input = _getLocalP2Input();
            } else if (mp.connectionType === 'online') {
                input = mp.isHost ? mp.remoteInput : mp.localInput;
            } else {
                input = _getLocalP2Input();
            }

            // Movement
            let dx = 0, dy = 0;
            if (input.up)    dy -= this.speed;
            if (input.down)  dy += this.speed;
            if (input.left)  dx -= this.speed;
            if (input.right) dx += this.speed;

            const nx = this.container.x + dx * delta;
            const ny = this.container.y + dy * delta;
            const W  = window.state.world.width;
            const H  = window.state.world.height;

            if (!window.checkTerrainCollision(nx, this.container.y)) this.container.x = Math.max(10, Math.min(W - 10, nx));
            if (!window.checkTerrainCollision(this.container.x, ny)) this.container.y = Math.max(10, Math.min(H - 10, ny));

            // Aim via arrow keys (local) or remote angle
            if (mp.connectionType === 'local') {
                const k = window.state.keys;
                let ax = 0, ay = 0;
                if (k['ArrowUp'])    ay = -1;
                if (k['ArrowDown'])  ay = 1;
                if (k['ArrowLeft'])  ax = -1;
                if (k['ArrowRight']) ax = 1;
                if (ax !== 0 || ay !== 0) mp.p2AimAngle = Math.atan2(ay, ax);
            } else {
                if (input.aimX !== 0 || input.aimY !== 0) mp.p2AimAngle = Math.atan2(input.aimY, input.aimX);
            }

            this.sprite.rotation = mp.p2AimAngle + Math.PI / 2;

            // Fire / reload triggers
            if (input.fire)   this.fire();
            if (input.reload) this.reload();
            if (input.melee)  this.cycleWeapon(1);

            // Timers
            if (this.fireCooldown > 0) this.fireCooldown -= delta;
            if (this.isReloading) {
                this.reloadTimer -= delta;
                if (this.reloadTimer <= 0) {
                    const w = this.currentWeapon;
                    const need = w.magSize - w.mag;
                    const give = Math.min(need, w.reserve);
                    w.mag += give; w.reserve -= give;
                    this.isReloading = false;
                }
            }

            // Bleed
            if (this.bleedDuration > 0) {
                this.bleedDuration -= delta;
                this.bleedTickTimer -= delta;
                if (this.bleedTickTimer <= 0) {
                    this.bleedTickTimer = 30;
                    this.takeDamage(this.bleedDmgPerTick);
                }
            }

            // CTF flag carrier
            if (mp.mode === 'pvp_ctf') checkCTFPickup(this, 2);
        }

        respawn(x, y) {
            this.dead = false;
            this.hp = this.maxHp;
            this.container.x = x || window.state.world.width * 0.65;
            this.container.y = y || window.state.world.height / 2;
            this.container.alpha = 1;
            this._drawHpBar();
            this.weapons.forEach(w => { if (w.category !== 'utility') { w.mag = w.magSize; } });
        }
    }

    function _getLocalP2Input() {
        const k = window.state.keys;
        return {
            up:     !!k[P2_KEYS.up],
            down:   !!k[P2_KEYS.down],
            left:   !!k[P2_KEYS.left],
            right:  !!k[P2_KEYS.right],
            fire:   !!k[P2_KEYS.fire],
            reload: !!k[P2_KEYS.reload],
            melee:  !!k[P2_KEYS.melee],
        };
    }

    function spawnPlayer2(x, y) {
        mp.player2 = new Player2(x, y);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  GAME LOOP PATCH
    // ═════════════════════════════════════════════════════════════════════════
    function patchGameLoop() {
        window.app.ticker.add((delta) => {
            if (!window.state.gameStarted || window.state.paused) return;
            if (!mp.player2 || mp.mode === 'none') return;

            const p2 = mp.player2;

            // Online: gather and send local input
            if (mp.connectionType === 'online') {
                if (mp.isHost) {
                    // Host controls P1; guest controls P2
                    // Host sends P1 state to guest (handled via bullet/state sync below)
                } else {
                    // Guest gathers local input for P2
                    const k = window.state.keys;
                    mp.localInput = {
                        up:     !!k[P2_KEYS.up],
                        down:   !!k[P2_KEYS.down],
                        left:   !!k[P2_KEYS.left],
                        right:  !!k[P2_KEYS.right],
                        fire:   !!k[P2_KEYS.fire],
                        reload: !!k[P2_KEYS.reload],
                        melee:  !!k[P2_KEYS.melee],
                        aimX:   Math.cos(mp.p2AimAngle),
                        aimY:   Math.sin(mp.p2AimAngle),
                    };
                }
                mp.syncTick++;
                if (mp.syncTick % 3 === 0) sendInput();
            }

            p2.update(delta);

            // PvP: prevent base game from spawning enemies/waves
            if (isPvP()) {
                window.state.isWaveActive = false;
                if (window.state.objective) window.state.objective.completed = false;
            }

            // Deathmatch timer
            if (mp.mode === 'pvp_dm' && !mp.roundOver) {
                mp.dmTimer -= delta / 60; // delta is frames at 60fps
                updateDMDisplay();
                if (mp.dmTimer <= 0) {
                    mp.dmTimer = 0;
                    endDeathmatch();
                }
            }

            // P1 death in PvP (BO5 / CTF)
            const p1 = window.state.player;
            if (isPvP() && p1 && p1.hp <= 0 && !mp.roundOver && mp.mode !== 'pvp_dm') {
                p1.hp = 1; // prevent base death screen
                if (mp.mode === 'pvp_bo5') handleRoundEnd('p2wins');
                if (mp.mode === 'pvp_ctf') { /* handled separately */ }
            }

            // DM: P1 death
            if (mp.mode === 'pvp_dm' && p1 && p1.hp <= 0 && !mp.roundOver) {
                p1.hp = 0;
                mp.dmKills2++;
                updateDMDisplay();
                // Respawn P1 after delay
                p1.hp = 100;
                p1.container.alpha = 0.4;
                setTimeout(() => {
                    p1.container.x = window.state.world.width * 0.35;
                    p1.container.y = window.state.world.height / 2;
                    p1.container.alpha = 1;
                }, 2000);
            }
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  BULLET HIT PATCHES
    // ═════════════════════════════════════════════════════════════════════════
    function patchBulletHitChecks() {
        const wait = setInterval(() => {
            if (window.Bullet && window.Bullet.prototype && window.Bullet.prototype.update) {
                clearInterval(wait);
                doPatchBullet();
            }
        }, 100);
    }

    function doPatchBullet() {
        const orig = window.Bullet.prototype.update;
        window.Bullet.prototype.update = function (delta) {
            const result = orig.call(this, delta);
            if (mp.mode === 'none' || !window.state.gameStarted) return result;
            const p2 = mp.player2;
            const p1 = window.state.player;

            if (isPvP() && p2 && p1) {
                // P2 bullet hits P1
                if (this.owner === p2 && !this._hitSomething && p1) {
                    const dx = p1.container.x - this.sprite.x;
                    const dy = p1.container.y - this.sprite.y;
                    if (Math.sqrt(dx*dx + dy*dy) < 22) {
                        p1.takeDamage(this.damage);
                        window.spawnBloodSplatter && window.spawnBloodSplatter(this.sprite.x, this.sprite.y, 30);
                        this._hitSomething = true;
                        window.worldContainer.removeChild(this.sprite);
                        return false;
                    }
                }
                // P1 bullet hits P2
                if (this.owner !== p2 && !p2.dead && !this._hitSomething) {
                    const dx = p2.container.x - this.sprite.x;
                    const dy = p2.container.y - this.sprite.y;
                    if (Math.sqrt(dx*dx + dy*dy) < 22) {
                        p2.takeDamage(this.damage);
                        window.spawnBloodSplatter && window.spawnBloodSplatter(this.sprite.x, this.sprite.y, 30);
                        this._hitSomething = true;
                        window.worldContainer.removeChild(this.sprite);
                        return false;
                    }
                }
            }

            // Co-op: P2 bullets hit enemies
            if (mp.mode === 'coop' && p2 && this.owner === p2 && !this._hitSomething) {
                for (let i = window.state.enemies.length - 1; i >= 0; i--) {
                    const e = window.state.enemies[i];
                    const dx = e.container.x - this.sprite.x;
                    const dy = e.container.y - this.sprite.y;
                    if (Math.sqrt(dx*dx + dy*dy) < 22) {
                        e.takeDamage(this.damage);
                        window.spawnBloodSplatter && window.spawnBloodSplatter(this.sprite.x, this.sprite.y, 25);
                        this._hitSomething = true;
                        window.worldContainer.removeChild(this.sprite);
                        return false;
                    }
                }
            }

            return result;
        };
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ROUND / MATCH MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════
    function handleRoundEnd(winner) {
        if (mp.roundOver || mp.matchOver) return;
        mp.roundOver = true;
        mp.roundNum++;

        if (winner === 'p1wins') mp.p1Wins++;
        else mp.p2Wins++;

        const matchDone = (mp.p1Wins >= BO5_WINS_TO_WIN || mp.p2Wins >= BO5_WINS_TO_WIN);

        showRoundResult(winner, matchDone, () => {
            if (matchDone) {
                showMatchOver(winner);
            } else {
                // New round
                mp.roundOver = false;
                resetRound();
            }
        });
    }

    function resetRound() {
        const p1 = window.state.player;
        const p2 = mp.player2;
        if (p1) {
            p1.hp = p1.maxHp;
            p1.container.x = window.state.world.width * 0.35;
            p1.container.y = window.state.world.height / 2;
            p1.container.alpha = 1;
            p1.dead = false;
        }
        if (p2) {
            p2.respawn(window.state.world.width * 0.65, window.state.world.height / 2);
        }
    }

    function showRoundResult(winner, isMatch, onDone) {
        const c    = window.uiContainer;
        const W    = window.innerWidth, H = window.innerHeight;
        const ov   = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.85); ov.drawRect(0, 0, W, H); c.addChild(ov);

        const winnerName = winner === 'p1wins' ? 'UNION WINS THE ROUND!' : 'CONFEDERATE WINS THE ROUND!';
        const winColor   = winner === 'p1wins' ? COLORS.UNION : COLORS.CONFED;

        const t = new PIXI.Text(winnerName, {
            fontFamily:'Georgia,serif', fontSize: 50, fill: winColor, fontWeight:'bold', align:'center'
        });
        t.anchor.set(0.5); t.x = W/2; t.y = H/2 - 70; c.addChild(t);

        const score = new PIXI.Text(`Union: ${mp.p1Wins}   Confederate: ${mp.p2Wins}`, {
            fontFamily:'Georgia,serif', fontSize: 28, fill: 0xffffff
        });
        score.anchor.set(0.5); score.x = W/2; score.y = H/2 + 20; c.addChild(score);

        const next = isMatch ? 'Final result incoming…' : 'Next round in 3 seconds…';
        const sub = new PIXI.Text(next, {
            fontFamily:'Georgia,serif', fontSize: 20, fill: 0xaaaaaa
        });
        sub.anchor.set(0.5); sub.x = W/2; sub.y = H/2 + 70; c.addChild(sub);

        setTimeout(() => {
            c.removeChild(ov); c.removeChild(t); c.removeChild(score); c.removeChild(sub);
            onDone();
        }, 3000);
    }

    function showMatchOver(winner) {
        mp.matchOver = true;
        window.state.gameStarted = false;
        const c = window.uiContainer;
        const W = window.innerWidth, H = window.innerHeight;

        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.95); ov.drawRect(0, 0, W, H); c.addChild(ov);

        const winnerName = winner === 'p1wins' ? 'UNION VICTORIOUS!' : 'CONFEDERATE VICTORIOUS!';
        const winColor   = winner === 'p1wins' ? COLORS.UNION : COLORS.CONFED;

        const title = new PIXI.Text(winnerName, {
            fontFamily:'Georgia,serif', fontSize: 64, fill: winColor, fontWeight:'bold', align:'center'
        });
        title.anchor.set(0.5); title.x = W/2; title.y = H/2 - 100; c.addChild(title);

        const score = new PIXI.Text(
            `Final Score — Union: ${mp.p1Wins} wins   Confederate: ${mp.p2Wins} wins`,
            { fontFamily:'Georgia,serif', fontSize: 26, fill: 0xffffff, align: 'center' }
        );
        score.anchor.set(0.5); score.x = W/2; score.y = H/2; c.addChild(score);

        const again = _makeBtn('PLAY AGAIN', W/2, H/2 + 110, 240, 60, COLORS.BTN);
        again.on('pointerdown', () => location.reload());
        c.addChild(again);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  DEATHMATCH
    // ═════════════════════════════════════════════════════════════════════════
    let dmDisplay = null;

    function startDeathmatch() {
        mp.dmTimer  = DEATHMATCH_DURATION;
        mp.dmKills1 = 0;
        mp.dmKills2 = 0;

        // Build on-screen timer / kill counter
        if (dmDisplay) window.uiContainer.removeChild(dmDisplay);
        dmDisplay = new PIXI.Container();

        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.6);
        bg.drawRoundedRect(-130, -28, 260, 56, 10);
        dmDisplay.addChild(bg);

        dmDisplay.timerText = new PIXI.Text('3:00', {
            fontFamily:'Georgia,serif', fontSize: 26, fill: 0xffd700,
            stroke: 0x000000, strokeThickness: 3
        });
        dmDisplay.timerText.anchor.set(0.5);
        dmDisplay.timerText.y = -6;
        dmDisplay.addChild(dmDisplay.timerText);

        dmDisplay.killText = new PIXI.Text('P1: 0   P2: 0', {
            fontFamily:'Georgia,serif', fontSize: 14, fill: 0xcccccc
        });
        dmDisplay.killText.anchor.set(0.5);
        dmDisplay.killText.y = 16;
        dmDisplay.addChild(dmDisplay.killText);

        dmDisplay.x = window.innerWidth / 2;
        dmDisplay.y = 50;
        window.uiContainer.addChild(dmDisplay);
    }

    function updateDMDisplay() {
        if (!dmDisplay) return;
        const s = Math.max(0, Math.floor(mp.dmTimer));
        const m = Math.floor(s / 60);
        const sec = s % 60;
        dmDisplay.timerText.text = `${m}:${sec.toString().padStart(2,'0')}`;
        dmDisplay.timerText.style.fill = mp.dmTimer < 30 ? 0xff4444 : 0xffd700;
        dmDisplay.killText.text = `Union Kills: ${mp.dmKills1}   Confederate Kills: ${mp.dmKills2}`;
    }

    function endDeathmatch() {
        if (mp.roundOver || mp.matchOver) return;
        mp.roundOver = true;
        mp.matchOver = true;
        window.state.gameStarted = false;
        if (dmDisplay) { window.uiContainer.removeChild(dmDisplay); dmDisplay = null; }

        const winner = mp.dmKills1 > mp.dmKills2 ? 'p1wins' : mp.dmKills2 > mp.dmKills1 ? 'p2wins' : 'draw';
        showDMResult(winner);
    }

    function showDMResult(winner) {
        const c = window.uiContainer;
        const W = window.innerWidth, H = window.innerHeight;
        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.95); ov.drawRect(0, 0, W, H); c.addChild(ov);

        const labels = { p1wins:'UNION WINS THE DEATHMATCH!', p2wins:'CONFEDERATE WINS THE DEATHMATCH!', draw:'A BLOODY DRAW!' };
        const colors = { p1wins: COLORS.UNION, p2wins: COLORS.CONFED, draw: COLORS.GOLD };

        const title = new PIXI.Text(labels[winner], {
            fontFamily:'Georgia,serif', fontSize: 52, fill: colors[winner], fontWeight:'bold', align:'center'
        });
        title.anchor.set(0.5); title.x = W/2; title.y = H/2 - 90; c.addChild(title);

        const kills = new PIXI.Text(`Union: ${mp.dmKills1} kills   Confederate: ${mp.dmKills2} kills`, {
            fontFamily:'Georgia,serif', fontSize: 28, fill: 0xffffff
        });
        kills.anchor.set(0.5); kills.x = W/2; kills.y = H/2; c.addChild(kills);

        const again = _makeBtn('PLAY AGAIN', W/2, H/2 + 100, 240, 60, COLORS.BTN);
        again.on('pointerdown', () => location.reload());
        c.addChild(again);
    }

    function respawnP2() {
        if (!mp.player2) return;
        setTimeout(() => {
            if (mp.player2) mp.player2.respawn(window.state.world.width * 0.65, window.state.world.height / 2);
        }, 2000);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CAPTURE THE FLAG
    // ═════════════════════════════════════════════════════════════════════════
    function spawnCTFFlags() {
        const W = window.state.world.width;
        const H = window.state.world.height;
        mp.ctfFlags = [];

        // P1 base flag (Union) — left side
        const f1 = _makeCTFFlag(W * 0.2, H / 2, 'union');
        mp.ctfFlags.push(f1);

        // P2 base flag (Confederate) — right side
        const f2 = _makeCTFFlag(W * 0.8, H / 2, 'confed');
        mp.ctfFlags.push(f2);

        // CTF scoreboard
        if (!window._ctfScoreDisplay) {
            const disp = new PIXI.Container();
            const bg = new PIXI.Graphics();
            bg.beginFill(0x000000, 0.65);
            bg.drawRoundedRect(-150, -22, 300, 44, 8);
            disp.addChild(bg);
            disp.scoreText = new PIXI.Text(`Union: 0   Confederate: 0`, {
                fontFamily:'Georgia,serif', fontSize: 18, fill: 0xffd700,
                stroke:0x000000, strokeThickness:3
            });
            disp.scoreText.anchor.set(0.5);
            disp.addChild(disp.scoreText);
            disp.x = window.innerWidth / 2;
            disp.y = 50;
            window.uiContainer.addChild(disp);
            window._ctfScoreDisplay = disp;
        }

        // Hook into main ticker to check captures
        window.app.ticker.add(() => {
            if (!window.state.gameStarted || mp.mode !== 'pvp_ctf') return;
            checkCTFPickup(window.state.player, 1);
            if (mp.player2) checkCTFPickup(mp.player2, 2);
        });
    }

    function _makeCTFFlag(x, y, side) {
        const flag = {
            x, y, side,
            homeX: x, homeY: y,
            carried: false,
            carrier: null,
            sprite: null,
            poleSprite: null,
        };

        const g = new PIXI.Graphics();
        // Pole
        g.lineStyle(3, 0x8b6914, 1);
        g.moveTo(0, 0); g.lineTo(0, -50);
        // Flag cloth
        g.lineStyle(0);
        g.beginFill(side === 'union' ? COLORS.UNION : COLORS.CONFED);
        g.drawRect(0, -50, 30, 18);
        g.endFill();
        g.beginFill(0xffffff, 0.5);
        g.drawRect(0, -50, 10, 6);
        g.drawRect(20, -44, 10, 6);
        g.endFill();

        // Base marker
        const base = new PIXI.Graphics();
        base.lineStyle(2, side === 'union' ? COLORS.UNION : COLORS.CONFED, 0.5);
        base.drawCircle(0, 0, 40);

        g.x = x; g.y = y;
        base.x = x; base.y = y;
        window.worldContainer.addChild(base);
        window.worldContainer.addChild(g);
        flag.sprite = g;
        flag.baseCircle = base;
        return flag;
    }

    function checkCTFPickup(player, playerNum) {
        if (mp.mode !== 'pvp_ctf' || mp.matchOver) return;
        const px = player.container.x, py = player.container.y;
        const enemyFlag = playerNum === 1 ? mp.ctfFlags[1] : mp.ctfFlags[0];
        const homeFlag  = playerNum === 1 ? mp.ctfFlags[0] : mp.ctfFlags[1];

        // Pick up enemy flag
        if (!enemyFlag.carried && !enemyFlag.returned) {
            const dx = px - enemyFlag.x, dy = py - enemyFlag.y;
            if (Math.sqrt(dx*dx + dy*dy) < 35) {
                enemyFlag.carried = true;
                enemyFlag.carrier = player;
            }
        }

        // Move carried flag with player
        if (enemyFlag.carried && enemyFlag.carrier === player) {
            enemyFlag.sprite.x = px;
            enemyFlag.sprite.y = py - 20;

            // Return to home base = score!
            const hx = homeFlag.homeX, hy = homeFlag.homeY;
            const dx = px - hx, dy = py - hy;
            if (Math.sqrt(dx*dx + dy*dy) < 40) {
                // Score!
                if (playerNum === 1) mp.ctfScore1++;
                else mp.ctfScore2++;

                // Reset enemy flag
                enemyFlag.carried = false;
                enemyFlag.carrier = null;
                enemyFlag.sprite.x = enemyFlag.homeX;
                enemyFlag.sprite.y = enemyFlag.homeY;

                _updateCTFDisplay();

                if (mp.ctfScore1 >= CTF_SCORE_TO_WIN || mp.ctfScore2 >= CTF_SCORE_TO_WIN) {
                    endCTF();
                }
            }
        }
    }

    function _updateCTFDisplay() {
        if (window._ctfScoreDisplay) {
            window._ctfScoreDisplay.scoreText.text =
                `Union 🚩 ${mp.ctfScore1}   Confederate 🚩 ${mp.ctfScore2}   (First to ${CTF_SCORE_TO_WIN})`;
        }
    }

    function endCTF() {
        if (mp.matchOver) return;
        mp.matchOver = true;
        window.state.gameStarted = false;
        const winner = mp.ctfScore1 >= CTF_SCORE_TO_WIN ? 'p1wins' : 'p2wins';
        if (window._ctfScoreDisplay) { window.uiContainer.removeChild(window._ctfScoreDisplay); window._ctfScoreDisplay = null; }

        const c = window.uiContainer;
        const W = window.innerWidth, H = window.innerHeight;
        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.95); ov.drawRect(0, 0, W, H); c.addChild(ov);

        const title = new PIXI.Text(
            winner === 'p1wins' ? 'UNION CAPTURES THE FLAG!' : 'CONFEDERATE CAPTURES THE FLAG!',
            { fontFamily:'Georgia,serif', fontSize: 50, fill: winner === 'p1wins' ? COLORS.UNION : COLORS.CONFED, fontWeight:'bold', align:'center' }
        );
        title.anchor.set(0.5); title.x = W/2; title.y = H/2 - 80; c.addChild(title);

        const score = new PIXI.Text(`Union: ${mp.ctfScore1}   Confederate: ${mp.ctfScore2}`, {
            fontFamily:'Georgia,serif', fontSize: 28, fill: 0xffffff
        });
        score.anchor.set(0.5); score.x = W/2; score.y = H/2; c.addChild(score);

        const again = _makeBtn('PLAY AGAIN', W/2, H/2 + 100, 240, 60, COLORS.BTN);
        again.on('pointerdown', () => location.reload());
        c.addChild(again);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  UTILITIES
    // ═════════════════════════════════════════════════════════════════════════
    function _makeBtn(label, x, y, w, h, color) {
        const btn = new PIXI.Container();
        const bg  = new PIXI.Graphics();
        bg.beginFill(color);
        bg.drawRoundedRect(-w/2, -h/2, w, h, 12);
        btn.addChild(bg);
        const t = new PIXI.Text(label, {
            fontFamily:'Georgia,serif', fontSize: Math.min(20, h * 0.4),
            fill:0xffffff, align:'center',
            stroke: 0x000000, strokeThickness: 2
        });
        t.anchor.set(0.5);
        btn.addChild(t);
        btn.x = x; btn.y = y;
        btn.eventMode = 'static'; btn.cursor = 'pointer';
        btn.on('pointerover',  () => { bg.tint = 0xccccff; });
        btn.on('pointerout',   () => { bg.tint = 0xffffff; });
        btn._bg = bg; btn._label = t;
        return btn;
    }

    function _makeSmallBtn(label, x, y) {
        const btn = new PIXI.Container();
        const bg  = new PIXI.Graphics();
        bg.beginFill(0x333344);
        bg.drawRoundedRect(0, -16, 140, 32, 8);
        btn.addChild(bg);
        const t = new PIXI.Text(label, {
            fontFamily:'Georgia,serif', fontSize: 16, fill: 0xcccccc
        });
        t.anchor.set(0, 0.5);
        t.x = 12;
        btn.addChild(t);
        btn.x = x; btn.y = y;
        btn.eventMode = 'static'; btn.cursor = 'pointer';
        btn.on('pointerover', () => { bg.tint = 0xaaaacc; });
        btn.on('pointerout',  () => { bg.tint = 0xffffff; });
        return btn;
    }

    function _drawPanel(parent, x, y, w, h) {
        const g = new PIXI.Graphics();
        g.beginFill(0x0a0a1a, 0.7);
        g.lineStyle(1.5, COLORS.SEPIA, 0.4);
        g.drawRoundedRect(x, y, w, h, 12);
        parent.addChild(g);
    }

    function _highlightBtn(btn, active) {
        if (!btn._bg) return;
        btn._bg.clear();
        btn._bg.beginFill(active ? COLORS.BTN_HOV : COLORS.BTN);
        btn._bg.drawRoundedRect(-130, -28, 260, 56, 12);
        if (active) {
            btn._bg.lineStyle(2, COLORS.GOLD, 0.8);
            btn._bg.drawRoundedRect(-130, -28, 260, 56, 12);
        }
    }

    function _tintSprites(player, color) {
        if (!player || !player.container) return;
        player.container.children.forEach(c => {
            if (c instanceof PIXI.Sprite) c.tint = color;
        });
    }

    function _addLabel(player, text, color) {
        if (!player || !player.container) return;
        const lbl = new PIXI.Text(text, {
            fontFamily:'Georgia,serif', fontSize: 12,
            fill: color, stroke: 0x000000, strokeThickness: 2
        });
        lbl.anchor.set(0.5); lbl.y = -32;
        player.container.addChild(lbl);
    }

    function _randomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    function loadPeerJS(cb) {
        if (window.Peer) { cb(); return; }
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        s.onload = cb;
        s.onerror = () => {
            // Try alternate CDN
            const s2 = document.createElement('script');
            s2.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
            s2.onload = cb;
            document.head.appendChild(s2);
        };
        document.head.appendChild(s);
    }

})();
