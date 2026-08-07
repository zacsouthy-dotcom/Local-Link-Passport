# Local Link — Home Passport

A digital property record. One property, one page, organised into categories that matter for a home: hidden services (pipe/cable photos before walls close), compliance documents, build progress, finishes and specs, appliances and warranties, and contractors. An NFC plaque at the property links straight to it.

## How it works
1. You create a **property** in the admin panel — address, build year, and a link slug
2. You get a link: `yourdomain.com/p/123-example-street`
3. Upload photos and documents into the right category — select multiple files at once (up to 20 in one go) and add an optional caption that applies to the whole batch
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
- **Renovation & Maintenance History** — ongoing updates after handover

## Backing up a property's records
Every property's manage page has a **Download all records (.zip)** link. This exports every photo and document, organised into folders by category, plus a `SUMMARY.txt` listing everything — including text notes, which have no file of their own. Worth doing periodically, and definitely before relying on this for anything real, since right now the only copy of your data otherwise lives on Railway's volume.

## Editing and deleting properties
Each property on the dashboard has **Edit** (change the address or build year — the link slug is fixed once created, same as your tags) and **Delete** (permanently removes the property and every file uploaded to it, with a confirmation step first).

## What happens if an upload fails
Files over 15MB, or more than 20 in one go, now fail with a clear on-screen message instead of crashing. The app keeps running normally either way — one bad upload from someone's phone won't take the whole thing down.

## Builder upload link — no login needed
Each property gets its own private upload link, separate from your admin password. Find it on the property's manage page ("Builder upload link"). Send that link to the builder — they can bookmark it and add photos/documents directly, with big category buttons and a build-stage reminder ("Hidden Services photos need to happen before the walls close"), but they can never see your admin panel, other properties, or edit anything beyond adding new records to that one property. Photos they upload get compressed automatically too, same as your own uploads.

## Multiple photos at once
Both your admin upload and the builder link support selecting up to 20 files in one go, with a shared caption applied to the whole batch.

## Photo uploads are compressed automatically
Phone photos are resized (max 1800px on the longest side) and compressed in the browser before they upload — this makes on-site mobile uploads much faster without a noticeable quality drop on screen. PDFs and other document types are sent through untouched. If a photo somehow compresses larger than the original (rare), the original is used instead automatically.

## What this version deliberately does NOT do
No AI document reading, no homeowner login/account system, no insurer integrations, no maintenance reminders, no multi-user access levels. This is the 90-day MVP version — enough to build a real, working passport for one house and show builders what it looks like, not the full long-term product.

## A note on file size
Uploads are capped at 15MB each — fine for photos and PDFs, but worth knowing if someone tries to upload a very high-resolution drone video, which would need a different storage approach (this app stores files directly on the server's disk, not cloud storage).
