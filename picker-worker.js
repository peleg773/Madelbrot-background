const MIN_CY_ABS = 0.001;
const MAX_PICK_RETRIES = 40;
const MIN_RENDER_RADIUS = 5.0e-5;
const MAX_POWER = 8;
const PREITER_MAX_ITERS = 2048;
const PREITER_MAX_COLS = 320;
const PREITER_MAX_ROWS = 180;

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "pick") {
    return;
  }

  try {
    const id = data.id;
    const width = Math.max(1, data.width | 0);
    const height = Math.max(1, data.height | 0);
    const depth = Math.max(1, data.depth | 0);
    const grid = Math.max(8, data.grid | 0);
    const rows = Math.max(1, data.rows | 0);
    const cols = Math.max(1, data.cols | 0);
    const minRadius = Math.max(1.0e-8, Number(data.minRadius) || MIN_RENDER_RADIUS);
    const scenePower = Math.max(2, Math.min(MAX_POWER, data.power | 0));

    const aspect = height / width;
    const point = findValidBoundaryPoint(aspect, depth, grid, minRadius, scenePower);
    const preIter = computePreIterEstimate(point.cx, point.cy, point.r, aspect, scenePower, rows, cols);

    self.postMessage({
      type: "picked",
      id,
      cx: point.cx,
      cy: point.cy,
      r: point.r,
      power: scenePower,
      preIter
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function findValidBoundaryPoint(aspect, depth, grid, minRadius, scenePower) {
  let fallback = null;

  for (let attempt = 0; attempt < MAX_PICK_RETRIES; attempt += 1) {
    const point = pickBoundaryPoint(aspect, depth, grid, minRadius, scenePower);
    fallback = point;
    if (Math.abs(point.cy) > MIN_CY_ABS) {
      return point;
    }
  }

  return fallback || { cx: -0.75, cy: 0.3, r: minRadius };
}

function pickBoundaryPoint(aspect, depth, grid, minRadius, scenePower) {
  const rows = grid;
  const cols = grid;
  const inside = new Uint8Array(rows * cols);
  const boundaryI = [];
  const boundaryJ = [];

  let cx = -0.75;
  let cy = 0.0;
  let r = 1.25;
  let maxIter = 100;

  for (let level = 0; level < depth && r > minRadius; level += 1) {
    boundaryI.length = 0;
    boundaryJ.length = 0;

    const xCoord = new Float64Array(cols);
    const yCoord = new Float64Array(rows);

    for (let i = 0; i < cols; i += 1) {
      xCoord[i] = cx + mapValue(i, 0, cols, -r, r);
    }
    for (let j = 0; j < rows; j += 1) {
      yCoord[j] = cy + mapValue(j, 0, rows, r, -r) * aspect;
    }

    for (let j = 0; j < rows; j += 1) {
      const y0 = yCoord[j];
      const rowOffset = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const x0 = xCoord[i];
        inside[rowOffset + i] = escapesAfterMaxIter(x0, y0, maxIter, scenePower) ? 0 : 1;
      }
    }

    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (onBoundary(inside, cols, rows, i, j)) {
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

    cx = cx + mapValue(i, 0, cols, -r, r);
    cy = cy + mapValue(j, 0, rows, r, -r) * aspect;
    r /= 4.0;
    maxIter += 100;
  }

  if (r < minRadius) {
    r = minRadius;
  }

  return { cx, cy, r };
}

function escapesAfterMaxIter(x0, y0, maxIter, scenePower) {
  let x = x0;
  let y = y0;
  let n = 0;

  while (x * x + y * y <= 4.0 && n < maxIter) {
    const iter = iterateComplexPower(x, y, x0, y0, scenePower);
    x = iter.x;
    y = iter.y;
    n += 1;
  }

  return n < maxIter;
}

function onBoundary(map, cols, rows, i, j) {
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

function computePreIterEstimate(centerX, centerY, radius, aspect, scenePower, rows, cols) {
  const coarseCols = Math.max(16, Math.min(PREITER_MAX_COLS, cols));
  const coarseRows = Math.max(16, Math.min(PREITER_MAX_ROWS, rows));

  const xCoord = new Float64Array(coarseCols);
  const yCoord = new Float64Array(coarseRows);

  for (let i = 0; i < coarseCols; i += 1) {
    xCoord[i] = centerX + mapValue(i, 0, coarseCols, -radius, radius);
  }
  for (let j = 0; j < coarseRows; j += 1) {
    yCoord[j] = centerY + mapValue(j, 0, coarseRows, radius, -radius) * aspect;
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
