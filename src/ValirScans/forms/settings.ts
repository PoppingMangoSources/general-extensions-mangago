/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
  URL,
  WebViewRow,
  type Cookie,
  type CookieStorageInterceptor,
} from "@paperback/types";

import { DOMAIN, type ValirAccountStatus } from "../models";

const BASE_URL_KEY = "valirscans.baseUrl";

// setBaseUrl normalizes before every write, so a plain non-empty read suffices.
export const getBaseUrl = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  return typeof value === "string" && value.length > 0 ? value : DOMAIN;
};

export const setBaseUrl = (value: string): void => {
  Application.setState(value.trim().replace(/\/+$/, ""), BASE_URL_KEY);
};

const SHOW_PAID_CHAPTERS_KEY = "valirscans.showPaidChapters";

export const getShowPaidChapters = (): boolean =>
  Application.getState(SHOW_PAID_CHAPTERS_KEY) === true;

const isAuthCookie = (name: string): boolean =>
  /^(?:authjs|next-auth)[._-]/.test(name.toLowerCase().replace(/^__(?:secure|host)-/, ""));

const isFirstPartyCookie = (cookie: Cookie): boolean => {
  const host = new URL(getBaseUrl()).hostname.toLowerCase();
  const domain = cookie.domain.trim().replace(/^\.+/, "").toLowerCase();
  return domain === host || domain.endsWith(`.${host}`);
};

export class ValirScansSettingsForm extends Form {
  private showPaidChapters = getShowPaidChapters();
  private baseUrlOverride = getBaseUrl();

  constructor(
    private readonly cookieStorage: CookieStorageInterceptor,
    private account: ValirAccountStatus,
    private readonly refreshAccount: () => Promise<ValirAccountStatus>,
  ) {
    super();
  }

  private clearAuthCookies(): void {
    for (const cookie of this.cookieStorage.cookies) {
      if (isAuthCookie(cookie.name)) this.cookieStorage.deleteCookie(cookie);
    }
  }

  async handleLoginComplete(cookies: Cookie[]): Promise<void> {
    this.clearAuthCookies();
    const now = Date.now();
    for (const cookie of cookies) {
      if (isFirstPartyCookie(cookie) && (!cookie.expires || cookie.expires.getTime() > now)) {
        this.cookieStorage.setCookie(cookie);
      }
    }
    this.account = await this.refreshAccount();
    this.reloadForm();
  }

  async handleLoginCancel(): Promise<void> {
    this.account = await this.refreshAccount();
    this.reloadForm();
  }

  async handleClearSession(): Promise<void> {
    this.clearAuthCookies();
    this.account = { authenticated: false };
    this.reloadForm();
  }

  async updateShowPaidChapters(value: boolean): Promise<void> {
    this.showPaidChapters = value;
    Application.setState(value, SHOW_PAID_CHAPTERS_KEY);
  }

  async updateBaseUrl(value: string): Promise<void> {
    this.baseUrlOverride = value;
    setBaseUrl(value);
    this.reloadForm();
  }

  async resetBaseUrl(): Promise<void> {
    this.baseUrlOverride = DOMAIN;
    setBaseUrl("");
    this.reloadForm();
  }

  override getSections() {
    const identity = this.account.displayName || this.account.email;
    const accountStatus = this.account.authenticated
      ? identity
        ? `Logged in as ${identity}`
        : "Logged in"
      : "Not logged in";
    return [
      Section(
        {
          id: "account",
          footer:
            "Sign in on ValirScans, then tap Done. Credentials stay in the site's WebView; " +
            "the extension stores only first-party session cookies.",
        },
        [
          LabelRow("account_status", { title: "Account status", value: accountStatus }),
          WebViewRow("login", {
            title: "Sign in to ValirScans",
            request: { url: `${getBaseUrl()}/login`, method: "GET" },
            onComplete: Application.Selector(this as ValirScansSettingsForm, "handleLoginComplete"),
            onCancel: Application.Selector(this as ValirScansSettingsForm, "handleLoginCancel"),
          }),
          ButtonRow("clear_session", {
            title: "Clear saved session",
            isHidden: !this.account.authenticated,
            onSelect: Application.Selector(this as ValirScansSettingsForm, "handleClearSession"),
          }),
        ],
      ),
      Section(
        {
          id: "chapters",
          footer:
            "Paid chapters must be unlocked on ValirScans. This extension never purchases or " +
            "bypasses locked content.",
        },
        [
          ToggleRow("show_paid_chapters", {
            title: "Show Paid Chapters",
            value: this.showPaidChapters,
            onValueChange: Application.Selector(
              this as ValirScansSettingsForm,
              "updateShowPaidChapters",
            ),
          }),
        ],
      ),
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if it moves to a new domain. " +
            `Leave empty to use the default (${DOMAIN}). Include the scheme.`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.baseUrlOverride === DOMAIN ? "" : this.baseUrlOverride,
            onValueChange: Application.Selector(this as ValirScansSettingsForm, "updateBaseUrl"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: getBaseUrl() }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector(this as ValirScansSettingsForm, "resetBaseUrl"),
          }),
        ],
      ),
    ];
  }
}
