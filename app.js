const SAMPLE_TARGET_PIXELS = 4096;

const PICK_GRID_SIZE = 200;
const MINIMUM_RENDER_RADIUS = 1.0e-5;
const PICK_MIN_CY_ABS = 0.001;
const PICK_MAX_RETRIES = 24;
const PICK_TARGET_RADIUS_FACTOR = 2.0;

const MIN_POWER = 2;
const MAX_POWER = 8;

const FLOAT32_MIN_STEP = Math.pow(2, -149);
const PRECISION_STEP_ULPS = 4.0;
const SCENE_PREP_MAX_ITERS = 20000;
const SCENE_PREP_MAX_PASSES_PER_FRAME = 96;
const SCENE_PREP_TIME_BUDGET_MS = 6.0;
const SCENE_PREP_COVERAGE_CHECK_INTERVAL = 4;
const PREITER_MAX_ITERS = 2048;
const PREITER_MAX_COLS = 320;
const PREITER_MAX_ROWS = 180;
const PREITER_SAFETY_MARGIN = 24;

const MAX_UPDATE_PASSES_PER_FRAME = 24;
const FULLSCREEN_TRIANGLES = 3;
const COLOR_CURVE_EXPONENT = Math.log(0.21) / Math.log(0.5);
const MIN_ITERATION_RATE = 15;
const MAX_ITERATION_RATE = 720;

const SETTINGS_STORAGE_KEY = "mandelbrotBackground.settings.v2";
const LEGACY_SETTINGS_STORAGE_KEY = "mandelbrotBackground.settings.v1";
const SETTINGS_SCHEMA_VERSION = 2;

const SCENE_SWITCH_MODE_SECONDS = "seconds";
const SCENE_SWITCH_MODE_FRAMES = "frames";
const SCENE_SWITCH_MODE_ITERATIONS = "iterations";
const SCENE_REFRESH_NONE = "none";
const SCENE_REFRESH_AUTO = "auto";
const SCENE_REFRESH_MANUAL = "manual";

const SCENE_SWITCH_LIMITS = {
  [SCENE_SWITCH_MODE_SECONDS]: { min: 6, max: 120, step: 0.5, defaultValue: 36 },
  [SCENE_SWITCH_MODE_FRAMES]: { min: 300, max: 8000, step: 1, defaultValue: 1800 },
  [SCENE_SWITCH_MODE_ITERATIONS]: { min: 300, max: 8000, step: 1, defaultValue: 1800 }
};

const RENDER_SCALE_OPTIONS = [1, 1.5, 2, 3];

const PALETTE_LUT_SIZE = 2048;
const PALETTE_OPTIONS = [
  {
    id: "hsv-classic",
    name: "HSV",
    kind: "hsv"
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    kind: "stops",
    // Control points from the Wikimedia/Ultra Fractal gradient definition.
    stops: [
      { position: 0.0, color: "#000764" },
      { position: 0.16, color: "#206bcb" },
      { position: 0.42, color: "#edffff" },
      { position: 0.6425, color: "#ffaa00" },
      { position: 0.8575, color: "#000200" },
      { position: 1.0, color: "#000764" }
    ]
  },
  {
    id: "red-blue-loop",
    name: "Red-Blue",
    kind: "stops",
    stops: ["#2a0011", "#8f1d2c", "#ff4655", "#478bff", "#1f2f8f", "#2a0011"]
  },
  {
    id: "ocean-loop",
    name: "Ocean",
    kind: "stops",
    stops: ["#0a1d42", "#0b4f87", "#00a6a6", "#4ae3d2", "#0a1d42"]
  },
  {
    id: "sunset-loop",
    name: "Sunset",
    kind: "stops",
    stops: ["#38004b", "#8a1f7a", "#f15b4a", "#ffb34d", "#38004b"]
  },
  {
    id: "neon-loop",
    name: "Neon",
    kind: "stops",
    stops: ["#14002b", "#2d45ff", "#00c8ff", "#4eff9e", "#14002b"]
  },
  {
    id: "violet-loop",
    name: "Violet",
    kind: "stops",
    stops: ["#12003d", "#4f2fb3", "#8b5cf6", "#f58cff", "#12003d"]
  }
];

const PALETTE_SCOPED_SETTING_KEYS = Object.freeze([
  "paletteCycleLength",
  "colorIncrementCurve",
  "startColorMode",
  "startColorPhase",
  "smoothColors"
]);

const GLOBAL_SETTING_KEYS = Object.freeze([
  "renderScale",
  "sceneSwitchMode",
  "sceneSwitchLimit",
  "iterationRate",
  "boundarySearchDepth",
  "powerMin",
  "powerMax",
  "showButtons"
]);

const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
  renderScale: 1,
  paletteId: "hsv-classic",
  paletteCycleLength: 200,
  colorIncrementCurve: 0,
  startColorMode: "random",
  startColorPhase: 0,
  smoothColors: true,
  sceneSwitchMode: SCENE_SWITCH_MODE_SECONDS,
  sceneSwitchLimit: 36,
  iterationRate: 60,
  boundarySearchDepth: 20,
  powerMin: 2,
  powerMax: 5,
  showButtons: true
});

let settingsStore = loadSettingsStore();
let runtimeSettings = buildRuntimeSettingsFromStore(settingsStore);
let activeSettings = { ...runtimeSettings };
let pickerSettingsPending = false;

let canvas;
let unsupportedEl;
let menuEdgeZone;
let menuOverlay;
let menuPeekButton;
let settingsDrawer;
let drawerDragHandle;

const ui = {};

let gl;
let extColorBufferFloat;
let stateInternalFormat;
let stateType;

let vao;
let updateProgram;
let displayProgram;
let coverageProgram;
let stateOnlyProgram;

let updateUniforms;
let displayUniforms;
let coverageUniforms;
let stateOnlyUniforms;

let renderTargets = [];
let currentIndex = 0;

let sampleTarget = null;
let sampleReadBuffer = new Uint8Array(0);

let simCols = 1;
let simRows = 1;
let aspect = 1;
let appliedRenderScale = activeSettings.renderScale;
let displayPixelSize = activeSettings.renderScale;
let displayCropOffsetX = 0;
let displayCropOffsetY = 0;

let sceneCenterX = -0.75;
let sceneCenterY = 0.0;
let sceneRadius = 1.25;
let scenePower = 2;
let sceneLogPower = Math.log(2.0);

let sceneIterationPhase = 1;
let sceneStartColorPhase = Math.random();

let sceneElapsedFrames = 0;
let sceneElapsedIterations = 0;
let sceneElapsedSeconds = 0;
let iterationAccumulator = 0;
let lastFrameTimeMs = 0;
let sceneJustReset = false;

let sceneActive = false;
let refreshRequested = false;
let refreshRequestKind = SCENE_REFRESH_NONE;
let pendingScene = null;
let scenePaused = false;
let sceneHeld = false;
let scenePreparation = null;

let pickerWorker = null;
let pickerBusy = false;
let desiredPickRequestId = 0;
let inFlightPickRequestId = 0;

const paletteTexturesById = new Map();
let activePaletteTexture = null;

let drawerProgress = 0;
let drawerOpen = false;
let drawerDrag = null;

bootstrap();

function bootstrap() {
  cacheDomElements();
  if (!canvas || !unsupportedEl) {
    return;
  }

  initializeMenuUi();
  applySettingsToUi();
  applyDrawerProgress(0, false);

  gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false
  });

  if (!gl) {
    showUnsupported("WebGL2 is required for this page.");
    return;
  }

  extColorBufferFloat = gl.getExtension("EXT_color_buffer_float");
  stateInternalFormat = gl.RG32F;
  stateType = gl.FLOAT;

  if (!extColorBufferFloat) {
    stateInternalFormat = gl.RG16F;
    stateType = gl.HALF_FLOAT;
    console.warn("EXT_color_buffer_float unavailable. Falling back to RG16F state textures.");
  }

  setupGLState();
  createPrograms();
  createFullscreenVAO();
  createPaletteTextures();
  setActivePalette(activeSettings.paletteId);
  setupPickerWorker();

  window.addEventListener("resize", () => handleResize(false), { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });

  handleResize(true);
  if (unsupportedEl.style.display === "grid") {
    return;
  }

  requestAnimationFrame(renderLoop);
}

function cacheDomElements() {
  canvas = document.getElementById("fractal");
  unsupportedEl = document.getElementById("unsupported");

  menuEdgeZone = document.getElementById("menu-edge-zone");
  menuOverlay = document.getElementById("menu-overlay");
  menuPeekButton = document.getElementById("menu-peek-button");
  settingsDrawer = document.getElementById("settings-drawer");
  drawerDragHandle = document.getElementById("drawer-drag-handle");

  ui.closeButton = document.getElementById("menu-close-button");
  ui.sceneHud = document.getElementById("scene-hud");
  ui.saveFrameButton = document.getElementById("save-frame-button");
  ui.pauseSceneButton = document.getElementById("pause-scene-button");
  ui.pauseSceneLabel = document.getElementById("pause-scene-label");
  ui.holdSceneButton = document.getElementById("hold-scene-button");
  ui.hudNewSceneButton = document.getElementById("hud-new-scene-button");
  ui.paletteSelect = document.getElementById("palette-select");
  ui.paletteCycleSlider = document.getElementById("palette-cycle-slider");
  ui.paletteCycleValue = document.getElementById("palette-cycle-value");
  ui.smoothColorsToggle = document.getElementById("smooth-colors-toggle");
  ui.colorIncrementCurveSlider = document.getElementById("color-increment-curve-slider");
  ui.colorIncrementCurveValue = document.getElementById("color-increment-curve-value");
  ui.startColorRandomToggle = document.getElementById("start-color-random-toggle");
  ui.startColorSlider = document.getElementById("start-color-slider");
  ui.startColorValue = document.getElementById("start-color-value");
  ui.sceneSwitchMode = document.getElementById("scene-switch-mode");
  ui.sceneSwitchLimitSlider = document.getElementById("scene-switch-limit-slider");
  ui.sceneSwitchLimitValue = document.getElementById("scene-switch-limit-value");
  ui.iterationRateSlider = document.getElementById("iteration-rate-slider");
  ui.iterationRateValue = document.getElementById("iteration-rate-value");
  ui.boundarySearchDepthSlider = document.getElementById("boundary-search-depth-slider");
  ui.boundarySearchDepthValue = document.getElementById("boundary-search-depth-value");
  ui.powerRangeControl = document.getElementById("power-range-control");
  ui.powerMinSlider = document.getElementById("power-min-slider");
  ui.powerMaxSlider = document.getElementById("power-max-slider");
  ui.powerRangeValue = document.getElementById("power-range-value");
  ui.powerRangeFill = document.getElementById("power-range-fill");
  ui.resolutionPresetSelect = document.getElementById("resolution-preset-select");
  ui.showButtonsToggle = document.getElementById("show-buttons-toggle");
  ui.newSceneButton = document.getElementById("new-scene-button");
  ui.resetSettingsButton = document.getElementById("reset-settings-button");
}

function initializeMenuUi() {
  if (!ui.paletteSelect) {
    return;
  }

  ui.paletteSelect.textContent = "";
  for (const palette of PALETTE_OPTIONS) {
    const option = document.createElement("option");
    option.value = palette.id;
    option.textContent = palette.name;
    ui.paletteSelect.append(option);
  }

  setupMenuEvents();
  setupDrawerInteractions();
  setupPowerRangeTrackInteraction();
  setupInfoButtonInteractions();
  refreshHudVisibility();
  syncSceneControlButtons();
}

function setupMenuEvents() {
  ui.closeButton.addEventListener("click", () => setDrawerOpen(false, true));

  ui.paletteSelect.addEventListener("change", () => {
    updateRuntimeSettings({ paletteId: ui.paletteSelect.value });
  });

  ui.paletteCycleSlider.addEventListener("input", () => {
    updateRuntimeSettings({ paletteCycleLength: Number(ui.paletteCycleSlider.value) });
  });

  ui.smoothColorsToggle.addEventListener("change", () => {
    updateRuntimeSettings({ smoothColors: ui.smoothColorsToggle.checked });
  });

  ui.colorIncrementCurveSlider.addEventListener("input", () => {
    updateRuntimeSettings({ colorIncrementCurve: Number(ui.colorIncrementCurveSlider.value) });
  });

  ui.startColorRandomToggle.addEventListener("change", () => {
    updateRuntimeSettings({ startColorMode: ui.startColorRandomToggle.checked ? "random" : "manual" });
  });

  ui.startColorSlider.addEventListener("input", () => {
    updateRuntimeSettings({ startColorPhase: Number(ui.startColorSlider.value) });
  });

  ui.sceneSwitchMode.addEventListener("change", () => {
    updateRuntimeSettings({
      sceneSwitchMode: ui.sceneSwitchMode.value,
      sceneSwitchLimit: getSceneSwitchRange(ui.sceneSwitchMode.value).defaultValue
    });
  });

  ui.sceneSwitchLimitSlider.addEventListener("input", () => {
    updateRuntimeSettings({ sceneSwitchLimit: Number(ui.sceneSwitchLimitSlider.value) });
  });

  ui.iterationRateSlider.addEventListener("input", () => {
    updateRuntimeSettings({ iterationRate: Number(ui.iterationRateSlider.value) });
  });

  ui.boundarySearchDepthSlider.addEventListener("input", () => {
    updateRuntimeSettings({ boundarySearchDepth: Number(ui.boundarySearchDepthSlider.value) });
  });

  ui.powerMinSlider.addEventListener("input", () => {
    const nextMin = Number(ui.powerMinSlider.value);
    const nextMax = Math.max(nextMin, Number(ui.powerMaxSlider.value));
    updateRuntimeSettings({ powerMin: nextMin, powerMax: nextMax });
  });

  ui.powerMaxSlider.addEventListener("input", () => {
    const nextMax = Number(ui.powerMaxSlider.value);
    const nextMin = Math.min(nextMax, Number(ui.powerMinSlider.value));
    updateRuntimeSettings({ powerMin: nextMin, powerMax: nextMax });
  });

  ui.resolutionPresetSelect.addEventListener("change", () => {
    updateRuntimeSettings({ renderScale: Number(ui.resolutionPresetSelect.value) });
  });

  ui.showButtonsToggle.addEventListener("change", () => {
    updateRuntimeSettings({ showButtons: ui.showButtonsToggle.checked });
  });

  ui.newSceneButton.addEventListener("click", () => {
    requestSceneRefreshNow();
  });

  ui.resetSettingsButton.addEventListener("click", () => {
    resetAllSettings();
  });

  if (menuPeekButton) {
    menuPeekButton.addEventListener("click", () => setDrawerOpen(true, true));
    menuPeekButton.addEventListener("pointerdown", (event) => {
      if (drawerOpen) {
        return;
      }
      beginDrawerDrag(event, "open");
    });
  }

  ui.saveFrameButton?.addEventListener("click", saveCurrentFrame);
  ui.pauseSceneButton?.addEventListener("click", () => {
    setScenePaused(!scenePaused);
  });
  ui.holdSceneButton?.addEventListener("click", () => {
    setSceneHeld(!sceneHeld);
  });
  ui.hudNewSceneButton?.addEventListener("click", () => {
    requestSceneRefreshNow();
  });
}

function setupDrawerInteractions() {
  menuOverlay.addEventListener("click", () => setDrawerOpen(false, true));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerOpen) {
      setDrawerOpen(false, true);
    }
  });

  menuEdgeZone.addEventListener("pointerdown", (event) => {
    if (drawerOpen) {
      return;
    }
    beginDrawerDrag(event, "open");
  });

  drawerDragHandle.addEventListener("pointerdown", (event) => {
    if (!drawerOpen) {
      return;
    }
    beginDrawerDrag(event, "close");
  });

  window.addEventListener("pointermove", onDrawerDragMove, { passive: false });
  window.addEventListener("pointerup", onDrawerDragEnd, { passive: true });
  window.addEventListener("pointercancel", onDrawerDragEnd, { passive: true });
}

function beginDrawerDrag(event, mode) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  const source = event.currentTarget;
  if (source && source.setPointerCapture) {
    try {
      source.setPointerCapture(event.pointerId);
    } catch (_) {
      // Ignore capture failures.
    }
  }

  drawerDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    mode,
    axisLocked: null
  };

  applyDrawerProgress(drawerProgress, false);
}

function onDrawerDragMove(event) {
  if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) {
    return;
  }

  const dx = event.clientX - drawerDrag.startX;
  const dy = event.clientY - drawerDrag.startY;

  if (drawerDrag.axisLocked === null) {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 8 && absY < 8) {
      return;
    }

    if (absX >= absY * 1.2) {
      drawerDrag.axisLocked = "x";
    } else {
      drawerDrag.axisLocked = "y";
      drawerDrag = null;
      return;
    }
  }

  if (drawerDrag.axisLocked !== "x") {
    return;
  }

  event.preventDefault();

  const drawerWidth = settingsDrawer.getBoundingClientRect().width || 1;
  let progress;

  if (drawerDrag.mode === "open") {
    progress = clampNumber(dx / drawerWidth, 0, 1);
  } else {
    progress = clampNumber(1 + dx / drawerWidth, 0, 1);
  }

  applyDrawerProgress(progress, false);
}

function onDrawerDragEnd(event) {
  if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) {
    return;
  }

  const shouldOpen = drawerProgress >= 0.35;
  drawerDrag = null;
  setDrawerOpen(shouldOpen, true);
}

function setDrawerOpen(isOpen, animate) {
  drawerOpen = Boolean(isOpen);
  const target = drawerOpen ? 1 : 0;
  applyDrawerProgress(target, animate);
}

function applyDrawerProgress(progress, animate) {
  drawerProgress = clampNumber(progress, 0, 1);

  settingsDrawer.style.transition = animate ? "transform 220ms ease" : "none";
  menuOverlay.style.transition = animate ? "opacity 220ms ease, visibility 220ms ease" : "none";

  const translatePct = -100 + drawerProgress * 100;
  settingsDrawer.style.transform = `translateX(${translatePct}%)`;

  if (drawerProgress <= 0.001) {
    menuOverlay.style.opacity = "0";
    menuOverlay.style.pointerEvents = "none";
    menuOverlay.style.visibility = "hidden";
    settingsDrawer.setAttribute("aria-hidden", "true");
    settingsDrawer.style.visibility = "hidden";
    settingsDrawer.style.pointerEvents = "none";
  } else {
    menuOverlay.style.visibility = "visible";
    menuOverlay.style.opacity = `${0.95 * drawerProgress}`;
    menuOverlay.style.pointerEvents = "auto";
    settingsDrawer.setAttribute("aria-hidden", "false");
    settingsDrawer.style.visibility = "visible";
    settingsDrawer.style.pointerEvents = "auto";
  }

  refreshHudVisibility();
}

function updateRuntimeSettings(partial) {
  const previous = runtimeSettings;
  settingsStore = storeCurrentRuntimeSettings(settingsStore, runtimeSettings);

  const requestedPaletteId = typeof partial.paletteId === "string" ? partial.paletteId : runtimeSettings.paletteId;
  const nextPaletteId = getPaletteById(requestedPaletteId) ? requestedPaletteId : runtimeSettings.paletteId;

  settingsStore.selectedPaletteId = nextPaletteId;
  settingsStore.globalSettings = normalizeGlobalSettings({
    ...settingsStore.globalSettings,
    ...extractSettingsSubset(partial, GLOBAL_SETTING_KEYS)
  });

  const currentProfile = settingsStore.paletteProfiles[nextPaletteId] || extractPaletteScopedSettings(DEFAULT_RUNTIME_SETTINGS);
  settingsStore.paletteProfiles[nextPaletteId] = normalizePaletteProfile({
    ...currentProfile,
    ...extractSettingsSubset(partial, PALETTE_SCOPED_SETTING_KEYS)
  });

  runtimeSettings = buildRuntimeSettingsFromStore(settingsStore);
  persistSettingsStore(settingsStore);
  applySettingsToUi();
  applyImmediateSettings(previous, runtimeSettings);
  pickerSettingsPending = !arePickerSettingsEqual(runtimeSettings, activeSettings);
}

function arePickerSettingsEqual(a, b) {
  return (
    a.boundarySearchDepth === b.boundarySearchDepth &&
    a.powerMin === b.powerMin &&
    a.powerMax === b.powerMax
  );
}

function applyImmediateSettings(previous, next) {
  if (previous.paletteId !== next.paletteId) {
    activeSettings.paletteId = next.paletteId;
    setActivePalette(next.paletteId);
    if (next.startColorMode === "random") {
      sceneStartColorPhase = Math.random();
    }
  }

  if (previous.paletteCycleLength !== next.paletteCycleLength) {
    activeSettings.paletteCycleLength = next.paletteCycleLength;
  }

  if (previous.smoothColors !== next.smoothColors) {
    activeSettings.smoothColors = next.smoothColors;
  }

  if (previous.colorIncrementCurve !== next.colorIncrementCurve) {
    activeSettings.colorIncrementCurve = next.colorIncrementCurve;
  }

  if (previous.startColorMode !== next.startColorMode) {
    activeSettings.startColorMode = next.startColorMode;
    if (next.startColorMode === "random") {
      sceneStartColorPhase = Math.random();
    } else {
      sceneStartColorPhase = next.startColorPhase;
    }
  }

  if (previous.startColorPhase !== next.startColorPhase) {
    activeSettings.startColorPhase = next.startColorPhase;
    if (next.startColorMode === "manual") {
      sceneStartColorPhase = next.startColorPhase;
    }
  }

  if (previous.sceneSwitchMode !== next.sceneSwitchMode) {
    activeSettings.sceneSwitchMode = next.sceneSwitchMode;
  }

  if (previous.sceneSwitchLimit !== next.sceneSwitchLimit) {
    activeSettings.sceneSwitchLimit = next.sceneSwitchLimit;
  }

  if (
    sceneActive &&
    (
      previous.sceneSwitchMode !== next.sceneSwitchMode ||
      previous.sceneSwitchLimit !== next.sceneSwitchLimit
    )
  ) {
    if (!sceneHeld && hasReachedSceneLengthLimit()) {
      requestSceneRefresh(SCENE_REFRESH_AUTO);
    } else if (refreshRequestKind === SCENE_REFRESH_AUTO) {
      clearSceneRefreshRequest();
    }
  }

  if (previous.iterationRate !== next.iterationRate) {
    activeSettings.iterationRate = next.iterationRate;
  }

  if (previous.showButtons !== next.showButtons) {
    activeSettings.showButtons = next.showButtons;
    refreshHudVisibility();
  }

  if (previous.renderScale !== next.renderScale) {
    activeSettings.renderScale = next.renderScale;
    handleResize(true);
    requestSceneRefreshNow();
  }
}

function activatePendingPickerSettingsIfNeeded() {
  if (!pickerSettingsPending) {
    return false;
  }

  activeSettings.boundarySearchDepth = runtimeSettings.boundarySearchDepth;
  activeSettings.powerMin = runtimeSettings.powerMin;
  activeSettings.powerMax = runtimeSettings.powerMax;
  pickerSettingsPending = false;

  pendingScene = null;
  requestPick();
  return true;
}

function applySettingsToUi() {
  if (!ui.paletteSelect) {
    return;
  }

  ui.paletteSelect.value = runtimeSettings.paletteId;
  updateStartColorSliderGradient();

  ui.paletteCycleSlider.value = String(runtimeSettings.paletteCycleLength);
  ui.paletteCycleValue.textContent = `${runtimeSettings.paletteCycleLength.toFixed(1)}`;

  ui.smoothColorsToggle.checked = runtimeSettings.smoothColors;

  ui.colorIncrementCurveSlider.value = String(runtimeSettings.colorIncrementCurve);
  ui.colorIncrementCurveValue.textContent = formatColorIncrementCurveValue(runtimeSettings.colorIncrementCurve);

  ui.startColorRandomToggle.checked = runtimeSettings.startColorMode === "random";
  ui.startColorSlider.value = String(runtimeSettings.startColorPhase);
  ui.startColorValue.textContent = `${Math.round(runtimeSettings.startColorPhase * 360)}°`;

  ui.sceneSwitchMode.value = runtimeSettings.sceneSwitchMode;
  refreshSceneSwitchSliderBounds();
  ui.sceneSwitchLimitSlider.value = String(runtimeSettings.sceneSwitchLimit);
  ui.sceneSwitchLimitValue.textContent = formatSceneLengthValue(
    runtimeSettings.sceneSwitchMode,
    runtimeSettings.sceneSwitchLimit
  );

  ui.iterationRateSlider.value = String(runtimeSettings.iterationRate);
  ui.iterationRateValue.textContent = `${runtimeSettings.iterationRate.toFixed(0)} / sec`;

  ui.boundarySearchDepthSlider.value = String(runtimeSettings.boundarySearchDepth);
  ui.boundarySearchDepthValue.textContent = String(runtimeSettings.boundarySearchDepth);

  ui.powerMinSlider.value = String(runtimeSettings.powerMin);
  ui.powerMaxSlider.value = String(runtimeSettings.powerMax);
  ui.powerRangeValue.textContent = `${runtimeSettings.powerMin} to ${runtimeSettings.powerMax}`;
  refreshPowerRangeFill();

  ui.resolutionPresetSelect.value = String(runtimeSettings.renderScale);
  ui.showButtonsToggle.checked = runtimeSettings.showButtons;
  refreshHudVisibility();
}

function updateStartColorSliderGradient() {
  if (!ui.startColorSlider) {
    return;
  }

  const palette = getPaletteById(runtimeSettings.paletteId) || PALETTE_OPTIONS[0];
  ui.startColorSlider.style.setProperty("--start-color-gradient", buildPaletteCssGradient(palette));
}

function getPaletteById(paletteId) {
  return PALETTE_OPTIONS.find((palette) => palette.id === paletteId) || null;
}

function buildPaletteCssGradient(palette) {
  if (!palette) {
    return "linear-gradient(90deg, #ff0000, #00ffff, #ff0000)";
  }

  if (palette.kind === "hsv") {
    return "linear-gradient(90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)";
  }

  const stops = normalizePaletteStops(palette.stops);
  const cssStops = stops.map((stop) => {
    const [r, g, b] = stop.rgb;
    return `rgb(${r}, ${g}, ${b}) ${(stop.position * 100).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${cssStops.join(", ")})`;
}

function refreshPowerRangeFill() {
  if (!ui.powerRangeFill) {
    return;
  }
  const minPct = ((runtimeSettings.powerMin - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100;
  const maxPct = ((runtimeSettings.powerMax - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100;
  ui.powerRangeFill.style.left = `${minPct}%`;
  ui.powerRangeFill.style.width = `${Math.max(0, maxPct - minPct)}%`;
}

function refreshSceneSwitchSliderBounds() {
  const range = getSceneSwitchRange(runtimeSettings.sceneSwitchMode);
  ui.sceneSwitchLimitSlider.min = String(range.min);
  ui.sceneSwitchLimitSlider.max = String(range.max);
  ui.sceneSwitchLimitSlider.step = String(range.step);
}

function setupPowerRangeTrackInteraction() {
  if (!ui.powerRangeControl) {
    return;
  }

  ui.powerRangeControl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    if (event.target === ui.powerMinSlider || event.target === ui.powerMaxSlider) {
      return;
    }

    const rect = ui.powerRangeControl.getBoundingClientRect();
    const ratio = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const snappedValue = clampNumber(Math.round(MIN_POWER + ratio * (MAX_POWER - MIN_POWER)), MIN_POWER, MAX_POWER);

    if (Math.abs(snappedValue - runtimeSettings.powerMin) <= Math.abs(snappedValue - runtimeSettings.powerMax)) {
      updateRuntimeSettings({
        powerMin: snappedValue,
        powerMax: Math.max(snappedValue, runtimeSettings.powerMax)
      });
    } else {
      updateRuntimeSettings({
        powerMin: Math.min(snappedValue, runtimeSettings.powerMin),
        powerMax: snappedValue
      });
    }

    event.preventDefault();
  });
}

function focusElementWithoutScroll(element) {
  if (!element || typeof element.focus !== "function") {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch (_) {
    element.focus();
  }
}

function setupInfoButtonInteractions() {
  const infoButtons = document.querySelectorAll(".info-button");
  for (const button of infoButtons) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      focusElementWithoutScroll(button);
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      focusElementWithoutScroll(button);
    });
  }
}

function refreshHudVisibility() {
  const showButtons = runtimeSettings.showButtons !== false;
  const hidePeek = !showButtons || drawerProgress > 0.001;

  if (menuPeekButton) {
    menuPeekButton.classList.toggle("is-hidden", hidePeek);
  }

  if (ui.sceneHud) {
    ui.sceneHud.classList.toggle("is-hidden", !showButtons);
  }
}

function syncSceneControlButtons() {
  if (ui.pauseSceneButton && ui.pauseSceneLabel) {
    ui.pauseSceneButton.setAttribute("aria-pressed", scenePaused ? "true" : "false");
    ui.pauseSceneButton.setAttribute("aria-label", scenePaused ? "Resume scene" : "Pause scene");
    ui.pauseSceneButton.title = scenePaused ? "Resume scene" : "Pause scene";
    ui.pauseSceneLabel.textContent = scenePaused ? "Resume" : "Pause";
  }

  if (ui.holdSceneButton) {
    ui.holdSceneButton.setAttribute("aria-pressed", sceneHeld ? "true" : "false");
    ui.holdSceneButton.setAttribute(
      "aria-label",
      sceneHeld ? "Allow scene switching" : "Stay on current scene"
    );
    ui.holdSceneButton.title = sceneHeld ? "Allow scene switching" : "Stay on current scene";
  }
}

function setScenePaused(isPaused) {
  scenePaused = Boolean(isPaused);
  if (!scenePaused) {
    lastFrameTimeMs = performance.now();
  }
  syncSceneControlButtons();
}

function setSceneHeld(isHeld) {
  sceneHeld = Boolean(isHeld);

  if (sceneHeld && refreshRequestKind === SCENE_REFRESH_AUTO) {
    clearSceneRefreshRequest();
  } else if (!sceneHeld && sceneActive && hasReachedSceneLengthLimit()) {
    requestSceneRefresh(SCENE_REFRESH_AUTO);
  }

  syncSceneControlButtons();
}

function buildFrameFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `mandelbrot-frame-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

function saveCurrentFrame() {
  if (!canvas) {
    return;
  }

  if (typeof canvas.toBlob === "function") {
    canvas.toBlob((blob) => {
      if (!blob) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildFrameFilename();
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
    return;
  }

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = buildFrameFilename();
  link.click();
}

function resetAllSettings() {
  const previous = runtimeSettings;
  settingsStore = buildDefaultSettingsStore();
  runtimeSettings = buildRuntimeSettingsFromStore(settingsStore);
  persistSettingsStore(settingsStore);
  applySettingsToUi();
  applyImmediateSettings(previous, runtimeSettings);
  pickerSettingsPending = !arePickerSettingsEqual(runtimeSettings, activeSettings);
}

function getSceneSwitchRange(mode) {
  return SCENE_SWITCH_LIMITS[mode] || SCENE_SWITCH_LIMITS[DEFAULT_RUNTIME_SETTINGS.sceneSwitchMode];
}

function formatColorIncrementCurveValue(value) {
  if (value <= 0.0005) {
    return "Linear";
  }
  if (value >= 0.9995) {
    return "Logarithmic";
  }
  return value.toFixed(3);
}

function formatSceneLengthValue(mode, value) {
  if (mode === SCENE_SWITCH_MODE_SECONDS) {
    return `${value.toFixed(1)} s`;
  }
  if (mode === SCENE_SWITCH_MODE_ITERATIONS) {
    return `${Math.round(value)} iters`;
  }
  return `${Math.round(value)} frames`;
}

function extractSettingsSubset(source, keys) {
  const subset = {};
  if (!source || typeof source !== "object") {
    return subset;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      subset[key] = source[key];
    }
  }
  return subset;
}

function extractPaletteScopedSettings(source) {
  return extractSettingsSubset(source, PALETTE_SCOPED_SETTING_KEYS);
}

function extractGlobalSettings(source) {
  return extractSettingsSubset(source, GLOBAL_SETTING_KEYS);
}

function normalizePaletteProfile(input) {
  const normalized = normalizeRuntimeSettings({
    ...DEFAULT_RUNTIME_SETTINGS,
    ...(input || {})
  });
  return extractPaletteScopedSettings(normalized);
}

function normalizeGlobalSettings(input) {
  const normalized = normalizeRuntimeSettings({
    ...DEFAULT_RUNTIME_SETTINGS,
    ...(input || {})
  });
  return extractGlobalSettings(normalized);
}

function buildDefaultSettingsStore() {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    selectedPaletteId: DEFAULT_RUNTIME_SETTINGS.paletteId,
    globalSettings: extractGlobalSettings(DEFAULT_RUNTIME_SETTINGS),
    paletteProfiles: {
      [DEFAULT_RUNTIME_SETTINGS.paletteId]: extractPaletteScopedSettings(DEFAULT_RUNTIME_SETTINGS)
    }
  };
}

function normalizeSettingsStore(input) {
  const defaults = buildDefaultSettingsStore();
  const paletteIds = new Set(PALETTE_OPTIONS.map((palette) => palette.id));
  const selectedPaletteId = paletteIds.has(input?.selectedPaletteId)
    ? input.selectedPaletteId
    : defaults.selectedPaletteId;

  const rawProfiles = input && typeof input.paletteProfiles === "object" ? input.paletteProfiles : {};
  const paletteProfiles = {};

  for (const palette of PALETTE_OPTIONS) {
    const rawProfile = rawProfiles[palette.id];
    if (rawProfile && typeof rawProfile === "object") {
      paletteProfiles[palette.id] = normalizePaletteProfile(rawProfile);
    }
  }

  if (!paletteProfiles[selectedPaletteId]) {
    paletteProfiles[selectedPaletteId] = extractPaletteScopedSettings(DEFAULT_RUNTIME_SETTINGS);
  }

  return {
    version: SETTINGS_SCHEMA_VERSION,
    selectedPaletteId,
    globalSettings: normalizeGlobalSettings({
      ...defaults.globalSettings,
      ...(input && typeof input.globalSettings === "object" ? input.globalSettings : {})
    }),
    paletteProfiles
  };
}

function migrateLegacySettings(parsed) {
  const legacySettings = normalizeRuntimeSettings(parsed.settings);
  return normalizeSettingsStore({
    selectedPaletteId: legacySettings.paletteId,
    globalSettings: extractGlobalSettings(legacySettings),
    paletteProfiles: {
      [legacySettings.paletteId]: extractPaletteScopedSettings(legacySettings)
    }
  });
}

function loadSettingsStore() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.version === SETTINGS_SCHEMA_VERSION &&
        typeof parsed.globalSettings === "object"
      ) {
        return normalizeSettingsStore(parsed);
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (
        legacyParsed &&
        legacyParsed.version === 1 &&
        typeof legacyParsed.settings === "object"
      ) {
        return migrateLegacySettings(legacyParsed);
      }
    }
  } catch (_) {
    // Ignore storage failures.
  }

  return buildDefaultSettingsStore();
}

function persistSettingsStore(store) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettingsStore(store)));
  } catch (_) {
    // Ignore storage failures.
  }
}

function buildRuntimeSettingsFromStore(store) {
  const normalizedStore = normalizeSettingsStore(store);
  const selectedPaletteId = normalizedStore.selectedPaletteId;
  const paletteProfile =
    normalizedStore.paletteProfiles[selectedPaletteId] ||
    extractPaletteScopedSettings(DEFAULT_RUNTIME_SETTINGS);

  return normalizeRuntimeSettings({
    ...DEFAULT_RUNTIME_SETTINGS,
    ...normalizedStore.globalSettings,
    ...paletteProfile,
    paletteId: selectedPaletteId
  });
}

function storeCurrentRuntimeSettings(store, settings) {
  const nextStore = normalizeSettingsStore(store);
  nextStore.selectedPaletteId = settings.paletteId;
  nextStore.globalSettings = normalizeGlobalSettings({
    ...nextStore.globalSettings,
    ...extractGlobalSettings(settings)
  });
  nextStore.paletteProfiles[settings.paletteId] = normalizePaletteProfile(settings);
  return nextStore;
}

function normalizeRuntimeSettings(input) {
  const next = { ...DEFAULT_RUNTIME_SETTINGS, ...(input || {}) };

  next.renderScale = normalizeRenderScale(next.renderScale);

  const paletteIds = new Set(PALETTE_OPTIONS.map((palette) => palette.id));
  next.paletteId = paletteIds.has(next.paletteId) ? next.paletteId : DEFAULT_RUNTIME_SETTINGS.paletteId;

  next.paletteCycleLength = clampNumber(Number(next.paletteCycleLength), 20, 5000);
  next.colorIncrementCurve = clampNumber(Number(next.colorIncrementCurve), 0, 1);

  next.startColorMode = next.startColorMode === "manual" ? "manual" : "random";
  next.startColorPhase = clampNumber(Number(next.startColorPhase), 0, 1);
  next.smoothColors = next.smoothColors !== false;

  const mode = typeof next.sceneSwitchMode === "string" ? next.sceneSwitchMode : DEFAULT_RUNTIME_SETTINGS.sceneSwitchMode;
  next.sceneSwitchMode = SCENE_SWITCH_LIMITS[mode] ? mode : DEFAULT_RUNTIME_SETTINGS.sceneSwitchMode;

  const limitRange = getSceneSwitchRange(next.sceneSwitchMode);
  next.sceneSwitchLimit = clampNumber(Number(next.sceneSwitchLimit), limitRange.min, limitRange.max);
  if (next.sceneSwitchMode === SCENE_SWITCH_MODE_SECONDS) {
    next.sceneSwitchLimit = Math.round(next.sceneSwitchLimit * 10) / 10;
  } else {
    next.sceneSwitchLimit = Math.round(next.sceneSwitchLimit);
  }

  next.iterationRate = clampNumber(Math.round(Number(next.iterationRate) || 0), MIN_ITERATION_RATE, MAX_ITERATION_RATE);

  next.boundarySearchDepth = clampNumber(Math.round(Number(next.boundarySearchDepth) || 0), 4, 36);

  let powerMin = clampNumber(Math.round(Number(next.powerMin) || MIN_POWER), MIN_POWER, MAX_POWER);
  let powerMax = clampNumber(Math.round(Number(next.powerMax) || MAX_POWER), MIN_POWER, MAX_POWER);
  if (powerMin > powerMax) {
    const temp = powerMin;
    powerMin = powerMax;
    powerMax = temp;
  }
  next.powerMin = powerMin;
  next.powerMax = powerMax;
  next.showButtons = next.showButtons !== false;

  return next;
}

function normalizeRenderScale(scale) {
  const numeric = Number(scale);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_RUNTIME_SETTINGS.renderScale;
  }

  let best = RENDER_SCALE_OPTIONS[0];
  let bestDist = Math.abs(numeric - best);
  for (const option of RENDER_SCALE_OPTIONS) {
    const dist = Math.abs(numeric - option);
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function setupGLState() {
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.clearColor(0, 0, 0, 1);
}

function createPrograms() {
  const vertexShaderSource = `#version 300 es
    precision highp float;

    out vec2 vUv;

    void main() {
      vec2 pos;
      if (gl_VertexID == 0) {
        pos = vec2(-1.0, -1.0);
      } else if (gl_VertexID == 1) {
        pos = vec2(3.0, -1.0);
      } else {
        pos = vec2(-1.0, 3.0);
      }

      vUv = 0.5 * (pos + 1.0);
      gl_Position = vec4(pos, 0.0, 1.0);
    }
  `;

  const updateFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;

    layout(location = 0) out vec2 outState;
    layout(location = 1) out vec4 outColor;
    layout(location = 2) out vec4 outDelta;

    uniform sampler2D uPrevState;
    uniform sampler2D uPrevColor;

    uniform float uCenterX;
    uniform float uCenterY;
    uniform float uRadius;
    uniform float uAspect;
    uniform float uCols;
    uniform float uRows;
    uniform float uIterationPhase;
    uniform int uPower;
    uniform float uLogPower;

    vec2 cmul(vec2 a, vec2 b) {
      return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
    }

    vec2 cpowInt(vec2 z, int p) {
      vec2 result = vec2(1.0, 0.0);
      for (int i = 0; i < ${MAX_POWER}; i++) {
        if (i >= p) {
          break;
        }
        result = cmul(result, z);
      }
      return result;
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      ivec2 texel = ivec2(pixel);
      float tx = pixel.x / uCols;
      float ty = pixel.y / uRows;

      float x0 = uCenterX + mix(-uRadius, uRadius, tx);
      float y0 = uCenterY + mix(uRadius, -uRadius, ty) * uAspect;

      vec2 z = texelFetch(uPrevState, texel, 0).rg;
      vec4 prevColor = texelFetch(uPrevColor, texel, 0);

      if (prevColor.a > 0.5) {
        outState = z;
        outColor = prevColor;
        outDelta = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec2 zPow = cpowInt(z, uPower);
      vec2 zNew = zPow + vec2(x0, y0);
      float mag2 = dot(zNew, zNew);

      if (mag2 >= 4.0) {
        float zMag = sqrt(mag2);
        float smoothEscape = max(0.0, uIterationPhase - (log(log(zMag)) / uLogPower));
        float discreteEscape = max(0.0, uIterationPhase);

        outState = vec2(smoothEscape, discreteEscape);
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        outDelta = vec4(1.0, 0.0, 0.0, 1.0);
      } else {
        outState = zNew;
        outColor = vec4(0.0, 0.0, 0.0, 0.0);
        outDelta = vec4(0.0, 0.0, 0.0, 1.0);
      }
    }
  `;

  const displayFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uState;
    uniform sampler2D uMask;
    uniform sampler2D uPalette;
    uniform float uPaletteCycleLength;
    uniform float uColorIncrementCurve;
    uniform bool uSmoothColors;
    uniform float uStartColorPhase;
    uniform vec2 uSimSize;
    uniform float uPixelSize;
    uniform vec2 uCropOffset;

    ivec2 getSimulationTexel() {
      vec2 simPos = floor((gl_FragCoord.xy - vec2(0.5) + uCropOffset) / max(uPixelSize, 1.0e-4));
      vec2 clamped = clamp(simPos, vec2(0.0), uSimSize - vec2(1.0));
      return ivec2(clamped);
    }

    float mapEscapedPhase(float escapedPhase) {
      float n = max(0.0, escapedPhase);
      float c = clamp(uColorIncrementCurve, 0.0, 1.0);
      float transformedC = c <= 0.0 ? 0.0 : pow(c, ${COLOR_CURVE_EXPONENT.toFixed(12)});
      float oneMinusCurve = 1.0 - transformedC;

      if (abs(oneMinusCurve) <= 1.0e-4) {
        return log(n + 1.0);
      }

      return max(0.0, (pow(n + 1.0, oneMinusCurve) - 1.0) / oneMinusCurve);
    }

    void main() {
      ivec2 texel = getSimulationTexel();
      vec4 mask = texelFetch(uMask, texel, 0);
      if (mask.a <= 0.5) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec2 escapedState = texelFetch(uState, texel, 0).rg;
      float escapedPhase = uSmoothColors ? escapedState.r : escapedState.g;
      float adjustedPhase = mapEscapedPhase(escapedPhase);
      float paletteT = fract(uStartColorPhase + adjustedPhase / uPaletteCycleLength);

      vec3 rgb = texture(uPalette, vec2(paletteT, 0.5)).rgb;
      outColor = vec4(rgb, 1.0);
    }
  `;

  const coverageFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uSource;

    void main() {
      float a = texture(uSource, vUv).a;
      outColor = vec4(a, 0.0, 0.0, 1.0);
    }
  `;

  const stateOnlyFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    layout(location = 0) out vec2 outState;

    uniform sampler2D uPrevState;
    uniform float uCenterX;
    uniform float uCenterY;
    uniform float uRadius;
    uniform float uAspect;
    uniform float uCols;
    uniform float uRows;
    uniform int uPower;

    vec2 cmul(vec2 a, vec2 b) {
      return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
    }

    vec2 cpowInt(vec2 z, int p) {
      vec2 result = vec2(1.0, 0.0);
      for (int i = 0; i < ${MAX_POWER}; i++) {
        if (i >= p) {
          break;
        }
        result = cmul(result, z);
      }
      return result;
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      ivec2 texel = ivec2(pixel);
      float tx = pixel.x / uCols;
      float ty = pixel.y / uRows;

      float x0 = uCenterX + mix(-uRadius, uRadius, tx);
      float y0 = uCenterY + mix(uRadius, -uRadius, ty) * uAspect;

      vec2 z = texelFetch(uPrevState, texel, 0).rg;
      vec2 zPow = cpowInt(z, uPower);
      outState = zPow + vec2(x0, y0);
    }
  `;

  updateProgram = createProgram(vertexShaderSource, updateFragmentSource);
  displayProgram = createProgram(vertexShaderSource, displayFragmentSource);
  coverageProgram = createProgram(vertexShaderSource, coverageFragmentSource);
  stateOnlyProgram = createProgram(vertexShaderSource, stateOnlyFragmentSource);

  updateUniforms = {
    prevState: gl.getUniformLocation(updateProgram, "uPrevState"),
    prevColor: gl.getUniformLocation(updateProgram, "uPrevColor"),
    centerX: gl.getUniformLocation(updateProgram, "uCenterX"),
    centerY: gl.getUniformLocation(updateProgram, "uCenterY"),
    radius: gl.getUniformLocation(updateProgram, "uRadius"),
    aspect: gl.getUniformLocation(updateProgram, "uAspect"),
    cols: gl.getUniformLocation(updateProgram, "uCols"),
    rows: gl.getUniformLocation(updateProgram, "uRows"),
    iterationPhase: gl.getUniformLocation(updateProgram, "uIterationPhase"),
    power: gl.getUniformLocation(updateProgram, "uPower"),
    logPower: gl.getUniformLocation(updateProgram, "uLogPower")
  };

  displayUniforms = {
    state: gl.getUniformLocation(displayProgram, "uState"),
    mask: gl.getUniformLocation(displayProgram, "uMask"),
    palette: gl.getUniformLocation(displayProgram, "uPalette"),
    paletteCycleLength: gl.getUniformLocation(displayProgram, "uPaletteCycleLength"),
    colorIncrementCurve: gl.getUniformLocation(displayProgram, "uColorIncrementCurve"),
    smoothColors: gl.getUniformLocation(displayProgram, "uSmoothColors"),
    startColorPhase: gl.getUniformLocation(displayProgram, "uStartColorPhase"),
    simSize: gl.getUniformLocation(displayProgram, "uSimSize"),
    pixelSize: gl.getUniformLocation(displayProgram, "uPixelSize"),
    cropOffset: gl.getUniformLocation(displayProgram, "uCropOffset")
  };

  coverageUniforms = {
    source: gl.getUniformLocation(coverageProgram, "uSource")
  };

  stateOnlyUniforms = {
    prevState: gl.getUniformLocation(stateOnlyProgram, "uPrevState"),
    centerX: gl.getUniformLocation(stateOnlyProgram, "uCenterX"),
    centerY: gl.getUniformLocation(stateOnlyProgram, "uCenterY"),
    radius: gl.getUniformLocation(stateOnlyProgram, "uRadius"),
    aspect: gl.getUniformLocation(stateOnlyProgram, "uAspect"),
    cols: gl.getUniformLocation(stateOnlyProgram, "uCols"),
    rows: gl.getUniformLocation(stateOnlyProgram, "uRows"),
    power: gl.getUniformLocation(stateOnlyProgram, "uPower")
  };
}

function createFullscreenVAO() {
  vao = gl.createVertexArray();
}

function createProgram(vertexSource, fragmentSource) {
  const vs = createShader(gl.VERTEX_SHADER, vertexSource);
  const fs = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error("Failed to create shader program.");
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "Unknown linker error.";
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Program link failed: ${info}`);
  }

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return program;
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to allocate shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "Unknown compile error.";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }

  return shader;
}

function createPaletteTextures() {
  for (const palette of PALETTE_OPTIONS) {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create palette texture.");
    }

    const lut = buildPaletteLut(palette, PALETTE_LUT_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);

    paletteTexturesById.set(palette.id, texture);
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
}

function buildPaletteLut(palette, size) {
  const output = new Uint8Array(size * 4);

  if (palette.kind === "hsv") {
    for (let i = 0; i < size; i += 1) {
      const t = size <= 1 ? 0 : i / (size - 1);
      const rgb = hsvToRgb(t, 1, 1);
      output[4 * i + 0] = Math.round(rgb[0] * 255);
      output[4 * i + 1] = Math.round(rgb[1] * 255);
      output[4 * i + 2] = Math.round(rgb[2] * 255);
      output[4 * i + 3] = 255;
    }
    return output;
  }

  const stops = normalizePaletteStops(palette.stops);
  let stopIndex = 0;

  for (let i = 0; i < size; i += 1) {
    const t = size <= 1 ? 0 : i / (size - 1);
    while (stopIndex + 1 < stops.length && t > stops[stopIndex + 1].position) {
      stopIndex += 1;
    }

    const a = stops[stopIndex];
    const b = stops[Math.min(stops.length - 1, stopIndex + 1)];
    const span = Math.max(1.0e-6, b.position - a.position);
    const frac = clampNumber((t - a.position) / span, 0, 1);

    output[4 * i + 0] = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * frac);
    output[4 * i + 1] = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * frac);
    output[4 * i + 2] = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * frac);
    output[4 * i + 3] = 255;
  }

  return output;
}

function normalizePaletteStops(stops) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [
      { position: 0, rgb: [255, 255, 255] },
      { position: 1, rgb: [255, 255, 255] }
    ];
  }

  const normalized = [];
  const denominator = Math.max(1, stops.length - 1);

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    let color = "#ffffff";
    let position = i / denominator;

    if (typeof stop === "string") {
      color = stop;
    } else if (stop && typeof stop === "object") {
      if (typeof stop.color === "string") {
        color = stop.color;
      }
      if (Number.isFinite(stop.position)) {
        position = Number(stop.position);
      }
    } else {
      continue;
    }

    normalized.push({
      position: clampNumber(position, 0, 1),
      rgb: parseHexRgb(color)
    });
  }

  if (normalized.length === 0) {
    return [
      { position: 0, rgb: [255, 255, 255] },
      { position: 1, rgb: [255, 255, 255] }
    ];
  }

  normalized.sort((a, b) => a.position - b.position);

  if (normalized[0].position > 0) {
    normalized.unshift({ position: 0, rgb: [...normalized[0].rgb] });
  }

  const last = normalized[normalized.length - 1];
  if (last.position < 1) {
    normalized.push({ position: 1, rgb: [...last.rgb] });
  }

  return normalized;
}

function hsvToRgb(h, s, v) {
  const hue = ((h % 1) + 1) % 1;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function parseHexRgb(hex) {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  if (value.length !== 6) {
    return [255, 255, 255];
  }

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

function setActivePalette(paletteId) {
  activePaletteTexture = paletteTexturesById.get(paletteId) || paletteTexturesById.get(DEFAULT_RUNTIME_SETTINGS.paletteId) || null;
}

function setupPickerWorker() {
  try {
    pickerWorker = new Worker("./picker-worker.js");
    pickerWorker.addEventListener("message", handlePickerMessage);
    pickerWorker.addEventListener("error", (event) => {
      console.error("Picker worker error:", event.message);
      if (pickerWorker) {
        pickerWorker.terminate();
      }
      pickerWorker = null;
      pickerBusy = false;
      maybeLaunchPick();
    });
    pickerWorker.addEventListener("messageerror", () => {
      console.error("Picker worker message error.");
      if (pickerWorker) {
        pickerWorker.terminate();
      }
      pickerWorker = null;
      pickerBusy = false;
      maybeLaunchPick();
    });
  } catch (error) {
    pickerWorker = null;
    console.warn("Picker worker unavailable. Using main-thread scene picker fallback.", error);
  }
}

function handlePickerMessage(event) {
  const data = event.data;
  pickerBusy = false;

  if (data && data.type === "picked") {
    if (data.requestId === desiredPickRequestId) {
      pendingScene = {
        centerX: data.centerX,
        centerY: data.centerY,
        radius: data.radius,
        power: data.power,
        preIter: data.preIter
      };
    }
  } else if (data && data.type === "error") {
    console.error("Picker worker failed:", data.message);
  }

  maybeLaunchPick();
}

function requestPick() {
  desiredPickRequestId += 1;
  maybeLaunchPick();
}

function maybeLaunchPick() {
  if (pickerBusy) {
    return;
  }
  if (desiredPickRequestId <= inFlightPickRequestId) {
    return;
  }

  pickerBusy = true;
  inFlightPickRequestId = desiredPickRequestId;

  const request = {
    requestId: inFlightPickRequestId,
    viewportWidth: canvas.width,
    viewportHeight: canvas.height,
    simulationAspect: aspect,
    simulationRows: simRows,
    simulationCols: simCols,
    searchDepth: activeSettings.boundarySearchDepth,
    searchGridSize: PICK_GRID_SIZE,
    minimumRadius: MINIMUM_RENDER_RADIUS,
    powerMin: activeSettings.powerMin,
    powerMax: activeSettings.powerMax
  };

  if (pickerWorker) {
    pickerWorker.postMessage({
      type: "pickScene",
      ...request
    });
    return;
  }

  setTimeout(() => {
    try {
      const pickedScene = pickSceneLocal(request);
      if (request.requestId === desiredPickRequestId) {
        pendingScene = pickedScene;
      }
    } catch (error) {
      console.error("Main-thread picker failed:", error);
    } finally {
      pickerBusy = false;
      maybeLaunchPick();
    }
  }, 0);
}

function chooseScenePower(powerMin, powerMax) {
  const minPower = clampNumber(Math.round(powerMin), MIN_POWER, MAX_POWER);
  const maxPower = clampNumber(Math.round(powerMax), MIN_POWER, MAX_POWER);
  const from = Math.min(minPower, maxPower);
  const to = Math.max(minPower, maxPower);
  return from + ((Math.random() * (to - from + 1)) | 0);
}

function handleVisibilityChange() {
  if (!document.hidden) {
    lastFrameTimeMs = performance.now();
  }
}

function greatestCommonDivisor(a, b) {
  let x = Math.max(1, Math.floor(Math.abs(a)));
  let y = Math.max(1, Math.floor(Math.abs(b)));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function chooseEffectivePixelSize(width, height, requestedPixelSize) {
  const target = Math.max(1, Number(requestedPixelSize) || 1);
  const sharedDivisor = greatestCommonDivisor(width, height);
  if (sharedDivisor <= 1) {
    return 1;
  }

  let best = 1;
  let bestError = Math.abs(1 - target);

  function consider(divisor) {
    if (divisor < 1) {
      return;
    }

    const error = Math.abs(divisor - target);
    if (error < bestError || (error === bestError && divisor > best)) {
      best = divisor;
      bestError = error;
    }
  }

  const limit = Math.floor(Math.sqrt(sharedDivisor));
  for (let candidate = 1; candidate <= limit; candidate += 1) {
    if (sharedDivisor % candidate !== 0) {
      continue;
    }
    consider(candidate);
    consider(sharedDivisor / candidate);
  }

  return best;
}

function computeSimulationGrid(width, height, requestedPixelSize) {
  const pixelSize = chooseEffectivePixelSize(width, height, requestedPixelSize);
  const cols = Math.max(1, Math.floor(width / pixelSize));
  const rows = Math.max(1, Math.floor(height / pixelSize));

  return {
    cols,
    rows,
    pixelSize,
    cropOffsetX: 0,
    cropOffsetY: 0
  };
}

function handleResize(forceRecreate) {
  if (!gl) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));

  const scaleChanged = appliedRenderScale !== activeSettings.renderScale;
  if (!forceRecreate && !scaleChanged && canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;

  appliedRenderScale = activeSettings.renderScale;
  const simulationGrid = computeSimulationGrid(canvas.width, canvas.height, appliedRenderScale);
  displayPixelSize = simulationGrid.pixelSize;
  simCols = simulationGrid.cols;
  simRows = simulationGrid.rows;
  displayCropOffsetX = simulationGrid.cropOffsetX;
  displayCropOffsetY = simulationGrid.cropOffsetY;
  aspect = simRows / simCols;

  try {
    recreateRenderTargets();
    recreateSampleTarget();
  } catch (error) {
    console.error(error);
    showUnsupported("This browser/GPU cannot allocate the required render targets.");
    return;
  }

  sceneActive = false;
  pendingScene = null;
  sceneJustReset = false;
  scenePreparation = null;
  clearSceneRefreshRequest();

  sceneElapsedFrames = 0;
  sceneElapsedIterations = 0;
  sceneElapsedSeconds = 0;
  iterationAccumulator = 0;

  requestPick();
}

function recreateRenderTargets() {
  for (const target of renderTargets) {
    destroyRenderTarget(target);
  }

  renderTargets = [
    createRenderTarget(simCols, simRows),
    createRenderTarget(simCols, simRows)
  ];

  currentIndex = 0;
  clearSimulationTextures();
}

function destroyRenderTarget(target) {
  if (!target) {
    return;
  }
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.stateTex);
  gl.deleteTexture(target.colorTex);
  gl.deleteTexture(target.deltaTex);
}

function createRenderTarget(width, height) {
  const stateTex = createTexture(width, height, stateInternalFormat, gl.RG, stateType, gl.NEAREST, null);
  const colorTex = createTexture(width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, null);
  const deltaTex = createTexture(width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, null);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    throw new Error("Failed to create framebuffer.");
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, colorTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, deltaTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, stateTex, colorTex, deltaTex };
}

function createTexture(width, height, internalFormat, format, type, filter, data) {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
}

function clearSimulationTextures() {
  for (const target of renderTargets) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function recreateSampleTarget() {
  if (sampleTarget) {
    gl.deleteFramebuffer(sampleTarget.fbo);
    gl.deleteTexture(sampleTarget.texture);
    sampleTarget = null;
  }

  const screenAspect = simCols / simRows;
  const sampleRows = Math.max(8, Math.round(Math.sqrt(SAMPLE_TARGET_PIXELS / screenAspect)));
  const sampleCols = Math.max(8, Math.round(sampleRows * screenAspect));
  const width = Math.min(simCols, sampleCols);
  const height = Math.min(simRows, sampleRows);

  const texture = createTexture(width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    throw new Error("Failed to create sample framebuffer.");
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    throw new Error(`Sample framebuffer incomplete: 0x${status.toString(16)}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  sampleTarget = { fbo, texture, width, height };
  sampleReadBuffer = new Uint8Array(width * height);
}

function applyScene(scene) {
  sceneCenterX = Math.fround(scene.centerX);
  sceneCenterY = Math.fround(scene.centerY);

  const precisionSafeRadius = getPrecisionSafeRadius(sceneCenterX, sceneCenterY);
  sceneRadius = Math.fround(Math.max(scene.radius, precisionSafeRadius));
  scenePower = clampNumber(scene.power | 0, MIN_POWER, MAX_POWER);
  sceneLogPower = Math.log(scenePower);

  sceneIterationPhase = 1;
  sceneStartColorPhase =
    activeSettings.startColorMode === "random"
      ? Math.random()
      : activeSettings.startColorPhase;

  sceneElapsedFrames = 0;
  sceneElapsedIterations = 0;
  sceneElapsedSeconds = 0;
  iterationAccumulator = 0;

  clearSceneRefreshRequest();
  sceneJustReset = true;

  let preIterEstimate = Math.max(0, scene.preIter | 0);
  if (sceneRadius > scene.radius) {
    preIterEstimate = computePreIterEstimateLocal(sceneCenterX, sceneCenterY, sceneRadius, aspect, scenePower);
  }

  clearSimulationTextures();
  scenePreparation = createScenePreparation(preIterEstimate);
  sceneActive = true;
}

function getPrecisionSafeRadius(centerX, centerY) {
  const centerXF32 = Math.fround(centerX);
  const centerYF32 = Math.fround(centerY);

  let radiusFloor = MINIMUM_RENDER_RADIUS;
  const safeAspect = Math.max(1.0e-6, aspect);

  // Iterate a few times because ulp can change slightly across the sampled span.
  for (let i = 0; i < 3; i += 1) {
    const ySpan = radiusFloor * safeAspect;

    const xStepUlp = Math.max(
      getFloat32Ulp(centerXF32),
      getFloat32Ulp(Math.fround(centerXF32 - radiusFloor)),
      getFloat32Ulp(Math.fround(centerXF32 + radiusFloor))
    );
    const yStepUlp = Math.max(
      getFloat32Ulp(centerYF32),
      getFloat32Ulp(Math.fround(centerYF32 - ySpan)),
      getFloat32Ulp(Math.fround(centerYF32 + ySpan))
    );

    const requiredRadius = 0.5 * simCols * PRECISION_STEP_ULPS * Math.max(xStepUlp, yStepUlp);
    radiusFloor = Math.max(radiusFloor, requiredRadius);
  }

  return radiusFloor;
}

function getFloat32Ulp(value) {
  const rounded = Math.abs(Math.fround(value));
  if (!Number.isFinite(rounded)) {
    return Infinity;
  }
  if (rounded === 0) {
    return FLOAT32_MIN_STEP;
  }

  const exponent = Math.floor(Math.log2(rounded));
  return Math.max(FLOAT32_MIN_STEP, Math.pow(2, exponent - 23));
}

function pickSceneLocal(request) {
  const localAspect = Number.isFinite(request.simulationAspect) && request.simulationAspect > 0
    ? request.simulationAspect
    : request.viewportHeight / request.viewportWidth;
  const selectedPower = chooseScenePower(request.powerMin, request.powerMax);

  const point = findValidBoundaryPointLocal(
    localAspect,
    request.searchDepth,
    request.searchGridSize,
    request.minimumRadius,
    selectedPower
  );

  const preIter = computePreIterEstimateLocal(point.centerX, point.centerY, point.radius, localAspect, selectedPower);
  return {
    centerX: point.centerX,
    centerY: point.centerY,
    radius: point.radius,
    power: selectedPower,
    preIter
  };
}

function findValidBoundaryPointLocal(localAspect, searchDepth, searchGridSize, minimumRadius, scenePowerValue) {
  let fallback = null;
  let best = null;
  const requestedTargetRadius = minimumRadius * PICK_TARGET_RADIUS_FACTOR;
  const achievableRadius = 1.25 / Math.pow(4, Math.max(1, searchDepth));
  const targetRadius = Math.max(requestedTargetRadius, achievableRadius);

  for (let attempt = 0; attempt < PICK_MAX_RETRIES; attempt += 1) {
    const point = pickBoundaryPointLocal(
      localAspect,
      searchDepth,
      searchGridSize,
      minimumRadius,
      scenePowerValue
    );

    fallback = point;

    if (Math.abs(point.centerY) <= PICK_MIN_CY_ABS) {
      continue;
    }

    if (!best || point.radius < best.radius) {
      best = point;
    }

    if (point.radius <= targetRadius) {
      break;
    }
  }

  if (best) {
    return best;
  }

  return fallback || { centerX: -0.75, centerY: 0.3, radius: minimumRadius };
}

function pickBoundaryPointLocal(localAspect, searchDepth, searchGridSize, minimumRadius, scenePowerValue) {
  const rows = searchGridSize;
  const cols = searchGridSize;
  const count = rows * cols;

  const inside = new Uint8Array(count);
  const boundaryIndices = new Uint32Array(count);
  const xCoord = new Float64Array(cols);
  const yCoord = new Float64Array(rows);

  let centerX = -0.75;
  let centerY = 0.0;
  let radius = 1.25;
  let maxIter = 100;

  for (let level = 0; level < searchDepth && radius > minimumRadius; level += 1) {
    const xStart = centerX - radius;
    const xStep = (2.0 * radius) / cols;
    for (let i = 0; i < cols; i += 1) {
      xCoord[i] = xStart + xStep * i;
    }

    const yStart = centerY + radius * localAspect;
    const yStep = (2.0 * radius * localAspect) / rows;
    for (let j = 0; j < rows; j += 1) {
      yCoord[j] = yStart - yStep * j;
    }

    for (let j = 0; j < rows; j += 1) {
      const y0 = yCoord[j];
      const rowOffset = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const x0 = xCoord[i];
        inside[rowOffset + i] = escapesAfterMaxIterLocal(x0, y0, maxIter, scenePowerValue) ? 0 : 1;
      }
    }

    let boundaryCount = 0;

    for (let j = 1; j < rows - 1; j += 1) {
      const rowOffset = j * cols;
      for (let i = 1; i < cols - 1; i += 1) {
        const idx = rowOffset + i;
        if (inside[idx] === 0) {
          continue;
        }

        if (
          inside[idx - cols - 1] === 0 ||
          inside[idx - cols] === 0 ||
          inside[idx - cols + 1] === 0 ||
          inside[idx - 1] === 0 ||
          inside[idx + 1] === 0 ||
          inside[idx + cols - 1] === 0 ||
          inside[idx + cols] === 0 ||
          inside[idx + cols + 1] === 0
        ) {
          boundaryIndices[boundaryCount] = idx;
          boundaryCount += 1;
        }
      }
    }

    if (boundaryCount === 0) {
      break;
    }

    const pickedBoundaryIdx = boundaryIndices[(Math.random() * boundaryCount) | 0];

    const pickedCol = pickedBoundaryIdx % cols;
    const pickedRow = (pickedBoundaryIdx / cols) | 0;

    centerX = xCoord[pickedCol];
    centerY = yCoord[pickedRow];
    radius /= 4.0;
    maxIter += 100;
  }

  if (radius < minimumRadius) {
    radius = minimumRadius;
  }

  return { centerX, centerY, radius };
}

function escapesAfterMaxIterLocal(x0, y0, maxIter, scenePowerValue) {
  let xVal = x0;
  let yVal = y0;
  let n = 0;

  while (xVal * xVal + yVal * yVal <= 4.0 && n < maxIter) {
    const iter = iterateComplexPower(xVal, yVal, x0, y0, scenePowerValue);
    xVal = iter.x;
    yVal = iter.y;
    n += 1;
  }

  return n < maxIter;
}

function computePreIterEstimateLocal(centerX, centerY, radius, localAspect, scenePowerValue) {
  const coarseCols = Math.max(16, Math.min(PREITER_MAX_COLS, simCols));
  const coarseRows = Math.max(16, Math.min(PREITER_MAX_ROWS, simRows));

  const xCoord = new Float64Array(coarseCols);
  const yCoord = new Float64Array(coarseRows);

  const xStart = centerX - radius;
  const xStep = (2.0 * radius) / coarseCols;
  for (let i = 0; i < coarseCols; i += 1) {
    xCoord[i] = xStart + xStep * i;
  }

  const yStart = centerY + radius * localAspect;
  const yStep = (2.0 * radius * localAspect) / coarseRows;
  for (let j = 0; j < coarseRows; j += 1) {
    yCoord[j] = yStart - yStep * j;
  }

  const count = coarseCols * coarseRows;
  let x = new Float64Array(count);
  let y = new Float64Array(count);
  let nextX = new Float64Array(count);
  let nextY = new Float64Array(count);

  let safeIterations = 0;
  while (safeIterations < PREITER_MAX_ITERS) {
    let escaped = false;

    for (let j = 0; j < coarseRows && !escaped; j += 1) {
      const y0 = yCoord[j];
      const rowOffset = j * coarseCols;

      for (let i = 0; i < coarseCols; i += 1) {
        const idx = rowOffset + i;
        const iter = iterateComplexPower(x[idx], y[idx], xCoord[i], y0, scenePowerValue);
        nextX[idx] = iter.x;
        nextY[idx] = iter.y;
        if (iter.x * iter.x + iter.y * iter.y >= 4.0) {
          escaped = true;
          break;
        }
      }
    }

    if (escaped) {
      break;
    }

    safeIterations += 1;
    const oldX = x;
    const oldY = y;
    x = nextX;
    y = nextY;
    nextX = oldX;
    nextY = oldY;
  }

  return safeIterations;
}

function iterateComplexPower(x, y, x0, y0, scenePowerValue) {
  let px = x;
  let py = y;

  for (let p = 1; p < scenePowerValue; p += 1) {
    const pxNew = px * x - py * y;
    py = px * y + py * x;
    px = pxNew;
  }

  return { x: px + x0, y: py + y0 };
}

function runUpdatePass() {
  const src = renderTargets[currentIndex];
  const dst = renderTargets[1 - currentIndex];

  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simCols, simRows);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

  gl.useProgram(updateProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.stateTex);
  gl.uniform1i(updateUniforms.prevState, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, src.colorTex);
  gl.uniform1i(updateUniforms.prevColor, 1);

  gl.uniform1f(updateUniforms.centerX, sceneCenterX);
  gl.uniform1f(updateUniforms.centerY, sceneCenterY);
  gl.uniform1f(updateUniforms.radius, sceneRadius);
  gl.uniform1f(updateUniforms.aspect, aspect);
  gl.uniform1f(updateUniforms.cols, simCols);
  gl.uniform1f(updateUniforms.rows, simRows);
  gl.uniform1f(updateUniforms.iterationPhase, sceneIterationPhase);
  gl.uniform1i(updateUniforms.power, scenePower);
  gl.uniform1f(updateUniforms.logPower, sceneLogPower);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);

  currentIndex = 1 - currentIndex;
}

function runStateOnlyPass() {
  const src = renderTargets[currentIndex];
  const dst = renderTargets[1 - currentIndex];

  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, simCols, simRows);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  gl.useProgram(stateOnlyProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.stateTex);
  gl.uniform1i(stateOnlyUniforms.prevState, 0);

  gl.uniform1f(stateOnlyUniforms.centerX, sceneCenterX);
  gl.uniform1f(stateOnlyUniforms.centerY, sceneCenterY);
  gl.uniform1f(stateOnlyUniforms.radius, sceneRadius);
  gl.uniform1f(stateOnlyUniforms.aspect, aspect);
  gl.uniform1f(stateOnlyUniforms.cols, simCols);
  gl.uniform1f(stateOnlyUniforms.rows, simRows);
  gl.uniform1i(stateOnlyUniforms.power, scenePower);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);

  currentIndex = 1 - currentIndex;
}

function advanceSceneIteration(iterationSteps) {
  sceneIterationPhase += iterationSteps;
}

function estimateColorCoverage() {
  if (!sampleTarget) {
    return 0;
  }

  const src = renderTargets[currentIndex];
  const sum = sampleTextureSum(src.colorTex);
  const maxSum = 255 * sampleTarget.width * sampleTarget.height;
  return maxSum > 0 ? sum / maxSum : 0;
}

function sampleTextureSum(sourceTexture) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, sampleTarget.fbo);
  gl.viewport(0, 0, sampleTarget.width, sampleTarget.height);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  gl.useProgram(coverageProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(coverageUniforms.source, 0);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);
  gl.readPixels(0, 0, sampleTarget.width, sampleTarget.height, gl.RED, gl.UNSIGNED_BYTE, sampleReadBuffer);

  let sum = 0;
  for (let i = 0; i < sampleReadBuffer.length; i += 1) {
    sum += sampleReadBuffer[i];
  }
  return sum;
}

function createScenePreparation(preIterEstimate) {
  return {
    remainingStateOnlyPasses: Math.min(
      SCENE_PREP_MAX_ITERS,
      Math.max(0, preIterEstimate - PREITER_SAFETY_MARGIN)
    ),
    updatePasses: 0,
    updatePassesSinceCoverageCheck: 0
  };
}

function runScenePreparationStep() {
  if (!scenePreparation) {
    return true;
  }

  const startMs = performance.now();
  let passesRun = 0;

  while (
    scenePreparation &&
    passesRun < SCENE_PREP_MAX_PASSES_PER_FRAME &&
    performance.now() - startMs < SCENE_PREP_TIME_BUDGET_MS
  ) {
    if (scenePreparation.remainingStateOnlyPasses > 0) {
      const batchSize = Math.min(8, scenePreparation.remainingStateOnlyPasses);
      for (let i = 0; i < batchSize; i += 1) {
        runStateOnlyPass();
      }
      scenePreparation.remainingStateOnlyPasses -= batchSize;
      passesRun += batchSize;
      continue;
    }

    runUpdatePass();
    advanceSceneIteration(1);
    scenePreparation.updatePasses += 1;
    scenePreparation.updatePassesSinceCoverageCheck += 1;
    passesRun += 1;

    const shouldCheckCoverage =
      scenePreparation.updatePasses === 1 ||
      scenePreparation.updatePassesSinceCoverageCheck >= SCENE_PREP_COVERAGE_CHECK_INTERVAL ||
      scenePreparation.updatePasses >= SCENE_PREP_MAX_ITERS;

    if (!shouldCheckCoverage) {
      continue;
    }

    scenePreparation.updatePassesSinceCoverageCheck = 0;
    if (
      scenePreparation.updatePasses >= SCENE_PREP_MAX_ITERS ||
      estimateColorCoverage() > 0
    ) {
      scenePreparation = null;
      return true;
    }
  }

  return !scenePreparation;
}

function drawToScreen() {
  const src = renderTargets[currentIndex];

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(displayProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.stateTex);
  gl.uniform1i(displayUniforms.state, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, src.colorTex);
  gl.uniform1i(displayUniforms.mask, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, activePaletteTexture);
  gl.uniform1i(displayUniforms.palette, 2);

  gl.uniform1f(displayUniforms.paletteCycleLength, activeSettings.paletteCycleLength);
  gl.uniform1f(displayUniforms.colorIncrementCurve, activeSettings.colorIncrementCurve);
  gl.uniform1i(displayUniforms.smoothColors, activeSettings.smoothColors ? 1 : 0);
  gl.uniform1f(displayUniforms.startColorPhase, sceneStartColorPhase);
  gl.uniform2f(displayUniforms.simSize, simCols, simRows);
  gl.uniform1f(displayUniforms.pixelSize, displayPixelSize);
  gl.uniform2f(displayUniforms.cropOffset, displayCropOffsetX, displayCropOffsetY);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);
}

function clearScreen() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function clearSceneRefreshRequest() {
  refreshRequested = false;
  refreshRequestKind = SCENE_REFRESH_NONE;
}

function requestSceneRefresh(kind) {
  const nextKind = kind === SCENE_REFRESH_MANUAL ? SCENE_REFRESH_MANUAL : SCENE_REFRESH_AUTO;
  if (nextKind === SCENE_REFRESH_AUTO && sceneHeld) {
    return;
  }

  refreshRequested = true;
  if (nextKind === SCENE_REFRESH_MANUAL || refreshRequestKind !== SCENE_REFRESH_MANUAL) {
    refreshRequestKind = nextKind;
  }

  ensureNextPickReady();
}

function requestSceneRefreshNow() {
  requestSceneRefresh(SCENE_REFRESH_MANUAL);
}

function ensureNextPickReady() {
  if (pendingScene || pickerBusy || desiredPickRequestId > inFlightPickRequestId) {
    return;
  }
  requestPick();
}

function hasReachedSceneLengthLimit() {
  const limit = activeSettings.sceneSwitchLimit;

  if (activeSettings.sceneSwitchMode === SCENE_SWITCH_MODE_SECONDS) {
    return sceneElapsedSeconds >= limit;
  }
  if (activeSettings.sceneSwitchMode === SCENE_SWITCH_MODE_ITERATIONS) {
    return sceneElapsedIterations >= limit;
  }
  return sceneElapsedFrames >= limit;
}

function renderLoop(timeMs) {
  if (unsupportedEl.style.display === "grid") {
    return;
  }

  requestAnimationFrame(renderLoop);

  if (document.hidden) {
    lastFrameTimeMs = timeMs;
    return;
  }

  if (lastFrameTimeMs === 0) {
    lastFrameTimeMs = timeMs;
  }

  const deltaSeconds = Math.min(0.25, Math.max(0, (timeMs - lastFrameTimeMs) / 1000));
  lastFrameTimeMs = timeMs;
  const canSwapToPendingScene = !scenePaused || refreshRequestKind === SCENE_REFRESH_MANUAL;

  if (!sceneActive) {
    activatePendingPickerSettingsIfNeeded();

    if (pendingScene) {
      const nextScene = pendingScene;
      pendingScene = null;
      applyScene(nextScene);
      requestPick();
      drawToScreen();
      lastFrameTimeMs = performance.now();
      sceneJustReset = false;
    } else {
      clearScreen();
      ensureNextPickReady();
    }
    return;
  }

  if (refreshRequested) {
    activatePendingPickerSettingsIfNeeded();
  }

  if (refreshRequested && pendingScene && canSwapToPendingScene) {
    const nextScene = pendingScene;
    pendingScene = null;
    applyScene(nextScene);
    requestPick();
    drawToScreen();
    lastFrameTimeMs = performance.now();
    sceneJustReset = false;
    return;
  }

  if (sceneJustReset) {
    drawToScreen();
    sceneJustReset = false;
    return;
  }

  if (scenePaused) {
    drawToScreen();
    return;
  }

  if (scenePreparation) {
    runScenePreparationStep();
    drawToScreen();
    iterationAccumulator = 0;
    lastFrameTimeMs = performance.now();
    return;
  }

  sceneElapsedFrames += 1;
  sceneElapsedSeconds += deltaSeconds;

  iterationAccumulator = Math.min(
    MAX_UPDATE_PASSES_PER_FRAME * 2,
    iterationAccumulator + activeSettings.iterationRate * deltaSeconds
  );
  const updatesToRun = Math.min(MAX_UPDATE_PASSES_PER_FRAME, Math.floor(iterationAccumulator));

  if (updatesToRun > 0) {
    iterationAccumulator -= updatesToRun;
    for (let i = 0; i < updatesToRun; i += 1) {
      runUpdatePass();
      advanceSceneIteration(1);
      sceneElapsedIterations += 1;
    }
  }

  drawToScreen();

  if (!sceneHeld && hasReachedSceneLengthLimit()) {
    requestSceneRefresh(SCENE_REFRESH_AUTO);
  }

  if (refreshRequested) {
    ensureNextPickReady();
  }
}

function showUnsupported(message) {
  unsupportedEl.textContent = message;
  unsupportedEl.style.display = "grid";
  if (canvas) {
    canvas.style.display = "none";
  }
}
