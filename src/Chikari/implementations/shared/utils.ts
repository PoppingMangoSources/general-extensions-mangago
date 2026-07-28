/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

type ConstructorLike = { prototype: object };

export const applyMixins = (
  derivedConstructor: ConstructorLike,
  baseConstructors: ConstructorLike[],
): void => {
  for (const baseConstructor of baseConstructors) {
    for (const name of Object.getOwnPropertyNames(baseConstructor.prototype)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(baseConstructor.prototype, name);
      if (descriptor) Object.defineProperty(derivedConstructor.prototype, name, descriptor);
    }
  }
};
