

---

# Three Days at Gettysburg

An interactive, top-down tactical survival game that simulates the grueling combat conditions, historical vulnerabilities, and desperate tactical maneuvers of July 1–3, 1863. Built natively for the browser using modern JavaScript, PixiJS, and serverless WebRTC.

---

## 📖 Table of Contents

1. [Core Features]
2. [Artistic & Sound Design]
3. [Installation & Local Setup]
4. [Gameplay Tutorial & Controls]
5. [Project Architecture]

---

## 🚀 Core Features

* **Historical Infantry Simulation:** Move beyond standard arcade shooters. Experience the agonizing pacing of 19th-century black-powder warfare featuring period-accurate reload penalties, weapon recoil screen-shake, and vision-obscuring gunsmoke.
* **Dynamic Objective System:** Complete historical battlefield parameters including defending **Cemetery Ridge**, spiking enemy artillery batteries, and searching for and recovering wounded Union allies.
* **"Commander Picket" Boss Raid:** Brave the final day of fighting against a towering boss representing Pickett's Charge. This encounter challenges players with dynamic explosive tracking and persistent Confederate reinforcements.
* **Serverless Multiplayer (⚠️ Experimental Alpha/Beta):** Host up to 10 players simultaneously using direct browser-to-browser WebRTC via PeerJS. Cooperative rooms sync using a shared random map seed.
> 🔴 **DEVELOPER NOTE:** The multiplayer infrastructure is currently in a **highly volatile alpha/beta development stage**. Connection drops, desynchronization, packet loss, and frame rate instability should be expected while peer-to-peer mechanics are actively being iterated.



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
git clone https://github.com/abhijithoddiraju-lab/Three-Days-at-Gettysburg.git
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

### Base Controls & Abilities

| Input Key | Action Performance |
| --- | --- |
| `W`, `A`, `S`, `D` | Navigate character across the battlefield |
| **`Mouse Cursor`** | Aim your current firearm |
| **`Left Click`** | Fire weapon |
| **`R`** | Manually initiate firearm reload sequence |
| **`G`** | Interact / Loot fallen bodies for supplies |
| **`E`** | Start Smoking a Cigarette / Trigger healing restorative |
| **`Q`** | Call in a high-impact Artillery Bombardment |
| **`F`** | Order a disciplined tactical Bullet Volley |

---

### 📦 Tactical Arsenal Guide

> ⚠️ **CRITICAL STRATEGY UPGRADE RULE:** The battlefield demands total versatility. To survive later combat waves, **you must upgrade both your rifle and your pistol.** Relying strictly on one category will leave you completely vulnerable and defenseless during long, immobile black-powder reloads.

#### 1. Long Arms (Rifles & Musket Infantry)

* **Springfield Model 1861:** *Unlocked at Wave 1.* High stopping power (115 DMG), but features a highly punishing, completely immobile black-powder reload delay (`immobileReload: true`). Holds 1 round.
* **Sharps New Model 1859:** *Unlocked at Wave 2.* Magazine capacity upgrade holding 8 rounds per cycle (60 DMG). Keeps you anchored during reloads (`immobileReload: true`).
* **Spencer Repeating Rifle:** *Unlocked at Wave 3.* The ultimate long arm upgrade. Rapid-fire lever action holding 12 rounds per magazine (34 DMG) with **full movement capability** while feeding rounds (`immobileReload: false`).
* **Blunderbuss:** *Unlocked at Wave 3.* High-impact vintage smoothbore. Fires 6 devastating shrapnel pellets per shot with a wide crosshair spread (90 Base DMG), requiring you to halt completely while reloading.

#### 2. Sidearms (Pistols & Revolvers)

* **Flintlock Pistol:** *Unlocked at Wave 1.* A reliable backup holding 1 round (85 DMG). Allows full mobile reloading to evade charging hostiles.
* **Colt 1860 Army Revolver:** *Unlocked at Wave 2.* Six-shot repeating cylinder (42 DMG) offering fast, continuous close-quarters protection.
* **Converted Model 1842 Pistol:** *Unlocked at Wave 2.* Elite sidearm upgrade boasting an 8-round capacity and excellent muzzle velocity (58 DMG).

#### 3. Support & Auxiliary Elements

* **Ketchum Hand Grenade:** Heavy throwable utility explosive. Deals massive area-of-effect blast damage (110 DMG) over long ranges to shatter dense infantry lines.
* **Model 1860 Light Cavalry Saber:** Standard issue high-speed melee defense blade (55 DMG). Features infinite structural durability with zero reload constraints.

---

## 🛠 Project Architecture

The application is structured into modular JavaScript components designed to work alongside the PixiJS execution lifecycle:

```text
├── index.html        # Application root entry point; loads remote PixiJS & PeerJS CDNs
├── style.css         # Full-window layout styles and canvas container alignment
├── server.js         # Lightweight Node.js HTTP asset-serving development platform
├── main.js           # Core loop, physics engine, game state, and asset filters
├── boss.js           # Class file handling custom AI routines for "Commander Picket"
├── commands.js       # Sandbox cheat databases and console parsing behaviors
└── multiplayer.js    # PeerJS WebRTC network sync, UI rooms, and lobby state machines

```
