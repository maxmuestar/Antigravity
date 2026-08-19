# Antigravity

Antigravity is a modern Electron-based game launcher and Minecraft management platform designed to organize, download, and launch PC games and Minecraft installations from a single unified application. It features a clean interface, built-in download and extraction engine, console-style Big Picture mode, and a complete Minecraft instance ecosystem.

> **Note: This project is currently under active development. Features and functionality may evolve over time.**

---

# Features

### Core Game Launcher
- Modern and responsive dark-mode interface
- Ultra Big Picture Mode designed for TV and gamepad navigation with dynamic ambient glow
- Built-in download manager with real-time progress and speed statistics
- Native archive extraction supporting 7z, ZIP, and RAR formats with password decryption
- Integrated secure in-app browser with ad blocking and tracker protection
- In-place automatic updater powered by GitHub Releases

### Minecraft Hub
- Multi-Instance Management: Create and manage isolated Minecraft installations with customizable versions, mod loaders (Fabric, Forge, NeoForge, Quilt, Vanilla), RAM allocation, and JVM arguments
- Modrinth Integration: Search, browse, and install mods, resource packs, and shaders directly inside the launcher
- 1-Click Modpack Support: Full compatibility with `.mrpack` modpacks including automated dependency resolution
- Multi-Account Manager: 1-click profile switching between Microsoft accounts and offline profiles
- Offline Skin Station: Custom skin injection for offline profiles with local authentication support and Java Agent runtime interception
- Crash and Log Diagnostics: Live console output with 1-click log sharing to mclo.gs

---

# Requirements

Before building Antigravity, make sure you have installed:

- Node.js 18 or newer
- npm (comes with Node.js)
- Java Runtime Environment (JRE/JDK 8, 17, or 21 depending on Minecraft versions played)
- Git

---

# Installation

Clone the repository:

```bash
git clone https://github.com/maxmuestar/Antigravity.git
cd Antigravity
```

Install dependencies:

```bash
npm install
```

---

# Running the Launcher

Start the application in development mode:

```bash
npm start
```

---

# Building

Build the executable package for Windows:

```bash
npm run build
```

The compiled application will be generated in the `dist/` folder.

---

# Project Structure

```
Antigravity/
├── main.js                 # Electron main process, lifecycle, IPC handlers, downloads & updater
├── preload.js              # Secure IPC bridge exposing system APIs to renderer
├── renderer.js             # UI logic, state management, Big Picture controller & sound engine
├── minecraft-service.js    # Minecraft instance management, Modrinth API, auth & skin injection
├── index.html              # Core application layout and modal dialogs
├── styles.css              # Custom styling, animations, and Big Picture design system
├── package.json            # Project dependencies, build scripts, and metadata
└── assets/                 # Icons, sound effects, and default branding assets
```

---

# Disclaimers

### General Disclaimer
This launcher is provided solely as a software management and game launching tool. It does **not** include, distribute, host, promote, or facilitate access to unauthorized, pirated, or illegally obtained software or game content.

Users are solely responsible for ensuring that they own the necessary licenses, rights, and permissions to access and use any games or software launched through this application. The developer does not verify the legality or ownership of any third-party software used with this launcher.

The developer shall not be held liable for any misuse of this launcher, including, but not limited to, the use of unauthorized, modified, or illegally obtained software. Any violation of applicable laws, software licenses, or third-party terms of service is the sole responsibility of the user.

### Minecraft and Mojang Disclaimer
**NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

"Minecraft" is a registered trademark of Mojang Synergies AB. Antigravity is an independent third-party launcher and is in no way affiliated with, endorsed by, sponsored by, or associated with Mojang Studios, Microsoft Corporation, or any of their subsidiaries or affiliates.

---

# Contributing

Pull requests and contributions are welcome.

If you encounter a bug or have a feature suggestion, please open an Issue on GitHub.

---

# License

This project is licensed under the MIT License. See the `LICENSE` file for more details.

---

# Author

Developed by **MaxMuestar**

GitHub: https://github.com/maxmuestar