# Forge — Train & Eat

A fast, offline-first workout logger and calorie tracker in one installable web app (PWA).
It has no account and no server, and your data stays on your device.

## Why it's built this way

The design pulls the best ideas from the top apps in each category:

| Idea | Inspired by | In Forge |
|---|---|---|
| Fast, minimal set logging with "previous" column | Strong | Workout logger with Prev column and one-tap ✓ |
| Generous free tier, history & PRs | Hevy | Everything is free, with PR detection + confetti 🏆 |
| Tells you what to lift next | Fitbod | 🔮 Double-progression suggestions per exercise |
| Calorie + macro diary with a big food DB | MyFitnessPal / Lose It | Meal diary, local SA-friendly food list, Open Food Facts search |
| Smoothed weight trend, not daily noise | MacroFactor | Exponentially smoothed trend line + weekly rate |
| Evidence-based targets | Cronometer | Mifflin-St Jeor TDEE, protein by body weight |

## Features
- **Train:** routines (Push/Pull/Legs/Full Body included), a 44-exercise library + custom exercises, rest timer with sound/vibration, live workout timer, PR detection (Epley e1RM), history, and repeating a past workout
- **Smart progression:** double progression (8→12 reps, then add load), tuned by per-set effort ratings (RPE 😌🙂😤💀). It detects stalls after 3 flat sessions, suggests a deload week every 4/6/8 training weeks, and has a "rough day" mode.
- **Exercise guides:** form cues, muscles worked, the most common mistake, a form-video link, and your own stats for every exercise
- **Eat:** breakfast/lunch/dinner/snacks, a built-in food list with SA staples (pap, boerewors, biltong, chakalaka…), recent foods, quick add, custom foods, and a water tracker
- **Barcode scanning:** uses the native BarcodeDetector where available, with a ZXing fallback for iPhone and manual number entry. Lookups go to Open Food Facts.
- **Online food search:** South African products first, with automatic retry when Open Food Facts is rate-limiting
- **Progress:** weight trend, 14-day calories vs target, muscle sets heat map, weekly volume, e1RM chart per lift, and a PR leaderboard
- **Backup & sync:** automatic cloud backup to a *private* GitHub Gist (token stays on-device) with conflict handling across devices. You can also share a backup file to WhatsApp/Drive/email and restore from it.
- **Reminders:** training days + time and a food-log nudge, shown as notifications while the app is open and exportable to your phone's calendar (.ics) for when it's closed
- **Animations:** animated calorie ring and count-ups, sliding tab indicator, spring sheets, confetti, set-tick animations, a pulsing rest timer, a scanning laser, and drifting ambient background. Motion is reduced when the OS asks for it.
- **Phone-ready:** PNG home-screen icons for iOS/Android, 16px inputs (no iOS zoom), offline caching

## Run locally
It's static files, so you can serve the folder with any web server, e.g.

```bash
npx serve .
```

Then open the URL and "Add to Home Screen" to install it.

## Deploy
You can deploy it to GitHub Pages, Netlify or Vercel as-is, with no build step.
