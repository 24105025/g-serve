# G-Serve website

Static one-page site for **G-Serve** (Play. Serve. Connect.). HTML5, Tailwind CSS (CDN) and vanilla JavaScript. No build step, no backend, free to host on GitHub Pages.

```
g-serve/
├── index.html            # home page: all sections + SEO tags
├── book.html             # customer booking page
├── admin.html            # private manager dashboard (noindex)
├── css/styles.css        # custom styles
├── js/main.js            # menu + contact form
├── js/tw.js              # Tailwind colours for book/admin pages
├── js/store.js           # connection to Supabase (3 lines to edit) + shared helpers
├── js/book.js            # booking page logic
├── js/admin.js           # dashboard logic
├── assets/               # hero.jpg, logo.jpg, favicon.png, gcash-qr.jpg
├── .github/workflows/keep-alive.yml   # stops the free database from pausing
├── robots.txt
└── sitemap.xml
```

## Put it live with GitHub (step by step)

### Part 1: Create the repository
1. Sign in at github.com (create a free account if needed).
2. Click **+** (top right) > **New repository**.
3. Name it `g-serve`, set it to **Public**, leave "Add a README" unchecked, then click **Create repository**.

### Part 2: Upload the files (no software needed)
1. On the empty repo page, click **uploading an existing file**.
2. Unzip `g-serve.zip` on your computer. Open the `g-serve` folder and drag **everything inside it** (index.html, css, js, assets, robots.txt, sitemap.xml, README.md) into the GitHub upload area. `index.html` must sit at the top level of the repo.
3. Wait for all files to finish uploading, type a message like `Add G-Serve site`, and click **Commit changes**.

*Prefer the command line?* From inside the unzipped folder:
```bash
git init
git add .
git commit -m "Add G-Serve site"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/g-serve.git
git push -u origin main
```

### Part 3: Turn on GitHub Pages
1. In the repo, open **Settings** > **Pages** (left sidebar).
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and folder to `/ (root)`, then click **Save**.
4. Wait 1 to 2 minutes and refresh. GitHub shows your live address: `https://YOUR-USERNAME.github.io/g-serve/`.

### Part 4: Replace the placeholders
Edit files on GitHub by opening them and clicking the pencil icon, then **Commit changes**. Every edit redeploys automatically.
1. Search `YOUR-USERNAME` in `index.html`, `robots.txt` and `sitemap.xml` and replace it with your GitHub username (or your custom domain).
2. In `index.html`, replace the email, phone number and social links in the Contact section and in the JSON-LD block near the top.

### Part 5: Connect the contact form
1. Create a free account at formspree.io and click **New form**.
2. Copy the form ID (the part after `/f/` in the endpoint).
3. In `index.html`, replace `YOUR_FORM_ID` in the form's `action` attribute. Submissions now arrive in your inbox. The hidden `_gotcha` field blocks basic spam bots.

### Part 6 (optional): Custom domain
1. Buy a domain, then in **Settings > Pages > Custom domain** enter it and click **Save**.
2. At your domain registrar, add the DNS records GitHub lists (four `A` records for the root domain, or a `CNAME` pointing to `YOUR-USERNAME.github.io` for `www`).
3. Tick **Enforce HTTPS** once it becomes available, then update the domain in `index.html`, `robots.txt` and `sitemap.xml`.

### Part 7: Get found on Google
Add the site at search.google.com/search-console and submit `sitemap.xml`.

## Customising
- **Colours:** edit the `tailwind.config` block in `index.html` (`pine`, `deep`, `lime`, `line`). Court-line yellow comes from the hero photo.
- **Text:** all copy is plain HTML in `index.html`. Each section has an `id` (`about`, `services`, `contact`).
- **Photos:** replace `assets/hero.jpg` and `assets/logo.jpg`, keeping the same file names. Keep the hero under about 200 KB.
- **New sections:** copy an existing `<section>` block and add a link in the `<nav>`. Suggested next additions: a schedule table, pricing, a photo gallery, testimonials.
- **Faster loading:** the Tailwind CDN script is fine for launch. For maximum speed, build a static stylesheet with the Tailwind CLI and swap out the CDN `<script>`.

## Booking system

**How it is built (all free):** the pages are static and live on GitHub Pages. Bookings, prices and the manager login live in a free **Supabase** project (Postgres database). Confirmation emails are sent from your own Gmail through a small **Google Apps Script**. No server to run.

| Piece | Where | What it does |
|---|---|---|
| Customer page | `book.html` + `js/book.js` | multi-day calendar, hourly slots (peak/off-peak), paddle rental, cart, GCash QR, "Find my bookings" |
| Manager dashboard | `admin.html` + `js/admin.js` | confirmed revenue, bookings, paddles, awaiting-check count, daily revenue chart, transactions with Confirm / Reject, booking calendar |
| Database + rules | `supabase/01-schema.sql` | tables, prices, double-booking lock, security, email triggers |
| Emails | `google-apps-script/Code.gs` + `supabase/02-connect-email.sql` | "received", "confirmed", "rejected", "cancelled" emails to the customer, and a "new booking to verify" email to you |
| Keep awake | `.github/workflows/keep-alive.yml` | pings the database twice a week |

**Prices, hours, court name and paddle price** are the EDIT block at the top of `supabase/01-schema.sql`. Change them later in Supabase > Table Editor > `settings` (no re-upload needed). Your QR is `assets/gcash-qr.jpg` (replace it to change accounts). The only things to edit in `js/store.js` are the Supabase URL, the public key and the manager email.

**How payment works with your static GCash/InstaPay QR:** the customer picks times and presses **Pay with GCash QR**. The server prices the booking itself and **holds the times for 10 minutes** (nobody else can take them). The customer scans the QR, pays the exact total and types the reference number from their receipt. The booking becomes **Awaiting payment check** and you get an email. In the dashboard, compare the reference number and amount with your GCash history and press **Confirm** (customer is emailed) or **Reject** (times are released, customer is emailed). Only confirmed bookings count as revenue. A static QR cannot confirm payments by itself; automatic confirmation would need a payment provider such as PayMongo (QR Ph).

**Double-booking protection:** the database has a unique rule on (court, date, hour) for active bookings, so even two people pressing Pay at the same instant cannot both succeed. Unpaid holds expire automatically; rejected or cancelled bookings free their times; the same GCash reference number cannot be used for two bookings; prices are always recalculated on the server.

**Security notes**
- The key in `js/store.js` is a *public* key. The database tables are locked, and the website can only call the specific functions in `01-schema.sql`. Never put the `service_role` / secret key in any file.
- The manager PIN is the password of the manager account in Supabase. It is checked by Supabase, never stored in the page, and every dashboard action is re-checked on the server. Use 8 or more digits, and turn off "Allow new users to sign up" in Supabase Auth.
- Because `MANAGER_EMAIL` is visible in the page source, use an email address you only use for this.
- Keep your real secret (the Apps Script password) out of GitHub: paste it only into script.google.com and the Supabase SQL editor.

**Free-plan limits:** Gmail allows about 100 email recipients per day through Apps Script (each booking uses about 3), and a free Supabase project pauses after 7 idle days (the keep-alive workflow prevents this). If you ever see "Paused", open the Supabase dashboard and click **Restore project**.

**Troubleshooting emails:** in Supabase > SQL Editor run `select id, status_code, error_msg, created from net._http_response order by created desc limit 5;`. Run `testEmail` in the Apps Script editor to confirm Gmail is authorised.
