# 16kb-check (moved to play-preflight)

`16kb-check` is now **[play-preflight](https://www.npmjs.com/package/play-preflight)**.

```bash
# The same 16 KB SDK table as before
npx play-preflight 16kb

# Every Google Play check: target API, 16 KB, Play Billing, foreground services,
# edge to edge, large screens, predictive back, restricted permissions
npx play-preflight check
```

This package still works. `npx 16kb-check` prints a short notice on stderr and runs `play-preflight 16kb` with the same options (`--path`, `--json`, `--ci`, `--no-color`), so existing scripts and CI jobs keep working. Please switch when you can.

Everything still runs on your machine. See the [play-preflight README](https://github.com/priscila225/16kb-check/tree/main/packages/play-preflight#readme) for details and privacy.

MIT. Built for [devbooth.dev](https://devbooth.dev/cli).
