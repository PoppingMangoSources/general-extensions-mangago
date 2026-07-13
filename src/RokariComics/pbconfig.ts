/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { basePbConfig, customVersion } from "./generic/config";

let pbConfig = basePbConfig;

pbConfig.name = "RokariComics";
pbConfig.description = "Extension that pulls content from rokaricomics.com.";
pbConfig.version = customVersion({ increasePrerelease: 3 });

export default pbConfig;
