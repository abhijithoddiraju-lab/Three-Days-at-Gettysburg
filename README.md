---

# Three Days at Gettysburg (Union Edition)

An interactive, top-down tactical survival game that simulates the grueling combat conditions, historical vulnerabilities, and desperate tactical maneuvers of July 1-3, 1863. Built natively for the browser using modern JavaScript, PixiJS, and serverless WebRTC.

---

## 📖 Table of Contents

1. [Core Features]()
2. [Artistic & Sound Design]()
3. [Installation & Local Setup]()
4. [Gameplay Tutorial & Controls]()
5. [Project Architecture]()

---

## 🚀 Core Features

* **Historical Infantry Simulation:** Move beyond standard arcade shooters. Experience the agonizing pacing of 19th-century black-powder warfare featuring period-accurate reload penalties, weapon recoil screen-shake, and vision-obscuring gunsmoke.
* **Dynamic Objective System:** Complete historical battlefield parameters including defending **Cemetery Ridge**, spiking enemy artillery batteries, and searching for and recovering wounded Union allies.
* **"Commander Picket" Boss Raid:** Brave the final day of fighting against a towering boss representing Pickett's Charge. This encounter challenges players with dynamic explosive tracking and persistent Confederate reinforcements.
* **Serverless Multiplayer:** Host up to 10 players simultaneously using direct browser-to-browser WebRTC via PeerJS. Cooperative rooms sync cleanly using a shared random map seed, ensuring all peers navigate identical tactical environments.

---

## 🎨 Artistic & Sound Design

* **Tintype Visual Grading:** The entire canvas utilizes a custom web filter matrix setting environments to a dim, low-brightness **sepia tone**—emulating the ghostly, haunting look of mid-19th-century photography.
* **Dynamic Daylight Cycle:** Environments visually transition from a crisp dawn to a dim twilight over the three simulated days, forcing players to actively feel the slow passage of time during the engagement.
* **Historical Audio Landscape:** Period-accurate sound assets fuse overlapping flintlock blasts and booming musket volleys with the melodic strains of the **"Battle Cry of Freedom"**.

---

## 💻 Installation & Local Setup

The project runs completely inside modern web browsers. To set up a local development server:

1. **Clone the repository:**
```bash
git clone https://github.com/YOUR_USERNAME/Three-Days-at-Gettysburg.git
cd Three-Days-at-Gettysburg

```


2. **Launch the Node.js development server:**
Ensure you have [Node.js](https://www.google.com/search?q=https://nodejs.org/) installed, then execute:
```bash
node server.js

```


3. **Access the application:**
Open your browser and navigate to:
```url
http://localhost:5000

```



---

## 🎮 Gameplay Tutorial & Controls

### The Objective

Your goal is simple but brutal: survive the relentless Confederate onslaught across three chaotic days. Monitor your health indicators, seek structural terrain for cover to mitigate incoming volleys, and coordinate closely with your comrades.

### Base Controls

| Input Key | Action Performance |
| --- | --- |
| **`W`, `A`, `S`, `D**` | Navigate character across the battlefield |
| **`Mouse Cursor`** | Aim your current firearm |
| **`Left Click`** | Fire weapon |
| **`R`** | Manually initiate firearm reload sequence |
| **`E`** | Interact / Revive fallen allies / Loot supplies |
| **`Enter`** | Open / Close Developer Command Console |

### Arsenal Guide

* **Springfield Model 1861:** High stopping power, long range, but features a highly punishing, immobile black-powder reload delay.
* **Spencer Repeating Rifle:** Faster rate of fire and quicker reloads, but yields reduced maximum damage output per round.

---

## 🛠 Project Architecture

The application is structured into modular JavaScript components designed to work alongside the PixiJS execution lifecycle:

```text
├── index.html       # Application root entry point; loads remote PixiJS & PeerJS CDNs
├── style.css        # Full-window layout styles and canvas container alignment
├── server.js        # Lightweight Node.js HTTP asset-serving development platform
├── main.js          # Core loop, physics engine, game state state, and asset filters
├── boss.js          # Class file handling custom AI routines for "Commander Picket"
├── commands.js      # Sandbox cheat databases and console parsing behaviors
└── multiplayer.js   # PeerJS WebRTC network sync, UI rooms, and lobby state machines

```
