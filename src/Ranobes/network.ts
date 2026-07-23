/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DOMAIN } from "./models";

export const fetchHtml = async (url: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: {
      referer: `${DOMAIN}/`,
      "user-agent": await Application.getDefaultUserAgent(),
    },
  });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
