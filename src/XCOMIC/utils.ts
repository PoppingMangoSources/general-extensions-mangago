/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const utf8Bytes = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(++i);
      code = 0x10000 + ((code & 0x3ff) << 10) + (low & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
};

const rotateLeft = (value: number, amount: number): number =>
  ((value << amount) | (value >>> (32 - amount))) >>> 0;

const md5 = (input: Uint8Array): Uint8Array => {
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >>> 6) + 1) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;

  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0,
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const nextD = c;
      c = b;
      const sum = (a + f + constants[i]! + words[g]!) >>> 0;
      b = (b + rotateLeft(sum, shifts[i]!)) >>> 0;
      a = d;
      d = nextD;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
};

const base64Bytes = (value: string): Uint8Array => {
  const decoded = Application.base64Decode(value);
  if (typeof decoded === "string") {
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(decoded);
};

const deriveOpenSslKey = (
  password: string,
  salt: Uint8Array,
): { key: Uint8Array; iv: Uint8Array } => {
  const passwordBytes = utf8Bytes(password);
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array();
  let length = 0;

  while (length < 48) {
    previous = md5(concatBytes(previous, passwordBytes, salt));
    blocks.push(previous);
    length += previous.length;
  }

  const material = concatBytes(...blocks);
  return { key: material.slice(0, 32), iv: material.slice(32, 48) };
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export const decryptOpenSslAes = async (encrypted: string, password: string): Promise<string> => {
  const payload = base64Bytes(encrypted);
  if (payload.length < 32 || String.fromCharCode(...payload.slice(0, 8)) !== "Salted__") {
    throw new Error("Invalid encrypted chapter payload");
  }

  const { key, iv } = deriveOpenSslKey(password, payload.slice(8, 16));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(payload.slice(16)),
  );
  return Application.arrayBufferToUTF8String(decrypted);
};
