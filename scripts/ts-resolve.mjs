// Lets `node --test` import source files as they are written for the bundler: relative
// specifiers without an extension (`./models`) or pointing at a directory resolve to `.ts`.
// Node 24 strips the types itself. Used only by test/unit; the bundle never sees it.
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
      const base = new URL(specifier, context.parentURL);
      const path = fileURLToPath(base);
      for (const candidate of [`${path}.ts`, `${path}/index.ts`]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return nextResolve(new URL(`file://${candidate}`).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
