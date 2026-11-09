# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Existing codebase: vanilla ES modules, plain HTML and CSS, hand-made SVG charts, a Cloudflare Worker with static assets and Workers KV. No framework. Deployed to Cloudflare through GitHub.

## Users
Brandon, a solo freelance Google Ads manager, is the only person who logs in (admin and team hub). His clients are small-business owners who are not ad specialists: Pure Meal Prep SD (San Diego meal-prep subscription company; a result is a purchase) and Greenbacks Bookkeeping (a result is a form-submission lead). Clients will eventually open their own private report link; today only Brandon looks.

## Product Purpose
Live Google Ads reports in plain words for each client, plus a private hub where Brandon can see all clients at once and change clients, goals, metrics and report layout without editing code. Success: a client can open their link and understand how their ads did, whether goals are being met and what the next step is, with no jargon; Brandon can add or adjust a client in a few minutes.

## Positioning
A report written for the business owner, not the ad manager: one plain-language summary first, numbers in the client's own words (purchases, leads), goals shown as on track or not, and a single next step. Run by a one-person agency on free Cloudflare hosting.

## Operating Context
Each client has a secret report link (no login). The admin and team hub sit behind one password. Data comes from the Google Ads API through Explorer access, refreshed daily and saved. Until Google Ads is connected, sample data is shown. Reports end yesterday and compare with the previous period of the same length. Phone viewing matters (owners check on their phones).

## Capabilities and Constraints
- Five report tabs: Overview, Week by week, Campaigns, Audiences, Creative.
- Goals per client: cost per result, monthly budget, monthly results, return on ad spend (0 turns a goal off).
- Pure Meal Prep SD: goals 30 purchases a month, $1,800 a month, about 2-3x return (goal 2), conversion action "EC - Purchase".
- Greenbacks Bookkeeping: goals about 4 leads a month, $1,500 a month, conversion action "Form Submission Confirmed".
- Brandon accesses both Google Ads accounts directly with his personal email (no manager account known).
- Free Cloudflare address, no custom domain. Agency name undecided ("Kishido" floated); placeholder mark is a "K" for Knight.
- Hub pages wanted: all-clients overview, client profile, admin settings. Creative-across-clients was offered and not wanted.
- Admin login: one password stored as a Cloudflare secret.

## Brand Commitments
Placeholder "K" mark until a name and logo are chosen. Three palette options were offered earlier (navy and gold, charcoal and crimson, deep green and copper); none has been chosen.

## Evidence on Hand
No real client data yet (sample data only). No client logos or photos on hand. Do not invent testimonials or real results.

## Product Principles
1. Plain words before numbers: every report opens with what happened and what to do.
2. Numbers use the client's own word for a result.
3. Color means good or bad for the client, never decoration.
4. Brandon can change anything about a client without touching code.
5. Private by default: secret links for clients, a password for everything else.

## Accessibility & Inclusion
Readable on a phone; color never the only signal for on track or off track.
