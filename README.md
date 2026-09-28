# 烛火与长路 · Candle & Road

A single-player, text-only fantasy RPG with an AI Dungeon Master and a simplified D&D 5e (2014) rules engine. Bring your own model API key, write a character backstory, and explore an adventure shaped by your actions.

The interface and generated narration are in **Simplified Chinese**. The UI pairs parchment reading panels with a restrained medieval RPG style.

## Features

- **Choose your Dungeon Master:** OpenAI, Anthropic, LLM Gateway, or an administrator-approved OpenAI-compatible endpoint.
- **Personalized adventures:** an optional character backstory gives the model people, motivations, and unresolved threads to incorporate.
- **Free-text actions:** describe what you want to do; the server resolves supported checks, dice rolls, damage, and combat resources.
- **Suggestions when you pause:** after 10 seconds without typing or clicking, four suggestions fade in above the action box. They stay outside the scrolling story and disappear when you interact. Short model lists are supplemented with generic actions; no extra API request is made.
- **Portable saves:** export a JSON file and import it later to resume exploration or combat. Optionally include your API key to avoid entering it again.
- **Lightweight deployment:** plain HTML/CSS/JavaScript and a Node.js server, with no third-party runtime dependencies, build step, or database.

## Quick start

Requirements: **Node.js 22+**, a modern browser, and an API key for a supported model service. Model calls use the player's provider account and may incur charges.

Clone the repository and start the server:

```sh
git clone https://github.com/jensenmao/5E-DnD.git
cd 5E-DnD
npm start
```

Alternatively, run `node server.js`. There are no dependencies to install.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. Enter a character name, choose a race, class, and background, and optionally write a backstory of up to 2,000 characters.
2. Assign **15, 14, 13, 12, 10, 8** once each across the six abilities. Racial bonuses are applied automatically.
3. Select a model service and enter its API address, model ID, and API key.
4. Click **开始冒险** to generate the opening scene.
5. Type an action and click **行动**, or press **Ctrl/Cmd + Enter**. During combat, use the displayed combat controls.

## Model configuration

| Service in the UI | Recommended base URL | Protocol |
| --- | --- | --- |
| OpenAI / 兼容接口 | `https://api.openai.com/v1` | Chat Completions |
| Anthropic | `https://api.anthropic.com/v1` | Messages |
| LLM Gateway | `https://api.llmgateway.io/v1` | OpenAI-compatible Chat Completions |

Use an exact model ID available to your provider account. The interface's defaults are editable examples, not a guarantee of model access or availability. A ChatGPT or Claude web subscription alone does not provide an API key.

Both a base URL and a complete endpoint URL are accepted. The server appends `/chat/completions` or `/messages` as appropriate without duplicating an existing endpoint. Root URLs for the three built-in API hosts are normalized to `/v1`.

### LLM Gateway and 404 errors

Select **LLM Gateway** and use `https://api.llmgateway.io/v1`. Requests go to:

```text
https://api.llmgateway.io/v1/chat/completions
```

The game also corrects a bare `https://api.llmgateway.io` URL. A model ID such as `alibaba/deepseek-v4.1-flash:cn-beijing` is forwarded unchanged; its availability and routing permissions depend on your account. If a 404 persists, check both the endpoint and the exact model ID in your provider's dashboard.

### Custom compatible providers

Choose **OpenAI / 兼容接口** for a provider that implements Chat Completions. The server administrator must include its hostname in `ALLOWED_API_HOSTS` (see deployment). HTTPS on the default port or port 443 is required; credentials, query strings, and fragments are not accepted in API URLs.

## Saves and API key handling

### Browser autosave

After a successful turn, character state and non-secret connection settings are saved in the browser's `localStorage`. The API key is excluded. Returning to the game requires entering the key again unless you import a file that contains it.

Autosaves belong to the current browser and site origin. They do not sync across devices, and clearing site data removes them. Export a file before switching browsers, devices, or deployment domains.

### Export and import

1. In the game sidebar, open **存档与读档**, then choose **保存为文件**.
2. **一并保存 API Key，下次免输** is checked by default. Uncheck it before sharing a save.
3. On a later visit, choose **导入存档** on the initial screen, or open the in-game save dialog.
4. Select the JSON file, review the character and API destination, and click **读取此存档**.

Importing replaces the current progress and browser autosave. Import itself makes no model request. A save without a key returns you to setup to enter one; a save with a key restores it to the current page so you can continue directly.

**A key included in an exported file is stored as plaintext. Keep that file private and never commit it to GitHub.** Keys are sent through the game server to the chosen provider on model requests; the application does not write them to server files. Only use a hosted instance whose operator you trust.

The version-1 save format includes character details, backstory, inventory, journal, recent narrative, suggestions, combat state, and model configuration. Files are limited to **256 KB** and validated before replacing progress. Older saves with fewer suggestions remain supported.

The game retains **12 recent narrative entries**, plus a journal summary updated during exploration. Each model prompt includes up to eight recent entries. A save preserves the current state, not an unlimited transcript.

## Gameplay scope

This is a playable prototype with a subset of the tabletop rules.

| Area | Current implementation |
| --- | --- |
| Races | Human, dwarf, elf, halfling |
| Classes | Fighter, rogue, cleric, wizard |
| Backgrounds | Soldier, criminal, sage, acolyte |
| Character creation | Standard ability array and simplified racial bonuses |
| Checks | Ability checks, skill proficiency, saving throws, advantage/disadvantage |
| Combat | One enemy at a time, initiative, attacks, critical hits, dodge, potions, escape, death saves |
| Class actions | Selected features and spells, including Second Wind, hiding, Fire Bolt, Magic Missile, Sacred Flame, Guiding Bolt, and Cure Wounds |
| Rest and progression | Hit-die short rests, long rests, XP, and simplified levels 1–3 |

The model proposes scenes, checks, and enemies. The Node.js rules engine rolls dice using `crypto.randomInt` and resolves supported numerical outcomes. The model is instructed to respect those outcomes and the player's choices; narrative consistency still depends on the selected model.

Not yet implemented: multiplayer, full class/subclass progression, a complete spell list, tactical positioning, multiple simultaneous enemies, a full equipment economy, or all tabletop rules. Rest safety and the once-per-day long-rest constraint rely on the Dungeon Master's judgment; there is no persistent game clock. Solo stabilization also uses a simplified recovery rule.

## Deployment

Use a host capable of running a persistent **Node.js 22+** process. GitHub can host the source, but **GitHub Pages alone cannot run the game server**.

Start command:

```sh
npm start
```

Required runtime files: `server.js`, `index.html`, `tokens.css`, and `package.json`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port |
| `HOST` | `127.0.0.1`, or `0.0.0.0` when `PORT` is set | Listening interface |
| `ALLOWED_API_HOSTS` | `api.openai.com,api.anthropic.com,api.llmgateway.io` | Comma-separated API hostname allowlist |

`ALLOWED_API_HOSTS` **replaces** the default list. Include every hostname you intend to allow; supply hostnames only, without schemes or paths.

Linux/macOS example:

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

PowerShell example:

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
npm start
```

Route your domain's root path `/` to the Node.js process through an HTTPS reverse proxy. The frontend uses absolute paths such as `/api/play`, so deployment under a URL subdirectory is not supported as-is. Allow outbound HTTPS to the configured providers and a proxy request timeout longer than the model request's 60-second timeout.

Health check: **`GET /healthz`**, which returns `{"ok":true}` when the server responds. This checks the application process, not provider credentials or connectivity.

No server-side save database or central model key is required. The prototype has no built-in accounts, rate limiting, or anti-cheat protections; game state is supplied by the client. For a public instance, add access and request-rate controls at the reverse proxy and avoid logging request bodies containing keys.

## Development and verification

Run the automated checks:

```sh
npm test
```

The checks cover rules, provider request construction, model-output parsing, save validation, HTTP routes, frontend syntax, and the suggestion timer. Provider responses are mocked; these checks do not spend API credits or confirm access to a real model.

For browser regression checks:

```sh
node ui-test.cjs
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). A successful run changes the page title to **UI checks passed · 旅途手札**. The harness uses a dummy key, mocked model replies, and in-memory storage. Set `UI_TEST_PORT` if port 3001 is occupied.

| File | Responsibility |
| --- | --- |
| `index.html` | Character creation, game UI, API settings, saves, idle suggestions |
| `tokens.css` | Shared colors, typography, and visual tokens |
| `server.js` | HTTP server, provider requests, rules engine, model-output parsing |
| `test.js` | Automated regression checks |
| `ui-test.cjs` | Isolated browser regression harness |
| `package.json` | Node.js requirement and run/test commands |

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| 401 or 403 from a provider | API key, account permissions, billing, and model access |
| 404 from LLM Gateway | `/v1/chat/completions` path and exact model/provider/region ID |
| API hostname rejected | Administrator's `ALLOWED_API_HOSTS` setting |
| Connection failure or timeout | Server outbound network access, proxy configuration, and provider availability |
| JSON parsing error | Use a model that follows structured-output instructions. The parser can extract a usable scene object from surrounding model text, but the provider's HTTP response must still be a valid JSON envelope. |
| No action suggestions | Wait 10 seconds without typing or clicking. Suggestions are suppressed during combat, unconsciousness, model requests, save dialogs, and while the page is hidden. |
| Save missing after moving the site | Browser autosaves are origin-specific; import an exported file. |

## References and project status

The original rules reference for this project is [DND5e 不全书](https://github.com/DND5eChm/DND5e_chm), particularly the 2014 Player's Handbook material. This repository does not bundle that reference's rulebook text and is not an official Dungeons & Dragons product.

No software license has been selected for this project yet. Publishing the source does not by itself grant an open-source license.
