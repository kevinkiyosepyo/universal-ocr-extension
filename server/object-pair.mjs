// Fast path for a provider's two-object horizontal slider canvas. Color comes
// from the border. Connected regions distinguish stacked objects that share
// the same columns; enclosed details such as an icon's eyes stay with the icon.
export function locateObjectPair({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 30 || height < 20 || width > 1200 || height > 300 || data?.length !== width * height * 4) return null;
  const border = [[], [], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) border[c].push(data[offset + c]);
  }
  const background = border.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  const difference = offset => Math.max(Math.abs(data[offset] - background[0]), Math.abs(data[offset + 1] - background[1]), Math.abs(data[offset + 2] - background[2]));
  const foreground = new Uint8Array(width * height), stack = new Uint32Array(width * height);
  for (let i = 0; i < foreground.length; i++) if (data[i * 4 + 3] >= 180 && difference(i * 4) >= 45) foreground[i] = 1;
  const components = [];
  for (let start = 0; start < foreground.length; start++) {
    if (!foreground[start]) continue;
    let pending = 1, count = 0, left = width, right = -1, top = height, bottom = -1;
    stack[0] = start; foreground[start] = 0;
    while (pending) {
      const pixel = stack[--pending], x = pixel % width, y = Math.floor(pixel / width);
      count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (foreground[neighbor]) { foreground[neighbor] = 0; stack[pending++] = neighbor; }
      }
    }
    if (count >= 60) components.push({ left, right, top, bottom, count });
  }
  const regions = [];
  for (const region of components.sort((a, b) => b.count - a.count)) {
    if (regions.some(other => other.count > region.count && other.left <= region.left && other.right >= region.right && other.top <= region.top && other.bottom >= region.bottom)) continue;
    regions.push(region); if (regions.length > 2) return null;
  }
  if (regions.length !== 2 || regions.some(region => region.right - region.left < 10 || region.bottom - region.top < 10)) return null;
  regions.sort((a, b) => a.left - b.left);
  if (regions.some(r => r.right - r.left > width * .45) || Math.abs((regions[0].top + regions[0].bottom) - (regions[1].top + regions[1].bottom)) > height * .5) return null;
  const gap = regions[1].left - regions[0].right - 1;
  if (gap < 3) return null;
  return { points: regions.map(r => ({ x: (r.left + r.right) / 2 / width, y: (r.top + r.bottom) / 2 / height })), confidence: Math.min(.98, .85 + gap / 100), method: 'foreground-regions' };
}
