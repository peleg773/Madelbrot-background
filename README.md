# Mandelbrot Background (WebGL2)

Live at [https://peleg773.github.io/Madelbrot-background/](https://peleg773.github.io/Madelbrot-background/).

Fullscreen animated Mandelbrot/Multibrot background ported from Processing.

## What It Does
- Renders a continuously evolving fractal in real time.
- Starts each new scene from pure black and evolves pixel-by-pixel.
- Auto-picks deep boundary points for each scene.
- Uses mixed integer powers (`2, 3, 4, 5`) so scenes include Multibrot sets, not only classic Mandelbrot (`power = 2`).

## Tech
- `index.html` + `styles.css` + `app.js`
- `picker-worker.js` for async scene picking
- WebGL2 render pipeline with ping-pong textures for performance
- Automatic fallback to main-thread scene picking if Worker is unavailable (for example some `file://` launches)

## Run
1. Open `index.html` directly, or
2. Serve the folder (recommended):
   - Python: `python -m http.server 8000`
   - Open: `http://localhost:8000`

## Mobile Notes
- Designed to run on modern mobile browsers (Chrome/Safari/Firefox).
- Canvas is fullscreen and responsive to orientation/viewport changes.
- If Worker creation fails on a device/browser, scene picking continues on the main thread.

## Tuning
Main runtime knobs are at the top of [`app.js`](./app.js):
- `PICK_DEPTH`: deeper boundary search (`16` by default)
- `POWER_OPTIONS`: frequency of power values per scene
- `COLOR_COVERAGE_TARGET`: percent of colored pixels before switching scenes (`0.975` by default)
- `MAX_SCENE_FRAMES`: hard upper bound on scene lifetime
- `SAMPLE_EVERY_N_FRAMES`: how often scene-switch metrics are sampled
- `MIN_RENDER_RADIUS` and `PRECISION_RADIUS_FACTOR`: depth vs precision safety
