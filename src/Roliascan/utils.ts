/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DOMAIN } from "./models";

export function fixImageUrl(url: string): string {
  if (!url || url.trim() === "") return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (trimmed.startsWith("http://")) return "https://" + trimmed.slice(7);
  if (trimmed.startsWith("/")) return DOMAIN + trimmed;
  return trimmed;
}

export function generateChapterToken(): { token: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  const now = new Date();
  const hour =
    now.getUTCFullYear().toString() +
    (now.getUTCMonth() + 1).toString().padStart(2, "0") +
    now.getUTCDate().toString().padStart(2, "0") +
    now.getUTCHours().toString().padStart(2, "0");
  const secret = "mng_ch_" + hour;
  return {
    token: Application.crypto_md5Hash(timestamp.toString() + secret).substring(0, 16),
    timestamp,
  };
}
