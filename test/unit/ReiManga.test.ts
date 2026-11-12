/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareError,
  ContentRating,
  type Chapter,
  type Request,
  type Response,
} from "@paperback/types";

const application = {
  getState: () => undefined,
  getDefaultUserAgent: async () => "ReiManga test browser",
  arrayBufferToUTF8String: (value: ArrayBuffer) => new TextDecoder().decode(value),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });
const { parseChapterPages } = await import("../../src/ReiManga/parsers");
const { ReiMangaInterceptor } = await import("../../src/ReiManga/network");
const { ReiManga } = await import("../../src/ReiManga/main");

const chapter: Chapter = {
  chapterId: "1986227",
  chapNum: 1,
  volume: 0,
  langCode: "en",
  sourceManga: {
    mangaId: "hotaru-no-yomeiri-83231",
    mangaInfo: {
      primaryTitle: "Hotaru no Yomeiri",
      secondaryTitles: [],
      thumbnailUrl: "https://example.com/cover.webp",
      synopsis: "",
      contentRating: ContentRating.MATURE,
    },
  },
};
// Independently encoded, lossless 1×1 WebP images, with different pixels.
const red = Uint8Array.from(
  Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA", "base64"),
).buffer;
const blue = Uint8Array.from(
  Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ0f/+ByKi/wEA", "base64"),
).buffer;
const manifest = () => ({
  images: [1, 2, 3].map((page_number) => ({ page_number, image_url: "", storage: "r2-pack" })),
  pack: {
    index: {
      v: 1,
      s: [2, 1],
      p: [
        [36, 1, 1],
        [36, 1, 1],
        [36, 1, 1],
      ],
    },
    urls: ["https://cdn.example/first.rpk?generation=fixture", "https://cdn.example/second.rpk"],
  },
});
const expectedPages = [
  "https://cdn.example/first.rpk?generation=fixture#reimanga-range=0-35.webp",
  "https://cdn.example/first.rpk?generation=fixture#reimanga-range=36-71.webp",
  "https://cdn.example/second.rpk#reimanga-range=0-35.webp",
];
const response = (status: number, headers: Record<string, string> = {}): Response => ({
  url: expectedPages[1],
  status,
  headers,
  cookies: [],
});

void test("maps packed pages in manifest order and resets byte offsets for each segment", () => {
  assert.deepEqual(parseChapterPages(JSON.stringify(manifest()), chapter), {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: expectedPages,
  });
});

void test("retains direct images and joins fragmented HTML Flight payloads", () => {
  const data = JSON.stringify({
    images: [
      { page_number: 2, image_url: "https://cdn.example/2.webp" },
      { page_number: 1, url: "https://cdn.example/1.webp" },
    ],
  });
  const html = [data.slice(0, 40), data.slice(40)]
    .map((piece) => `<script>self.__next_f.push([1,${JSON.stringify(piece)}])</script>`)
    .join("");
  const result = parseChapterPages(html, chapter);
  assert.ok("pages" in result);
  assert.deepEqual(result.pages, ["https://cdn.example/1.webp", "https://cdn.example/2.webp"]);
  assert.throws(() => parseChapterPages('{"images":[]}', chapter), /No pages found/);
});

void test("rejects incomplete and malformed packs instead of returning partial chapters", () => {
  for (const index of [
    { v: 2, s: [3], p: [[36], [36], [36]] },
    { v: 1, s: [2], p: [[36], [36], [36]] },
    { v: 1, s: [3], p: [[36], [0], [36]] },
    { v: 1, s: [3], p: [[36], [Number.MAX_SAFE_INTEGER], [36]] },
  ]) {
    assert.throws(
      () =>
        parseChapterPages(
          JSON.stringify({ ...manifest(), pack: { ...manifest().pack, index } }),
          chapter,
        ),
      /Invalid.*pack/,
    );
  }
  const data = manifest();
  data.pack.urls.pop();
  assert.throws(() => parseChapterPages(JSON.stringify(data), chapter), /Invalid.*pack/);
});

void test("reader uses one route request and preserves saved manga and chapter IDs", async (t) => {
  const requests: Request[] = [];
  t.mock.method(
    application,
    "scheduleRequest",
    async (request: Request): Promise<[Response, ArrayBuffer]> => {
      requests.push(request);
      return [response(200), new TextEncoder().encode(JSON.stringify(manifest())).buffer];
    },
  );
  const details = await ReiManga.getChapterDetails(chapter);
  assert.ok("pages" in details);
  assert.deepEqual(details.pages, expectedPages);
  assert.equal(details.id, chapter.chapterId);
  assert.equal(details.mangaId, chapter.sourceManga.mangaId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://reimanga.net/manga/hotaru-no-yomeiri-83231/1986227");
});

void test("requests exact ranges and extracts WebP pages from partial or full pack responses", async () => {
  const interceptor = new ReiMangaInterceptor("test");
  const request = await interceptor.interceptRequest({ url: expectedPages[1], method: "GET" });
  assert.equal(request.headers?.range, "bytes=36-71");
  assert.equal(request.headers?.referer, "https://reimanga.net/");
  const partial = response(206, { "Content-Range": "bytes 36-71/72" });
  assert.deepEqual(await interceptor.interceptResponse(request, partial, blue), blue);
  assert.equal(partial.headers["content-type"], "image/webp");
  const fullPack = new Uint8Array(72);
  fullPack.set(new Uint8Array(red));
  fullPack.set(new Uint8Array(blue), 36);
  assert.deepEqual(
    await interceptor.interceptResponse(request, response(200), fullPack.buffer),
    blue,
  );
  assert.deepEqual(
    await interceptor.interceptResponse(
      { url: "https://example.com/cover.webp", method: "GET" },
      response(200),
      red,
    ),
    red,
  );
});

void test("rejects blocked, mismatched and corrupt pack responses and propagates Cloudflare", async () => {
  const interceptor = new ReiMangaInterceptor("test");
  const request = { url: expectedPages[1], method: "GET" };
  await assert.rejects(interceptor.interceptResponse(request, response(403), red), /403/);
  await assert.rejects(
    interceptor.interceptResponse(
      request,
      response(206, { "content-range": "bytes 0-35/72" }),
      red,
    ),
    /range/i,
  );
  await assert.rejects(interceptor.interceptResponse(request, response(200), red), /range/i);
  await assert.rejects(
    interceptor.interceptResponse(
      request,
      response(206, { "content-range": "bytes 36-71/72" }),
      new ArrayBuffer(36),
    ),
    /WebP/,
  );
  await assert.rejects(
    interceptor.interceptResponse(request, response(403, { "cf-mitigated": "challenge" }), red),
    CloudflareError,
  );
});
