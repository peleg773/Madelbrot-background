# Mandelbrot Background (WebGL2)

Live at [https://peleg773.github.io/Madelbrot-background/](https://peleg773.github.io/Madelbrot-background/).

Fullscreen animated Mandelbrot/Multibrot background ported from Processing.

## What It Does
- Renders a continuously evolving fractal in real time.
- Starts each new scene from pure black and evolves pixel-by-pixel.
- Auto-picks deep boundary points for each scene.
- Uses integer exponents (`2..8`) so scenes can be classic Mandelbrot (`power = 2`) or Multibrot (`power > 2`).
- Includes a hidden slide-in settings menu from the left edge (desktop + mobile).
- Includes optional on-canvas controls for save, pause, stay-on-scene, and new scene actions.
- Persists user settings in localStorage (`mandelbrotBackground.settings.v2`) with palette-specific color profiles.

## Tech
- `index.html` + `styles.css` + `app.js`
- `picker-worker.js` for async scene picking
- WebGL2 render pipeline with ping-pong textures for performance
- Automatic fallback to main-thread scene picking if Worker is unavailable (for example some `file://` launches)
- Palette LUT texture sampling in shader with seamless cyclic palettes (default: HSV)

## Run
1. Open `index.html` directly, or
2. Serve the folder (recommended):
   - Python: `python -m http.server 8000`
   - Open: `http://localhost:8000`

## Mobile Notes
- Designed to run on modern mobile browsers (Chrome/Safari/Firefox).
- Canvas is fullscreen and responsive to orientation/viewport changes.
- If Worker creation fails on a device/browser, scene picking continues on the main thread.
- Pull-to-refresh remains available (the page is not hard-locked with `overflow: hidden`).
- Menu opening gesture is edge-only from the left side to reduce scroll conflicts.

## Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `Space` | Pause / Resume |
| `N` | New scene |
| `H` | Hold (stay on current scene) |
| `S` | Save current frame as PNG |
| `M` | Toggle settings menu |
| `F` | Toggle fullscreen |
| `Esc` | Close settings menu |

Double-click or double-tap the canvas to toggle fullscreen.

## Controls (Slide-In Menu)
Open by dragging from the left edge.

- **Color**
  - Palette dropdown (cyclic palette set, default `HSV Classic`, includes `Wikipedia` gradient).
  - Start color control with per-palette `Random` or manual palette-position memory.
  - Palette cycle length slider (maps to color-cycle period; old `MOD` concept).
  - `Smooth Colors` toggle for continuous escape coloring.
  - Marginal color increment slider using `(((n+1)^(1-c^d))-1)/(1-c^d)` with `d = log_0.5(0.21)`.
- **Timing**
  - Scene length mode: `seconds | frames | iterations` (default `seconds`).
  - Scene length slider (unit depends on selected mode).
  - Iterations per second slider (`15..720`) for frame-rate-independent speed control.
  - Scene switching is length-driven only (no coverage trigger).
- **Scene**
  - Boundary search depth slider.
  - Power range slider (`2..8`), sampled uniformly from the selected integer range.
- **Screen**
  - Resolution quality: `High=1×1`, `Medium=2×2`, `Low=3×3`, `Very Low=4×4` pixels per complex number.
  - `Show Buttons` toggle for the floating scene HUD.
- **Actions**
  - `Generate New Scene` button.
  - `Reset Settings` button.

## Scene Picking Notes
- Worker request payload now includes:
  - viewport size
  - simulation grid size
  - boundary search depth
  - power range (`powerMin`, `powerMax`)
- Main-thread fallback mirrors the same picker algorithm and settings.

## Settings Application
- Color and timing controls apply immediately to the current scene.
- Scene picker controls (boundary search depth + power range) are staged and only apply on the next scene transition.
- Changing quality (resolution preset) rebuilds render targets and starts a new scene immediately.
