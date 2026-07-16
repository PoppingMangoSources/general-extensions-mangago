/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { OniSaga } from "../OniSaga/main.js";
import {
  completeMobileSafariUserAgent,
  consumePageToken,
  formatPageSafetyPause,
  getHeaderValue,
  getRetryDelayMs,
  isCloudflareChallengeResponse,
  normalisePageRequestStarts,
  normalisePageTokenBucket,
  OniSagaInterceptor,
  PAGE_BURST_CAPACITY,
  PAGE_BUDGET_MAX_REQUESTS,
  PAGE_BUDGET_WINDOW_MS,
  PAGE_TOKEN_REFILL_INTERVAL_MS,
  pageBudgetReadyAt,
  pageTokenReadyAt,
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

  suite.test("reader token bucket bursts, refills and migrates retained history", async () => {
    const now = 2_000_000_000_000;
    let state = normalisePageTokenBucket(undefined, [], now);
    expect(state.tokens).to.equal(PAGE_BURST_CAPACITY);

    for (let index = 0; index < PAGE_BURST_CAPACITY; index++) {
      state = consumePageToken(state, now);
    }
    expect(state.tokens).to.equal(0);
    expect(pageTokenReadyAt(state, now)).to.equal(now + PAGE_TOKEN_REFILL_INTERVAL_MS);

    state = normalisePageTokenBucket(state, [], now + PAGE_TOKEN_REFILL_INTERVAL_MS);
    expect(state.tokens).to.be.closeTo(1, 0.000_001);
    expect(pageTokenReadyAt(state, now + PAGE_TOKEN_REFILL_INTERVAL_MS)).to.equal(
      now + PAGE_TOKEN_REFILL_INTERVAL_MS,
    );

    const oldBurst = Array.from(
      { length: PAGE_BURST_CAPACITY + 5 },
      (_, index) => now - 1000 + index,
    );
    const migrated = normalisePageTokenBucket(undefined, oldBurst, now);
    expect(migrated.tokens).to.be.lessThan(1);
    expect(pageTokenReadyAt(migrated, now)).to.be.greaterThan(now);

    let saturated = normalisePageTokenBucket(undefined, [], now);
    let scheduledAt = now;
    let scheduledWithinWindow = 0;
    for (let index = 0; index < PAGE_BUDGET_MAX_REQUESTS + 10; index++) {
      scheduledAt = pageTokenReadyAt(saturated, scheduledAt);
      if (scheduledAt > now + PAGE_BUDGET_WINDOW_MS) break;
      saturated = consumePageToken(saturated, scheduledAt);
      scheduledWithinWindow++;
    }
    expect(scheduledWithinWindow).to.equal(PAGE_BUDGET_MAX_REQUESTS);
  });

  suite.test("reader safety errors expose a countdown instead of a silent wait", async () => {
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

  suite.test("reader redirect handling restores protected page headers", async () => {
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
