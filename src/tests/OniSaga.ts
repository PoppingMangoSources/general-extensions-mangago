/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { OniSaga } from "../OniSaga/main.js";
import {
  getHeaderValue,
  getRetryDelayMs,
  isCloudflareChallengeResponse,
  normalisePageRequestStarts,
  PAGE_BUDGET_MAX_REQUESTS,
  PAGE_BUDGET_WINDOW_MS,
  pageBudgetReadyAt,
} from "../OniSaga/network.js";
import { countPages, extractPageOrders, extractReaderToken } from "../OniSaga/parsers.js";
import sourceInfo from "../OniSaga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("OniSaga tests", logger);

  suite.test("reader retry helpers read headers case-insensitively", async () => {
    expect(getHeaderValue({ "X-Reader-Token": "abc" }, "x-reader-token")).to.equal("abc");
    expect(getHeaderValue({ "x-reader-token-next": "def" }, "X-Reader-Token-Next")).to.equal("def");
    expect(getRetryDelayMs({ "retry-after": "3" })).to.equal(3000);
    expect(getRetryDelayMs({})).to.equal(2000);
  });

  suite.test(
    "reader challenge detection distinguishes Cloudflare HTML from token 403s",
    async () => {
      const pageUrl = "https://onisaga.com/api/chapter/2843379/page/8";
      expect(
        isCloudflareChallengeResponse(pageUrl, 403, {
          "Content-Type": "text/html; charset=UTF-8",
          "CF-Mitigated": "challenge",
        }),
      ).to.equal(true);
      expect(
        isCloudflareChallengeResponse(
          pageUrl,
          403,
          { "content-type": "text/html; charset=UTF-8" },
          "<title>Just a moment...</title><script>window._cf_chl_opt = {}</script>",
        ),
      ).to.equal(true);
      expect(
        isCloudflareChallengeResponse(
          pageUrl,
          403,
          { "content-type": "application/json", server: "cloudflare" },
          '{"error":"invalid reader token"}',
        ),
      ).to.equal(false);
    },
  );

  suite.test("reader markup parser handles the current two-page import result", async () => {
    const markup = `
      pages: [{"order":0,"is_spread":false,"width":1024,"height":1056},{"order":1,"is_spread":false,"width":1024,"height":1055}],
      totalPages: 2,
      readerToken: "reader-token-value",
      importInProgress: false
    `;
    expect(extractReaderToken(markup)).to.equal("reader-token-value");
    expect(extractPageOrders(markup)).to.deep.equal([0, 1]);
    expect(countPages(markup)).to.equal(2);
  });

  suite.test("hourly reader budget waits for its oldest charged lookup", async () => {
    const now = 2_000_000_000_000;
    const starts = Array.from(
      { length: PAGE_BUDGET_MAX_REQUESTS },
      (_, index) => now - 10_000 + index,
    );
    expect(pageBudgetReadyAt(starts.slice(1), now)).to.equal(now);
    expect(pageBudgetReadyAt(starts, now)).to.equal(starts[0] + PAGE_BUDGET_WINDOW_MS);

    expect(
      normalisePageRequestStarts(
        [now - PAGE_BUDGET_WINDOW_MS - 1, now - 5, Number.NaN, "bad", now + 1],
        now,
      ),
    ).to.deep.equal([now - 5]);
  });

  registerDefaultTests(suite, OniSaga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
  });

  await suite.run();
}
