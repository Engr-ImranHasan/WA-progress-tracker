# WA Section Progress Studio (A1 Micro-Tunnelling Report)

Interactive digital progress report & A1 CAD-style vector drawing generator for **WA Section (WA-01 to WA-36 incl. WA-24.1 + Pump Station)**.

## Features
- **37 Shafts (`WA-1`..`WA-36`, `WA-24.1`)** with dynamic **6 to 13 layers (`W1`–`W13`)** + Bottom Slab.
- **2-Part Manhole Tracking**: Lower **In-situ Casting** + Upper **Precast Ring** tracked independently (`0–100%`).
- **Shaft-to-Shaft Micro-Tunnelling Connections** (`DN900`, `DN1100`, `DN1600`, variable lengths, synced `%` ↔ `meters`).
- **Auto Duration & Status**: Inclusive `Duration (Days)` calculation and automatic `Remaining` / `On-going` / `Complete` status.
- **Incremental Weekly & Monthly Progress Comparison**:
  - **Weekly View**: Shows work up to Previous Week in one color and This Week's progress in a distinct highlight color.
  - **Monthly View**: Shows work up to Last Monthly Meeting in one color and New Monthly progress in a highlight color.
  - **Close Week / Close Month Rollover**: Lock a finished period into History and continue entering new updates seamlessly from that point forward.
- **Instant Auto-Save**: Every edit saves automatically to browser storage (`localStorage`), plus 1-click **JSON Backup** and **Excel (`.xlsx`) Import/Export**.
- **A1 Exports**: **A1 Vector PDF (`841×594mm`)**, **Browser Print A1**, **Vector SVG**, **High-Res PNG**, **AutoCAD DXF (`.dxf`)**, and **Excel (`.xlsx`)**.

## Deploy to GitHub Pages
1. Push the `wa-progress-tracker` folder to a GitHub repository (on branch `main`).
2. Go to **Repository → Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` workflow will automatically build and publish your live app!

## Local Development
```bash
npm install
npm run dev
```
