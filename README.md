# Local Link — Home Passport

A digital property record. One property, one page, organised into categories that matter for a home: hidden services (pipe/cable photos before walls close), compliance documents, build progress, finishes and specs, appliances and warranties, and contractors. An NFC plaque at the property links straight to it.

## How it works
1. You create a **property** in the admin panel — address, build year, and a link slug
2. You get a link: `yourdomain.com/p/123-example-street`
3. Upload photos and documents into the right category — each upload gets an optional caption
4. Write that link onto an NFC plaque, install it at the meter box / garage / entryway
5. Anyone — homeowner, future buyer, tradie, insurer — taps the plaque and sees the organised record, no login required to view

## Running it locally
```
npm install
ADMIN_PASSWORD=yourpassword npm start
```
Open `http://localhost:3000`, log in, click **+ New property**.

## Deploying (same process as your other Local Link apps)
1. Push this folder's contents to a new GitHub repo (contents at the top level)
2. New Railway project → Deploy from GitHub repo
3. Variables: `ADMIN_PASSWORD`, `SESSION_SECRET`
4. Add a Volume mounted at `/app/data` — **this one matters even more than your other apps**, since it's storing actual photo and document files, not just small text records. Losing this volume means losing real uploaded files, not just re-creatable data
5. Settings → Networking → Generate Domain

## Categories included
- **Hidden Services** — pipe & cable locations before walls closed (your strongest, hardest-to-copy asset)
- **Compliance Documents** — CCC, producer statements, certificates
- **Build Progress** — photos through each stage
- **Finishes & Specs** — paint codes, product specifications
- **Appliances & Warranties** — manuals, models, warranty info
- **Contractors** — who built it, who to call

## What this version deliberately does NOT do
No AI document reading, no homeowner login/account system, no insurer integrations, no maintenance reminders, no multi-user access levels. This is the 90-day MVP version — enough to build a real, working passport for one house and show builders what it looks like, not the full long-term product.

## A note on file size
Uploads are capped at 15MB each — fine for photos and PDFs, but worth knowing if someone tries to upload a very high-resolution drone video, which would need a different storage approach (this app stores files directly on the server's disk, not cloud storage).
