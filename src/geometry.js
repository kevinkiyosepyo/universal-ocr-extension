export const MAX_PIXELS = 20_000_000;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function pixelCrop(crop, viewport, image) {
  if (!crop) return { x: 0, y: 0, width: image.width, height: image.height };
  const values = [crop.x, crop.y, crop.width, crop.height, viewport?.width, viewport?.height, image.width, image.height];
  if (!values.every(Number.isFinite) || crop.width <= 0 || crop.height <= 0 ||
      viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    throw new Error('The selection is invalid. Select the region again.');
  }
  const x = Math.max(0, Math.floor(crop.x * image.width / viewport.width));
  const y = Math.max(0, Math.floor(crop.y * image.height / viewport.height));
  const right = Math.min(image.width, Math.ceil((crop.x + crop.width) * image.width / viewport.width));
  const bottom = Math.min(image.height, Math.ceil((crop.y + crop.height) * image.height / viewport.height));
  if (right <= x || bottom <= y) throw new Error('The selection is outside the image.');
  return { x, y, width: right - x, height: bottom - y };
}

export function scaledSize(width, height, padding = 24, desiredScale = 1) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('This image has invalid dimensions.');
  }
  // Budget includes the white border; large inputs are reduced instead of exhausting memory.
  const border = padding * 2;
  const area = width * height;
  const linear = border * (width + height);
  const areaScale = (2 * (MAX_PIXELS - border * border)) / (linear + Math.sqrt(linear * linear + 4 * area * (MAX_PIXELS - border * border)));
  const scale = Math.min(3, Math.max(0.1, desiredScale), areaScale, 8192 / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// Estimate printed line height from horizontal ink bands. Large glyphs need shrinking,
// while very small glyphs benefit from enlargement. Blank/photo-like inputs stay unchanged.
export function estimateTextScale(data, width, height) {
  const bands = [];
  let start = -1, lastInk = -1;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114 < 128) ink++;
    }
    const hasInk = ink >= Math.max(2, width * 0.008) && ink < width * 0.85;
    if (hasInk) { if (start < 0) start = y; lastInk = y; }
    if (start >= 0 && (y - lastInk > 2 || y === height - 1)) {
      const band = lastInk - start + 1;
      if (band >= 4 && band < height * 0.9) bands.push(band);
      start = -1;
    }
  }
  if (!bands.length) return 1;
  bands.sort((a, b) => a - b);
  return Math.max(0.25, Math.min(3, 42 / bands[Math.floor(bands.length / 2)]));
}

export function selectionRect(start, end, viewport) {
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  const x1 = clamp(start.x, viewport.width), x2 = clamp(end.x, viewport.width);
  const y1 = clamp(start.y, viewport.height), y2 = clamp(end.y, viewport.height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
