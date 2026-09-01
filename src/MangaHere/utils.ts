/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

const evaluateExpression = (expression: string): unknown => {
  const FunctionConstructor = globalThis.Function;
  if (typeof FunctionConstructor !== "function") {
    throw new Error("The JavaScript evaluator is unavailable.");
  }
  return FunctionConstructor(`"use strict"; return (${expression});`)();
};

const evaluateScript = (script: string, result: string): unknown => {
  const FunctionConstructor = globalThis.Function;
  if (typeof FunctionConstructor !== "function") {
    throw new Error("The JavaScript evaluator is unavailable.");
  }
  return FunctionConstructor(`"use strict"; let currentimageid; ${script}; return (${result});`)();
};

const unpackScript = (script: string): string => {
  const source = script.trim();
  if (!source.startsWith("eval(function(p,a,c,k,e,d)")) {
    throw new Error("The reader script uses an unsupported format.");
  }
  let unpacked: unknown;
  try {
    unpacked = evaluateExpression(source.slice(4));
  } catch (cause) {
    throw new Error("Unable to unpack the reader script.", { cause });
  }
  if (typeof unpacked !== "string" || !unpacked.trim()) {
    throw new Error("The unpacked reader script is empty.");
  }
  return unpacked;
};

export const parseEmbeddedPages = (script: string): string[] => {
  const unpacked = unpackScript(script);
  const values = /\bnewImgs\s*=\s*(\[[\s\S]*?\])\s*;/i.exec(unpacked)?.[1];
  if (!values) throw new Error("No embedded pages were found in the reader script.");

  let pages: unknown;
  try {
    pages = evaluateExpression(values);
  } catch (cause) {
    throw new Error("Unable to parse the embedded page list.", { cause });
  }
  if (!Array.isArray(pages) || !pages.every((page) => typeof page === "string" && page)) {
    throw new Error("The embedded page list has an invalid shape.");
  }
  return pages.map((page) => (page.startsWith("//") ? `https:${page}` : page));
};

export const parseReaderSecretKey = (script: string): string => {
  const unpacked = unpackScript(script);
  const expression = /\bguidkey\s*=\s*([^;]+);/i.exec(unpacked)?.[1];
  if (!expression) throw new Error("No reader key was found in the reader script.");

  let key: unknown;
  try {
    key = evaluateExpression(expression);
  } catch (cause) {
    throw new Error("Unable to parse the reader key.", { cause });
  }
  if (typeof key !== "string") throw new Error("The reader key has an invalid shape.");
  return key;
};

export const parseChapterImageUrl = (script: string): string => {
  const unpacked = unpackScript(script);
  let pages: unknown;
  try {
    pages = evaluateScript(unpacked, "dm5imagefun()");
  } catch (cause) {
    throw new Error("Unable to parse the chapter image response.", { cause });
  }
  const url = Array.isArray(pages) ? pages[0] : undefined;
  if (typeof url !== "string" || !url) {
    throw new Error("No chapter image was found in the reader response.");
  }
  return url.startsWith("//") ? `https:${url}` : url;
};

export const validateChapterPages = (pages: string[], expectedCount: number): string[] => {
  if (pages.some((page) => /\/images\/war\.jpg(?:\?|$)/i.test(page))) {
    throw new Error("Chapter images are unavailable.");
  }
  if (pages.length === expectedCount && pages.every((page) => /^https?:\/\//i.test(page))) {
    return pages;
  }
  if (pages.length === expectedCount - 1 && pages.every((page) => /^https?:\/\//i.test(page))) {
    return pages;
  }
  throw new Error(`The reader returned ${pages.length} of ${expectedCount} expected pages.`);
};
