// CommonJS config — deliberately NOT `next.config.ts`. Next 16 compiles
// `next.config.ts` to CJS output but invokes it in an ESM-ish context, so
// neither `import.meta.url` nor `process.cwd()` resolve the frontend path
// reliably from there. Using a plain `.js` file means `__dirname` is always
// the directory of THIS file, which is exactly what we need.
//
// Background:
//   - Session 10 tried `fileURLToPath(import.meta.url)` in next.config.ts →
//     `ReferenceError: exports is not defined` at build/startup.
//   - Follow-up tried `process.cwd()` → Turbopack resolved modules against
//     the wrong directory (TradingBot parent instead of frontend), so
//     `@import "tailwindcss"` in globals.css failed with "Can't resolve
//     'tailwindcss'", and the OOM-looped dev workers froze the machine.
//   - Pinning `turbopack.root = __dirname` in a CJS config matches the
//     Next 16 docs example and works first-try. See:
//       node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md
//
// Why we care about `turbopack.root`: both `TradingBot/package-lock.json`
// (bot) and `frontend/package-lock.json` (this app) exist side by side, so
// Next's auto-detection picks the parent `TradingBot` as the workspace
// root, and Turbopack then looks for `tailwindcss` under the bot's
// non-existent `node_modules`. Forcing root to this directory fixes that.

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
