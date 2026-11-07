---
title: ValirScans
type: subsystem
created: 2026-11-07
updated: 2026-11-07
sources:
  - code: src/ValirScans/
  - code: test/unit/ValirScans.test.ts
  - ext: https://valirscans.org
verified_at: pending
---

# ValirScans

## Discover

The featured carousel uses the homepage's most-popular list. Its section heading is
Most Popular, with the subtitle The most popular titles in the catalogue.

## Reader data

The reader route is `/series/<comic|novel>/<slug>/chapter/<number>`. Sending `rsc: 1`
returns Next.js Flight data. Full HTML embeds the same stream in `self.__next_f.push` scripts.

On 2026-11-07, The Convenient Empress Resigns chapter 7 returned 39 image pages in a reader
object beginning with `{"kind":"comic","chapter":...}`. I Don't Want to Be the Magpie Bridge
chapter 1 uses the same object shape. Searching only for an object beginning with `{"chapter":`
missed the reader and raised the reported missing-data error. Recognize both shapes and keep
the surrounding access flags when choosing the reader. Other chapter objects contain only
audio metadata and have no readable pages or prose.

The reader's `isUnlocked` and `isLocked` fields still determine access. Paid chapter
handling uses the website's unlocked state. Novel content can reference a Flight text row,
whose length counts UTF-8 bytes. Tests cover current and earlier reader props, embedded and
raw streams, ordered images, referenced prose, and locked or empty readers.

The fixed parser read 39 images from Empress chapter 7, 35 from Magpie Bridge chapter 1,
and prose from Post-Possession Damage Control chapter 1 in fresh responses. Empress chapter 13
was rejected as locked. All six generated live tests passed. Paperback reader rendering remains
unverified on a device.

## Verification

The screenshot's automated test received HTTP 200 Flight responses before parsing failed.
The failing comic response also contained ordinary image URLs when fetched directly here.
Completing Turnstile in Paperback requires a device check independently of these parser tests.
