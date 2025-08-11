# Nate3D Torn Scripts

> **Content Disclaimer:**  
> All references to drugs, violence, crime, or similar topics within these scripts are **purely related to Torn's in-game mechanics and fictional world**.  
> They do **not** promote, endorse, or depict any real-world illegal or harmful activity.  
> Everything here is created **solely for gameplay purposes within Torn**.

A collection of **custom, compliant userscripts** for [Torn](https://www.torn.com/)  
designed to enhance gameplay quality-of-life **without breaking the Torn API Terms of Service**.

All scripts are built for **Tampermonkey** (desktop & mobile) and **Torn PDA**,  
using read-only API access and safe DOM enhancements.

---

## ✅ Compliance & Fair Use

These scripts are designed with **Torn’s Terms of Service** and **scripting rules** in mind:

- **No automated gameplay actions** — scripts never perform clicks or send game actions for you.
- **Read-only API usage** — only allowed API endpoints are used (e.g., `user→profile`).
- **DOM enhancements only** — scripts may rearrange, highlight, or pre-fill game UI, but you must confirm actions manually.
- **No botting** — scripts are not bots and cannot be used to gain unfair gameplay advantages.
- **No commercial use** — provided free and open source.
- **No affiliation** — not associated with Torn or its developers.
- **Not a replacement for official features** — supplements gameplay with quality-of-life improvements only.
- **Local storage only** — settings are saved in `localStorage`/`sessionStorage`; nothing is transmitted externally.
- **API key safety** — any API key is stored locally and never shared. Users are responsible for managing their own keys.
- **Purpose** — built purely for in-game convenience, monitoring, and notifications.

---

## 📜 Overview

These scripts aim to:
- Automate **monitoring** and **notifications** for in-game events (e.g., leaving hospital).
- **Navigate** or prepare game pages automatically (no auto-clicking game actions).
- Provide **visual aids** and **status indicators**.
- Always stay within Torn’s scripting and API rules.

---

## 📂 Scripts

| Script                          | Description                                                                                                                                                                                                   | Install Link                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Hospital-Exit Travel Helper** | Monitors your hospital status, auto-redirects to the Travel Agency when released (including meds), pre-selects your destination, focuses the Travel button, and shows a hospital “Monitoring” badge with ETA. | [📄 View Script](./scripts/torn-hospital-exit-travel-helper.user.js) |
| *(add more scripts here)*       | *(description)*                                                                                                                                                                                               | *(link)*                                                            |

---

## 📦 Installation

1. **Install Tampermonkey** (or equivalent userscript manager):
   - [Tampermonkey for Chrome](https://tampermonkey.net/?ext=dhdg&browser=chrome)
   - [Tampermonkey for Firefox](https://tampermonkey.net/?ext=dhdg&browser=firefox)
   - [Kiwi Browser for Android](https://kiwibrowser.com/) (supports Tampermonkey)
   - Torn PDA users: paste or import the script via in-app userscript settings.
   
2. **Click the script link** in the [Scripts](#-scripts) table above.
3. Tampermonkey should prompt to **install** — click *Install*.
4. Open Torn and **configure your API key** (script will prompt on first run).

---

## ⚙️ Configuration

Each script may have configurable values at the top of the file (e.g., default travel destination).  
Open the `.user.js` file in a text editor to adjust settings.

For **API-based scripts**:
- Create a Torn API key with **`Limited Access`** scope (read-only).
- Paste it into the script’s settings prompt.

---

## 📌 Adding Your Own Scripts

When adding a new script to this repository:

1. Place the `.user.js` file in the `/scripts` folder.
2. Add a row to the [Scripts](#-scripts) table with:
   - Script name (bold)
   - Short description
   - Relative link to the script file
3. (Optional) Include a screenshot in `/docs/images/` and link it.
---

## 📚 References
[Torn API Documentation](https://www.torn.com/api.html)

[Torn Scripting Rules](https://www.torn.com/forums.php#/p=threads&f=61&t=16112659)

[Tampermonkey Documentation](https://www.tampermonkey.net/documentation.php)

## 📝 License
This project is licensed under the [MIT License](./LICENSE).