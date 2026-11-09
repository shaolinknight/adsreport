# Google Ads client reports

Live Google Ads reports for your clients, one private link each. Plain HTML, CSS and JavaScript in the browser, one small Cloudflare Worker behind it, saved reports in Cloudflare KV. No framework and no database.

**Current version: 1.0** (client report, sample data). See the version notes at the bottom.

---

## What is in this folder

| Path | What it does |
|---|---|
| `wrangler.jsonc` | Cloudflare settings: the Worker name, the pages folder, the saved-report store, the daily schedule |
| `clients.json` | Your client list: name, private link key, Google Ads ID, result name, goals |
| `worker/index.mjs` | The Worker: serves the pages and `/api/...`, runs the daily refresh |
| `worker/lib/ads.mjs` | Google Ads sign-in, queries, building one report |
| `worker/lib/store.mjs` | Client list and saved reports (Cloudflare KV) |
| `worker/lib/demo.mjs` | Sample data, used until Google Ads is connected |
| `worker/lib/report.mjs` | `/api/report` (the report for a link and date range) and `/api/refresh` |
| `worker/lib/refresh.mjs` | Rebuilds and saves reports; the daily job |
| `worker/lib/ranges.mjs` | Turns "last 30 days" or custom dates into exact dates |
| `src/lib/calc.mjs` | All the number logic (totals, weeks, goals, summary). Tested. |
| `src/pages`, `src/css`, `src/js` | The pages you see |
| `scripts/build.mjs` | Builds the pages into `dist/` |
| `scripts/dev.mjs` | Optional local preview with sample data (`npm run dev`) |
| `test/` | Automated tests (`npm test`) |

---

## Step 1. Put the files on GitHub

1. Unzip `dashboards-1.0.zip` on your computer. You will get a folder called `dashboards`.
2. On GitHub, click **New repository**. Name it `ads-reports`. Choose **Private**. Click **Create repository**.
3. On the new empty repository page, click **uploading an existing file**.
4. Open the unzipped `dashboards` folder. Select everything inside it and drag it into the GitHub page. Drag the folders too (`worker`, `src`, `scripts`, `test`).
5. Wait for the upload to finish, then click **Commit changes**.

Check that you can see `wrangler.jsonc`, `package.json` and `package-lock.json` in the list of files. Those three matter most.

## Step 2. Connect the repository to Cloudflare

1. In Cloudflare, go to **Workers & Pages** and click **Create application**.
2. Choose to **import a repository** (the Git option). Pick the GitHub account and the `ads-reports` repository.
3. Cloudflare asks for a project name. **It must be exactly `ads-reports`**, because that is the name in `wrangler.jsonc`. If the names differ the build will fail.
4. Set the build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (this is usually already filled in)
5. Click **Save and Deploy**.

When the build finishes, Cloudflare shows your address. It looks like `https://ads-reports.YOUR-NAME.workers.dev`.

On the first deploy Cloudflare also creates the saved-report store (called `REPORTS`) by itself. If the build stops with a message about a missing KV namespace, tell me the exact words and I will give you the two clicks to fix it.

## Step 3. Open your reports

Each client has a private link. Add the client's `linkKey` (from `clients.json`) to your address:

- Pure Meal Prep SD: `https://ads-reports.YOUR-NAME.workers.dev/pure-meal-prep-sd-p7xa72s`
- Greenbacks Bookkeeping: `https://ads-reports.YOUR-NAME.workers.dev/greenbacks-bookkeeping-jukhmb8`

Until Google Ads is connected, every report shows a yellow **Sample data** bar. The numbers are made up so you can see the layout.

Anyone with a link can open that one client's report, so send each link only to that client. The link is the only protection (the plan in the brief). Search engines are told to ignore the pages.

### Trying the three colour palettes

Add `?theme=` to a report link:

- `?theme=steel` navy and steel blue with gold (the default)
- `?theme=banner` charcoal and crimson with brass
- `?theme=order` deep green and copper

Tell me which one you like and I will make it the default in version 1.1. The palettes live at the top of `src/css/base.css`, and the default is set in `src/js/brand.js`.

## Changing a client

Click `clients.json` on GitHub, click the pencil icon, change it, then click **Commit changes**. Cloudflare rebuilds in about a minute.

Things you will want to change soon (the goals are placeholders):

- `customerId`: the client's Google Ads ID, digits only, no dashes
- `goals`: `costPerResult`, `monthlyBudget`, `monthlyResults`, `roas` (use `0` to switch a goal off)
- `conversionActions`: the exact names of the conversion actions that count as a result, as they appear in Google Ads

The admin page that does this with forms is planned for version 1.1.

---

## Step 4. Connect Google Ads (later)

This is the slow part because Google reviews access requests. In 1.1 I will walk you through it one click at a time. In short:

1. Create a Google Cloud project and turn on the Google Ads API.
2. Apply for **Explorer** access on that project (enough for two clients). Google retired developer tokens on 9 September 2026, so access now belongs to the Cloud project that owns the OAuth client. There is no developer token to find or paste.
3. Create an OAuth client (Web application) and get a refresh token for the Google user that can see your accounts. Google now asks for a passkey when creating a new refresh token.
4. In Cloudflare, open the Worker, then **Settings**, then **Variables and Secrets**. Add these as **Secrets** (never in the code, never in chat):

| Name | What it is |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | OAuth client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | The refresh token |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Your manager (MCC) account ID, digits only |
| `REFRESH_SECRET` | Optional. A long random phrase that lets you trigger a refresh by hand |

`GOOGLE_ADS_API_VERSION` (currently `v25`) and `REFRESH_RANGES` (currently `7,30,90`) are ordinary settings in `wrangler.jsonc`. The daily refresh runs at 11:17 UTC, about 3:17 am in San Diego.

5. Put each client's Google Ads ID into `clients.json`.

Once the secrets and the ID are in, the yellow bar disappears and the report uses real numbers. Everything else stays the same.

---

## What is tested, and what is not

- **Tested (62 automated tests):** all the number logic, date ranges and the comparison period, goal colours and thresholds, the summary wording, the Google sign-in and query code (against a pretend Google), saved reports, stale-copy refresh, the daily job, link safety, and that one client can never see another's data.
- **Also checked in a real browser:** no sideways scrolling at 360, 390, 820 and 1280 pixels wide on every tab, every campaign view, all three palettes, and that campaign names with odd characters cannot break the page.
- **NOT tested against a real Google Ads account** (there is no access yet): every live Google Ads query. The ones to watch on the first real run:
  - the main campaign-by-day query and the split of results by conversion action
  - ad groups, ads, keywords (`keyword_view`), search terms (`search_term_view`)
  - age (`age_range_view`), gender (`gender_view`), audience segments (`campaign_audience_view`)
  - videos (`video`, with the `ad_group_ad_asset_view` fallback) and their watch-through fields
  - filtering by `segments.date` without selecting the date, which I believe Google allows

If any extra table fails, the report still loads, leaves that part out and says which part. If the main table fails, the report shows Google's problem in plain words (for example "The Google Cloud project only has Test access").

---

## Version notes

### 1.0 (9 November 2026)

- Client report at `/{link-key}` with sample data for Pure Meal Prep SD and Greenbacks Bookkeeping.
- Header with date buttons (7, 30, 90 days, custom), campaign type filter and an updated time.
- Five tabs: Overview (plain-words summary, headline numbers with change against the previous period, day-by-day chart, goals, what stands out, next step), Week by week (weekly table with best and weakest full week, day-of-week chart), Campaigns (ranked, click into ad groups, ads, keywords, search terms), Audiences (age, gender, device, audience segments), Creative (videos with watched-to 25, 50, 75 and 100 percent, and ads).
- Every number uses the client's own word for a result (purchase, lead). Green only when a change is good for the client; spend is never coloured.
- Hosted on Cloudflare Workers with saved reports in KV and a daily refresh. Custom date ranges are built on demand, then saved for two weeks. A saved copy older than a day is shown at once and refreshed in the background.
- Google Ads code is in place and uses OAuth only (no developer token), but is untested against a live account.
- Three colour palettes to try with `?theme=`.

**Not in 1.0 yet (planned):** the team pages (all clients, clients and goals admin, creative across clients, client profile), password protection for them, and the guided Google Ads connection.

**Choices I made (tell me if you want any changed):**

- Hosting is Cloudflare Workers with static assets, not Cloudflare Pages. The Worker handles the data; the daily job uses a Cron Trigger instead of a separate background function and queue. With two clients this is simple and fast.
- Reports end **yesterday**, because today's numbers are still changing.
- Google Ads API version `v25`. Version `v26` exists; change `GOOGLE_ADS_API_VERSION` when you want it.
- Goal colours: cost per result is green at or under goal, amber up to 15% over, red beyond. Results are green at or over the goal for the period, amber down to 85%. Spend is green between 70% and 105% of the budget for the period, amber up to 120%, red beyond. Return on ad spend is green at or over goal, amber down to 85%. These numbers are in one place: `THRESHOLDS` in `src/lib/calc.mjs`.
- The `K` is a plain placeholder mark in the top bar until you pick a name and logo.
- Both clients' goals and names of conversion actions (`Purchase`, `Form submission`) are placeholders. Replace them with the real ones.
