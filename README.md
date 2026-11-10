# Gotcha Shootout — event game page

One-time event game for Gotcha Matcha's booth at the OCBC Arena / Kallang Wave Mall pop-up, Fri 13 – Sun 15 Nov 2026 (owner, 11 Nov 2026;
records in gotcha-hq `knowledge/DECISIONS.md` 11 Nov, plan `systems/plans/SHOOTOUT-PLAN.md`). Served by GitHub Pages at
https://gotchamatcha2025.github.io/shootout/ — **the printed banner QR opens this exact address: never rename this repo or move the page.**

- `index.html` + `assets/play.js`: the phone game (free shot, or 3 shots with a cup card; prize screen with hold-to-redeem).
- `wall/`: the projector screen (1920×1080, Xiaomi projector browser). Staff press "Sound on" and "Full screen" once.
- `staff/`: the staff phone page (PIN checked by the server).
- `rules/`: who runs it, when, how shots are decided, prizes, data (GRA trade-promotion information).
- `assets/judge.js`: the game rules, **byte-identical** to the server's `src/judge.js` (the server's tests compare them).
- `assets/pitch.js`: the pitch, keeper, ball and stadium lights (2D canvas, no WebGL). `assets/core.js`: server calls, phone storage,
  sounds (made in the browser, no audio files), confetti.
- Brand: logo, cat doodles, matcha photo and the Gotcha hand lettering are copied from the Website repo (`assets/img`, `assets/fonts`).
  `assets/vendor/qrcode.min.js` = qrcode-generator 1.4.4 (MIT), used by the staff page for new cup codes.

The server is the private repo `shootout-server` (Cloudflare Worker `gotcha-shootout`, its own D1). It decides every result and holds the
prices, prizes, odds and hours. Phone storage keys all start `shootout:` (the spin page lives on the same site).

**Testing:** add `?api=staging` once (remembered for the browser tab) or open the page from the Mac (`localhost`): it then uses the staging
server (its own database, always open). A yellow "TEST SERVER" tag shows on every staging page. `?api=live` switches back.

After the event: archive this repo and switch Pages off (owner's last look first); the server deletes its data after 30 Nov 2026.
