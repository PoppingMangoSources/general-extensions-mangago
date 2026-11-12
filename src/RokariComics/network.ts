/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import * as cheerio from "cheerio";

export const fetchChapterPage = async (
  domain: string,
  slug: string,
  chapterId: string,
): Promise<cheerio.CheerioAPI> => {
  const [response, buffer] = await Application.scheduleRequest({
    url: `${domain}/${slug}-chapter-${chapterId}/`,
    method: "GET",
  });
  if (response.status !== 200)
    throw new Error(`RokariComics chapter request failed with status ${response.status}`);
  return cheerio.load(Application.arrayBufferToUTF8String(buffer));
};
