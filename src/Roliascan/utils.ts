/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export function generateChapterToken(): { token: string; timestamp: number } {
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
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
