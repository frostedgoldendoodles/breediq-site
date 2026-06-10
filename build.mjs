// BreedIQ build — precompile the dashboard's JSX to a static bundle.
//
// Why: dashboard.html used to ship Babel-standalone (~300KB gzipped) and
// compile ~178KB of JSX in the browser on every load. This moves that to
// build time. The output (dashboard.bundle.js) is committed and served as a
// plain static file, so Vercel's deploy flow is unchanged — there is no
// required build step on Vercel; this script runs locally / in CI when the
// dashboard source changes.
//
// React/ReactDOM stay as global UMD <script> tags in dashboard.html. The
// source does NOT import React, so esbuild's classic JSX transform emits
// React.createElement calls that resolve to window.React at runtime.
//
// Usage:  npm run compile        (one-off)
//         npm run compile:watch  (rebuild on save while editing src/dashboard.jsx)

import { build, context } from 'esbuild';

const options = {
    entryPoints: ['src/dashboard.jsx'],
    outfile: 'dashboard.bundle.js',
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
    console.log('[build] watching src/dashboard.jsx …');
} else {
    await build(options);
    console.log('[build] wrote dashboard.bundle.js');
}
