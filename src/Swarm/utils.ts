/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

const SECRET = "e3bca6f9a7e64e369ddc450bb7ff295b3d78e7d4fcb148c10d10ae9385476a5f";
const utf8Bytes = (value: string): Uint8Array<ArrayBuffer> => {
  const encoded = encodeURIComponent(value),
    bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
};
export const encryptPayload = async (
  value: string,
  iv = crypto.getRandomValues(new Uint8Array(16)),
): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(SECRET));
  const key = await crypto.subtle.importKey("raw", digest, "AES-CBC", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, utf8Bytes(value));
  const hex = (bytes: Uint8Array): string =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex(iv)}:${hex(new Uint8Array(encrypted))}`;
};
