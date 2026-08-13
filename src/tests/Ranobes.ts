import { CloudflareError, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Ranobes, resumeChapterPageCrawl } from "../Ranobes/main.js";
import type { ChapterCrawlCheckpoint } from "../Ranobes/models.js";
import { RanobesInterceptor } from "../Ranobes/network.js";
import sourceInfo from "../Ranobes/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Ranobes tests", logger);
  registerDefaultTests(suite, Ranobes, sourceInfo);

  suite.test("chapter crawl resumes after a challenge without refetching saved pages", async () => {
    const checkpoint: ChapterCrawlCheckpoint = {
      novelId: "1207185",
      pages: { "1": { cstart: 1 } },
    };
    const challenge = new CloudflareError({ url: "https://ranobes.net/", method: "GET" });
    const requestedPages: number[] = [];
    let firstAttempt = true;
    const fetchPage = async (page: number) => {
      requestedPages.push(page);
      if (firstAttempt && page === 3) throw challenge;
      return { cstart: page };
    };

    let caught: unknown;
    try {
      await resumeChapterPageCrawl(checkpoint, 4, fetchPage);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(challenge);
    expect(Object.keys(checkpoint.pages).sort()).to.deep.equal(["1", "2", "4"]);

    firstAttempt = false;
    const pages = await resumeChapterPageCrawl(checkpoint, 4, fetchPage);
    expect(requestedPages).to.deep.equal([2, 3, 4, 3]);
    expect(pages.map((page) => page.cstart)).to.deep.equal([1, 2, 3, 4]);
  });

  suite.test("DDoS-Guard failures resolve on the challenged chapter-list page", async () => {
    const request = {
      url: "https://ranobes.net/chapters/1207185/page/4/",
      method: "GET" as const,
      headers: {},
    };
    const interceptor = new RanobesInterceptor("ranobes-test-interceptor");
    let caught: unknown;
    try {
      await interceptor.interceptResponse(
        request,
        {
          url: request.url,
          status: 403,
          headers: { server: "ddos-guard", "content-type": "text/html" },
          cookies: [],
        },
        new TextEncoder().encode("<title>Access denied</title>").buffer,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(CloudflareError);
    if (!(caught instanceof CloudflareError)) throw new Error("Expected CloudflareError");
    expect(caught.resolutionRequest.url).to.equal(request.url);
    expect(caught.resolutionRequest.method).to.equal(request.method);
  });

  await suite.run();
}
