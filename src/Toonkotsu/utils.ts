/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Cookie } from "@paperback/types";

import { READER_SECRET, type ReaderKeyResponse, type ReaderPage } from "./models";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const asciiBytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value, (c) => c.charCodeAt(0));

export const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const clean = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ||
    clean.length % 4 === 1 ||
    (value.includes("=") && value.length % 4 !== 0)
  ) {
    throw new Error("Invalid base64 reader data.");
  }
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    const digit = BASE64.indexOf(character);
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  if (bits && buffer & ((1 << bits) - 1)) throw new Error("Invalid base64 reader data.");
  return bytes.subarray(0, index);
};

export const encodeBase64Url = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const length = Math.min(3, bytes.length - i) + 1;
    for (let j = 0; j < length; j++) out += BASE64[(chunk >> (18 - j * 6)) & 63];
  }
  return out;
};

const xorCycle = (data: Uint8Array, mask: Uint8Array): Uint8Array<ArrayBuffer> =>
  data.map((value, index) => value ^ mask[index % mask.length]!);

export interface ReaderKey {
  key: CryptoKey;
  offset: number;
}

// The served key is masked with a digest of the reader secret; unmasked it is the HMAC key that
// signs chapter requests and unwraps page keys.
export const deriveReaderKey = async (
  response: ReaderKeyResponse,
  secret = READER_SECRET,
): Promise<ReaderKey> => {
  const mask = new Uint8Array(await crypto.subtle.digest("SHA-256", asciiBytes(`sign:${secret}`)));
  const key = await crypto.subtle.importKey(
    "raw",
    xorCycle(decodeBase64Url(response.key), mask),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { key, offset: Number(response.now) - Date.now() || 0 };
};

// Capture the digest input, not the bundle's obfuscated variable names. Chapter requests are
// blocked so recovery never downloads pages; the captured secret is validated by the caller.
export const captureReaderSecret = async (
  html: string,
  url: string,
  response: ReaderKeyResponse,
  cookies: Cookie[],
): Promise<string> => {
  const bootstrap = `
    window.__toonkotsuReaderSecret = new Promise((resolve) => {
      let settled = false;
      const finish = (secret) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(secret);
      };
      const timer = setTimeout(() => finish(""), 15000);
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (algorithm, data) => {
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        if (name.toUpperCase() === "SHA-256") {
          const text = new TextDecoder().decode(data);
          if (text.startsWith("sign:") && text.length > 5) {
            finish(text.slice(5));
            return Promise.reject(new Error("Signing configuration captured"));
          }
        }
        return digest(algorithm, data);
      };
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        if (path === "/api/manga/key") {
          return Promise.resolve(new Response(${JSON.stringify(JSON.stringify(response)).replace(/</g, "\\u003c")}, {
            headers: { "content-type": "application/json" },
          }));
        }
        if (path.startsWith("/api/manga/chapter/")) {
          return Promise.reject(new Error("Chapter loading disabled during signing recovery"));
        }
        return fetch(input, init);
      };
    });
  `;
  const captured = await Application.executeInWebView({
    source: {
      html: `<script>${bootstrap}</script>${html}`,
      baseUrl: url,
      loadCSS: false,
      loadImages: false,
      userAgent: await Application.getDefaultUserAgent(),
    },
    inject: "return window.__toonkotsuReaderSecret;",
    storage: { cookies },
  });
  if (typeof captured.result !== "string" || !captured.result) {
    throw new Error(
      "Could not recover Toonkotsu's signing configuration. The source may need an update.",
    );
  }
  return captured.result;
};

const hmac = async (readerKey: ReaderKey, message: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.sign("HMAC", readerKey.key, asciiBytes(message)));

export const signReaderPath = async (readerKey: ReaderKey, path: string): Promise<string> => {
  const time = String(Date.now() + readerKey.offset);
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const signature = encodeBase64Url(await hmac(readerKey, `${time}.${nonce}.${path}`));
  return `v1.${time}.${nonce}.${signature.slice(0, 32)}`;
};

// A "v1" wrapped chapter masks each page key with an HMAC of that page's nonce.
export const unwrapPageKey = async (readerKey: ReaderKey, page: ReaderPage): Promise<string> =>
  encodeBase64Url(
    xorCycle(decodeBase64Url(page.k ?? ""), await hmac(readerKey, `page.${page.n ?? ""}`)),
  );

const SBOX = new Uint8Array(256);
const MIX = [0, 1, 2, 3].map(() => new Uint32Array(256));

{
  const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));
  let x = 0;
  let xi = 0;
  for (let i = 0; i < 256; i++) {
    let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    SBOX[x] = sx;
    const x2 = double[x]!;
    const x8 = double[double[x2]!]!;
    const t = (double[sx]! * 0x101) ^ (sx * 0x1010100);
    MIX[0]![x] = (t << 24) | (t >>> 8);
    MIX[1]![x] = (t << 16) | (t >>> 16);
    MIX[2]![x] = (t << 8) | (t >>> 24);
    MIX[3]![x] = t;
    if (x === 0) {
      x = xi = 1;
    } else {
      x = x2 ^ double[double[double[x8 ^ x2]!]!]!;
      xi ^= double[double[xi]!]!;
    }
  }
}

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

const subWord = (t: number): number =>
  (SBOX[t >>> 24]! << 24) |
  (SBOX[(t >>> 16) & 0xff]! << 16) |
  (SBOX[(t >>> 8) & 0xff]! << 8) |
  SBOX[t & 0xff]!;

const expandKey = (key: Uint8Array): Uint32Array => {
  const words = key.length / 4;
  if (![4, 6, 8].includes(words)) throw new Error(`Unsupported page key length ${key.length}`);
  const schedule = new Uint32Array((words + 7) * 4);
  for (let i = 0; i < schedule.length; i++) {
    if (i < words) {
      schedule[i] =
        (key[i * 4]! << 24) | (key[i * 4 + 1]! << 16) | (key[i * 4 + 2]! << 8) | key[i * 4 + 3]!;
      continue;
    }
    let t = schedule[i - 1]!;
    if (i % words === 0) {
      t = subWord((t << 8) | (t >>> 24)) ^ (RCON[i / words]! << 24);
    } else if (words > 6 && i % words === 4) {
      t = subWord(t);
    }
    schedule[i] = schedule[i - words]! ^ t;
  }
  return schedule;
};

const [M0, M1, M2, M3] = MIX as [Uint32Array, Uint32Array, Uint32Array, Uint32Array];

const encryptBlock = (schedule: Uint32Array, input: Uint32Array, output: Uint32Array): void => {
  const rounds = schedule.length / 4 - 1;
  let s0 = input[0]! ^ schedule[0]!;
  let s1 = input[1]! ^ schedule[1]!;
  let s2 = input[2]! ^ schedule[2]!;
  let s3 = input[3]! ^ schedule[3]!;
  let k = 4;
  for (let round = 1; round < rounds; round++) {
    const t0 =
      M0[s0 >>> 24]! ^
      M1[(s1 >>> 16) & 0xff]! ^
      M2[(s2 >>> 8) & 0xff]! ^
      M3[s3 & 0xff]! ^
      schedule[k++]!;
    const t1 =
      M0[s1 >>> 24]! ^
      M1[(s2 >>> 16) & 0xff]! ^
      M2[(s3 >>> 8) & 0xff]! ^
      M3[s0 & 0xff]! ^
      schedule[k++]!;
    const t2 =
      M0[s2 >>> 24]! ^
      M1[(s3 >>> 16) & 0xff]! ^
      M2[(s0 >>> 8) & 0xff]! ^
      M3[s1 & 0xff]! ^
      schedule[k++]!;
    const t3 =
      M0[s3 >>> 24]! ^
      M1[(s0 >>> 16) & 0xff]! ^
      M2[(s1 >>> 8) & 0xff]! ^
      M3[s2 & 0xff]! ^
      schedule[k++]!;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  const last = (a: number, b: number, c: number, d: number): number =>
    (SBOX[a >>> 24]! << 24) |
    (SBOX[(b >>> 16) & 0xff]! << 16) |
    (SBOX[(c >>> 8) & 0xff]! << 8) |
    SBOX[d & 0xff]!;
  output[0] = last(s0, s1, s2, s3) ^ schedule[k++]!;
  output[1] = last(s1, s2, s3, s0) ^ schedule[k++]!;
  output[2] = last(s2, s3, s0, s1) ^ schedule[k++]!;
  output[3] = last(s3, s0, s1, s2) ^ schedule[k]!;
};

// Pages are AES-CTR encrypted: the counter block is the first 8 bytes of the page nonce followed
// by a 64-bit big-endian block counter. Paperback's native crypto has no CTR mode, so the
// keystream is generated here.
export const decryptPage = (data: ArrayBuffer, key: Uint8Array, nonce: Uint8Array): ArrayBuffer => {
  if (nonce.length < 8) throw new Error("Invalid AES-CTR page nonce: fewer than 8 bytes.");
  const schedule = expandKey(key);
  const bytes = new Uint8Array(data);
  const counter = new Uint32Array(4);
  const stream = new Uint32Array(4);
  counter[0] = (nonce[0]! << 24) | (nonce[1]! << 16) | (nonce[2]! << 8) | nonce[3]!;
  counter[1] = (nonce[4]! << 24) | (nonce[5]! << 16) | (nonce[6]! << 8) | nonce[7]!;
  for (let offset = 0, block = 0; offset < bytes.length; offset += 16, block++) {
    counter[2] = Math.floor(block / 0x100000000);
    counter[3] = block;
    encryptBlock(schedule, counter, stream);
    const end = Math.min(16, bytes.length - offset);
    for (let i = 0; i < end; i++) {
      bytes[offset + i]! ^= (stream[i >> 2]! >>> (24 - (i & 3) * 8)) & 0xff;
    }
  }
  return bytes.buffer;
};
