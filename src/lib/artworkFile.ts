// src/lib/artworkFile.ts
// Opens a PNG, JPG, WebP or PDF in the browser and draws the cropped part at
// print size, so a 21 MB CorelDRAW PDF leaves the computer as ~400 KB.
// The PDF reader (Mozilla's, public/pdfjs) is fetched only for a PDF.

import { ARTWORK_MAX_BYTES, artworkSize, type Crop } from '@/lib/artwork';

export type OpenPage = {
  width: number; height: number;       // the page's own size
  preview: string;                     // object URL
  draw: (crop: Crop) => Promise<HTMLCanvasElement>;
  close: () => void;
};
export type OpenFile = { name: string; pages: number; page: (n: number) => Promise<OpenPage>; close: () => void };

export const ARTWORK_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf';
const MAX_SOURCE = 100 * 1024 * 1024;
const PREVIEW_PX = 1000;

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

function sheet(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw the artwork');
  ctx.fillStyle = '#fff'; // transparent artwork prints on white
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));

export async function openArtwork(file: File): Promise<OpenFile> {
  if (file.size > MAX_SOURCE) throw new Error('Choose a file under 100 MB');
  if (isPdf(file)) return openPdf(file);
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPG, WebP or PDF file');

  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image couldn’t be read'); });
  return {
    name: file.name, pages: 1,
    page: async () => {
      const preview = URL.createObjectURL(file);
      return {
        width: bitmap.width, height: bitmap.height, preview,
        draw: async (crop) => {
          const size = artworkSize(bitmap, crop);
          const { canvas, ctx } = sheet(size.width, size.height);
          ctx.drawImage(bitmap, crop.x * bitmap.width, crop.y * bitmap.height, crop.w * bitmap.width, crop.h * bitmap.height,
            0, 0, size.width, size.height);
          return canvas;
        },
        close: () => URL.revokeObjectURL(preview),
      };
    },
    close: () => bitmap.close(),
  };
}

async function openPdf(file: File): Promise<OpenFile> {
  // Served as it is, outside the bundle: webpack breaks this module.
  const url = '/pdfjs/pdf.min.mjs';
  const pdfjs = await import(/* webpackIgnore: true */ url) as typeof import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  const doc = await task.promise.catch((e: Error) => {
    throw new Error(e.name === 'PasswordException' ? 'This PDF has a password' : 'This PDF couldn’t be read');
  });
  return {
    name: file.name, pages: doc.numPages,
    page: async (n) => {
      const page = await doc.getPage(n);
      const own = page.getViewport({ scale: 1 });
      const render = async (crop: Crop, width: number, height: number) => {
        const scale = width / (own.width * crop.w);
        const { canvas, ctx } = sheet(width, height);
        await page.render({
          canvasContext: ctx,
          viewport: page.getViewport({ scale, offsetX: -crop.x * own.width * scale, offsetY: -crop.y * own.height * scale }),
        }).promise;
        return canvas;
      };
      const fit = Math.min(PREVIEW_PX / own.width, PREVIEW_PX / own.height);
      const small = await render({ x: 0, y: 0, w: 1, h: 1 }, Math.round(own.width * fit), Math.round(own.height * fit));
      const blob = await toBlob(small, 'image/webp', 0.8);
      if (!blob) throw new Error('This PDF couldn’t be drawn');
      const preview = URL.createObjectURL(blob);
      return {
        width: own.width, height: own.height, preview,
        // Vectors have no pixels of their own, so a small crop may be drawn larger.
        draw: (crop) => { const s = artworkSize(own, crop, 10); return render(crop, s.width, s.height); },
        close: () => URL.revokeObjectURL(preview),
      };
    },
    close: () => { task.destroy(); },
  };
}

/** The file to send: WebP, or JPEG where the browser can't write WebP. */
export async function artworkBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.8, 0.65, 0.5]) {
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (blob?.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= ARTWORK_MAX_BYTES) return blob;
  }
  throw new Error('The artwork is too large even when shrunk: crop it closer');
}
