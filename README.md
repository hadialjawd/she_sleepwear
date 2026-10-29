# She Sleepwear

A simple app to track an online pajama shop: shipments from Turkey, stock, orders, cash on delivery, expenses and profit.
Works on phone and computer. Runs free on Cloudflare (no credit card).

## What it does

- **Shipments**: add each shipment from Turkey with its items, shipping and customs. When it arrives, the app splits shipping and customs over every piece, so you see the **real cost per piece**.
- **Stock**: by style, size and color. Goes down when you sell, comes back on returns or cancels.
- **Orders**: customer, area, items, cash on delivery / Whish / OMT / cash in hand, and status (New → Sent → Delivered → Paid).
- **Drivers owe you**: cash-on-delivery orders that were delivered but not paid to you yet.
- **Dashboard**: profit for the month, sales, costs, stock value, best sellers, low stock, 6-month profit chart.
- **Expenses**: ads, packaging and other costs, with receipt photos.
- **Receipts**: photos are shrunk and saved with the shipment or expense.
- **USD and LBP**: every money field can be typed in USD or LBP. Everything is saved in USD using the rate in Settings.
- **Google sign-in with an allow list**: only the owner and the emails the owner adds can get in. Only the owner can add or remove people. **Export** to Excel (CSV) from Settings.

## How profit is counted

```
Profit = sales − real cost of pieces sold − delivery fees − other expenses
```

Only orders marked **Delivered** or **Paid** count as sales.
Real cost of a piece = Turkey price + (shipping + customs + other) ÷ number of pieces in that shipment.

## Put it online (Cloudflare, free)

You need a free Cloudflare account and Node.js on a computer.

```bash
npm install
npx wrangler login
npx wrangler d1 create she-sleepwear
```

Copy the `database_id` it prints into `wrangler.jsonc`.

Set up Google sign-in (free):
1. In [Google Cloud Console](https://console.cloud.google.com), create a project, then **Google Auth Platform → Get started** (Audience: External).
2. **Clients → Create client → Web application**. Add your app link (`https://she-sleepwear.<your-name>.workers.dev`) under **Authorized JavaScript origins**.
3. **Audience → Publish app**.
4. Put the **Client ID** in `GOOGLE_CLIENT_ID` and your Google email in `OWNER_EMAIL` in `wrangler.jsonc`. The client secret is not needed.

Then:

```bash
npm run db:init
npm run deploy
```

Open the link it shows and sign in with the owner's Google account. Add other people in **More → Settings → Who can get in**.

## Run it on your computer

```bash
npm install
npm run db:init:local
npm run dev
```

Then open http://localhost:8787. For Google sign-in to work locally, also add `http://localhost:8787` to the Client's **Authorized JavaScript origins**.

## Database changes

Files in `migrations/` change an existing database. Run each new one once:

```bash
npx wrangler d1 execute she-sleepwear --remote --file=migrations/0002_google_login.sql
```

## Free plan limits

Cloudflare's free plan is far more than a small shop needs (about 100,000 requests a day, 5 GB database).
With no card on file, going over a limit stops the app for the day. It does not charge you.

## Files

- `src/index.js`: the server (API, login, profit math)
- `public/`: the app screens (HTML, CSS, JavaScript)
- `schema.sql`: database tables
- `wrangler.jsonc`: Cloudflare settings
