// Fast path for a provider's two-object horizontal slider canvas. Background
// color comes from the border; separated foreground regions are measured in
// pixel space. Overlapping or additional objects require visual analysis.
export function locateObjectPair({ data, width, height }) {
  if (width < 30 || height < 20 || width > 1200 || height > 300) return null;
  const border = [[], [], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) border[c].push(data[offset + c]);
  }
  const background = border.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  const columns = Array.from({ length: width }, () => ({ count: 0, top: height, bottom: -1 }));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 180 || Math.max(...background.map((value, c) => Math.abs(data[offset + c] - value))) < 45) continue;
    columns[x].count++; columns[x].top = Math.min(columns[x].top, y); columns[x].bottom = y;
  }
  const runs = []; let start = null, last = null;
  for (let x = 0; x <= width; x++) {
    if (x < width && columns[x].count >= Math.max(2, height * .04)) { start ??= x; last = x; }
    if (start !== null && (x === width || x - last > 2)) {
      const group = columns.slice(start, last + 1), top = Math.min(...group.map(c => c.top)), bottom = Math.max(...group.map(c => c.bottom));
      if (last - start >= 10 && bottom - top >= 10 && group.reduce((n, c) => n + c.count, 0) >= 60) runs.push({ left: start, right: last, top, bottom });
      start = last = null;
    }
  }
  if (runs.length !== 2 || runs.some(r => r.right - r.left > width * .45) || Math.abs((runs[0].top + runs[0].bottom) - (runs[1].top + runs[1].bottom)) > height * .5) return null;
  const gap = runs[1].left - runs[0].right - 1;
  if (gap < 3) return null;
  return { points: runs.map(r => ({ x: (r.left + r.right) / 2 / width, y: (r.top + r.bottom) / 2 / height })), confidence: Math.min(.98, .85 + gap / 100), method: 'foreground-regions' };
}
