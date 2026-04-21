const MINIMUM_CENTER_Y_ABS = 0.001;
const MAX_PICK_RETRIES = 24;
const MINIMUM_RENDER_RADIUS = 1.0e-5;
const PICK_TARGET_RADIUS_FACTOR = 2.0;

const MIN_POWER = 2;
const MAX_POWER = 8;

const PREITER_MAX_ITERS = 2048;
const PREITER_MAX_COLS = 320;
const PREITER_MAX_ROWS = 180;

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "pickScene") {
    return;
  }

  try {
    const requestId = data.requestId;
    const viewportWidth = Math.max(1, data.viewportWidth | 0);
    const viewportHeight = Math.max(1, data.viewportHeight | 0);
    const simulationAspect = Number.isFinite(data.simulationAspect) && data.simulationAspect > 0
      ? Number(data.simulationAspect)
      : viewportHeight / viewportWidth;
    const searchDepth = Math.max(1, data.searchDepth | 0);
    const searchGridSize = Math.max(8, data.searchGridSize | 0);
    const simulationRows = Math.max(1, data.simulationRows | 0);
    const simulationCols = Math.max(1, data.simulationCols | 0);
    const minimumRadius = Math.max(1.0e-8, Number(data.minimumRadius) || MINIMUM_RENDER_RADIUS);
    const powerMin = clampNumber(data.powerMin | 0, MIN_POWER, MAX_POWER);
    const powerMax = clampNumber(data.powerMax | 0, MIN_POWER, MAX_POWER);
    const chosenPower = chooseScenePower(powerMin, powerMax);

    const point = findValidBoundaryPoint(
      simulationAspect,
      searchDepth,
      searchGridSize,
      minimumRadius,
      chosenPower
    );
    const preIter = computePreIterEstimate(
      point.centerX,
      point.centerY,
      point.radius,
      simulationAspect,
      chosenPower,
      simulationRows,
      simulationCols
    );

    self.postMessage({
      type: "picked",
      requestId,
      centerX: point.centerX,
      centerY: point.centerY,
      radius: point.radius,
      power: chosenPower,
      preIter
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: data.requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function chooseScenePower(powerMin, powerMax) {
  const from = Math.min(powerMin, powerMax);
  const to = Math.max(powerMin, powerMax);
  return from + ((Math.random() * (to - from + 1)) | 0);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function findValidBoundaryPoint(aspect, searchDepth, searchGridSize, minimumRadius, chosenPower) {
  let fallback = null;
  let best = null;
  const requestedTargetRadius = minimumRadius * PICK_TARGET_RADIUS_FACTOR;
  const achievableRadius = 1.25 / Math.pow(4, Math.max(1, searchDepth));
  const targetRadius = Math.max(requestedTargetRadius, achievableRadius);

  for (let attempt = 0; attempt < MAX_PICK_RETRIES; attempt += 1) {
    const point = pickBoundaryPoint(
      aspect,
      searchDepth,
      searchGridSize,
      minimumRadius,
      chosenPower
    );
    fallback = point;

    if (Math.abs(point.centerY) <= MINIMUM_CENTER_Y_ABS) {
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

function pickBoundaryPoint(aspect, searchDepth, searchGridSize, minimumRadius, chosenPower) {
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

    const yStart = centerY + radius * aspect;
    const yStep = (2.0 * radius * aspect) / rows;
    for (let j = 0; j < rows; j += 1) {
      yCoord[j] = yStart - yStep * j;
    }

    for (let j = 0; j < rows; j += 1) {
      const y0 = yCoord[j];
      const rowOffset = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const x0 = xCoord[i];
        inside[rowOffset + i] = escapesAfterMaxIter(x0, y0, maxIter, chosenPower) ? 0 : 1;
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

function escapesAfterMaxIter(x0, y0, maxIter, chosenPower) {
  let x = x0;
  let y = y0;
  let n = 0;

  while (x * x + y * y <= 4.0 && n < maxIter) {
    const iter = iterateComplexPower(x, y, x0, y0, chosenPower);
    x = iter.x;
    y = iter.y;
    n += 1;
  }

  return n < maxIter;
}

function computePreIterEstimate(centerX, centerY, radius, aspect, chosenPower, rows, cols) {
  const coarseCols = Math.max(16, Math.min(PREITER_MAX_COLS, cols));
  const coarseRows = Math.max(16, Math.min(PREITER_MAX_ROWS, rows));

  const xCoord = new Float64Array(coarseCols);
  const yCoord = new Float64Array(coarseRows);

  const xStart = centerX - radius;
  const xStep = (2.0 * radius) / coarseCols;
  for (let i = 0; i < coarseCols; i += 1) {
    xCoord[i] = xStart + xStep * i;
  }

  const yStart = centerY + radius * aspect;
  const yStep = (2.0 * radius * aspect) / coarseRows;
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
        const iter = iterateComplexPower(x[idx], y[idx], xCoord[i], y0, chosenPower);
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

function iterateComplexPower(x, y, x0, y0, chosenPower) {
  let px = x;
  let py = y;
  for (let p = 1; p < chosenPower; p += 1) {
    const pxNew = px * x - py * y;
    py = px * y + py * x;
    px = pxNew;
  }
  return { x: px + x0, y: py + y0 };
}
