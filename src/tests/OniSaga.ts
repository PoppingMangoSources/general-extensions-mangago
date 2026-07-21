/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { OniSaga } from "../OniSaga/main.js";
import {
  completeMobileSafariUserAgent,
  formatPageSafetyPause,
  getHeaderValue,
  getRetryDelayMs,
  isCloudflareChallengeResponse,
  normalisePageRequestStarts,
  OniSagaInterceptor,
  PAGE_BUDGET_MAX_REQUESTS,
  PAGE_BUDGET_WINDOW_MS,
  pageBudgetReadyAt,
} from "../OniSaga/network.js";
import { countPages, extractPageOrders, extractReaderToken } from "../OniSaga/parsers.js";
import sourceInfo from "../OniSaga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("OniSaga tests", logger);

  suite.test("reader helpers handle response headers case-insensitively", async () => {
    expect(getHeaderValue({ "X-Reader-Token": "abc" }, "x-reader-token")).to.equal("abc");
    expect(getHeaderValue({ "x-reader-token-next": "def" }, "X-Reader-Token-Next")).to.equal("def");
    expect(getRetryDelayMs({ "retry-after": "3" })).to.equal(3000);
    expect(getRetryDelayMs({})).to.equal(2000);
  });

  suite.test("reader challenge detection excludes ordinary token failures", async () => {
    const pageUrl = "https://onisaga.com/api/chapter/2843379/page/8";
    for (const status of [403, 503]) {
      expect(
        isCloudflareChallengeResponse(
          pageUrl,
          status,
          { "content-type": "text/html; charset=UTF-8" },
          "<title>Just a moment...</title><script>window._cf_chl_opt = {}</script>",
        ),
      ).to.equal(true);
    }
    expect(
      isCloudflareChallengeResponse(
        pageUrl,
        403,
        { "content-type": "application/json", server: "cloudflare" },
        '{"error":"invalid reader token"}',
      ),
    ).to.equal(false);
  });

  suite.test("reader markup parser preserves sparse page order", async () => {
    const markup = `
      pages: [{"order":0},{"order":2},{"order":7}],
      totalPages: 3,
      readerToken: "reader-token-value",
      importInProgress: false
    `;
    expect(extractReaderToken(markup)).to.equal("reader-token-value");
    expect(extractPageOrders(markup)).to.deep.equal([0, 2, 7]);
    expect(countPages(markup)).to.equal(3);
  });

  suite.test("reader budget allows a full chapter before its hard ceiling", async () => {
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

  suite.test("reader safety errors expose a countdown", async () => {
    expect(formatPageSafetyPause(29_100)).to.contain("30 seconds");
    expect(formatPageSafetyPause(53 * 60 * 1000)).to.contain("53 minutes");
  });

  suite.test("reader completes a bare iOS WebView user agent for Cloudflare", async () => {
    const bare =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    const full = completeMobileSafariUserAgent(bare);
    expect(full).to.contain("Version/18.7 Mobile/15E148 Safari/604.1");
    expect(completeMobileSafariUserAgent(full)).to.equal(full);
  });

  suite.test("reader redirects restore the token and referer", async () => {
    const manager = new OniSagaInterceptor("onisaga-redirect-test");
    const pageUrl = "https://onisaga.com/api/chapter/2843379/page/8";
    const referer = "https://onisaga.com/read/example/2843379";
    manager.setReaderToken("2843379", "reader-token", referer);

    const redirected = await manager.prepareRedirect(
      { url: `${pageUrl}?redirected=1`, method: "GET", headers: {} },
      { url: pageUrl, status: 302, headers: {}, cookies: [] },
    );
    expect(getHeaderValue(redirected.headers, "x-reader-token")).to.equal("reader-token");
    expect(getHeaderValue(redirected.headers, "referer")).to.equal(referer);
    expect(getHeaderValue(redirected.headers, "accept")).to.equal("*/*");
  });

  registerDefaultTests(suite, OniSaga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
  });

  await suite.run();
}
