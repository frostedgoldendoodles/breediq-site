// BreedIQ build — precompile every page's JSX to a static bundle.
//
// Why: the pages used to ship Babel-standalone (~450KB) and transpile JSX in
// the browser on every load. This moves that to build time. Each src/<page>.jsx
// compiles to <page>.bundle.js at the repo root, committed and served as a
// plain static file — so Vercel's deploy flow is unchanged (there is NO build
// step on Vercel; this runs locally / in CI when a page source changes).
//
// React/ReactDOM/Tailwind are loaded as self-hosted UMD <script> tags in each
// HTML page (/vendor/*). The sources do NOT import React, so esbuild's classic
// JSX transform emits React.createElement calls that resolve to window.React.
//
// Usage:  npm run compile        (build all pages once)
//         npm run compile:watch  (rebuild on save)

import { build, context } from 'esbuild';
import { readdirSync } from 'fs';

// Every src/*.jsx is a page entry point → <page>.bundle.js at the repo root.
const entryPoints = readdirSync('src')
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => `src/${f}`);

const options = {
    entryPoints,
    outdir: '.',
    entryNames: '[name].bundle',
    loader: { '.jsx': 'jsx' },
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    minify: true,
    target: ['es2018'],
    // No bundling: there are no imports to resolve. React is a runtime global.
    bundle: false,
    logLevel: 'info',
};

const watch = process.argv.includes('--watch');

if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`[build] watching ${entryPoints.length} page source(s) …`);
} else {
    await build(options);
    console.log(`[build] compiled ${entryPoints.length} page bundle(s)`);
}
