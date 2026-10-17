/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Cookie } from "@paperback/types";

import {
  HUMAN_CHECK_TIMEOUT_MS,
  READER_SECRET,
  type ReaderKeyResponse,
  type ReaderPage,
} from "./models";

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

// The site's own reader runs the human check, which often passes without a tap. Its record of
// requests shows the unlock being posted without touching the page, which its checks could notice.
// Returns the cookies the unlocked session leaves, or undefined when the check did not pass.
export const runHumanCheck = async (
  html: string,
  url: string,
  cookies: Cookie[],
): Promise<Cookie[] | undefined> => {
  const { result, storage } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: url,
      loadCSS: true,
      loadImages: false,
      userAgent: await Application.getDefaultUserAgent(),
    },
    inject: `
      return new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
          if (performance.getEntriesByType("resource").some((entry) => entry.name.includes("/api/manga/unlock"))) {
            resolve(true);
          } else if (Date.now() - started > ${HUMAN_CHECK_TIMEOUT_MS}) {
            resolve(false);
          } else {
            setTimeout(poll, 500);
          }
        };
        poll();
      });
    `,
    storage: { cookies },
  });
  return result === true ? storage.cookies : undefined;
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
const MIX = [0, 1, 2, 3].map(() => new Int32Array(256));
const FINAL = [0, 1, 2, 3].map(() => new Int32Array(256));

{
  const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let x = 0;
  let xi = 0;
  for (let i = 0; i < 256; i++) {
    let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    SBOX[x] = sx;
    for (let n = 0; n < 4; n++) FINAL[n]![x] = sx << (littleEndian ? n * 8 : 24 - n * 8);
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

// Process full blocks as words and reuse the fixed first-round terms between counter changes.
// The final-round tables use memory byte order so the same loop works on either endianness.
export const decryptPage = (data: ArrayBuffer, key: Uint8Array, nonce: Uint8Array): ArrayBuffer => {
  if (nonce.length < 8) throw new Error("Invalid AES-CTR page nonce: fewer than 8 bytes.");
  const rk = new Int32Array(expandKey(key));
  const rounds = rk.length / 4 - 1;
  const end = rounds * 4;
  const m0 = MIX[0];
  const m1 = MIX[1];
  const m2 = MIX[2];
  const m3 = MIX[3];
  const f0 = FINAL[0]!;
  const f1 = FINAL[1]!;
  const f2 = FINAL[2]!;
  const f3 = FINAL[3]!;
  // The last round key, rearranged into memory order like the FINAL tables.
  const last = new Int32Array(4);
  const lastView = new DataView(last.buffer);
  for (let i = 0; i < 4; i++) lastView.setInt32(i * 4, rk[rounds * 4 + i]!, false);
  const l0 = last[0]!;
  const l1 = last[1]!;
  const l2 = last[2]!;
  const l3 = last[3]!;

  const length = data.byteLength;
  const bytes = new Uint8Array(data);
  const wordCount = length >>> 2;
  const words = new Int32Array(bytes.buffer, 0, wordCount);

  const c0 = ((nonce[0]! << 24) | (nonce[1]! << 16) | (nonce[2]! << 8) | nonce[3]!) ^ rk[0]!;
  const c1 = ((nonce[4]! << 24) | (nonce[5]! << 16) | (nonce[6]! << 8) | nonce[7]!) ^ rk[1]!;
  const blocks = Math.ceil(length / 16);
  // Round 1 terms that only depend on the fixed nonce words.
  const a0 = m0[c0 >>> 24]! ^ m1[(c1 >>> 16) & 0xff]! ^ rk[4]!;
  const a1 = m0[c1 >>> 24]! ^ m3[c0 & 0xff]! ^ rk[5]!;
  const a2 = m2[(c0 >>> 8) & 0xff]! ^ m3[c1 & 0xff]! ^ rk[6]!;
  const a3 = m1[(c0 >>> 16) & 0xff]! ^ m2[(c1 >>> 8) & 0xff]! ^ rk[7]!;

  let c2 = 0;
  let r0 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  for (let block = 0, w = 0; block < blocks; block++, w += 4) {
    const c3 = block ^ rk[3]!;
    if (block === 0 || (block & 0xff) === 0) {
      // Everything except the counter's low byte is fixed for the next 256 blocks.
      c2 = Math.floor(block / 0x100000000) ^ rk[2]!;
      r0 = a0 ^ m2[(c2 >>> 8) & 0xff]!;
      const t1 = a1 ^ m1[(c2 >>> 16) & 0xff]! ^ m2[(c3 >>> 8) & 0xff]!;
      const t2 = a2 ^ m0[c2 >>> 24]! ^ m1[(c3 >>> 16) & 0xff]!;
      const t3 = a3 ^ m0[c3 >>> 24]! ^ m3[c2 & 0xff]!;
      b0 = m1[(t1 >>> 16) & 0xff]! ^ m2[(t2 >>> 8) & 0xff]! ^ m3[t3 & 0xff]! ^ rk[8]!;
      b1 = m0[t1 >>> 24]! ^ m1[(t2 >>> 16) & 0xff]! ^ m2[(t3 >>> 8) & 0xff]! ^ rk[9]!;
      b2 = m0[t2 >>> 24]! ^ m1[(t3 >>> 16) & 0xff]! ^ m3[t1 & 0xff]! ^ rk[10]!;
      b3 = m0[t3 >>> 24]! ^ m2[(t1 >>> 8) & 0xff]! ^ m3[t2 & 0xff]! ^ rk[11]!;
    }
    const t0 = r0 ^ m3[c3 & 0xff]!;
    let s0 = b0 ^ m0[t0 >>> 24]!;
    let s1 = b1 ^ m3[t0 & 0xff]!;
    let s2 = b2 ^ m2[(t0 >>> 8) & 0xff]!;
    let s3 = b3 ^ m1[(t0 >>> 16) & 0xff]!;
    for (let k = 12; k < end;) {
      const t0 =
        m0[s0 >>> 24]! ^
        m1[(s1 >>> 16) & 0xff]! ^
        m2[(s2 >>> 8) & 0xff]! ^
        m3[s3 & 0xff]! ^
        rk[k++]!;
      const t1 =
        m0[s1 >>> 24]! ^
        m1[(s2 >>> 16) & 0xff]! ^
        m2[(s3 >>> 8) & 0xff]! ^
        m3[s0 & 0xff]! ^
        rk[k++]!;
      const t2 =
        m0[s2 >>> 24]! ^
        m1[(s3 >>> 16) & 0xff]! ^
        m2[(s0 >>> 8) & 0xff]! ^
        m3[s1 & 0xff]! ^
        rk[k++]!;
      s3 =
        m0[s3 >>> 24]! ^
        m1[(s0 >>> 16) & 0xff]! ^
        m2[(s1 >>> 8) & 0xff]! ^
        m3[s2 & 0xff]! ^
        rk[k++]!;
      s0 = t0;
      s1 = t1;
      s2 = t2;
    }
    const o0 =
      f0[s0 >>> 24]! ^ f1[(s1 >>> 16) & 0xff]! ^ f2[(s2 >>> 8) & 0xff]! ^ f3[s3 & 0xff]! ^ l0;
    const o1 =
      f0[s1 >>> 24]! ^ f1[(s2 >>> 16) & 0xff]! ^ f2[(s3 >>> 8) & 0xff]! ^ f3[s0 & 0xff]! ^ l1;
    const o2 =
      f0[s2 >>> 24]! ^ f1[(s3 >>> 16) & 0xff]! ^ f2[(s0 >>> 8) & 0xff]! ^ f3[s1 & 0xff]! ^ l2;
    const o3 =
      f0[s3 >>> 24]! ^ f1[(s0 >>> 16) & 0xff]! ^ f2[(s1 >>> 8) & 0xff]! ^ f3[s2 & 0xff]! ^ l3;

    if (w + 4 <= wordCount) {
      words[w]! ^= o0;
      words[w + 1]! ^= o1;
      words[w + 2]! ^= o2;
      words[w + 3]! ^= o3;
    } else {
      const stream = new Uint8Array(new Int32Array([o0, o1, o2, o3]).buffer);
      for (let i = block * 16; i < length; i++) bytes[i]! ^= stream[i - block * 16]!;
    }
  }
  return bytes.buffer;
};
