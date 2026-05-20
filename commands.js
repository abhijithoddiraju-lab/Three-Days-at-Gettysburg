// commands.js
// No 'const state' here; it uses the global state from main.js

    const CommandDB = {
        "wave": (args) => {
            // args[0] is the first number after the word 'wave'
            const newWave = parseInt(args[0]);
            if (!isNaN(newWave)) {
                state.wave = newWave;
                if (state.ui) state.ui.update(); // Refresh the screen text
                return `Jumped to wave ${newWave}`;
            }
            return "Error: Please provide a number (e.g., wave 5)";
        },

        "spawn_boss": () => {
            spawnCommanderPicket(state.player.container.x, state.player.container.y - 300);
            return "Commander Picket has arrived!";
        },

    // Restore health
    "heal": () => {
        if (state.player) {
            state.player.hp = state.player.maxHp || 100;
            return "Health restored!";
        }
        return "Player not found.";
    },

};