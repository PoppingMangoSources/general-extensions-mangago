/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

const PRIMITIVES: Record<number, unknown> = {
  0: undefined,
  1: null,
  2: true,
  3: false,
  4: "",
  20: "id",
};

export const decodeQwikLoader = (input: string): unknown => {
  let encoded: unknown;
  try {
    encoded = JSON.parse(input) as unknown;
  } catch (error: unknown) {
    throw new Error("XCOMIC returned malformed latest-upload data", { cause: error });
  }
  if (!Array.isArray(encoded) || encoded.length < 2 || encoded.length % 2 !== 0) {
    throw new Error("XCOMIC returned malformed latest-upload data");
  }

  const serialized = encoded as unknown[];
  for (let offset = 0; offset < serialized.length; offset += 2) {
    const pathValue = serialized[offset + 1];
    if (serialized[offset] !== 1 || typeof pathValue !== "string" || !pathValue.includes(" ")) {
      continue;
    }

    const path = pathValue.split(" ").map(Number);
    if (path.some((index) => !Number.isInteger(index) || index < 0)) {
      throw new Error("XCOMIC returned malformed latest-upload references");
    }

    let branch = serialized;
    let parent = serialized;
    let slot = 0;
    let type: unknown;
    let payload: unknown;
    for (let index = 0; index < path.length; index++) {
      parent = branch;
      slot = path[index]! * 2;
      type = branch[slot];
      payload = branch[slot + 1];
      if (type === 1) {
        const reference = Number(payload) * 2;
        type = serialized[reference];
        payload = serialized[reference + 1];
      }
      if (index < path.length - 1) {
        if (!Array.isArray(payload)) {
          throw new Error("XCOMIC returned malformed latest-upload references");
        }
        branch = payload;
      }
    }
    parent[slot] = 1;
    parent[slot + 1] = offset / 2;
    serialized[offset] = type;
    serialized[offset + 1] = payload;
  }

  const values = Array.from<unknown>({ length: serialized.length / 2 });
  const decoded = new Uint8Array(values.length);
  let decodeEntry: (index: number) => unknown;
  let decodeValue: (type: unknown, payload: unknown) => unknown;

  const decodePairs = (payload: unknown, target?: unknown[]): unknown[] => {
    if (!Array.isArray(payload) || payload.length % 2 !== 0) {
      throw new Error("XCOMIC returned malformed latest-upload values");
    }
    const result = target ?? Array.from<unknown>({ length: payload.length / 2 });
    for (let offset = 0; offset < payload.length; offset += 2) {
      result[offset / 2] = decodeValue(payload[offset], payload[offset + 1]);
    }
    return result;
  };

  const decodeCollection = (
    type: 4 | 5,
    payload: unknown,
    target?: unknown[] | Record<string, unknown>,
  ): unknown[] | Record<string, unknown> => {
    if (type === 4) return decodePairs(payload, target as unknown[] | undefined);
    const object = (target as Record<string, unknown> | undefined) ?? {};
    if (payload === 0) return object;
    const fields = decodePairs(payload);
    for (let index = 0; index < fields.length; index += 2) {
      const key = fields[index];
      if (typeof key !== "string" && typeof key !== "number") {
        throw new Error("XCOMIC returned an invalid latest-upload property");
      }
      object[String(key)] = fields[index + 1];
    }
    return object;
  };

  decodeValue = (type: unknown, payload: unknown): unknown => {
    if (type === 0) return payload;
    if (type === 1) {
      const reference = Number(payload);
      if (!Number.isInteger(reference) || reference < 0 || reference >= values.length) {
        throw new Error("XCOMIC returned an invalid latest-upload reference");
      }
      return decodeEntry(reference);
    }
    if (type === 3) {
      if (!(typeof payload === "number" && payload in PRIMITIVES)) {
        throw new Error("XCOMIC returned an unsupported latest-upload primitive");
      }
      return PRIMITIVES[payload];
    }
    if (type === 4 || type === 5) return decodeCollection(type, payload);
    throw new Error("XCOMIC returned an unsupported latest-upload value");
  };

  decodeEntry = (index: number): unknown => {
    if (decoded[index]) return values[index];
    const type = serialized[index * 2];
    const payload = serialized[index * 2 + 1];
    if (type === 4 || type === 5) {
      const value: unknown[] | Record<string, unknown> = type === 4 ? [] : {};
      values[index] = value;
      decoded[index] = 1;
      return decodeCollection(type, payload, value);
    }
    const value = decodeValue(type, payload);
    values[index] = value;
    decoded[index] = 1;
    return value;
  };

  return decodeEntry(0);
};
