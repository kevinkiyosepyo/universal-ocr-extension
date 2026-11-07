import { MAX_FILE_BYTES, pixelCrop, scaledSize, estimateTextScale } from './geometry.js';

export async function fileDataURL(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, BMP, or GIF image. For a PDF, capture its visible page.');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('This image is over 15 MB. Resize it or select a smaller region.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export async function decodeImage(dataURL) {
  if (!/^data:image\/(png|jpeg|webp|bmp|gif);base64,/i.test(dataURL)) throw new Error('Unsupported image data.');
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Image loading timed out.')), 15_000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('Image loading failed.')); };
      image.src = dataURL;
    });
  } catch { throw new Error('This image could not be decoded. Try another file.'); }
  if (image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error('This image is too large. Resize it below 80 megapixels.');
  return image;
}

function canvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

export async function cropImage(dataURL, crop, viewport) {
  const image = await decodeImage(dataURL);
  const rect = pixelCrop(crop, viewport, { width: image.naturalWidth, height: image.naturalHeight });
  const out = canvas(rect.width, rect.height);
  out.getContext('2d').drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return out.toDataURL('image/png');
}

export async function rotateImage(dataURL) {
  const image = await decodeImage(dataURL);
  const out = canvas(image.naturalHeight, image.naturalWidth);
  const ctx = out.getContext('2d');
  ctx.translate(out.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0);
  return out.toDataURL('image/png');
}

export async function prepareImage(dataURL, processing) {
  const image = await decodeImage(dataURL);
  const size = scaledSize(image.naturalWidth, image.naturalHeight);
  const out = canvas(size.width, size.height);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, out.width, out.height);
  if (processing !== 'original') {
    const pixels = ctx.getImageData(0, 0, out.width, out.height);
    const data = pixels.data;
    const histogram = new Uint32Array(256);
    let border = 0, borderCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = gray; histogram[gray]++;
      const index = i / 4, x = index % out.width, y = Math.floor(index / out.width);
      if (x < 3 || x >= out.width - 3 || y < 3 || y >= out.height - 3) { border += gray; borderCount++; }
    }
    const percentile = (fraction) => {
      let count = 0;
      for (let i = 0; i < 256; i++) { count += histogram[i]; if (count >= out.width * out.height * fraction) return i; }
      return 255;
    };
    const low = percentile(0.01), high = percentile(0.99);
    const inverted = border / borderCount < 120;
    for (let i = 0; i < data.length; i += 4) {
      let value = high - low > 30 ? Math.max(0, Math.min(255, (data[i] - low) * 255 / (high - low))) : data[i];
      if (inverted) value = 255 - value;
      if (processing === 'contrast') value = value < 150 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  const pixels = ctx.getImageData(0, 0, out.width, out.height);
  let lightest = 0, darkest = 255;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
    lightest = Math.max(lightest, gray); darkest = Math.min(darkest, gray);
  }
  if (lightest - darkest < 2) return null;
  const normalized = scaledSize(out.width, out.height, 24, estimateTextScale(pixels.data, out.width, out.height));
  const padded = canvas(normalized.width + 48, normalized.height + 48);
  const padCtx = padded.getContext('2d');
  padCtx.fillStyle = '#ffffff'; padCtx.fillRect(0, 0, padded.width, padded.height);
  padCtx.imageSmoothingQuality = 'high';
  padCtx.drawImage(out, 24, 24, normalized.width, normalized.height);
  return padded;
}
