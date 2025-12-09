// src/nest-analysis/nest-heatmap.ts
import { MapBounds, ObservationPoint } from "./shapefile";

const NEAR_WATER_RADIUS_PX = 10;

export interface HeatmapConfig {
  // Ecologische wegingen
  treeScore: number;      // bijv. 1.0
  grassScore: number;     // bijv. 0.15
  nearWaterBonus: number; // bijv. 0.1
  wObs?: number;          // weging observatiedichtheid t.o.v. ecologie (0–1)
  treeColor: { r: number; g: number; b: number };
  grassColor: { r: number; g: number; b: number };
  waterColor: { r: number; g: number; b: number };
  treeTolerance?: number;
  grassTolerance?: number;
  waterTolerance?: number;

  // Geometrie / afstanden
  smoothPixels: number;      // smoothingradius in pixels (bijv. 20)

  // Max afstand vanaf waarneming in pixels voor masker + coverage
  coveragePx: number;        // bijv. 90

  // Iso-contour levels (waarden tussen 0 en 1)
  isoLevels: number[];       // bijv. [0.5, 0.75, 0.9]

  // Heatmapkleur (overlay)
  heatColor: { r: number; g: number; b: number }; // bijv. paars: { r: 180, g: 0, b: 200 }

  // Visualisatie tuning
  minAlpha: number; // minimale overlay alpha (0–255), bijv. 80
  gamma: number;    // gamma voor score -> intensiteit, bijv. 0.6
}

export interface HeatmapResult {
  heatmapCanvas: HTMLCanvasElement; // basiskaart + heat overlay
  isoCanvas: HTMLCanvasElement;     // heatmap + iso-lijnen
}

/**
 * HTMLImageElement -> ImageData
 */
function imageToImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to get 2D context for image.");
  }
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * RGB -> HSL (h in graden, s & l in 0–100).
 */
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = d / (1 - Math.abs(2 * l - 1));

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h *= 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

/**
 * Heuristische "tekstachtige" detectie:
 * pixels die wel als bosgroen gelden maar in een heel dun cluster zitten
 * (lage bosdichtheid in radius) worden als tekst gezien.
 */
function isTextLike(
  x: number,
  y: number,
  treeMask: Uint8Array,
  width: number,
  height: number
): boolean {
  const rad = 3;
  let count = 0;

  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (treeMask[ny * width + nx] === 1) {
        count++;
      }
    }
  }

  // Tekst is dun → lage dichtheid. Bosvakken hebben veel hogere dichtheid.
  return count < 25;
}

/**
 * 1D Gaussiaankernel.
 */
function makeGaussianKernel(radiusPx: number): Float32Array {
  const size = radiusPx * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma = radiusPx / 2 || 1;
  const mid = radiusPx;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - mid;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }

  if (sum === 0) {
    for (let i = 0; i < size; i++) kernel[i] = 1 / size;
  } else {
    for (let i = 0; i < size; i++) kernel[i] /= sum;
  }

  return kernel;
}

/**
 * 2D Gaussian blur via twee 1D convoluties.
 */
function gaussianBlur2D(
  field: Float32Array,
  width: number,
  height: number,
  radiusPx: number
): Float32Array {
  if (radiusPx <= 0) return field.slice();

  const kernel = makeGaussianKernel(radiusPx);
  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const idx = (x: number, y: number) => y * width + x;

  // Horizontale pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radiusPx; k <= radiusPx; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        acc += field[idx(sx, y)] * kernel[k + radiusPx];
      }
      temp[idx(x, y)] = acc;
    }
  }

  // Verticale pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radiusPx; k <= radiusPx; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        acc += temp[idx(x, sy)] * kernel[k + radiusPx];
      }
      out[idx(x, y)] = acc;
    }
  }

  return out;
}

/**
 * Hoofdfunctie: compute heatmap + iso-score canvas.
 */
export function computeNestHeatmap(
  baseImg: HTMLImageElement,
  observations: ObservationPoint[],
  mapBounds: MapBounds,
  config: HeatmapConfig
): HeatmapResult {
  if (!observations.length) {
    throw new Error("No observation points provided.");
  }

  const baseData = imageToImageData(baseImg);

  const baseW = baseData.width;
  const baseH = baseData.height;

  const basePixels = baseData.data;

  const idxBase = (x: number, y: number) => (y * baseW + x) * 4;
  const idxDomain = (x: number, y: number) => y * baseW + x;

  const widthUnits = mapBounds.maxX - mapBounds.minX;
  const heightUnits = mapBounds.maxY - mapBounds.minY;
  if (widthUnits <= 0 || heightUnits <= 0) {
    throw new Error("Invalid map bounds (width/height <= 0).");
  }

  // Map real-world coords to pixel coords on the base image
  const mapToPixel = (p: ObservationPoint) => ({
    x: ((p.x - mapBounds.minX) / widthUnits) * baseW,
    y: baseH - ((p.y - mapBounds.minY) / heightUnits) * baseH
  });

  const centroidsBase = observations
    .map(mapToPixel)
    .filter(c => Number.isFinite(c.x) && Number.isFinite(c.y))
    .filter(c => c.x >= 0 && c.x < baseW && c.y >= 0 && c.y < baseH);

  if (centroidsBase.length === 0) {
    throw new Error("No observation points fall within the provided bounds.");
  }

  const coverageRadiusPx = Math.max(1, config.coveragePx);
  const coverageRadiusSq = coverageRadiusPx * coverageRadiusPx;

  // 2b) Domain mask: unie van cirkels rond elke waarneming
  const domainMask = new Uint8Array(baseW * baseH);

  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const i = idxDomain(x, y);

      for (const c of centroidsBase) {
        const dx = x - c.x;
        const dy = y - c.y;
        if (dx * dx + dy * dy <= coverageRadiusSq) {
          domainMask[i] = 1;
          break;
        }
      }
    }
  }

  // 3) Ecologische score (bos, gras, waterbonus) in twee passes:
  //    1) voorlopige bosdetectie (kleur) + gras + water
  //    2) tekstfilter op bosmasker (structureel) en eco-score invullen

  const eco = new Float32Array(baseW * baseH);
  const waterMask = new Uint8Array(baseW * baseH);
  const prelimTreeMask = new Uint8Array(baseW * baseH);
  const grassMask = new Uint8Array(baseW * baseH);

  // HSL-based classification (spec ranges), tolerances expand the ranges.
  const hTreeMin = 80;
  const hTreeMax = 150;
  const sTreeMin = 10;
  const sTreeMax = 55;
  const lTreeMin = 20;
  const lTreeMax = 55;

  const hGrassMin = 70;
  const hGrassMax = 140;
  const sGrassMin = 40;
  const lGrassMin = 55;

  const tolTree = Math.min(40, Math.max(0, (config.treeTolerance ?? 0) / 2));   // degrees / %
  const tolGrass = Math.min(40, Math.max(0, (config.grassTolerance ?? 0) / 2));
  const tolWater = Math.min(60, Math.max(0, config.waterTolerance ?? 32));

  // 3a) Eerste pass: kleur-gebaseerde classificatie
  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const iBase = idxBase(x, y);
      const r = basePixels[iBase];
      const g = basePixels[iBase + 1];
      const b = basePixels[iBase + 2];

      const { h, s, l } = rgbToHsl(r, g, b);

      const isWater = b > g + 15 + tolWater * 0.25 && b > r + 15 + tolWater * 0.25;

      const prelimIsTree =
        h >= hTreeMin - tolTree && h <= hTreeMax + tolTree &&
        s >= sTreeMin - tolTree && s <= sTreeMax + tolTree &&
        l >= lTreeMin - tolTree && l <= lTreeMax + tolTree;

      const prelimIsGrass =
        !prelimIsTree &&
        h >= hGrassMin - tolGrass && h <= hGrassMax + tolGrass &&
        s >= sGrassMin - tolGrass &&
        l >= lGrassMin - tolGrass;

      const i = idxDomain(x, y);

      if (isWater) {
        waterMask[i] = 1;
      }

      if (prelimIsTree && !isWater) {
        prelimTreeMask[i] = 1;
      } else {
        prelimTreeMask[i] = 0;
      }

      if (!prelimIsTree && prelimIsGrass && !isWater) {
        grassMask[i] = 1;
      } else {
        grassMask[i] = 0;
      }
    }
  }

  // 3b) Tweede pass: tekstfilter op het bosmasker
  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const i = idxDomain(x, y);
      if (prelimTreeMask[i] !== 1) continue;

      if (isTextLike(x, y, prelimTreeMask, baseW, baseH)) {
        // Verwijder tekstachtige pixels uit bosmasker
        prelimTreeMask[i] = 0;
      }
    }
  }

  // 3c) Eco-score invullen op basis van refined bosmasker / gras / water
  for (let i = 0; i < eco.length; i++) {
    if (waterMask[i] === 1) {
      // Op water kan geen nest liggen
      eco[i] = 0;
    } else if (prelimTreeMask[i] === 1) {
      eco[i] = config.treeScore;
    } else if (grassMask[i] === 1) {
      eco[i] = config.grassScore;
    } else {
      eco[i] = 0;
    }
  }

  // Bonus nabij water: vast aantal pixels (kaart-overlay focus)
  const nearWaterRadius = Math.max(1, NEAR_WATER_RADIUS_PX);
  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const i = idxDomain(x, y);
      if (waterMask[i] !== 1) continue;

      for (let dy = -nearWaterRadius; dy <= nearWaterRadius; dy++) {
        for (let dx = -nearWaterRadius; dx <= nearWaterRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= baseW || ny >= baseH) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 > nearWaterRadius * nearWaterRadius) continue;

          const j = idxDomain(nx, ny);

          // geen bonus op water zelf
          if (waterMask[j] === 1) continue;

          if (eco[j] < config.nearWaterBonus) {
            eco[j] = config.nearWaterBonus;
          }
        }
      }
    }
  }

  // 4) Coverage: fractie waarnemingen binnen coverageRadius
  const coverage = new Float32Array(baseW * baseH);

  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const i = idxDomain(x, y);
      if (!domainMask[i]) continue;

      let count = 0;
      for (const c of centroidsBase) {
        const dx = x - c.x;
        const dy = y - c.y;
        if (dx * dx + dy * dy <= coverageRadiusSq) {
          count++;
        }
      }

      coverage[i] = count / centroidsBase.length;
    }
  }

  // 5) Combineer eco * coverage → rawScore
  const rawScore = new Float32Array(baseW * baseH);
  let maxRaw = 0;

  // observationWeight bepaalt hoe sterk waarnemingsdichtheid meetelt
  // 0   => alleen ecologie (coverage wordt genegeerd)
  // 1   => volledig huidige gedrag (eco * coverage)
  // 0.5 => half-half: eco * (0.5 + 0.5 * coverage)
  const wObs = Math.min(1, Math.max(0, config.wObs ?? 0.8));

  for (let i = 0; i < rawScore.length; i++) {
    if (!domainMask[i] || eco[i] <= 0) {
      rawScore[i] = 0;
      continue;
    }

    const cov = coverage[i];
    const covFactor = Math.max(0, (1 - wObs) + wObs * cov);
    const v = eco[i] * covFactor;

    rawScore[i] = v;
    if (v > maxRaw) maxRaw = v;
  }
  if (maxRaw === 0) maxRaw = 1;

  const normScore = new Float32Array(baseW * baseH);
  for (let i = 0; i < rawScore.length; i++) {
    normScore[i] = rawScore[i] / maxRaw;
  }

  // 6) Lokale smoothing op basis van pixels
  const radiusSmoothPx = Math.max(1, Math.round(config.smoothPixels));

  const localScore = gaussianBlur2D(normScore, baseW, baseH, radiusSmoothPx);

  // Renormaliseren binnen domainMask
  let localMax = 0;
  for (let i = 0; i < localScore.length; i++) {
    if (domainMask[i] && localScore[i] > localMax) {
      localMax = localScore[i];
    }
  }
  if (localMax === 0) localMax = 1;

  const localNorm = new Float32Array(baseW * baseH);
  for (let i = 0; i < localScore.length; i++) {
    localNorm[i] = localScore[i] / localMax;
  }

  // 7) Render basis heatmap (basiskaart + paarse overlay)
  const heatmapCanvas = document.createElement("canvas");
  heatmapCanvas.width = baseW;
  heatmapCanvas.height = baseH;
  const heatCtx = heatmapCanvas.getContext("2d");
  if (!heatCtx) throw new Error("Could not get 2D context for heatmap.");

  heatCtx.putImageData(baseData, 0, 0);
  const heatOverlay = heatCtx.getImageData(0, 0, baseW, baseH);
  const outPixels = heatOverlay.data;

  for (let y = 0; y < baseH; y++) {
    for (let x = 0; x < baseW; x++) {
      const id = idxDomain(x, y);
      const sVal = localNorm[id];
      if (sVal <= 0) continue;

      const v = Math.pow(sVal, config.gamma);
      const alpha = Math.max(config.minAlpha, Math.round(v * 255));
      const a = alpha / 255;

      const j = idxBase(x, y);
      const r0 = basePixels[j];
      const g0 = basePixels[j + 1];
      const b0 = basePixels[j + 2];

      const outIdx = id * 4;
      outPixels[outIdx]     = Math.round(r0 * (1 - a) + config.heatColor.r * a);
      outPixels[outIdx + 1] = Math.round(g0 * (1 - a) + config.heatColor.g * a);
      outPixels[outIdx + 2] = Math.round(b0 * (1 - a) + config.heatColor.b * a);
      outPixels[outIdx + 3] = 255;
    }
  }

  heatCtx.putImageData(heatOverlay, 0, 0);

  // 7b) Teken witte kruisjes op alle registratie-centroids op de heatmap
  heatCtx.fillStyle = "white";
  for (const c of centroidsBase) {
    const x = Math.round(c.x);
    const y = Math.round(c.y);

    // 1px kruis: centrum + 4 armen
    heatCtx.fillRect(x,     y,     1, 1);
    heatCtx.fillRect(x - 1, y,     1, 1);
    heatCtx.fillRect(x + 1, y,     1, 1);
    heatCtx.fillRect(x,     y - 1, 1, 1);
    heatCtx.fillRect(x,     y + 1, 1, 1);
  }

  // 8) Render iso-lijnen bovenop heatmap
  const isoCanvas = document.createElement("canvas");
  isoCanvas.width = baseW;
  isoCanvas.height = baseH;
  const isoCtx = isoCanvas.getContext("2d");
  if (!isoCtx) throw new Error("Could not get 2D context for iso canvas.");

  isoCtx.drawImage(heatmapCanvas, 0, 0);
  const isoData = isoCtx.getImageData(0, 0, baseW, baseH);
  const isoPixels = isoData.data;

  const kernel3x3 = [
    [0, 1, 0],
    [1, 1, 1],
    [0, 1, 0]
  ];

  const levels = config.isoLevels ?? [];

  for (const lvl of levels) {
    if (!(lvl > 0 && lvl < 1)) continue;

    const binary = new Uint8Array(baseW * baseH);
    for (let i = 0; i < binary.length; i++) {
      binary[i] = localNorm[i] >= lvl ? 1 : 0;
    }

    const eroded = new Uint8Array(baseW * baseH);

    for (let y = 0; y < baseH; y++) {
      for (let x = 0; x < baseW; x++) {
        const id = idxDomain(x, y);
        if (!binary[id]) continue;

        let ok = true;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            if (kernel3x3[ky + 1][kx + 1] === 0) continue;
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || ny < 0 || nx >= baseW || ny >= baseH) continue;
            const nid = idxDomain(nx, ny);
            if (!binary[nid]) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
        }

        if (ok) {
          eroded[id] = 1;
        }
      }
    }

    // edges = binary & !eroded
    for (let y = 0; y < baseH; y++) {
      for (let x = 0; x < baseW; x++) {
        const id = idxDomain(x, y);
        if (binary[id] && !eroded[id]) {
          const p = id * 4;
          isoPixels[p]     = 180;
          isoPixels[p + 1] = 180;
          isoPixels[p + 2] = 180;
          isoPixels[p + 3] = 255;
        }
      }
    }
  }

  isoCtx.putImageData(isoData, 0, 0);

  // 8b) Ook op de iso-kaart de witte kruisjes tonen
  isoCtx.fillStyle = "white";
  for (const c of centroidsBase) {
    const x = Math.round(c.x);
    const y = Math.round(c.y);

    isoCtx.fillRect(x,     y,     1, 1);
    isoCtx.fillRect(x - 1, y,     1, 1);
    isoCtx.fillRect(x + 1, y,     1, 1);
    isoCtx.fillRect(x,     y - 1, 1, 1);
    isoCtx.fillRect(x,     y + 1, 1, 1);
  }

  return {
    heatmapCanvas,
    isoCanvas
  };
}
