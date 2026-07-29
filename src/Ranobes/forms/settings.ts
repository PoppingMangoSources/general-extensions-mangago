/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  Section,
  WebViewRow,
  type Cookie,
  type CookieStorageInterceptor,
} from "@paperback/types";

import { DOMAIN } from "../models";
import { storeSessionCookies } from "../network";

export class RanobesSettingsForm extends Form {
  constructor(
    private readonly cookieStorage: CookieStorageInterceptor,
    private readonly userAgent: string,
  ) {
    super();
  }

  override getSections() {
    return [
      Section(
        {
          id: "protection",
          footer:
            "If browsing fails with a protection error, open the site and " +
            "complete any check it shows — the cleared session carries over. " +
            "If requests stall or time out, reset the stored session first, " +
            "then open the site again.",
        },
        [
          WebViewRow("open_site", {
            title: "Open ranobes.net",
            request: {
              url: `${DOMAIN}/`,
              method: "GET",
              headers: {
                referer: `${DOMAIN}/`,
                "user-agent": this.userAgent,
              },
            },
            onComplete: Application.Selector(this as RanobesSettingsForm, "handleWebViewComplete"),
            onCancel: Application.Selector(this as RanobesSettingsForm, "handleWebViewCancel"),
          }),
          ButtonRow("reset_session", {
            title: "Reset stored session",
            onSelect: Application.Selector(this as RanobesSettingsForm, "handleResetSession"),
          }),
        ],
      ),
    ];
  }

  async handleWebViewComplete(cookies: Cookie[]): Promise<void> {
    storeSessionCookies(cookies);
  }

  async handleWebViewCancel(): Promise<void> {}

  // Stale clearance can stall requests; wiping the session lets the next solve start clean.
  async handleResetSession(): Promise<void> {
    this.cookieStorage.cookies = [];
  }
}
