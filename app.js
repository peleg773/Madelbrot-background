const SCALE = 1;
const MOD = 300;
const COLOR_COVERAGE_TARGET = 0.975;
const SAMPLE_EVERY_N_FRAMES = 6;
const PICK_DEPTH = 16;
const PICK_GRID = 200;
const SAMPLE_TARGET_PIXELS = 4096;
const MIN_RENDER_RADIUS = 5.0e-5;
const FLOAT32_REL_EPS = 1.1920929e-7;
const PRECISION_RADIUS_FACTOR = 0.2;
const MAX_SCENE_FRAMES = 1800;
const POWER_OPTIONS = [2, 2, 2, 3, 3, 4, 5];
const MAX_POWER = 8;
const SCENE_PREP_MAX_ITERS = 20000;
const PREITER_MAX_ITERS = 2048;
const PREITER_MAX_COLS = 320;
const PREITER_MAX_ROWS = 180;

const PICK_MIN_CY_ABS = 0.001;
const PICK_MAX_RETRIES = 40;

const FULLSCREEN_TRIANGLES = 3;

let canvas;
let unsupportedEl;
let gl;
let extColorBufferFloat;
let stateInternalFormat;
let stateType;

let vao;
let updateProgram;
let displayProgram;
let sampleProgram;
let coverageProgram;
let stateOnlyProgram;
let escapeCheckProgram;

let updateUniforms;
let displayUniforms;
let sampleUniforms;
let coverageUniforms;
let stateOnlyUniforms;
let escapeCheckUniforms;

let renderTargets = [];
let currentIndex = 0;

let sampleTarget = null;
let sampleReadBuffer = new Uint8Array(0);

let simCols = 1;
let simRows = 1;
let aspect = 1;

let cx = -0.75;
let cy = 0.0;
let r = 1.25;
let power = 2;
let logPower = Math.log(2.0);

let dir = 0;
let off = 0;
let counter = 0;
let frameCounter = 0;
let sceneJustReset = false;

let sceneActive = false;
let refreshRequested = false;
let pendingScene = null;

let pickerWorker = null;
let pickerBusy = false;
let desiredPickId = 0;
let inFlightPickId = 0;

bootstrap();

function bootstrap() {
  canvas = document.getElementById("fractal");
  unsupportedEl = document.getElementById("unsupported");

  if (!canvas || !unsupportedEl) {
    return;
  }

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
  setupPickerWorker();

  window.addEventListener("resize", handleResize, { passive: true });

  handleResize();
  if (unsupportedEl.style.display === "grid") {
    return;
  }
  renderLoop();
}

function showUnsupported(message) {
  unsupportedEl.textContent = message;
  unsupportedEl.style.display = "grid";
  if (canvas) {
    canvas.style.display = "none";
  }
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

    uniform float uCx;
    uniform float uCy;
    uniform float uR;
    uniform float uAspect;
    uniform float uCols;
    uniform float uRows;
    uniform float uOff;
    uniform float uDir;
    uniform float uMod;
    uniform int uPower;
    uniform float uLogPower;

    vec3 hsvToRgb(vec3 c) {
      vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
      vec3 rgb = clamp(p - 1.0, 0.0, 1.0);
      return c.z * mix(vec3(1.0), rgb, c.y);
    }

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
      vec2 pixel = gl_FragCoord.xy - vec2(0.5);
      float tx = pixel.x / uCols;
      float ty = pixel.y / uRows;

      float x0 = uCx + mix(-uR, uR, tx);
      float y0 = uCy + mix(uR, -uR, ty) * uAspect;

      vec2 z = texture(uPrevState, vUv).rg;
      vec4 prevColor = texture(uPrevColor, vUv);

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
        float val = -(log(log(zMag)) / uLogPower);
        float mapped = mix(255.0 * (1.0 - uDir), 255.0 * uDir, (uOff + val) / uMod);
        float hue = clamp(mapped / 255.0, 0.0, 1.0);
        vec3 rgb = hsvToRgb(vec3(hue, 1.0, 1.0));

        outState = zNew;
        outColor = vec4(rgb, 1.0);
        outDelta = vec4(1.0, 0.0, 0.0, 1.0);
      } else {
        outState = zNew;
        outColor = prevColor;
        outDelta = vec4(0.0, 0.0, 0.0, 1.0);
      }
    }
  `;

  const displayFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uColor;

    void main() {
      vec3 rgb = texture(uColor, vUv).rgb;
      outColor = vec4(rgb, 1.0);
    }
  `;

  const sampleFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uSource;

    void main() {
      float d = texture(uSource, vUv).r;
      outColor = vec4(d, 0.0, 0.0, 1.0);
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
    uniform float uCx;
    uniform float uCy;
    uniform float uR;
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
      vec2 pixel = gl_FragCoord.xy - vec2(0.5);
      float tx = pixel.x / uCols;
      float ty = pixel.y / uRows;

      float x0 = uCx + mix(-uR, uR, tx);
      float y0 = uCy + mix(uR, -uR, ty) * uAspect;

      vec2 z = texture(uPrevState, vUv).rg;
      vec2 zPow = cpowInt(z, uPower);
      outState = zPow + vec2(x0, y0);
    }
  `;

  const escapeCheckFragmentSource = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uPrevState;
    uniform float uCx;
    uniform float uCy;
    uniform float uR;
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
      vec2 pixel = gl_FragCoord.xy - vec2(0.5);
      float tx = pixel.x / uCols;
      float ty = pixel.y / uRows;

      float x0 = uCx + mix(-uR, uR, tx);
      float y0 = uCy + mix(uR, -uR, ty) * uAspect;

      vec2 z = texture(uPrevState, vUv).rg;
      vec2 zNew = cpowInt(z, uPower) + vec2(x0, y0);
      float escaped = dot(zNew, zNew) >= 4.0 ? 1.0 : 0.0;
      outColor = vec4(escaped, 0.0, 0.0, 1.0);
    }
  `;

  updateProgram = createProgram(vertexShaderSource, updateFragmentSource);
  displayProgram = createProgram(vertexShaderSource, displayFragmentSource);
  sampleProgram = createProgram(vertexShaderSource, sampleFragmentSource);
  coverageProgram = createProgram(vertexShaderSource, coverageFragmentSource);
  stateOnlyProgram = createProgram(vertexShaderSource, stateOnlyFragmentSource);
  escapeCheckProgram = createProgram(vertexShaderSource, escapeCheckFragmentSource);

  updateUniforms = {
    prevState: gl.getUniformLocation(updateProgram, "uPrevState"),
    prevColor: gl.getUniformLocation(updateProgram, "uPrevColor"),
    cx: gl.getUniformLocation(updateProgram, "uCx"),
    cy: gl.getUniformLocation(updateProgram, "uCy"),
    r: gl.getUniformLocation(updateProgram, "uR"),
    aspect: gl.getUniformLocation(updateProgram, "uAspect"),
    cols: gl.getUniformLocation(updateProgram, "uCols"),
    rows: gl.getUniformLocation(updateProgram, "uRows"),
    off: gl.getUniformLocation(updateProgram, "uOff"),
    dir: gl.getUniformLocation(updateProgram, "uDir"),
    mod: gl.getUniformLocation(updateProgram, "uMod"),
    power: gl.getUniformLocation(updateProgram, "uPower"),
    logPower: gl.getUniformLocation(updateProgram, "uLogPower")
  };

  displayUniforms = {
    color: gl.getUniformLocation(displayProgram, "uColor")
  };

  sampleUniforms = {
    source: gl.getUniformLocation(sampleProgram, "uSource")
  };

  coverageUniforms = {
    source: gl.getUniformLocation(coverageProgram, "uSource")
  };

  stateOnlyUniforms = {
    prevState: gl.getUniformLocation(stateOnlyProgram, "uPrevState"),
    cx: gl.getUniformLocation(stateOnlyProgram, "uCx"),
    cy: gl.getUniformLocation(stateOnlyProgram, "uCy"),
    r: gl.getUniformLocation(stateOnlyProgram, "uR"),
    aspect: gl.getUniformLocation(stateOnlyProgram, "uAspect"),
    cols: gl.getUniformLocation(stateOnlyProgram, "uCols"),
    rows: gl.getUniformLocation(stateOnlyProgram, "uRows"),
    power: gl.getUniformLocation(stateOnlyProgram, "uPower")
  };

  escapeCheckUniforms = {
    prevState: gl.getUniformLocation(escapeCheckProgram, "uPrevState"),
    cx: gl.getUniformLocation(escapeCheckProgram, "uCx"),
    cy: gl.getUniformLocation(escapeCheckProgram, "uCy"),
    r: gl.getUniformLocation(escapeCheckProgram, "uR"),
    aspect: gl.getUniformLocation(escapeCheckProgram, "uAspect"),
    cols: gl.getUniformLocation(escapeCheckProgram, "uCols"),
    rows: gl.getUniformLocation(escapeCheckProgram, "uRows"),
    power: gl.getUniformLocation(escapeCheckProgram, "uPower")
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
    if (data.id === desiredPickId) {
      pendingScene = {
        cx: data.cx,
        cy: data.cy,
        r: data.r,
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
  desiredPickId += 1;
  maybeLaunchPick();
}

function maybeLaunchPick() {
  if (pickerBusy) {
    return;
  }
  if (desiredPickId <= inFlightPickId) {
    return;
  }

  pickerBusy = true;
  inFlightPickId = desiredPickId;
  const requestedPower = chooseScenePower();
  const request = {
    id: inFlightPickId,
    width: canvas.width,
    height: canvas.height,
    rows: simRows,
    cols: simCols,
    depth: PICK_DEPTH,
    grid: PICK_GRID,
    minRadius: MIN_RENDER_RADIUS,
    power: requestedPower
  };

  if (pickerWorker) {
    pickerWorker.postMessage({
      type: "pick",
      ...request
    });
    return;
  }

  setTimeout(() => {
    try {
      const picked = pickSceneLocal(request);
      if (request.id === desiredPickId) {
        pendingScene = picked;
      }
    } catch (error) {
      console.error("Main-thread picker failed:", error);
    } finally {
      pickerBusy = false;
      maybeLaunchPick();
    }
  }, 0);
}

function chooseScenePower() {
  const idx = (Math.random() * POWER_OPTIONS.length) | 0;
  return POWER_OPTIONS[idx];
}

function handleResize() {
  if (!gl) {
    return;
  }

  // Use DPR=1 to hold a consistent cost profile for real-time full-screen rendering.
  const dpr = 1;
  const nextWidth = Math.max(1, Math.floor(window.innerWidth * dpr));
  const nextHeight = Math.max(1, Math.floor(window.innerHeight * dpr));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;

  simCols = Math.max(1, Math.ceil(canvas.width / SCALE));
  simRows = Math.max(1, Math.ceil(canvas.height / SCALE));
  aspect = canvas.height / canvas.width;

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
  refreshRequested = false;
  counter = 0;
  frameCounter = 0;

  requestPick();
}

function recreateRenderTargets() {
  for (const target of renderTargets) {
    destroyRenderTarget(target);
  }
  renderTargets = [createRenderTarget(simCols, simRows), createRenderTarget(simCols, simRows)];
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
  const stateTex = createTexture(width, height, stateInternalFormat, gl.RG, stateType, gl.NEAREST);
  const colorTex = createTexture(width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
  const deltaTex = createTexture(width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);

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

function createTexture(width, height, internalFormat, format, type, filter) {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
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

  const texture = createTexture(width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
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
  cx = scene.cx;
  cy = scene.cy;
  r = Math.max(scene.r, getPrecisionSafeRadius(scene.cx, scene.cy));
  power = Math.max(2, Math.min(MAX_POWER, scene.power | 0));
  logPower = Math.log(power);

  dir = Math.random() < 0.5 ? 0 : 1;
  off = Math.random() * MOD;
  counter = 0;
  frameCounter = 0;
  refreshRequested = false;
  sceneJustReset = true;

  clearSimulationTextures();
  prepareSceneStateForSecondFrameColor(Math.max(0, scene.preIter | 0));
  sceneActive = true;
}

function getPrecisionSafeRadius(centerX, centerY) {
  const magnitude = Math.max(1.0, Math.abs(centerX), Math.abs(centerY));
  const ulp = magnitude * FLOAT32_REL_EPS;
  const widthDrivenFloor = PRECISION_RADIUS_FACTOR * ulp * simCols;
  return Math.max(MIN_RENDER_RADIUS, widthDrivenFloor);
}

function pickSceneLocal(request) {
  const localAspect = request.height / request.width;
  const selectedPower = Math.max(2, Math.min(MAX_POWER, request.power | 0));
  const point = findValidBoundaryPointLocal(
    localAspect,
    request.depth,
    request.grid,
    request.minRadius,
    selectedPower
  );
  const preIter = computePreIterEstimateLocal(point.cx, point.cy, point.r, localAspect, selectedPower);
  return {
    cx: point.cx,
    cy: point.cy,
    r: point.r,
    power: selectedPower,
    preIter
  };
}

function findValidBoundaryPointLocal(localAspect, depth, grid, minRadius, scenePower) {
  let fallback = null;

  for (let attempt = 0; attempt < PICK_MAX_RETRIES; attempt += 1) {
    const point = pickBoundaryPointLocal(localAspect, depth, grid, minRadius, scenePower);
    fallback = point;
    if (Math.abs(point.cy) > PICK_MIN_CY_ABS) {
      return point;
    }
  }

  return fallback || { cx: -0.75, cy: 0.3, r: minRadius };
}

function pickBoundaryPointLocal(localAspect, depth, grid, minRadius, scenePower) {
  const rows = grid;
  const cols = grid;
  const inside = new Uint8Array(rows * cols);
  const boundaryI = [];
  const boundaryJ = [];

  let pickedCx = -0.75;
  let pickedCy = 0.0;
  let pickedR = 1.25;
  let maxIter = 100;

  for (let level = 0; level < depth && pickedR > minRadius; level += 1) {
    boundaryI.length = 0;
    boundaryJ.length = 0;

    const xCoord = new Float64Array(cols);
    const yCoord = new Float64Array(rows);

    for (let i = 0; i < cols; i += 1) {
      xCoord[i] = pickedCx + mapValue(i, 0, cols, -pickedR, pickedR);
    }
    for (let j = 0; j < rows; j += 1) {
      yCoord[j] = pickedCy + mapValue(j, 0, rows, pickedR, -pickedR) * localAspect;
    }

    for (let j = 0; j < rows; j += 1) {
      const y0 = yCoord[j];
      const rowOffset = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const x0 = xCoord[i];
        inside[rowOffset + i] = escapesAfterMaxIterLocal(x0, y0, maxIter, scenePower) ? 0 : 1;
      }
    }

    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (onBoundaryLocal(inside, cols, rows, i, j)) {
          boundaryI.push(i);
          boundaryJ.push(j);
        }
      }
    }

    if (boundaryI.length === 0) {
      break;
    }

    const pickIdx = (Math.random() * boundaryI.length) | 0;
    const i = boundaryI[pickIdx];
    const j = boundaryJ[pickIdx];

    pickedCx = pickedCx + mapValue(i, 0, cols, -pickedR, pickedR);
    pickedCy = pickedCy + mapValue(j, 0, rows, pickedR, -pickedR) * localAspect;
    pickedR /= 4.0;
    maxIter += 100;
  }

  if (pickedR < minRadius) {
    pickedR = minRadius;
  }

  return { cx: pickedCx, cy: pickedCy, r: pickedR };
}

function escapesAfterMaxIterLocal(x0, y0, maxIter, scenePower) {
  let xVal = x0;
  let yVal = y0;
  let n = 0;

  while (xVal * xVal + yVal * yVal <= 4.0 && n < maxIter) {
    const iter = iterateComplexPower(xVal, yVal, x0, y0, scenePower);
    xVal = iter.x;
    yVal = iter.y;
    n += 1;
  }

  return n < maxIter;
}

function onBoundaryLocal(map, cols, rows, i, j) {
  const base = j * cols + i;
  if (map[base] === 0) {
    return false;
  }

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = i + dx;
      const ny = j + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
        return false;
      }
      if (map[ny * cols + nx] === 0) {
        return true;
      }
    }
  }

  return false;
}

function computePreIterEstimateLocal(centerX, centerY, radius, localAspect, scenePower) {
  const coarseCols = Math.max(16, Math.min(PREITER_MAX_COLS, simCols));
  const coarseRows = Math.max(16, Math.min(PREITER_MAX_ROWS, simRows));

  const xCoord = new Float64Array(coarseCols);
  const yCoord = new Float64Array(coarseRows);

  for (let i = 0; i < coarseCols; i += 1) {
    xCoord[i] = centerX + mapValue(i, 0, coarseCols, -radius, radius);
  }
  for (let j = 0; j < coarseRows; j += 1) {
    yCoord[j] = centerY + mapValue(j, 0, coarseRows, radius, -radius) * localAspect;
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
        const iter = iterateComplexPower(x[idx], y[idx], xCoord[i], y0, scenePower);
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

function iterateComplexPower(x, y, x0, y0, scenePower) {
  let px = x;
  let py = y;

  for (let p = 1; p < scenePower; p += 1) {
    const pxNew = px * x - py * y;
    py = px * y + py * x;
    px = pxNew;
  }

  return { x: px + x0, y: py + y0 };
}

function mapValue(value, inStart, inStop, outStart, outStop) {
  return outStart + (outStop - outStart) * ((value - inStart) / (inStop - inStart));
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

  gl.uniform1f(updateUniforms.cx, cx);
  gl.uniform1f(updateUniforms.cy, cy);
  gl.uniform1f(updateUniforms.r, r);
  gl.uniform1f(updateUniforms.aspect, aspect);
  gl.uniform1f(updateUniforms.cols, simCols);
  gl.uniform1f(updateUniforms.rows, simRows);
  gl.uniform1f(updateUniforms.off, off);
  gl.uniform1f(updateUniforms.dir, dir);
  gl.uniform1f(updateUniforms.mod, MOD);
  gl.uniform1i(updateUniforms.power, power);
  gl.uniform1f(updateUniforms.logPower, logPower);

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

  gl.uniform1f(stateOnlyUniforms.cx, cx);
  gl.uniform1f(stateOnlyUniforms.cy, cy);
  gl.uniform1f(stateOnlyUniforms.r, r);
  gl.uniform1f(stateOnlyUniforms.aspect, aspect);
  gl.uniform1f(stateOnlyUniforms.cols, simCols);
  gl.uniform1f(stateOnlyUniforms.rows, simRows);
  gl.uniform1i(stateOnlyUniforms.power, power);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);

  currentIndex = 1 - currentIndex;
}

function estimateColorCoverage() {
  if (!sampleTarget) {
    return 0;
  }
  const src = renderTargets[currentIndex];
  const sum = sampleTextureSum(src.colorTex, true);
  const maxSum = 255 * sampleTarget.width * sampleTarget.height;
  return maxSum > 0 ? sum / maxSum : 0;
}

function hasNextEscapePixels() {
  if (!sampleTarget) {
    return false;
  }
  const src = renderTargets[currentIndex];
  gl.bindFramebuffer(gl.FRAMEBUFFER, sampleTarget.fbo);
  gl.viewport(0, 0, sampleTarget.width, sampleTarget.height);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  gl.useProgram(escapeCheckProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.stateTex);
  gl.uniform1i(escapeCheckUniforms.prevState, 0);

  gl.uniform1f(escapeCheckUniforms.cx, cx);
  gl.uniform1f(escapeCheckUniforms.cy, cy);
  gl.uniform1f(escapeCheckUniforms.r, r);
  gl.uniform1f(escapeCheckUniforms.aspect, aspect);
  gl.uniform1f(escapeCheckUniforms.cols, simCols);
  gl.uniform1f(escapeCheckUniforms.rows, simRows);
  gl.uniform1i(escapeCheckUniforms.power, power);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);
  gl.readPixels(0, 0, sampleTarget.width, sampleTarget.height, gl.RED, gl.UNSIGNED_BYTE, sampleReadBuffer);

  let sum = 0;
  for (let i = 0; i < sampleReadBuffer.length; i += 1) {
    sum += sampleReadBuffer[i];
  }
  return sum > 0;
}

function sampleTextureSum(sourceTexture, sampleAlpha) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, sampleTarget.fbo);
  gl.viewport(0, 0, sampleTarget.width, sampleTarget.height);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  if (sampleAlpha) {
    gl.useProgram(coverageProgram);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(coverageUniforms.source, 0);
  } else {
    gl.useProgram(sampleProgram);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(sampleUniforms.source, 0);
  }

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);
  gl.readPixels(0, 0, sampleTarget.width, sampleTarget.height, gl.RED, gl.UNSIGNED_BYTE, sampleReadBuffer);

  let sum = 0;
  for (let i = 0; i < sampleReadBuffer.length; i += 1) {
    sum += sampleReadBuffer[i];
  }
  return sum;
}

function prepareSceneStateForSecondFrameColor(preIterEstimate) {
  const preloadIters = Math.min(SCENE_PREP_MAX_ITERS, Math.max(0, preIterEstimate));
  for (let i = 0; i < preloadIters; i += 1) {
    runStateOnlyPass();
  }

  for (let i = preloadIters; i < SCENE_PREP_MAX_ITERS; i += 1) {
    if (hasNextEscapePixels()) {
      return true;
    }
    runStateOnlyPass();
  }

  return hasNextEscapePixels();
}

function drawToScreen() {
  const src = renderTargets[currentIndex];

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(displayProgram);
  gl.bindVertexArray(vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.colorTex);
  gl.uniform1i(displayUniforms.color, 0);

  gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLES);
}

function clearScreen() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function ensureNextPickReady() {
  if (pendingScene || pickerBusy || desiredPickId > inFlightPickId) {
    return;
  }
  requestPick();
}

function renderLoop() {
  if (unsupportedEl.style.display === "grid") {
    return;
  }
  requestAnimationFrame(renderLoop);

  if (document.hidden) {
    return;
  }

  if (!sceneActive) {
    if (pendingScene) {
      const scene = pendingScene;
      pendingScene = null;
      applyScene(scene);
      requestPick();
    } else {
      clearScreen();
      ensureNextPickReady();
    }
    return;
  }

  if (refreshRequested && pendingScene) {
    const scene = pendingScene;
    pendingScene = null;
    applyScene(scene);
    requestPick();
  }

  if (sceneJustReset) {
    drawToScreen();
    sceneJustReset = false;
    return;
  }

  runUpdatePass();
  drawToScreen();

  off += 1;
  if (off >= MOD) {
    off -= MOD;
  }

  counter += 1;
  frameCounter += 1;

  if (frameCounter % SAMPLE_EVERY_N_FRAMES === 0) {
    const coverage = estimateColorCoverage();
    if (coverage >= COLOR_COVERAGE_TARGET) {
      refreshRequested = true;
    }
  }

  if (counter >= MAX_SCENE_FRAMES) {
    refreshRequested = true;
  }

  if (refreshRequested) {
    ensureNextPickReady();
  }
}
