/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const decodePageUrls = (encoded: string): string[] => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const value = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error("RinkoComics returned an invalid encoded page list");
  }
  const input = value.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((input.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;
  for (const character of input) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[position++] = (buffer >> bits) & 0xff;
    }
  }
  if (bytes.length <= 16) throw new Error("RinkoComics returned an empty encoded page list");
  // The site's canvas reader prefixes its JSON with a 16-byte XOR mask.
  const decoded = new Uint8Array(bytes.length - 16);
  for (let index = 0; index < decoded.length; index++) {
    decoded[index] = bytes[index + 16] ^ bytes[index % 16];
  }
  const pages: unknown = JSON.parse(Application.arrayBufferToUTF8String(decoded.buffer));
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.some((page: unknown) => typeof page !== "string" || !/^https?:\/\//i.test(page))
  ) {
    throw new Error("RinkoComics returned an invalid page list");
  }
  return pages as string[];
};
