# Google Ads client reports

Live Google Ads reports for your clients, one private link each, plus a private team hub to manage them. Plain HTML, CSS and JavaScript in the browser, one small Cloudflare Worker behind it, settings and saved reports in Cloudflare KV. No framework and no database.

**Current version: 1.1** (new look, team hub and admin). See the version notes at the bottom.

---

## What is in this folder

| Path | What it does |
|---|---|
| `wrangler.jsonc` | Cloudflare settings: the Worker name, the pages folder, the store, the daily schedule |
| `clients.json` | Only the **first-run starting list**. After the first visit the hub's copy is the real one (see "Changing a client") |
| `worker/index.mjs` | The Worker: serves the pages and `/api/...`, runs the daily refresh |
| `worker/lib/admin.mjs` | The hub's data and actions (`/api/admin/...`) |
| `worker/lib/auth.mjs` | Hub password, sign-in cookie, lock-out after repeated wrong passwords |
| `worker/lib/config.mjs` | Where clients and report settings are kept, and the checks on what you type |
| `worker/lib/ads.mjs` | Google Ads sign-in, queries, building one report |
| `worker/lib/store.mjs` | Saved reports (Cloudflare KV) |
| `worker/lib/demo.mjs` | Sample data, used until Google Ads is connected |
| `worker/lib/report.mjs` | `/api/report` (the report for a link and date range) and `/api/refresh` |
| `worker/lib/refresh.mjs` | Rebuilds and saves reports; the daily job |
| `src/lib/catalog.mjs` | The lists the hub offers: colour palettes, tabs, headline numbers, date choices |
| `src/lib/calc.mjs` | All the number logic (totals, weeks, goals, summary). Tested. |
| `src/pages`, `src/css`, `src/js` | The pages you see: `report.html` (client report) and `hub.html` (team and admin) |
| `scripts/build.mjs` | Builds the pages into `dist/` |
| `scripts/dev.mjs` | Optional local preview with sample data (`npm run dev`) |
| `test/` | Automated tests (`npm test`) |

---

## Step 1. Put the files on GitHub

1. Unzip `dashboards-1.1.zip` on your computer. You will get a folder called `dashboards`.
2. On GitHub, click **New repository**. Name it `ads-reports`. Choose **Private**. Click **Create repository**.
3. On the new empty repository page, click **uploading an existing file**.
4. Open the unzipped `dashboards` folder. Select everything inside it and drag it into the GitHub page. Drag the folders too (`worker`, `src`, `scripts`, `test`).
5. Wait for the upload to finish, then click **Commit changes**.

Check that you can see `wrangler.jsonc`, `package.json` and `package-lock.json` in the list of files. Those three matter most.

**Updating from 1.0:** upload the same way over your existing repository (GitHub replaces files with the same name). Your clients keep working, and the hub copies their details from `clients.json` the first time it is opened.

## Step 2. Connect the repository to Cloudflare

1. In Cloudflare, go to **Workers & Pages** and click **Create application**.
2. Choose to **import a repository** (the Git option). Pick the GitHub account and the `ads-reports` repository.
3. Cloudflare asks for a project name. **It must be exactly `ads-reports`**, because that is the name in `wrangler.jsonc`. If the names differ the build will fail.
4. Set the build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (this is usually already filled in)
5. Click **Save and Deploy**.

When the build finishes, Cloudflare shows your address. It looks like `https://ads-reports.YOUR-NAME.workers.dev`.

On the first deploy Cloudflare also creates the store (called `REPORTS`) by itself. If the build stops with a message about a missing KV namespace, tell me the exact words and I will give you the two clicks to fix it.

## Step 3. Switch on the team hub

The hub has one password. It lives in Cloudflare, never in the code.

1. In Cloudflare, open the `ads-reports` Worker, then **Settings**, then **Variables and Secrets**.
2. Click **Add**, choose type **Secret**, name it `ADMIN_PASSWORD`, and type a password of at least 8 characters. A few random words is good.
3. Save and deploy.
4. Go to `https://ads-reports.YOUR-NAME.workers.dev/team` and sign in. Sessions last 14 days. Changing the password signs everyone out. Five wrong passwords from one place lock sign-in for 15 minutes.

Until that secret exists, `/team` and `/admin` show a "hub is switched off" page and no private data can be reached.

## Step 4. Use the hub

- **`/team`: All clients.** Last 30 days for each client with the change against the 30 days before, goal status and anything that needs a look.
- **`/team/client/...`: Client profile.** One client's numbers, goal strips, report link (copy it), and an **Update numbers now** button once Google Ads is connected.
- **`/admin`: Clients and goals.** Add a client, pause one (its link shows "not valid"), or open its settings.
- **Client settings.** Name, Google Ads account ID, the exact conversion names that count, what a result is called, goals, report colour, which tabs show, which headline numbers show and in what order (the first three are large), the range it opens on, a note shown on the report, and private notes only you see. A new secret link is made for every client. **Make a new link** replaces it if one is shared by mistake. Deleting needs the client's name typed in.
- **`/admin/settings`: Report settings.** The name and mark in the report's top bar, and how far off a goal can be before it turns amber or red (in plain percentages).
- **`/admin/connection`: Google Ads connection.** Shows which secrets are set. Never shows their values.

Changes to goals, colours, tabs and numbers show on the client's report straight away. Changing the Google Ads account ID or the conversion names rebuilds the saved numbers in the background.

### Client report links

Each client's link is shown on their profile page. It looks like `https://ads-reports.YOUR-NAME.workers.dev/pure-meal-prep-sd-p7xa72s`. Anyone with a link can open that one client's report, so send each link only to that client. Search engines are told to ignore the pages.

Until Google Ads is connected, every report shows a yellow **Sample data** bar. The numbers are made up so you can see the layout.

### Colours

Eight palettes: Paprika, Saffron, Fern, Lagoon, Harbor (default), Plum, Clay and Slate. Pick one per client in the hub. To preview one on a report without saving, add `?theme=fern` (or any palette name) to the link. The old `steel`, `banner` and `order` names still work and map to Harbor, Paprika and Fern.

To add a colour: add a line near the top of `src/css/base.css` (a hue and a strength) and one entry in `src/lib/catalog.mjs`. Everything else is worked out from those.

## Changing a client

Use the hub. `clients.json` is only used **once**, the first time the hub's store is empty. After that, editing `clients.json` on GitHub changes nothing, because the hub's copy is the real one.

---

## Step 5. Connect Google Ads (later)

This is the slow part because Google reviews access requests. Ask me and I will walk you through it one click at a time. In short:

1. Create a Google Cloud project and turn on the Google Ads API.
2. Apply for **Explorer** access on that project (enough for two clients). Google retired developer tokens on 9 September 2026, so access now belongs to the Cloud project that owns the OAuth client. There is no developer token to find or paste.
3. Create an OAuth client (Web application) and get a refresh token for the Google user that can see your accounts. Google now asks for a passkey when creating a new refresh token.
4. In Cloudflare, open the Worker, then **Settings**, then **Variables and Secrets**. Add these as **Secrets** (never in the code, never in chat). Also set the OAuth consent screen to **In production**, or Google ends the refresh token after about 7 days:

| Name | What it is |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | OAuth client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | The refresh token |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Only if your clients sit under a manager (MCC) account: that manager account's ID, digits only. If you open each client's account directly, leave it out. |
| `REFRESH_SECRET` | Optional. A long random phrase that lets you trigger a refresh by hand |

`GOOGLE_ADS_API_VERSION` (currently `v25`) and `REFRESH_RANGES` (currently `7,30,90`) are ordinary settings in `wrangler.jsonc`. The daily refresh runs at 11:17 UTC, about 3:17 am in San Diego.

5. Put each client's Google Ads ID on its settings page in the hub (**Admin**, then the client, then **Google Ads, Account ID**). The hub's **Google Ads connection** page shows which of the secrets above are set.

Once the secrets and the ID are in, the yellow bar disappears and the report uses real numbers. Everything else stays the same.

---

## What is tested, and what is not

- **Tested (80 automated tests):** the hub sign-in (wrong passwords, lock-out after repeated failures, the cookie), every hub action (add, edit, pause, new link, delete), that hub changes show on the report at once, all the number logic, date ranges and the comparison period, goal colours and thresholds, the summary wording, the Google sign-in and query code (against a pretend Google), saved reports, stale-copy refresh, the daily job, link safety, and that one client can never see another's data.
- **Also checked in a real browser:** no sideways scrolling at 360, 390, 820 and 1280 pixels wide on every tab, every campaign view, every palette, and that campaign names with odd characters cannot break the page.
- **NOT tested against a real Google Ads account** (there is no access yet): every live Google Ads query. The ones to watch on the first real run:
  - the main campaign-by-day query and the split of results by conversion action
  - ad groups, ads, keywords (`keyword_view`), search terms (`search_term_view`)
  - age (`age_range_view`), gender (`gender_view`), audience segments (`campaign_audience_view`)
  - videos (`video`, with the `ad_group_ad_asset_view` fallback) and their watch-through fields
  - filtering by `segments.date` without selecting the date, which I believe Google allows

If any extra table fails, the report still loads, leaves that part out and says which part. If the main table fails, the report shows Google's problem in plain words (for example "The Google Cloud project only has Test access").

---

## Version notes

### 1.1 (9 November 2026)

- **New look for the client report:** colour-chip theme. Each client has their own colour. Three large headline cards, smaller numbers underneath, goals shown as five-step paint strips with a text status (never colour alone), a Figtree typeface served from your own site, and a layout that holds at phone width.
- **Team hub** (password protected): all clients, client profile, clients and goals, add a client, report settings, Google Ads connection check.
- **Per-client report settings:** colour, tabs, headline numbers and order, opening date range, a note to the client, result wording, goals.
- **Overall settings:** the name and mark on reports, and the goal colour thresholds.
- Real goals and account IDs entered: Pure Meal Prep SD (30 purchases a month, $1,800 budget, return on ad spend 2, cost per purchase $60, `EC - Purchase`, account 159-991-9693) and Greenbacks Bookkeeping ($1,500 budget, 4 leads a month, $375 a lead, `Form Submission Confirmed`, account 961-475-1344).
- Settings now live in Cloudflare KV (`config:v1`). `clients.json` seeds it once.
- A manager (MCC) account ID is optional.
- Sample data adjusted so each client's sample numbers sit near their real goals.

**Heads up on small numbers:** Greenbacks is aiming for about 4 leads a month, so one lead more or less moves cost per lead and the goal colour a lot. Look at a 90-day range before reacting.

**Still not tested:** the Google Ads queries against a real account (see above).

### 1.0 (9 November 2026)

- Client report at `/{link-key}` with sample data.
- Header with date buttons (7, 30, 90 days, custom), campaign type filter and an updated time.
- Five tabs: Overview, Week by week, Campaigns (down to ad groups, ads, keywords, search terms), Audiences, Creative.
- Every number uses the client's own word for a result. Green only when a change is good for the client; spend is never coloured.
- Hosted on Cloudflare Workers with saved reports in KV and a daily refresh.

**Choices I made (tell me if you want any changed):**

- Hosting is Cloudflare Workers with static assets, not Cloudflare Pages. With two clients this is simple and fast.
- Reports end **yesterday**, because today's numbers are still changing.
- Google Ads API version `v25`. Change `GOOGLE_ADS_API_VERSION` in `wrangler.jsonc` when you want `v26`.
- Goal colour defaults: cost per result green at or under goal, amber up to 15% over, red beyond. Results green at or over the goal for the period, amber down to 85%. Spend green between 70% and 105% of budget, amber up to 120%, red beyond. Return on ad spend green at or over goal, amber down to 85%. You can change all of these in the hub under **Report settings**.
- The `K` is a plain placeholder mark until you pick a name and logo. Set the name in **Report settings**.
