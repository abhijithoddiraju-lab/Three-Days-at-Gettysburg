// ============================================================================
//  THREE DAYS AT GETTYSBURG — ONLINE MULTIPLAYER
//  - Online-only via PeerJS (browser-to-browser WebRTC)
//  - Up to 10 players per server (host + 9 guests)
//  - Host acts as a relay; all guests connect only to the host
//  - Modes: Co-op  |  Best of 5 (1v1)  |  Deathmatch (FFA)  |  CTF (1v1)
//  - All players use the same Union sprite set; remotes are tinted by faction
//  - Same terrain seed shared across all peers
//  - Off-screen players show an on-screen arrow pointing toward them
// ============================================================================
(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────────
    const COLORS = {
        UNION:   0x4a90d9,
        CONFED:  0xc0392b,
        GOLD:    0xf0c040,
        GREEN:   0x2e7d32,
        BTN:     0x2b3d5b,
        BTN_HOV: 0x4a5d8b,
        SEPIA:   0xb89968,
        DARK:    0x0a0a1a,
    };
    const MAX_PLAYERS         = 10;
    const DEATHMATCH_DURATION = 180;   // seconds
    const CTF_SCORE_TO_WIN    = 3;
    const BO5_WINS_TO_WIN     = 3;
    const RESPAWN_DELAY       = 1500;  // ms (deathmatch)
    const ROUND_RESET_DELAY   = 3000;  // ms (BO5)
    const REVIVE_RANGE        = 60;    // px
    const REVIVE_HOLD_TICKS   = 180;   // ~3 seconds @ 60fps
    const REVIVE_HP_RESTORE   = 0.5;   // restore to 50% HP
    const WOUNDED_SOLDIER_SPRITE = 'assets/wounded_union.png';

    // Per-pid faction colors (host = pid 0 = Union; guests are mostly red shades)
    const PID_COLORS = [
        0x4a90d9, // 0 host  – Union blue
        0xc0392b, // 1       – Confederate red
        0xe67e22, // 2       – orange
        0xf1c40f, // 3       – gold
        0x9b59b6, // 4       – purple
        0x16a085, // 5       – teal
        0xe84393, // 6       – pink
        0x2ecc71, // 7       – green
        0xd35400, // 8       – burnt
        0x7f8c8d, // 9       – grey
    ];

    // ── Multiplayer state ──────────────────────────────────────────────────
    const mp = {
        active: false,
        isHost: false,
        peer: null,
        connected: false,
        mode: 'coop',                      // 'coop' | 'pvp_bo5' | 'pvp_dm' | 'pvp_ctf'

        localPid: -1,                      // 0 = host, 1-9 = guest
        nextGuestPid: 1,                   // host-only, increments on each accepted connection
        connsByPid: new Map(),             // host-only: pid → DataConnection
        hostConn: null,                    // guest-only: connection to host

        players: new Map(),                // ALL peers: pid → RemotePlayer (excludes self)
        remoteStates: new Map(),           // ALL peers: pid → last-known network state

        terrainSeed: 0,                    // shared world seed

        // Match state
        p1Wins: 0, p2Wins: 0,
        roundOver: false, matchOver: false,
        dmTimer: 0,
        dmKills: new Map(),                // pid → kill count (FFA)
        ctfFlags: [], ctfScore1: 0, ctfScore2: 0,
        ctfDisplay: null,
        dmDisplay: null,

        syncTick: 0,
        sendDamage: () => {},              // legacy stub (victim-authoritative now)
        sendToHost,
        broadcast,
    };
    window.mp = mp;
    // Backward-compat shim used by older bullet logic / mode helpers
    Object.defineProperty(mp, 'remote', {
        get() {
            // Return the "primary" opponent (first remote pid) for 1v1 mode logic
            for (const rp of mp.players.values()) return rp;
            return null;
        },
    });
    Object.defineProperty(mp, 'remoteState', {
        get() {
            for (const s of mp.remoteStates.values()) return s;
            return { x: 0, y: 0, hp: 100, maxHp: 100, dead: false };
        },
    });

    // Public entry point for the main-menu Multiplayer button
    window.openMultiplayerLobby = openMultiplayerLobby;

    // Bootstrap once main.js is ready
    waitForBoot(init);

    function waitForBoot(cb) {
        const tick = () => {
            if (window.state && window.state.ui && window.app && window.worldContainer && window.startGame) cb();
            else setTimeout(tick, 80);
        };
        tick();
    }

    function init() {
        patchStartGame();
        installGameLoop();
        hookPlayerFire();
        installReviveInput();
    }

    // ────────────────────────────────────────────────────────────────────────
    //  REVIVE INPUT — hold V near a downed teammate
    // ────────────────────────────────────────────────────────────────────────
    const reviveInput = { holding: false, targetPid: -1, progress: 0 };
    function installReviveInput() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyV') reviveInput.holding = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyV') reviveInput.holding = false;
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  LOBBY
    // ════════════════════════════════════════════════════════════════════════
    let lobby = null;

    function openMultiplayerLobby() {
        const ui = window.state.ui;
        const c  = window.uiContainer;
        if (lobby) return;

        ui.menu.visible = false;

        const W = window.innerWidth;
        const H = window.innerHeight;

        const root = new PIXI.Container();

        // Background
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.95); bg.drawRect(0, 0, W, H);
        root.addChild(bg);

        // Decorative border
        const border = new PIXI.Graphics();
        border.lineStyle(3, COLORS.SEPIA, 0.6);
        border.drawRoundedRect(36, 36, W - 72, H - 72, 18);
        root.addChild(border);

        // Title
        root.addChild(_text('ONLINE MULTIPLAYER', W/2, 92, {
            fontSize: 46, fill: COLORS.GOLD, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 5
        }));
        root.addChild(_text(`Up to ${MAX_PLAYERS} players · Host or join with a Room Code`, W/2, 138, {
            fontSize: 17, fill: 0x9999bb, fontStyle: 'italic'
        }));

        // Two columns: HOST / JOIN
        const colMid = W / 2;
        const panelTop = 175;
        const panelHeight = H - 175 - 240;
        const colW = (W - 60 * 2 - 42) / 2;
        const leftPanelX  = 48;
        const rightPanelX = colMid + 6;

        _drawPanel(root, leftPanelX,  panelTop, colW, panelHeight);
        _drawPanel(root, rightPanelX, panelTop, colW, panelHeight);

        const leftMid  = leftPanelX  + colW / 2;
        const rightMid = rightPanelX + colW / 2;

        // ── HOST panel ───────────────────────────────────────────────────
        root.addChild(_text('HOST A GAME', leftMid, panelTop + 38, { fontSize: 22, fill: COLORS.GOLD, fontWeight: 'bold' }));
        root.addChild(_text(`Create a server (max ${MAX_PLAYERS} players) and share the code.`,
            leftMid, panelTop + 70, { fontSize: 13, fill: 0xccddff, align: 'center', wordWrap: true, wordWrapWidth: colW - 30 }));

        const hostBtn = _btn('🏠  CREATE ROOM', leftMid, panelTop + 122, 260, 54, COLORS.GREEN);
        root.addChild(hostBtn);

        const hostStatus = _text('', leftMid, panelTop + 190, { fontSize: 14, fill: 0xccddff, align: 'center', wordWrap: true, wordWrapWidth: colW - 28 });
        hostStatus.text = 'Click "Create Room" to begin.';
        root.addChild(hostStatus);

        const hostCode = _text('', leftMid, panelTop + 246, {
            fontSize: 24, fill: 0x88ff88, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3,
            wordWrap: true, wordWrapWidth: colW - 18, align: 'center', letterSpacing: 1
        });
        hostCode.style.fontFamily = '"Courier New", monospace';
        root.addChild(hostCode);

        const copyHint = _text('', leftMid, panelTop + 284, { fontSize: 12, fill: 0xaaaa88 });
        root.addChild(copyHint);

        // Live "X / 10 players" count + small list of joined pids
        const playerCount = _text('', leftMid, panelTop + 320, { fontSize: 15, fill: 0xffd700, fontWeight: 'bold' });
        root.addChild(playerCount);
        const playerList = _text('', leftMid, panelTop + 345, {
            fontSize: 12, fill: 0xaaccee, align: 'center', wordWrap: true, wordWrapWidth: colW - 18
        });
        root.addChild(playerList);
        function refreshHostPlayerList() {
            if (!mp.isHost) return;
            const total = 1 + mp.connsByPid.size; // host + guests
            playerCount.text = `Players in lobby: ${total} / ${MAX_PLAYERS}`;
            const labels = ['You (Host, P1)'];
            const pids = Array.from(mp.connsByPid.keys()).sort((a, b) => a - b);
            pids.forEach(pid => labels.push(`P${pid + 1}`));
            playerList.text = labels.join('  ·  ');
        }
        mp._refreshHostPlayerList = refreshHostPlayerList;

        hostBtn.on('pointerdown', () => doHost(hostBtn, hostStatus, hostCode, copyHint, refreshHostPlayerList));

        // ── JOIN panel ───────────────────────────────────────────────────
        root.addChild(_text('JOIN A GAME', rightMid, panelTop + 38, { fontSize: 22, fill: COLORS.GOLD, fontWeight: 'bold' }));
        root.addChild(_text('Enter your friend\'s Room Code below:', rightMid, panelTop + 70, { fontSize: 14, fill: 0xccddff }));

        // HTML input — repositioned on resize
        const htmlInput = document.createElement('input');
        htmlInput.type = 'text';
        htmlInput.placeholder = 'ROOM CODE';
        htmlInput.maxLength = 12;
        htmlInput.autocomplete = 'off';
        htmlInput.spellcheck = false;
        Object.assign(htmlInput.style, {
            position: 'absolute',
            width: '260px',
            padding: '14px 12px',
            background: '#1a1a2e',
            color: '#88ff88',
            border: '2px solid #4a90d9',
            borderRadius: '10px',
            fontFamily: '"Courier New", monospace',
            fontSize: '24px',
            textAlign: 'center',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            outline: 'none',
            zIndex: '10000',
            fontWeight: 'bold',
            boxShadow: '0 0 12px rgba(74,144,217,0.4)',
        });
        htmlInput.addEventListener('input', () => {
            htmlInput.value = htmlInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
        document.body.appendChild(htmlInput);

        function positionInput() {
            const view = window.app && window.app.view;
            const rect = view ? view.getBoundingClientRect() : { left: 0, top: 0 };
            const left = rect.left + rightMid - 130;
            const top  = rect.top  + panelTop + 110;
            htmlInput.style.left = left + 'px';
            htmlInput.style.top  = top + 'px';
        }
        positionInput();
        const onResize = () => positionInput();
        window.addEventListener('resize', onResize);

        const joinBtn = _btn('🌐  JOIN ROOM', rightMid, panelTop + 204, 260, 54, COLORS.BTN);
        root.addChild(joinBtn);

        const joinStatus = _text('', rightMid, panelTop + 270, {
            fontSize: 14, fill: 0xccddff, align: 'center', wordWrap: true, wordWrapWidth: colW - 28
        });
        root.addChild(joinStatus);

        joinBtn.on('pointerdown', () => {
            const code = (htmlInput.value || '').trim().toUpperCase();
            if (code.length < 3) {
                joinStatus.text = '⚠  Please enter a Room Code first.';
                joinStatus.style.fill = 0xff8888;
                return;
            }
            doJoin(code, joinBtn, joinStatus);
        });

        // ── Mode selection panel (bottom) ─────────────────────────────────
        const modePanelY = H - 220;
        _drawPanel(root, 70, modePanelY, W - 140, 110);

        root.addChild(_text('GAME MODE', W/2, modePanelY + 22, { fontSize: 17, fill: COLORS.GOLD, fontWeight: 'bold' }));

        const modes = [
            { key: 'coop',    label: '🤝  CO-OP',           desc: `Co-op: Hold the line together (up to ${MAX_PLAYERS} players).` },
            { key: 'pvp_bo5', label: '🏆  BEST OF 5',       desc: `Best of 5 (1v1 host vs first guest): First to ${BO5_WINS_TO_WIN} wins.` },
            { key: 'pvp_dm',  label: '⏱  DEATHMATCH',       desc: `Deathmatch (FFA): ${DEATHMATCH_DURATION/60} minutes — most kills wins.` },
            { key: 'pvp_ctf', label: '🚩  CAPTURE THE FLAG', desc: `CTF (1v1): First to ${CTF_SCORE_TO_WIN} flag captures wins.` },
        ];
        const modeBtnW = 220;
        const totalW   = modes.length * modeBtnW + (modes.length - 1) * 14;
        const startX   = (W - totalW) / 2 + modeBtnW / 2;

        const modeButtons = [];
        const modeDesc = _text('', W/2, modePanelY + 92, { fontSize: 13, fill: 0xaaaacc, align: 'center' });
        root.addChild(modeDesc);

        modes.forEach((m, i) => {
            const b = _btn(m.label, startX + i * (modeBtnW + 14), modePanelY + 56, modeBtnW, 38, COLORS.BTN);
            b.on('pointerdown', () => {
                if (!mp.isHost) return;             // only host picks the mode
                mp.mode = m.key;
                modes.forEach((mm, j) => _highlight(modeButtons[j], mm.key === mp.mode));
                modeDesc.text = m.desc;
                broadcast({ type: 'config', mode: mp.mode });
            });
            modeButtons.push(b);
            root.addChild(b);
        });
        _highlight(modeButtons[0], true);
        mp.mode = 'coop';
        modeDesc.text = modes[0].desc;

        // ── Deploy button ────────────────────────────────────────────────
        const deployBtn = _btn('⚔  DEPLOY', W/2, H - 60, 280, 60, COLORS.GREEN);
        deployBtn.alpha = 0.4; deployBtn.eventMode = 'none';
        root.addChild(deployBtn);

        deployBtn.on('pointerdown', () => {
            if (!mp.isHost) return;
            // Generate a fresh shared terrain seed
            mp.terrainSeed = (Math.random() * 0x7fffffff) | 0 || 1;
            window.state.terrainSeed = mp.terrainSeed;
            broadcast({ type: 'start', mode: mp.mode, terrainSeed: mp.terrainSeed });
            cleanupLobby();
            launchMultiplayer();
        });

        function refreshDeploy() {
            const can = mp.isHost && mp.connected;
            deployBtn.alpha = can ? 1 : 0.4;
            deployBtn.eventMode = can ? 'static' : 'none';
            if (mp.isHost && !mp.connected) {
                deployBtn._label.text = 'WAITING FOR PLAYERS…';
            } else if (mp.isHost) {
                deployBtn._label.text = '⚔  DEPLOY';
            } else if (mp.connected) {
                deployBtn._label.text = 'WAITING FOR HOST…';
            }
        }
        refreshDeploy();

        function cleanupLobby() {
            try { window.removeEventListener('resize', onResize); } catch (e) {}
            try { htmlInput.remove(); } catch (e) {}
            try { c.removeChild(root); } catch (e) {}
            lobby = null;
        }

        c.addChild(root);
        lobby = { root, htmlInput, onResize, refreshDeploy, cleanupLobby };
    }

    // ════════════════════════════════════════════════════════════════════════
    //  PEERJS HOST / JOIN
    // ════════════════════════════════════════════════════════════════════════
    //  Cross-network connectivity needs both STUN (find your public IP) AND
    //  TURN (relay traffic when peers can't see each other directly — common
    //  on mobile networks, corporate Wi-Fi, and symmetric NATs). The default
    //  PeerJS broker only ships STUN, which is why "won't connect across
    //  devices" happens. We supply both below.
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        // Open Relay Project — free public TURN
        { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ];
    function peerOpts(extra) {
        return Object.assign({
            debug: 1,
            config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 },
        }, extra || {});
    }
    function describeErr(err) {
        if (!err) return 'connection error';
        const t = err.type || '';
        const m = err.message || String(err);
        switch (t) {
            case 'unavailable-id':    return 'That code is taken. Try again.';
            case 'peer-unavailable':  return 'No host with that code. Double-check the code.';
            case 'network':           return 'Network error. Check your internet and retry.';
            case 'disconnected':      return 'Disconnected from matchmaking. Retry.';
            case 'server-error':      return 'Matchmaking server is down. Try again in a moment.';
            case 'browser-incompatible': return 'This browser does not support WebRTC.';
            case 'webrtc':            return 'WebRTC blocked (firewall/VPN?). Try another network.';
            case 'ssl-unavailable':   return 'Secure connection unavailable.';
            case 'socket-error':
            case 'socket-closed':     return 'Lost matchmaking connection. Retry.';
            default:                  return (t ? t + ': ' : '') + m;
        }
    }

    function doHost(btn, status, codeText, copyHint, refreshList) {
        btn.eventMode = 'none'; btn.alpha = 0.4;
        status.text = '⏳  Initialising server…';
        status.style.fill = 0xccddff;

        loadPeerJS(() => {
            mp.isHost = true;
            mp.localPid = 0;
            mp.nextGuestPid = 1;

            let attempts = 0;
            tryOpen();

            function tryOpen() {
                attempts++;
                const code = randomCode();
                try {
                    if (mp.peer) { try { mp.peer.destroy(); } catch (e) {} }
                    mp.peer = new Peer(code, peerOpts());
                } catch (e) {
                    fail('Could not start. Try again.');
                    return;
                }
                mp.peer.on('open', (id) => {
                    codeText.text = id;
                    status.text = '✅  Server up!\nWaiting for players to join…';
                    status.style.fill = 0x88ff88;
                    copyHint.text = '(click code to copy)';
                    codeText.eventMode = 'static';
                    codeText.cursor = 'pointer';
                    codeText.on('pointerdown', () => {
                        try {
                            navigator.clipboard.writeText(id);
                            copyHint.text = '✓  Copied!';
                            setTimeout(() => copyHint.text = '(click code to copy)', 1500);
                        } catch (e) {}
                    });
                    if (refreshList) refreshList();
                    if (lobby) lobby.refreshDeploy();
                });
                mp.peer.on('connection', (conn) => {
                    if (mp.connsByPid.size >= MAX_PLAYERS - 1) {
                        // Server full — politely refuse
                        conn.on('open', () => {
                            try { conn.send({ type: 'kick', reason: `Server full (${MAX_PLAYERS} max)` }); } catch (e) {}
                            setTimeout(() => { try { conn.close(); } catch (e) {} }, 250);
                        });
                        return;
                    }
                    const pid = mp.nextGuestPid++;
                    wireGuestConn(conn, pid, status, refreshList);
                });
                mp.peer.on('error', (err) => {
                    // If our random code collided, just try a different one (a few times).
                    if (err && err.type === 'unavailable-id' && attempts < 5) {
                        status.text = '⏳  Code taken — generating a new one…';
                        try { mp.peer.destroy(); } catch (e) {}
                        setTimeout(tryOpen, 150);
                        return;
                    }
                    fail(describeErr(err));
                });
            }

            function fail(msg) {
                status.text = '❌  ' + msg;
                status.style.fill = 0xff6666;
                btn.eventMode = 'static'; btn.alpha = 1;
            }
        });
    }

    function doJoin(code, btn, status) {
        btn.eventMode = 'none'; btn.alpha = 0.4;
        status.text = '⏳  Connecting to host…';
        status.style.fill = 0xccddff;

        loadPeerJS(() => {
            mp.isHost = false;
            try {
                if (mp.peer) { try { mp.peer.destroy(); } catch (e) {} }
                mp.peer = new Peer(peerOpts());
            } catch (e) {
                fail('Could not start. Try again.');
                return;
            }
            let openTimer = null;
            mp.peer.on('open', () => {
                status.text = '⏳  Reaching host…';
                const conn = mp.peer.connect(code, { reliable: true });
                mp.hostConn = conn;
                wireHostConn(conn, status);
                // If the host code doesn't exist, PeerJS sometimes never resolves —
                // surface a clear timeout so the player isn't left guessing.
                openTimer = setTimeout(() => {
                    if (!mp.connected) fail('Could not reach host. Check the code, then retry.');
                }, 12000);
                conn.on('open', () => { if (openTimer) { clearTimeout(openTimer); openTimer = null; } });
            });
            mp.peer.on('error', (err) => {
                if (openTimer) { clearTimeout(openTimer); openTimer = null; }
                fail(describeErr(err));
            });

            function fail(msg) {
                status.text = '❌  ' + msg;
                status.style.fill = 0xff6666;
                btn.eventMode = 'static'; btn.alpha = 1;
            }
        });
    }

    // ── Host side: handle a single guest connection ────────────────────────
    function wireGuestConn(conn, pid, hostStatus, refreshList) {
        conn.on('open', () => {
            mp.connsByPid.set(pid, conn);
            mp.connected = true;

            // Tell the new guest who they are + everyone already in the room
            const peers = [{ pid: 0, color: PID_COLORS[0], label: 'Player 1 (Host)' }];
            for (const otherPid of mp.connsByPid.keys()) {
                if (otherPid === pid) continue;
                peers.push({ pid: otherPid, color: PID_COLORS[otherPid % PID_COLORS.length], label: `Player ${otherPid + 1}` });
            }
            try {
                conn.send({
                    type: 'welcome',
                    yourPid: pid,
                    mode: mp.mode,
                    terrainSeed: mp.terrainSeed,
                    peers,
                });
            } catch (e) {}

            // Notify existing guests that someone joined
            const announce = { type: 'peerjoin', pid, color: PID_COLORS[pid % PID_COLORS.length], label: `Player ${pid + 1}` };
            for (const [otherPid, otherConn] of mp.connsByPid.entries()) {
                if (otherPid === pid) continue;
                try { otherConn.send(announce); } catch (e) {}
            }

            if (hostStatus) {
                const total = 1 + mp.connsByPid.size;
                hostStatus.text = `✅  ${total}/${MAX_PLAYERS} players in lobby. Choose a mode and Deploy when ready.`;
                hostStatus.style.fill = 0x88ff88;
            }
            if (refreshList) refreshList();
            if (lobby) lobby.refreshDeploy();
        });

        conn.on('data', (data) => onHostReceive(pid, data));

        conn.on('close', () => handleGuestLeft(pid, hostStatus, refreshList));
        conn.on('error', () => handleGuestLeft(pid, hostStatus, refreshList));
    }

    function handleGuestLeft(pid, hostStatus, refreshList) {
        if (!mp.connsByPid.has(pid)) return;
        mp.connsByPid.delete(pid);
        mp.remoteStates.delete(pid);
        if (mp.players.has(pid)) {
            const rp = mp.players.get(pid);
            try { window.worldContainer.removeChild(rp.container); } catch (e) {}
            if (rp.arrow && rp.arrow.parent) try { rp.arrow.parent.removeChild(rp.arrow); } catch (e) {}
            mp.players.delete(pid);
        }
        // Tell remaining guests
        const msg = { type: 'peerleave', pid };
        for (const c of mp.connsByPid.values()) {
            try { c.send(msg); } catch (e) {}
        }
        if (mp.connsByPid.size === 0) mp.connected = false;
        if (hostStatus) {
            const total = 1 + mp.connsByPid.size;
            hostStatus.text = `Player ${pid + 1} left. ${total}/${MAX_PLAYERS} in lobby.`;
            hostStatus.style.fill = 0xffaa88;
        }
        if (refreshList) refreshList();
        if (lobby) lobby.refreshDeploy();
    }

    // ── Guest side: handle the connection back to the host ────────────────
    function wireHostConn(conn, status) {
        conn.on('open', () => {
            mp.connected = true;
            if (status) {
                status.text = '✅  Connected to host! Waiting for game start…';
                status.style.fill = 0x88ff88;
            }
            if (lobby) lobby.refreshDeploy();
        });
        conn.on('data', onGuestReceive);
        conn.on('close', () => {
            mp.connected = false;
            if (status) {
                status.text = '⚠  Connection to host lost.';
                status.style.fill = 0xff8888;
            }
        });
        conn.on('error', (err) => {
            if (status) {
                status.text = '❌  ' + (err && (err.type || err.message) || err);
                status.style.fill = 0xff6666;
            }
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  HOST: receive from a guest (also relay to others)
    // ════════════════════════════════════════════════════════════════════════
    function onHostReceive(senderPid, data) {
        if (!data || !data.type) return;
        // Stamp sender pid
        data.pid = senderPid;

        switch (data.type) {
            case 'state':
                mp.remoteStates.set(senderPid, data.s);
                updateTeamDeathState(senderPid, data.s || {});
                relayToOthers(senderPid, data);
                break;
            case 'fire':
                spawnRemoteShot(senderPid, data);
                relayToOthers(senderPid, data);
                break;
            case 'ctfgrab':
            case 'ctfdrop':
                relayToOthers(senderPid, data);
                applyCTFEvent(data);
                break;
            case 'revive':
                // A guest is reviving someone — route to the target
                routeRevive(data);
                break;
            // Guest-originated mode events are ignored on host (host is authoritative)
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  GUEST: receive from host
    // ════════════════════════════════════════════════════════════════════════
    function onGuestReceive(data) {
        if (!data || !data.type) return;
        switch (data.type) {
            case 'welcome':
                mp.localPid = data.yourPid;
                mp.mode = data.mode || 'coop';
                mp.terrainSeed = data.terrainSeed || 0;
                window.state.terrainSeed = mp.terrainSeed;
                // Build remote players for everyone already present
                (data.peers || []).forEach(p => addRemotePlayerStub(p.pid, p.color, p.label));
                break;
            case 'peerjoin':
                addRemotePlayerStub(data.pid, data.color, data.label);
                break;
            case 'peerleave':
                removeRemotePlayer(data.pid);
                break;
            case 'config':
                mp.mode = data.mode;
                break;
            case 'start':
                mp.mode = data.mode;
                mp.terrainSeed = data.terrainSeed || 0;
                window.state.terrainSeed = mp.terrainSeed;
                if (lobby) lobby.cleanupLobby();
                launchMultiplayer();
                break;
            case 'state':
                mp.remoteStates.set(data.pid, data.s);
                updateTeamDeathState(data.pid, data.s || {});
                break;
            case 'fire':
                spawnRemoteShot(data.pid, data);
                break;
            case 'roundwin':
                handleRoundEndFromHost(data.winner, data.p1Wins, data.p2Wins, data.matchDone);
                break;
            case 'reset':
                doResetRound();
                break;
            case 'dmkill':
                applyDMKills(data.kills);
                break;
            case 'dmend':
                applyDMKills(data.kills);
                doEndDeathmatch();
                break;
            case 'ctfscore':
                mp.ctfScore1 = data.s1; mp.ctfScore2 = data.s2;
                updateCTFDisplay();
                break;
            case 'ctfend':
                mp.ctfScore1 = data.s1; mp.ctfScore2 = data.s2;
                doEndCTF();
                break;
            case 'ctfgrab':
            case 'ctfdrop':
                applyCTFEvent(data);
                break;
            case 'revive':
                // We are being revived
                applyReviveToSelf();
                break;
            case 'kick':
                alert('Disconnected: ' + (data.reason || 'kicked by host'));
                try { mp.peer && mp.peer.destroy(); } catch (e) {}
                returnToNormalMode();
                break;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  MESSAGE SENDING
    // ════════════════════════════════════════════════════════════════════════
    function sendToHost(msg) {
        if (mp.hostConn && mp.hostConn.open) {
            try { mp.hostConn.send(msg); } catch (e) {}
        }
    }
    function broadcast(msg) {
        // Host → everyone
        for (const c of mp.connsByPid.values()) {
            if (c.open) try { c.send(msg); } catch (e) {}
        }
    }
    function relayToOthers(senderPid, msg) {
        // Host re-broadcasts to all guests except the sender
        for (const [pid, c] of mp.connsByPid.entries()) {
            if (pid === senderPid) continue;
            if (c.open) try { c.send(msg); } catch (e) {}
        }
    }
    function sendUpstream(msg) {
        // Universal: as host, broadcast; as guest, send to host
        if (mp.isHost) broadcast(msg);
        else sendToHost(msg);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  LAUNCH MULTIPLAYER
    // ════════════════════════════════════════════════════════════════════════
    function launchMultiplayer() {
        // Reset match scores
        mp.p1Wins = 0; mp.p2Wins = 0;
        mp.roundOver = false; mp.matchOver = false;
        mp.dmKills = new Map();
        mp.ctfScore1 = 0; mp.ctfScore2 = 0;
        mp.ctfFlags = [];
        mp.active = true;
        window.state.terrainSeed = mp.terrainSeed;
        window.startGame();
    }

    function returnToNormalMode() {
        mp.active = false;
        mp.roundOver = false;
        mp.matchOver = false;
        mp.dmKills = new Map();
        mp.ctfFlags = [];
        mp.ctfScore1 = 0;
        mp.ctfScore2 = 0;
        window.state.terrainSeed = 0;
        window.state.gameStarted = false;
        window.state.paused = false;
        if (window.state.ui) {
            window.state.ui.hideMenu();
            window.state.ui.pauseMenu.visible = false;
            window.state.ui.optionsMenu.visible = false;
        }
    }

    function isPvP() {
        return mp.mode === 'pvp_bo5' || mp.mode === 'pvp_dm' || mp.mode === 'pvp_ctf';
    }

    // ════════════════════════════════════════════════════════════════════════
    //  startGame patch — set positions, spawn remotes, set up mode
    // ════════════════════════════════════════════════════════════════════════
    function patchStartGame() {
        const orig = window.startGame;
        window.startGame = function () {
            // Make sure terrainSeed is in place BEFORE orig() runs spawnTerrain
            if (mp.active) window.state.terrainSeed = mp.terrainSeed;
            orig();
            if (!mp.active) return;

            const wx = window.state.world.width;
            const wy = window.state.world.height;
            const localPid = mp.localPid;

            // Spread players around the map: host (0) at left, guest 1 at right,
            // remaining guests spread around in a half-circle.
            const localPos = positionForPid(localPid, wx, wy);
            window.state.player.container.x = localPos.x;
            window.state.player.container.y = localPos.y;

            decoratePlayer(window.state.player,
                PID_COLORS[localPid % PID_COLORS.length],
                `YOU (P${localPid + 1})`);

            // Spawn RemotePlayer for every currently-known peer
            // (host already has the connsByPid map; guests built stub entries
            //  from the welcome message). Snapshot pids BEFORE clearing.
            const knownPids = collectKnownPids();
            mp.players.forEach((rp) => {
                if (rp && typeof rp.destroy === 'function') rp.destroy();
                else if (rp && rp.container && rp.container.parent) {
                    try { window.worldContainer.removeChild(rp.container); } catch (e) {}
                }
            });
            mp.players.clear();
            mp.remoteStates.clear();

            knownPids.forEach(pid => {
                if (pid === localPid) return;
                const pos = positionForPid(pid, wx, wy);
                const color = PID_COLORS[pid % PID_COLORS.length];
                const label = `Player ${pid + 1}`;
                const rp = new RemotePlayer(pos.x, pos.y, color, label, pid);
                mp.players.set(pid, rp);
                mp.remoteStates.set(pid, {
                    x: pos.x, y: pos.y, rot: 0, hp: 100, maxHp: 100, weaponIdx: 0, dead: false, alpha: 1
                });
            });

            // PvP modes
            if (isPvP()) {
                disableWaveSystem();
                if (mp.mode === 'pvp_dm')  startDeathmatch();
                if (mp.mode === 'pvp_ctf') spawnCTFFlags();
            }
            // Co-op: keep wave system
        };
    }

    function collectKnownPids() {
        const set = new Set();
        set.add(0); // host always pid 0
        if (mp.isHost) {
            mp.connsByPid.forEach((_, pid) => set.add(pid));
        } else {
            mp.players.forEach((_, pid) => set.add(pid));
        }
        set.add(mp.localPid);
        return Array.from(set);
    }

    function positionForPid(pid, wx, wy) {
        // Host (0) on the left, others fanned out on the right side of the map
        if (pid === 0) return { x: wx * 0.20, y: wy * 0.50 };
        const total = MAX_PLAYERS - 1;
        const slot = ((pid - 1) % total);
        const angle = -Math.PI / 2 + (slot / Math.max(1, total - 1)) * Math.PI;
        const radius = wx * 0.30;
        return {
            x: wx * 0.75 + Math.cos(angle) * radius * 0.4,
            y: wy * 0.50 + Math.sin(angle) * radius * 0.4,
        };
    }

    function disableWaveSystem() {
        window.state.isWaveActive = false;
        window.state.waveCountdown = 0;
        (window.state.enemies || []).forEach(e => {
            try { window.worldContainer.removeChild(e.container); } catch (e2) {}
        });
        window.state.enemies = [];
        if (window.state.objective) {
            try { window.worldContainer.removeChild(window.state.objective.graphic); } catch (e) {}
            window.state.objective = null;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  RemotePlayer — visual avatar synced from network
    // ════════════════════════════════════════════════════════════════════════
    class RemotePlayer {
        constructor(x, y, color, label, pid) {
            this._isRemote = true;
            this.pid = pid;
            this.color = color;
            this.label = label;
            this.weaponIdx = -1;
            this.hp = 100; this.maxHp = 100;
            this.dead = false;
            this.downed = false;
            this._reviveBar = null;
            this._reviveLabel = null;

            this.container = new PIXI.Container();
            this.container.x = x; this.container.y = y;

            this.ring = new PIXI.Graphics();
            this.ring.lineStyle(3, color, 0.85);
            this.ring.drawCircle(0, 0, 24);
            this.container.addChild(this.ring);

            this.spriteNode = null;
            this.shadowNode = null;
            this.buildSprite(0);

            this.hpBar = new PIXI.Graphics();
            this.container.addChild(this.hpBar);

            this.nameLabel = new PIXI.Text(label, {
                fontFamily: 'Georgia, serif', fontSize: 12,
                fill: color, stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold'
            });
            this.nameLabel.anchor.set(0.5);
            this.nameLabel.y = -38;
            this.container.addChild(this.nameLabel);

            window.worldContainer.addChild(this.container);
            this.drawHpBar();

            // Off-screen arrow pointer (lives in uiContainer, screen coords)
            this.arrow = new PIXI.Container();
            this.arrowShape = new PIXI.Graphics();
            this.arrow.addChild(this.arrowShape);
            this.arrowLabel = new PIXI.Text(label, {
                fontFamily: 'Georgia, serif', fontSize: 11, fill: color,
                stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold'
            });
            this.arrowLabel.anchor.set(0.5);
            this.arrow.addChild(this.arrowLabel);
            this.arrow.visible = false;
            window.uiContainer.addChild(this.arrow);
        }

        buildSprite(idx) {
            if (this.spriteNode) { try { this.container.removeChild(this.spriteNode); } catch (e) {} this.spriteNode = null; }
            if (this.shadowNode) { try { this.container.removeChild(this.shadowNode); } catch (e) {} this.shadowNode = null; }

            const weapons = window.state.player ? window.state.player.weapons : null;
            const w = weapons ? weapons[idx] : null;
            const path = !w ? 'assets/union_musket.png'
                : w.type === 'grenade' ? 'assets/union_granade.png'
                : w.type === 'melee'   ? 'assets/union_sword.png'
                : w.type === 'shotgun' ? 'assets/union_musket.png'
                : w.category === 'pistol' ? 'assets/union_flintlock.png'
                : 'assets/union_musket.png';

            const tex = (window.textures && window.textures[path]) || PIXI.Texture.from(path);

            const shadow = new PIXI.Graphics();
            shadow.beginFill(0x000000, 0.25);
            shadow.drawEllipse(4, 6, 22, 10);
            shadow.endFill();
            this.container.addChildAt(shadow, 1);
            this.shadowNode = shadow;

            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5, 0.5);
            const apply = () => {
                const w0 = sprite.texture.width  || 64;
                const h0 = sprite.texture.height || 64;
                const scale = 64 / Math.max(w0, h0);
                sprite.scale.set(scale);
            };
            if (tex.baseTexture && tex.baseTexture.valid) apply();
            else if (tex.baseTexture) tex.baseTexture.once('loaded', apply);
            sprite.tint = this.color;
            this.container.addChild(sprite);
            this.spriteNode = sprite;
        }

        drawHpBar() {
            this.hpBar.clear();
            const pct = Math.max(0, Math.min(1, this.hp / this.maxHp));
            this.hpBar.beginFill(0x330000); this.hpBar.drawRect(-22, 28, 44, 5); this.hpBar.endFill();
            const col = pct > 0.6 ? 0x44dd44 : pct > 0.3 ? 0xdddd22 : 0xdd3322;
            this.hpBar.beginFill(col); this.hpBar.drawRect(-22, 28, 44 * pct, 5); this.hpBar.endFill();
        }

        applyState(s) {
            if (!s) return;
            const k = 0.35;
            this.container.x += (s.x - this.container.x) * k;
            this.container.y += (s.y - this.container.y) * k;
            // Handle downed-state sprite swap
            const wasDowned = this.downed;
            const isDowned = !!s.downed;
            this.downed = isDowned;
            if (isDowned && !wasDowned) {
                this.applyDownedSprite();
            } else if (!isDowned && wasDowned) {
                this.weaponIdx = -1;
                this.buildSprite(typeof s.weaponIdx === 'number' ? s.weaponIdx : 0);
            }
            // Don't rotate the wounded sprite — it's lying on the ground
            if (this.spriteNode && typeof s.rot === 'number' && !isDowned) {
                this.spriteNode.rotation = s.rot;
            }
            if (!isDowned && typeof s.weaponIdx === 'number' && s.weaponIdx !== this.weaponIdx) {
                this.weaponIdx = s.weaponIdx;
                this.buildSprite(s.weaponIdx);
            }
            if (typeof s.hp === 'number' && s.hp !== this.hp) {
                this.hp = s.hp;
                this.drawHpBar();
            }
            if (typeof s.maxHp === 'number') this.maxHp = s.maxHp;
            const dead = !!s.dead;
            this.dead = dead;
            // Downed = visible but desaturated; truly dead = very faded
            if (isDowned) this.container.alpha = 0.85;
            else this.container.alpha = dead ? 0.25 : (typeof s.alpha === 'number' ? s.alpha : 1);
        }

        applyDownedSprite() {
            if (this.spriteNode) { try { this.container.removeChild(this.spriteNode); } catch (e) {} this.spriteNode = null; }
            if (this.shadowNode) { try { this.container.removeChild(this.shadowNode); } catch (e) {} this.shadowNode = null; }

            const tex = (window.textures && window.textures[WOUNDED_SOLDIER_SPRITE]) || PIXI.Texture.from(WOUNDED_SOLDIER_SPRITE);
            const shadow = new PIXI.Graphics();
            shadow.beginFill(0x000000, 0.25);
            shadow.drawEllipse(4, 6, 22, 10);
            shadow.endFill();
            this.container.addChildAt(shadow, 1);
            this.shadowNode = shadow;

            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5);
            const apply = () => {
                const w0 = sprite.texture.width  || 64;
                const h0 = sprite.texture.height || 64;
                const scale = 64 / Math.max(w0, h0);
                sprite.scale.set(scale);
            };
            if (tex.baseTexture && tex.baseTexture.valid) apply();
            else if (tex.baseTexture) tex.baseTexture.once('loaded', apply);
            this.container.addChild(sprite);
            this.spriteNode = sprite;
        }

        setReviveUi(progress, visible, holding) {
            // Lazily create the bar/label
            if (!this._reviveBar) {
                this._reviveBar = new PIXI.Graphics();
                this._reviveBar.y = -54;
                this.container.addChild(this._reviveBar);
                this._reviveLabel = new PIXI.Text('', {
                    fontFamily: 'Georgia, serif', fontSize: 11, fill: 0xffd700,
                    fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3
                });
                this._reviveLabel.anchor.set(0.5);
                this._reviveLabel.y = -68;
                this.container.addChild(this._reviveLabel);
            }
            if (!visible) {
                this._reviveBar.visible = false;
                this._reviveLabel.visible = false;
                return;
            }
            this._reviveBar.visible = true;
            this._reviveLabel.visible = true;
            const W = 50;
            const H = 5;
            this._reviveBar.clear();
            this._reviveBar.beginFill(0x000000, 0.7);
            this._reviveBar.drawRect(-W/2, 0, W, H);
            this._reviveBar.endFill();
            this._reviveBar.beginFill(holding ? 0x44dd44 : 0xaaaaaa, 1);
            this._reviveBar.drawRect(-W/2, 0, W * Math.max(0, Math.min(1, progress)), H);
            this._reviveBar.endFill();
            this._reviveLabel.text = holding ? 'REVIVING…' : 'Hold V to revive';
            this._reviveLabel.style.fill = holding ? 0xffd700 : 0xffaaaa;
        }

        updateOffscreenArrow() {
            // Compute screen coord of this remote player
            const wc = window.worldContainer;
            const sw = window.app.screen.width;
            const sh = window.app.screen.height;
            const sx = this.container.x + wc.x;
            const sy = this.container.y + wc.y;
            const margin = 36;
            const onScreen = sx >= 0 && sx <= sw && sy >= 0 && sy <= sh;
            if (onScreen || this.dead) {
                this.arrow.visible = false;
                return;
            }
            // Clamp arrow position to viewport edges
            const cx = sw / 2, cy = sh / 2;
            const dx = sx - cx, dy = sy - cy;
            const angle = Math.atan2(dy, dx);
            // Find intersection of line from center to (sx, sy) with the inner rect
            const halfW = sw / 2 - margin;
            const halfH = sh / 2 - margin;
            const t = Math.min(halfW / Math.abs(dx || 0.0001), halfH / Math.abs(dy || 0.0001));
            const ax = cx + Math.cos(angle) * Math.abs(dx) * t;
            const ay = cy + Math.sin(angle) * Math.abs(dy) * t;
            // Distance to the player (in world units), shown next to the arrow
            const distWorld = Math.sqrt(
                (this.container.x - (window.state.player.container.x)) ** 2 +
                (this.container.y - (window.state.player.container.y)) ** 2
            );
            this.arrowShape.clear();
            this.arrowShape.lineStyle(2, 0x000000, 0.9);
            this.arrowShape.beginFill(this.color, 0.95);
            // Triangle pointing toward (dx, dy), facing outward
            const size = 14;
            this.arrowShape.moveTo(size, 0);
            this.arrowShape.lineTo(-size * 0.7, size * 0.7);
            this.arrowShape.lineTo(-size * 0.7, -size * 0.7);
            this.arrowShape.lineTo(size, 0);
            this.arrowShape.endFill();
            this.arrowShape.rotation = angle;
            this.arrow.x = ax;
            this.arrow.y = ay;
            this.arrowLabel.text = `${this.label}  ·  ${Math.round(distWorld)}m`;
            // Position label perpendicular to arrow direction
            const off = 22;
            this.arrowLabel.x = -Math.cos(angle) * off;
            this.arrowLabel.y = -Math.sin(angle) * off;
            this.arrow.visible = true;
        }

        destroy() {
            try { window.worldContainer.removeChild(this.container); } catch (e) {}
            try { window.uiContainer.removeChild(this.arrow); } catch (e) {}
        }
    }

    function addRemotePlayerStub(pid, color, label) {
        // Used pre-game (in lobby) to remember peers; real avatars are spawned
        // when launchMultiplayer → startGame runs. We just keep the metadata.
        if (!mp.players.has(pid)) {
            mp.remoteStates.set(pid, {
                x: 0, y: 0, rot: 0, hp: 100, maxHp: 100, weaponIdx: 0, dead: false, alpha: 1
            });
            // Lightweight placeholder so collectKnownPids() finds it later
            mp.players.set(pid, { pid, color, label, _stub: true,
                container: { x: 0, y: 0 },
                applyState: () => {},
                updateOffscreenArrow: () => {},
                destroy: () => {},
            });
        }
    }

    function removeRemotePlayer(pid) {
        const rp = mp.players.get(pid);
        if (rp) {
            if (typeof rp.destroy === 'function') rp.destroy();
            mp.players.delete(pid);
        }
        mp.remoteStates.delete(pid);
    }

    function decoratePlayer(player, color, label) {
        if (!player || !player.container) return;
        if (player._mpRing) { try { player.container.removeChild(player._mpRing); } catch (e) {} }
        if (player._mpLabel) { try { player.container.removeChild(player._mpLabel); } catch (e) {} }

        const ring = new PIXI.Graphics();
        ring.lineStyle(3, color, 0.85);
        ring.drawCircle(0, 0, 24);
        player.container.addChildAt(ring, 0);
        player._mpRing = ring;

        const lbl = new PIXI.Text(label, {
            fontFamily: 'Georgia, serif', fontSize: 12,
            fill: color, stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold'
        });
        lbl.anchor.set(0.5); lbl.y = -38;
        player.container.addChild(lbl);
        player._mpLabel = lbl;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Game-loop hook (state sync, off-screen arrows, mode logic)
    // ════════════════════════════════════════════════════════════════════════
    function installGameLoop() {
        window.app.ticker.add((delta) => {
            if (!mp.active) return;
            if (!window.state.gameStarted || window.state.paused) return;

            // Apply network state to each remote player avatar
            mp.players.forEach((rp, pid) => {
                if (rp._stub) return;
                const s = mp.remoteStates.get(pid);
                if (s) rp.applyState(s);
                rp.updateOffscreenArrow();
            });

            // Send local state every 2 ticks (~30 Hz)
            mp.syncTick++;
            if (mp.syncTick % 2 === 0 && window.state.player) {
                const p = window.state.player;
                const stateMsg = {
                    type: 'state',
                    s: {
                        x: p.container.x,
                        y: p.container.y,
                        rot: p.container.rotation,
                        hp: p.hp,
                        maxHp: p.maxHp,
                        weaponIdx: p.currentWeaponIndex,
                        dead: p.hp <= 0,
                        downed: !!p._downed,
                        alpha: p.container.alpha,
                    },
                };
                if (mp.isHost) {
                    stateMsg.pid = 0;
                    broadcast(stateMsg);
                } else {
                    sendToHost(stateMsg);
                }
            }

            // Co-op revive system
            if (mp.mode === 'coop') {
                updateReviveSystem(delta);
                updateTeammatePanel();
            }

            // Force-PvP guard against base wave system reactivating
            if (isPvP()) {
                if (window.state.isWaveActive) window.state.isWaveActive = false;
                if (window.state.objective) {
                    try { window.worldContainer.removeChild(window.state.objective.graphic); } catch (e) {}
                    window.state.objective = null;
                }
            }

            if (mp.mode === 'pvp_dm')  updateDeathmatch(delta);
            if (mp.mode === 'pvp_ctf') updateCTF();
            if (mp.mode === 'pvp_bo5') updateBestOfFive();
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  REVIVE SYSTEM — co-op only
    // ════════════════════════════════════════════════════════════════════════
    function updateReviveSystem(delta) {
        const localP = window.state.player;
        if (!localP) return;

        // Find nearest downed teammate within REVIVE_RANGE
        let nearestPid = -1;
        let nearestDist = Infinity;
        if (!localP._downed) {
            mp.players.forEach((rp, pid) => {
                if (rp._stub) return;
                if (!rp.downed) return;
                const dx = rp.container.x - localP.container.x;
                const dy = rp.container.y - localP.container.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < REVIVE_RANGE && d < nearestDist) {
                    nearestDist = d;
                    nearestPid = pid;
                }
            });
        }

        // Reset progress when target changes or no target
        if (nearestPid !== reviveInput.targetPid) {
            reviveInput.targetPid = nearestPid;
            reviveInput.progress = 0;
        }

        // Update progress + UI
        mp.players.forEach((rp) => {
            if (rp._stub) return;
            rp.setReviveUi(0, false, false);
        });

        if (nearestPid >= 0) {
            const rp = mp.players.get(nearestPid);
            if (reviveInput.holding) {
                reviveInput.progress += delta;
                if (reviveInput.progress >= REVIVE_HOLD_TICKS) {
                    // Send revive
                    const msg = { type: 'revive', targetPid: nearestPid };
                    if (mp.isHost) routeRevive(msg);
                    else sendToHost(msg);
                    reviveInput.progress = 0;
                    reviveInput.holding = false;
                }
            } else {
                // Bleed off slowly when not holding
                reviveInput.progress = Math.max(0, reviveInput.progress - delta * 2);
            }
            rp.setReviveUi(reviveInput.progress / REVIVE_HOLD_TICKS, true, reviveInput.holding);
        }

        // If LOCAL player is downed, show a hint label above them
        if (localP._downed && !localP._downedHint) {
            const hint = new PIXI.Text('DOWNED — wait for a teammate to revive (V)', {
                fontFamily: 'Georgia, serif', fontSize: 12, fill: 0xff5555,
                stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold'
            });
            hint.anchor.set(0.5);
            hint.y = -52;
            localP.container.addChild(hint);
            localP._downedHint = hint;
        } else if (!localP._downed && localP._downedHint) {
            try { localP.container.removeChild(localP._downedHint); } catch (e) {}
            localP._downedHint = null;
        }
    }

    function routeRevive(msg) {
        if (mp.mode !== 'coop') return;
        const target = msg.targetPid;
        if (target === 0) {
            // Local host is being revived
            applyReviveToSelf();
        } else {
            const conn = mp.connsByPid.get(target);
            if (conn && conn.open) {
                try { conn.send({ type: 'revive', targetPid: target }); } catch (e) {}
            }
        }
    }

    function applyReviveToSelf() {
        const p = window.state.player;
        if (!p) return;
        if (typeof p.recoverFromDowned === 'function') {
            p.recoverFromDowned(Math.floor(p.maxHp * REVIVE_HP_RESTORE));
        }
        try { window.playSound && window.playSound('reload', 0.5, 0.05); } catch (e) {}
        if (window.state.ui) window.state.ui.update();
    }

    function updateTeamDeathState(pid, s) {
        const rp = mp.players.get(pid);
        if (!rp || rp._stub) return;
        if (typeof s.downed === 'boolean') {
            if (s.downed && !rp.downed) rp.applyDownedSprite();
            if (!s.downed && rp.downed) rp.buildSprite(typeof s.weaponIdx === 'number' ? s.weaponIdx : 0);
            rp.downed = s.downed;
        }
        if (typeof s.hp === 'number') rp.hp = s.hp;
        if (typeof s.maxHp === 'number') rp.maxHp = s.maxHp;
        if (typeof s.hp === 'number' || typeof s.maxHp === 'number') rp.drawHpBar();
        if (typeof s.dead === 'boolean') rp.dead = s.dead;
        rp.container.alpha = rp.downed ? 0.85 : (rp.dead ? 0.25 : (typeof s.alpha === 'number' ? s.alpha : 1));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TEAMMATE HP PANEL — top-right, co-op only
    // ════════════════════════════════════════════════════════════════════════
    function ensureTeammatePanel() {
        if (mp._teammatePanel) return mp._teammatePanel;
        const panel = new PIXI.Container();
        const bg = new PIXI.Graphics();
        panel.addChild(bg);
        const title = new PIXI.Text('TEAMMATES', {
            fontFamily: 'Georgia, serif', fontSize: 14, fill: COLORS.GOLD,
            fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3
        });
        title.x = 14; title.y = 8;
        panel.addChild(title);
        panel._bg = bg;
        panel._title = title;
        panel._rows = [];   // [{container, label, bar}]
        window.uiContainer.addChild(panel);
        mp._teammatePanel = panel;
        return panel;
    }

    function updateTeammatePanel() {
        const panel = ensureTeammatePanel();
        const W = window.innerWidth;

        // Build / update rows for each remote teammate
        const rowH = 26;
        const panelW = 230;
        // Collect "real" remote players (not stubs)
        const teammates = [];
        mp.players.forEach((rp, pid) => {
            if (rp._stub) return;
            const s = mp.remoteStates.get(pid);
            if (!s) return;
            teammates.push({ pid, rp, s });
        });
        teammates.sort((a, b) => a.pid - b.pid);

        // Resize rows array
        while (panel._rows.length < teammates.length) {
            const row = new PIXI.Container();
            const label = new PIXI.Text('', {
                fontFamily: 'Georgia, serif', fontSize: 12, fill: 0xffffff,
                stroke: 0x000000, strokeThickness: 2, fontWeight: 'bold'
            });
            label.x = 14; label.y = 4;
            const bar = new PIXI.Graphics();
            bar.x = 14; bar.y = 18;
            row.addChild(label);
            row.addChild(bar);
            panel.addChild(row);
            panel._rows.push({ container: row, label, bar });
        }
        while (panel._rows.length > teammates.length) {
            const r = panel._rows.pop();
            try { panel.removeChild(r.container); } catch (e) {}
        }

        // Update each row
        teammates.forEach((t, i) => {
            const row = panel._rows[i];
            row.container.x = 0;
            row.container.y = 30 + i * rowH;
            const color = PID_COLORS[t.pid % PID_COLORS.length];
            const hp = Math.max(0, t.s.hp || 0);
            const maxHp = t.s.maxHp || 100;
            const pct = Math.max(0, Math.min(1, hp / maxHp));
            const downed = !!t.s.downed;
            row.label.text = `P${t.pid + 1}` + (downed ? '   ⚠ DOWN' : `   ${Math.round(hp)}/${Math.round(maxHp)}`);
            row.label.style.fill = downed ? 0xff5555 : color;
            row.bar.clear();
            row.bar.beginFill(0x222222, 0.9);
            row.bar.drawRect(0, 0, panelW - 28, 6);
            row.bar.endFill();
            const fillCol = downed ? 0xff3333 : (pct > 0.6 ? 0x44dd44 : pct > 0.3 ? 0xdddd22 : 0xdd3322);
            row.bar.beginFill(fillCol, 1);
            row.bar.drawRect(0, 0, (panelW - 28) * pct, 6);
            row.bar.endFill();
        });

        // Resize panel background
        const totalH = 30 + teammates.length * rowH + 10;
        panel._bg.clear();
        panel._bg.beginFill(0x000000, 0.55);
        panel._bg.lineStyle(1.5, COLORS.SEPIA, 0.4);
        panel._bg.drawRoundedRect(0, 0, panelW, totalH, 8);
        panel._bg.endFill();
        panel.x = W - panelW - 18;
        panel.y = 18;
        panel.visible = teammates.length > 0;
    }

    function destroyTeammatePanel() {
        if (mp._teammatePanel) {
            try { window.uiContainer.removeChild(mp._teammatePanel); } catch (e) {}
            mp._teammatePanel = null;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Player.fire hook — broadcast shots
    // ════════════════════════════════════════════════════════════════════════
    function hookPlayerFire() {
        const tick = () => {
            const proto = window.Player && window.Player.prototype;
            if (!proto || !proto.fire) { setTimeout(tick, 80); return; }
            const orig = proto.fire;
            proto.fire = function () {
                if (!mp.active || this !== window.state.player) return orig.apply(this, arguments);
                const w = this.weapons[this.currentWeaponIndex];
                const beforeMag = w.mag;
                const result = orig.apply(this, arguments);
                const fired = w.mag < beforeMag || w.type === 'melee' || w.type === 'grenade';
                if (fired) {
                    const fireMsg = {
                        type: 'fire',
                        x: this.container.x,
                        y: this.container.y,
                        rot: this.container.rotation,
                        wType: w.type,
                        speed: w.speed,
                        damage: w.damage,
                        pellets: w.pellets || 1,
                        spread: w.spread || 0,
                        category: w.category,
                        longRange: !!w.longRange,
                    };
                    if (mp.isHost) {
                        fireMsg.pid = 0;
                        broadcast(fireMsg);
                    } else {
                        sendToHost(fireMsg);
                    }
                }
                return result;
            };
        };
        tick();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Spawn bullets/grenades/melee from a remote fire event
    // ════════════════════════════════════════════════════════════════════════
    function spawnRemoteShot(pid, data) {
        const owner = mp.players.get(pid);
        if (!owner || owner._stub) return;

        if (data.wType === 'melee') {
            const localP = window.state.player;
            if (localP) {
                const dx = localP.container.x - data.x;
                const dy = localP.container.y - data.y;
                const d  = Math.sqrt(dx * dx + dy * dy);
                if (d < 65) {
                    const angle = Math.atan2(dy, dx);
                    let diff = Math.abs(angle - data.rot);
                    while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
                    if (diff < 1.1 && isPvP()) {
                        localP.takeDamage(data.damage || 55);
                        window.state.shake = 6;
                    }
                }
            }
            try { window.playSound && window.playSound('sword', 0.6, 0.15); } catch (e) {}
            return;
        }

        if (data.wType === 'grenade') {
            const g = new window.Grenade(
                data.x + Math.cos(data.rot) * 22,
                data.y + Math.sin(data.rot) * 22,
                data.rot, data.speed || 16, null, null, !!data.longRange
            );
            window.state.grenades.push(g);
            return;
        }

        const pellets = data.pellets || 1;
        for (let i = 0; i < pellets; i++) {
            const sp = pellets > 1 ? (i - (pellets - 1) / 2) * (data.spread || 0) : 0;
            const b = new window.Bullet(
                data.x + Math.cos(data.rot) * 28,
                data.y + Math.sin(data.rot) * 28,
                data.rot + sp,
                data.speed || 18,
                data.damage || 60,
                110,
                owner   // owner = remote player; bullet logic checks owner._isRemote
            );
            window.state.bullets.push(b);
        }

        try {
            window.spawnMuzzleFlash && window.spawnMuzzleFlash(
                data.x + Math.cos(data.rot) * 30,
                data.y + Math.sin(data.rot) * 30,
                data.rot,
                data.category === 'rifle' ? 1.2 : 0.8
            );
        } catch (e) {}
        try {
            if (data.category === 'pistol') window.playSound('flintlock', 0.65, 0.12);
            else                            window.playSound('musket',    0.8,  0.08);
        } catch (e) {}
    }

    // ════════════════════════════════════════════════════════════════════════
    //  BO5 (1v1: host = P1, first guest = P2)
    // ════════════════════════════════════════════════════════════════════════
    function getOpponentState() {
        // First non-host pid = "P2"
        for (const [pid, s] of mp.remoteStates.entries()) {
            if (pid !== mp.localPid) return s;
        }
        return null;
    }

    function updateBestOfFive() {
        if (mp.matchOver || mp.roundOver) return;
        if (!mp.isHost) return;
        const localDead  = window.state.player && window.state.player.hp <= 0;
        const oppState   = getOpponentState();
        const remoteDead = oppState && oppState.hp <= 0;

        if (remoteDead && !localDead)        handleRoundEnd('p1wins');
        else if (localDead && !remoteDead)   handleRoundEnd('p2wins');
        else if (localDead && remoteDead)    handleRoundEnd('draw');
    }

    function handleRoundEnd(winner) {
        if (mp.roundOver || mp.matchOver) return;
        mp.roundOver = true;
        if (winner === 'p1wins') mp.p1Wins++;
        else if (winner === 'p2wins') mp.p2Wins++;
        const matchDone = (mp.p1Wins >= BO5_WINS_TO_WIN || mp.p2Wins >= BO5_WINS_TO_WIN);

        broadcast({ type: 'roundwin', winner, p1Wins: mp.p1Wins, p2Wins: mp.p2Wins, matchDone });

        showRoundResult(winner, matchDone, () => {
            if (matchDone) {
                showMatchOver(winner);
            } else {
                doResetRound();
                broadcast({ type: 'reset' });
                mp.roundOver = false;
            }
        });
    }

    function handleRoundEndFromHost(winner, p1Wins, p2Wins, matchDone) {
        if (mp.roundOver || mp.matchOver) return;
        mp.roundOver = true;
        mp.p1Wins = p1Wins;
        mp.p2Wins = p2Wins;
        showRoundResult(winner, matchDone, () => {
            if (matchDone) showMatchOver(winner);
            else mp.roundOver = false;
        });
    }

    function doResetRound() {
        const wx = window.state.world.width;
        const wy = window.state.world.height;
        const p  = window.state.player;
        if (p) {
            p.hp = p.maxHp;
            const pos = positionForPid(mp.localPid, wx, wy);
            p.container.x = pos.x; p.container.y = pos.y;
            p.container.alpha = 1;
            p.weapons.forEach(w => { if (w.category !== 'utility') w.mag = w.magSize; });
        }
        (window.state.bullets || []).forEach(b => { try { b.destroy && b.destroy(); } catch (e) {} });
        window.state.bullets = [];
        if (window.state.ui) window.state.ui.update();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  DEATHMATCH (FFA — supports up to MAX_PLAYERS)
    // ════════════════════════════════════════════════════════════════════════
    function startDeathmatch() {
        mp.dmTimer = DEATHMATCH_DURATION;
        mp.dmKills = new Map();
        collectKnownPids().forEach(pid => mp.dmKills.set(pid, 0));

        if (mp.dmDisplay) { try { window.uiContainer.removeChild(mp.dmDisplay); } catch (e) {} mp.dmDisplay = null; }
        const disp = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.65); bg.drawRoundedRect(-220, -32, 440, 64, 10); disp.addChild(bg);
        disp.timer = _text('3:00', 0, -10, { fontSize: 24, fill: 0xffd700, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 });
        disp.score = _text('', 0, 14, { fontSize: 12, fill: 0xcccccc, align: 'center' });
        disp.addChild(disp.timer); disp.addChild(disp.score);
        disp.x = window.innerWidth / 2; disp.y = 56;
        window.uiContainer.addChild(disp);
        mp.dmDisplay = disp;
    }

    function applyDMKills(kills) {
        mp.dmKills = new Map(Object.entries(kills || {}).map(([k, v]) => [parseInt(k, 10), v]));
    }

    function updateDeathmatch(delta) {
        if (!mp.dmDisplay || mp.matchOver) return;

        if (mp.isHost) {
            mp.dmTimer -= delta / 60;
            if (mp.dmTimer <= 0) {
                mp.dmTimer = 0;
                broadcast({ type: 'dmend', kills: dmKillsToObj() });
                doEndDeathmatch();
                return;
            }

            // Authoritative kill detection across all players
            const localP = window.state.player;
            if (localP && localP.hp <= 0 && !mp._localDeadFlag) {
                mp._localDeadFlag = true;
                // No specific killer attribution in FFA without bullet-source tracking;
                // award the kill to "world" (-1) — but for simple FFA we just award to
                // the leading other player. Keep it simple: don't increment, only count
                // remote deaths as kills for the local player.
                respawnLocal();
            }
            mp.players.forEach((rp, pid) => {
                if (rp._stub) return;
                const s = mp.remoteStates.get(pid);
                if (!s) return;
                const flagKey = '_remoteDeadFlag_' + pid;
                if (s.hp <= 0 && !mp[flagKey]) {
                    mp[flagKey] = true;
                    const k = mp.dmKills.get(mp.localPid) || 0;
                    mp.dmKills.set(mp.localPid, k + 1);
                    broadcast({ type: 'dmkill', kills: dmKillsToObj() });
                } else if (s.hp > 0) {
                    mp[flagKey] = false;
                }
            });
            if (localP && localP.hp > 0) mp._localDeadFlag = false;
        } else {
            const localP = window.state.player;
            if (localP && localP.hp <= 0 && !mp._guestRespawning) {
                mp._guestRespawning = true;
                respawnLocal(() => { mp._guestRespawning = false; });
            }
        }

        const sec = Math.max(0, Math.floor(mp.dmTimer));
        const mm  = Math.floor(sec / 60);
        const ss  = sec % 60;
        mp.dmDisplay.timer.text = `${mm}:${ss.toString().padStart(2, '0')}`;
        mp.dmDisplay.timer.style.fill = mp.dmTimer < 30 ? 0xff4444 : 0xffd700;

        const lines = [];
        Array.from(mp.dmKills.entries())
            .sort((a, b) => b[1] - a[1])
            .forEach(([pid, k]) => {
                lines.push(`P${pid + 1}: ${k}`);
            });
        mp.dmDisplay.score.text = lines.join('   ');
    }

    function dmKillsToObj() {
        const o = {};
        mp.dmKills.forEach((v, k) => o[k] = v);
        return o;
    }

    function doEndDeathmatch() {
        if (mp.matchOver) return;
        mp.matchOver = true;
        window.state.gameStarted = false;
        if (mp.dmDisplay) { try { window.uiContainer.removeChild(mp.dmDisplay); } catch (e) {} mp.dmDisplay = null; }

        // Find winner pid
        let bestPid = -1, bestKills = -1;
        mp.dmKills.forEach((k, pid) => { if (k > bestKills) { bestKills = k; bestPid = pid; } });
        const winnerLabel = bestPid === mp.localPid ? 'YOU WIN!' : `P${bestPid + 1} WINS!`;
        const lines = Array.from(mp.dmKills.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([pid, k]) => `P${pid + 1}: ${k} kills`)
            .join('     ');
        showFinal(winnerLabel, COLORS.GOLD, lines);
    }

    function respawnLocal(onDone) {
        const p = window.state.player;
        if (!p) { if (onDone) onDone(); return; }
        p.container.alpha = 0.3;
        setTimeout(() => {
            const wx = window.state.world.width;
            const wy = window.state.world.height;
            p.hp = p.maxHp;
            const pos = positionForPid(mp.localPid, wx, wy);
            p.container.x = pos.x + (Math.random() - 0.5) * 200;
            p.container.y = pos.y + (Math.random() - 0.5) * 200;
            p.container.alpha = 1;
            p.weapons.forEach(w => { if (w.category !== 'utility') w.mag = w.magSize; });
            if (window.state.ui) window.state.ui.update();
            if (onDone) onDone();
        }, RESPAWN_DELAY);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  CAPTURE THE FLAG (1v1)
    // ════════════════════════════════════════════════════════════════════════
    function spawnCTFFlags() {
        const W = window.state.world.width;
        const H = window.state.world.height;
        mp.ctfFlags = [
            makeCTFFlag(W * 0.18, H * 0.50, 'union'),
            makeCTFFlag(W * 0.82, H * 0.50, 'confed'),
        ];

        if (mp.ctfDisplay) { try { window.uiContainer.removeChild(mp.ctfDisplay); } catch (e) {} mp.ctfDisplay = null; }
        const disp = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.65); bg.drawRoundedRect(-220, -22, 440, 44, 10); disp.addChild(bg);
        disp.score = _text('', 0, 0, { fontSize: 17, fill: 0xffd700, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 });
        disp.addChild(disp.score);
        disp.x = window.innerWidth / 2; disp.y = 50;
        window.uiContainer.addChild(disp);
        mp.ctfDisplay = disp;
        updateCTFDisplay();
    }

    function makeCTFFlag(x, y, side) {
        const baseColor = side === 'union' ? COLORS.UNION : COLORS.CONFED;
        const base = new PIXI.Graphics();
        base.lineStyle(3, baseColor, 0.5);
        base.drawCircle(0, 0, 40);
        base.beginFill(baseColor, 0.12);
        base.drawCircle(0, 0, 40);
        base.endFill();
        base.x = x; base.y = y;
        window.worldContainer.addChild(base);

        const g = new PIXI.Graphics();
        g.lineStyle(3, 0x8b6914);
        g.moveTo(0, 0); g.lineTo(0, -50);
        g.lineStyle(0);
        g.beginFill(baseColor); g.drawRect(0, -50, 28, 18); g.endFill();
        g.beginFill(0xffffff, 0.55); g.drawRect(0, -50, 9, 6); g.drawRect(19, -44, 9, 6); g.endFill();
        g.x = x; g.y = y;
        window.worldContainer.addChild(g);

        return { x, y, side, homeX: x, homeY: y, sprite: g, base, carried: false, carrier: null };
    }

    function updateCTF() {
        if (!mp.isHost || mp.matchOver) return;
        const localP = window.state.player;
        if (!localP) return;

        // Host (P1) targets confed flag (idx 1), home is union flag (idx 0)
        ctfPickupCheck(localP, 1, mp.ctfFlags[1], mp.ctfFlags[0]);
        const opp = mp.players.values().next().value;
        if (opp && !opp._stub) ctfPickupCheck(opp, 2, mp.ctfFlags[0], mp.ctfFlags[1]);
    }

    function ctfPickupCheck(actor, num, enemyFlag, homeFlag) {
        if (!actor || !enemyFlag || !homeFlag) return;
        const ax = actor.container.x;
        const ay = actor.container.y;

        if (!enemyFlag.carried) {
            const dx = ax - enemyFlag.x;
            const dy = ay - enemyFlag.y;
            if (dx * dx + dy * dy < 36 * 36) {
                enemyFlag.carried = true;
                enemyFlag.carrier = actor;
            }
        }

        if (enemyFlag.carried && enemyFlag.carrier === actor) {
            enemyFlag.sprite.x = ax;
            enemyFlag.sprite.y = ay - 18;
            const dx = ax - homeFlag.homeX;
            const dy = ay - homeFlag.homeY;
            if (dx * dx + dy * dy < 40 * 40) {
                if (num === 1) mp.ctfScore1++; else mp.ctfScore2++;
                enemyFlag.carried = false; enemyFlag.carrier = null;
                enemyFlag.sprite.x = enemyFlag.homeX;
                enemyFlag.sprite.y = enemyFlag.homeY;
                broadcast({ type: 'ctfscore', s1: mp.ctfScore1, s2: mp.ctfScore2 });
                updateCTFDisplay();
                if (mp.ctfScore1 >= CTF_SCORE_TO_WIN || mp.ctfScore2 >= CTF_SCORE_TO_WIN) {
                    broadcast({ type: 'ctfend', s1: mp.ctfScore1, s2: mp.ctfScore2 });
                    doEndCTF();
                }
            }
        }
    }

    function applyCTFEvent(_data) { /* placeholder for future per-pid CTF events */ }

    function updateCTFDisplay() {
        if (!mp.ctfDisplay) return;
        mp.ctfDisplay.score.text = `Union 🚩 ${mp.ctfScore1}    Confederate 🚩 ${mp.ctfScore2}    (First to ${CTF_SCORE_TO_WIN})`;
    }

    function doEndCTF() {
        if (mp.matchOver) return;
        mp.matchOver = true;
        window.state.gameStarted = false;
        if (mp.ctfDisplay) { try { window.uiContainer.removeChild(mp.ctfDisplay); } catch (e) {} mp.ctfDisplay = null; }
        const winner = mp.ctfScore1 >= CTF_SCORE_TO_WIN ? 'p1wins' : 'p2wins';
        showFinal(
            winner === 'p1wins' ? 'UNION CAPTURES THE FLAG!' : 'CONFEDERATE CAPTURES THE FLAG!',
            winner === 'p1wins' ? COLORS.UNION : COLORS.CONFED,
            `Union: ${mp.ctfScore1}    Confederate: ${mp.ctfScore2}`
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Result overlays
    // ════════════════════════════════════════════════════════════════════════
    function showRoundResult(winner, isMatch, onDone) {
        const c = window.uiContainer;
        const W = window.innerWidth, H = window.innerHeight;

        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.85); ov.drawRect(0, 0, W, H);
        c.addChild(ov);

        const labels = { p1wins: 'UNION WINS THE ROUND!', p2wins: 'CONFEDERATE WINS THE ROUND!', draw: 'DOUBLE KILL — NO POINT' };
        const colors = { p1wins: COLORS.UNION, p2wins: COLORS.CONFED, draw: COLORS.GOLD };

        const t = _text(labels[winner], W/2, H/2 - 70, { fontSize: 48, fill: colors[winner], fontWeight: 'bold', align: 'center', stroke: 0x000000, strokeThickness: 5 });
        const score = _text(`Union: ${mp.p1Wins}    Confederate: ${mp.p2Wins}`, W/2, H/2 + 10, { fontSize: 28, fill: 0xffffff });
        const sub = _text(isMatch ? 'Final result incoming…' : `Next round in ${ROUND_RESET_DELAY/1000} seconds…`, W/2, H/2 + 60, { fontSize: 20, fill: 0xaaaaaa });
        c.addChild(t); c.addChild(score); c.addChild(sub);

        setTimeout(() => {
            try { c.removeChild(ov); c.removeChild(t); c.removeChild(score); c.removeChild(sub); } catch (e) {}
            onDone && onDone();
        }, ROUND_RESET_DELAY);
    }

    function showMatchOver(winner) {
        mp.matchOver = true;
        window.state.gameStarted = false;
        showFinal(
            winner === 'p1wins' ? 'UNION VICTORIOUS!' : 'CONFEDERATE VICTORIOUS!',
            winner === 'p1wins' ? COLORS.UNION : COLORS.CONFED,
            `Final — Union: ${mp.p1Wins}    Confederate: ${mp.p2Wins}`
        );
    }

    function showFinal(titleText, color, subText) {
        const c = window.uiContainer;
        const W = window.innerWidth, H = window.innerHeight;
        const ov = new PIXI.Graphics();
        ov.beginFill(0x000000, 0.95); ov.drawRect(0, 0, W, H); c.addChild(ov);

        const t = _text(titleText, W/2, H/2 - 90, { fontSize: 56, fill: color, fontWeight: 'bold', align: 'center', stroke: 0x000000, strokeThickness: 5 });
        c.addChild(t);
        c.addChild(_text(subText, W/2, H/2, { fontSize: 22, fill: 0xffffff, align: 'center', wordWrap: true, wordWrapWidth: W - 100 }));

        const again = _btn('PLAY AGAIN', W/2, H/2 + 110, 240, 60, COLORS.BTN);
        again.on('pointerdown', () => location.reload());
        c.addChild(again);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  UI helpers
    // ════════════════════════════════════════════════════════════════════════
    function _text(str, x, y, style) {
        const t = new PIXI.Text(str, Object.assign({
            fontFamily: 'Georgia, serif', fontSize: 16, fill: 0xffffff
        }, style || {}));
        t.anchor.set(0.5);
        t.x = x; t.y = y;
        return t;
    }

    function _btn(label, x, y, w, h, color) {
        const btn = new PIXI.Container();
        const bg  = new PIXI.Graphics();
        bg.beginFill(color); bg.drawRoundedRect(-w/2, -h/2, w, h, 12);
        btn.addChild(bg);
        const t = new PIXI.Text(label, {
            fontFamily: 'Georgia, serif', fontSize: Math.min(20, h * 0.42),
            fill: 0xffffff, fontWeight: 'bold', align: 'center',
            stroke: 0x000000, strokeThickness: 3
        });
        t.anchor.set(0.5);
        btn.addChild(t);
        btn.x = x; btn.y = y;
        btn.eventMode = 'static'; btn.cursor = 'pointer';
        btn.on('pointerover', () => { bg.tint = 0xccccff; });
        btn.on('pointerout',  () => { bg.tint = 0xffffff; });
        btn._bg = bg; btn._label = t; btn._w = w; btn._h = h; btn._color = color;
        return btn;
    }

    function _drawPanel(parent, x, y, w, h) {
        const g = new PIXI.Graphics();
        g.beginFill(0x0a0a1a, 0.7);
        g.lineStyle(1.5, COLORS.SEPIA, 0.4);
        g.drawRoundedRect(x, y, w, h, 12);
        parent.addChild(g);
    }

    function _highlight(btn, active) {
        if (!btn || !btn._bg) return;
        const w = btn._w, h = btn._h;
        btn._bg.clear();
        btn._bg.beginFill(active ? COLORS.BTN_HOV : btn._color);
        btn._bg.drawRoundedRect(-w/2, -h/2, w, h, 12);
        if (active) {
            btn._bg.lineStyle(2, COLORS.GOLD, 0.95);
            btn._bg.drawRoundedRect(-w/2, -h/2, w, h, 12);
        }
    }

    function randomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    function loadPeerJS(cb) {
        if (window.Peer) { cb(); return; }
        const tryLoad = (src, fallback) => {
            const s = document.createElement('script');
            s.src = src; s.onload = cb;
            s.onerror = fallback;
            document.head.appendChild(s);
        };
        tryLoad(
            'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
            () => tryLoad('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', () => {
                console.error('Failed to load PeerJS from both CDNs.');
            })
        );
    }
})();
