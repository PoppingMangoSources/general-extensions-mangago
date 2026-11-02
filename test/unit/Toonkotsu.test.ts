/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";

import { decryptPage } from "../../src/Toonkotsu/utils";

// The device's crypto.subtle has no AES-CTR, so the source decrypts pages in pure TypeScript.
// Node's own AES-CTR is the oracle: the page counter is the nonce's first 8 bytes followed by
// a 64-bit big-endian block index.
const encrypt = (plain: Buffer, key: Buffer, nonce: Buffer): Buffer => {
  const iv = Buffer.concat([nonce.subarray(0, 8), Buffer.alloc(8)]);
  const cipher = createCipheriv(`aes-${key.length * 8}-ctr`, key, iv);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
};

for (const keyBytes of [16, 24, 32]) {
  // An odd length exercises the partial final block; >256 blocks crosses the counter's byte boundary.
  for (const length of [1, 15, 16, 17, 4096 + 7, 16 * 300 + 3]) {
    void test(`decryptPage matches AES-${keyBytes * 8}-CTR for ${length} bytes`, () => {
      const key = randomBytes(keyBytes);
      const nonce = randomBytes(12);
      const plain = randomBytes(length);
      const cipherText = encrypt(plain, key, nonce);
      const buffer = new ArrayBuffer(cipherText.length);
      new Uint8Array(buffer).set(cipherText);
      const result = Buffer.from(decryptPage(buffer, new Uint8Array(key), new Uint8Array(nonce)));
      assert.ok(result.equals(plain));
    });
  }
}

void test("decryptPage rejects a nonce shorter than 8 bytes", () => {
  assert.throws(
    () => decryptPage(new ArrayBuffer(16), new Uint8Array(16), new Uint8Array(7)),
    /fewer than 8 bytes/,
  );
});
