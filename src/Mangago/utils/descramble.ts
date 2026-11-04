/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type MangagoImageContext } from "../models";
import { base64ToArrayBuffer } from "./crypto";

// Persist each image's descramble context keyed by its fragment-less URL, so a
// retry that drops the "#desckey=...&cols=..." fragment can still descramble.
const IMAGE_CONTEXT_STATE_PREFIX = "mangago-image-context:";

function cleanUrl(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function readSavedImageContext(url: string): MangagoImageContext | null {
  const raw = Application.getState(`${IMAGE_CONTEXT_STATE_PREFIX}${cleanUrl(url)}`) as
    | { desckey?: unknown; cols?: unknown }
    | undefined;

  const desckey = typeof raw?.desckey === "string" ? raw.desckey : undefined;
  const cols = typeof raw?.cols === "number" ? raw.cols : undefined;

  if (!desckey || !cols || cols <= 0) return null;

  return { desckey, cols };
}

// Descramble context for an image: the "#desckey=...&cols=..." fragment if present
// (also persisted), else the persisted value from an earlier fragment-carrying load.
export function parseImageContext(url: string): MangagoImageContext | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return readSavedImageContext(url);

  const fragment = url.slice(hashIndex + 1);

  // Parse the fragment by hand (URLSearchParams isn't guaranteed on-device).
  const fragmentParams = new Map<string, string>();
  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    try {
      fragmentParams.set(key, decodeURIComponent(value));
    } catch {
      fragmentParams.set(key, value);
    }
  }

  const desckey = fragmentParams.get("desckey");
  const colsRaw = fragmentParams.get("cols");

  if (!desckey || !colsRaw) return readSavedImageContext(url);

  const cols = Number(colsRaw);
  if (!Number.isFinite(cols) || cols <= 0) return readSavedImageContext(url);

  Application.setState({ desckey, cols }, `${IMAGE_CONTEXT_STATE_PREFIX}${cleanUrl(url)}`);
  return { desckey, cols };
}

function decodeDataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid data URL");

  return base64ToArrayBuffer(dataUrl.slice(comma + 1));
}

async function loadImageFromBuffer(data: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  const encoded = Application.base64Encode(data);
  const b64 = typeof encoded === "string" ? encoded : Application.arrayBufferToASCIIString(encoded);
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const img = new Image();

  // Settle once across every Image-polyfill behaviour (sync-complete, async
  // onload/onerror, or neither). The timer is a settle-guard against a polyfill
  // that never fires a callback; setTimeout isn't guaranteed, so it's typeof-guarded.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined && typeof clearTimeout === "function") clearTimeout(timer);
      action();
    };
    if (typeof setTimeout === "function") {
      timer = setTimeout(() => done(() => reject(new Error("image load timed out"))), 10000);
    }
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new Error("Image load failed")));
    img.src = dataUrl;
    if (img.complete && img.naturalWidth > 0) {
      done(() => resolve(img));
    }
  });
}

export async function descrambleMangagoImage(
  data: ArrayBuffer,
  key: string,
  cols: number,
  mimeType: string,
): Promise<ArrayBuffer> {
  const src = await loadImageFromBuffer(data, mimeType);

  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;

  const unitWidth = Math.floor(width / cols);
  const unitHeight = Math.floor(height / cols);

  if (unitWidth <= 0 || unitHeight <= 0) {
    throw new Error(`Invalid tile size for ${width}x${height}, cols=${cols}`);
  }

  const keyArray = key.split("a").map((x) => {
    const n = Number(x || "0");
    return Number.isFinite(n) ? n : 0;
  });

  if (keyArray.length < cols * cols) {
    throw new Error(`Invalid key array length ${keyArray.length}, expected ${cols * cols}`);
  }

  const canvas = new HTMLCanvasElement();
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");

  ctx.drawImage(src, 0, 0, width, height);

  // Permute tiles in the pixel buffer: the polyfill's 9-arg drawImage no-ops, and
  // its getImageData/putImageData are Y-up, so flip to Y-down, permute, flip back.
  // Pre-copying keeps the floor() remainder strip outside the cols×cols grid intact.
  const stride = width * 4;
  const srcYup = ctx.getImageData(0, 0, width, height).data;
  const srcStd = new Uint8ClampedArray(srcYup.length);
  for (let y = 0; y < height; y++) {
    srcStd.set(srcYup.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  const dstStd = new Uint8ClampedArray(srcStd);

  const rowBytes = unitWidth * 4;
  for (let idx = 0; idx < cols * cols; idx++) {
    const keyval = keyArray[idx] ?? 0;

    const srcRow = Math.floor(idx / cols);
    const srcCol = idx - srcRow * cols;

    const destRow = Math.floor(keyval / cols);
    const destCol = keyval - destRow * cols;

    for (let y = 0; y < unitHeight; y++) {
      const srcOff = ((srcRow * unitHeight + y) * width + srcCol * unitWidth) * 4;
      const dstOff = ((destRow * unitHeight + y) * width + destCol * unitWidth) * 4;
      dstStd.set(srcStd.subarray(srcOff, srcOff + rowBytes), dstOff);
    }
  }

  const dstYup = new Uint8ClampedArray(dstStd.length);
  for (let y = 0; y < height; y++) {
    dstYup.set(dstStd.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  ctx.putImageData(new ImageData(dstYup, width, height), 0, 0);

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
}
