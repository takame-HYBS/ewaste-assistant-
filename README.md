# Second Life: E-Waste Repairability and Recycling Decision Assistant

Helps people decide whether an old electronic device should be **repaired, kept, donated, mined for parts, or recycled**,
and shows verified places that can help.

- **Frontend:** React + Tailwind CSS (Vite), Leaflet + OpenStreetMap
- **Backend:** Node.js + Express, JWT login with roles
- **Database:** SQLite (built into Node.js, so there is nothing else to install; data lives in `server/data/ewaste.db`)
- **Recommendations:** a transparent rule-based engine (`server/src/engine/recommend.js`). An image classifier is an optional, clearly-labelled hint only.

## Run it (VS Code)

You only need **Node.js LTS** from https://nodejs.org (version 22.13 or newer). Install it, then close and reopen VS Code.

1. Open this folder in VS Code (File > Open Folder), then open a terminal (Terminal > New Terminal).
2. One-time setup. This installs everything and creates the database:
   ```
   npm run setup
   ```
3. Start the app (API and website together):
   ```
   npm run dev
   ```
4. Open **http://localhost:5173** in your browser. Press **Ctrl+C** in the terminal to stop.

Seeded administrator: `admin@example.com` / `ChangeMe!123` (change it before real use).
You can also create your own accounts on the **Create account** page.

### If something goes wrong

| Message or symptom | Fix |
|---|---|
| `npm is not recognized` | Node.js is not installed, or VS Code needs to be closed and reopened after installing it |
| "needs 22.13.0 or newer" | Install the current **LTS** version from nodejs.org |
| `ENOTFOUND` / `network` during setup | No internet or a blocked network. Reconnect and run `npm run setup` again |
| `EADDRINUSE` / port already in use | Another copy is running. Close the other terminal, or restart your computer |
| Website loads but "Failed to fetch" | The API is not running. Keep `npm run dev` open and look for red errors |
| Want a clean database | Stop the app, delete the `server/data` folder, run `npm run setup` again |

### Run the pieces separately (optional)

```
cd server && npm run dev      # API on http://localhost:4000
cd client && npm run dev      # website on http://localhost:5173 (proxies /api to :4000)
```

## Tests

```
npm test
```

Runs 14 recommendation-engine tests and 19 integration tests that start the API against a throwaway database and
exercise login, the Devices CRUD module, permissions, recommendations, actions, locations, stats and admin.
Your real data is never touched.

## Roles

| Role | Can do |
|---|---|
| Device owner | Register devices, answer the questionnaire (optional photo), see recommendations, record actions, view own impact |
| Partner | Create/edit/delete own locations. New and edited listings stay hidden until an admin verifies them |
| Administrator | Manage users, categories, all locations (verify/edit/delete), review user reports, see everyone's impact |

Self-registration can only create device owners and partners. Admins are created by the seed or by another admin.

## How the recommendation works

Every option (reuse, repair, donate, parts recovery, recycle) starts at 0. Rules add or subtract points, and **each point
is recorded with a plain-language reason** that the app shows next to the result. Rules cover condition, repair cost vs.
estimated current value, age vs. typical lifespan, security-update support, liquid damage, cosmetic-only damage,
and whether you still need the device.

Safety behaviour:
- A **swollen battery** overrides scoring: result is recycle/professional handling, with no DIY instructions.
- Confidence is capped at *medium* when the repair cost is only a rough estimate or key answers are missing.
- Output is always labelled as guidance, not a diagnosis.

**Prices are placeholders.** `CATEGORY_DEFAULTS` in `recommend.js` holds rough peso figures for new price and repair cost.
Replace them with real local pricing before relying on the cost rules.

## Optional image hint

Photos are stored privately (owner/admin only) as reference. To get a category *suggestion*, set `CLASSIFIER_URL` to a
service that accepts a multipart `image` upload and returns `{"label": "laptop", "confidence": 0.87}`. The hint is shown to
the user, never fed into the recommendation, and never claims to detect internal damage. Without it, the app works
from the questionnaire alone.

## Data rules (accountability)

- Device status (registered, assessed, in progress, completed) is derived from its assessments and actions, never set directly.
- Once a device has a **completed** action, owners can no longer edit/delete the device, its assessments, or that action
  (they can add notes). Admins can correct or remove them.
- Users who own devices cannot be deleted, only deactivated. Categories in use cannot be deleted, only deactivated.
- Deleting a location keeps action history (the link is cleared).
- The last active administrator cannot be demoted, deactivated or deleted.

## Project layout

```
scripts/               setup.mjs, dev.mjs (one-command setup and start)
server/src/engine/     recommend.js (rules), imageHint.js (optional classifier)
server/src/routes/     auth, categories, devices, assessments, actions, locations, stats, admin
server/src/db/         schema.sql, pool.js (SQLite layer), migrate.js, seed.js
server/test/           engine tests + API integration tests
client/src/pages/      one file per screen
```

## Known limits / next steps

- Login throttling is in-memory (one server instance).
- No password reset or email verification yet.
- Photos are stored on local disk (`server/uploads`).
- The location list is not paginated, and there is no "near me" sorting yet.
- SQLite suits a single-server project like this one. A larger deployment would move to PostgreSQL.


## AI component
The recommendation is made by a trained machine-learning model (`server/src/ai/`), with the written rules kept as a
second opinion and safety override. See `AI_REPORT.md` for data, accuracy, limits and how to retrain
(`cd server && npm run ml:train`). Users rate each recommendation; results appear on the "How the AI works" page.

## Going online
See `DEPLOY.md` (`npm run build` then `npm start` serves everything from one link).
