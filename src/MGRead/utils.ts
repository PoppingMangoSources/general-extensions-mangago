/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import type { ReaderProtection } from "./models";
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
const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex)) throw new Error("Invalid protected-reader key or IV.");
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
};

const base64Bytes = (value: string): Uint8Array<ArrayBuffer> => {
  const decoded = Application.base64Decode(value);
  return typeof decoded === "string" ? utf8Bytes(decoded) : new Uint8Array(decoded);
};

export const decryptReader = async (
  { encrypted, config }: ReaderProtection,
  readerKey?: string,
): Promise<string> => {
  let key: CryptoKey;
  if (readerKey)
    key = await crypto.subtle.importKey("raw", hexBytes(readerKey), "AES-CBC", false, ["decrypt"]);
  else {
    if (!config.decryption_key || !encrypted.salt)
      throw new Error("The website omitted this chapter's reader key.");
    const password = await crypto.subtle.importKey(
      "raw",
      base64Bytes(config.decryption_key),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: hexBytes(encrypted.salt), iterations: 999, hash: "SHA-512" },
      password,
      { name: "AES-CBC", length: 256 },
      false,
      ["decrypt"],
    );
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: hexBytes(encrypted.iv) },
    key,
    base64Bytes(encrypted.ciphertext),
  );
  return Application.arrayBufferToUTF8String(plaintext);
};
