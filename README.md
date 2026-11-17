# play-preflight

This repo holds three npm packages:

- [`packages/play-preflight`](packages/play-preflight): the Android CLI. `npx play-preflight check` runs every Google Play check on your Android project, APK or AAB, locally.
- [`packages/roku-preflight`](packages/roku-preflight): the Roku CLI. `npx roku-preflight check` runs a static certification preflight on a channel folder or zip, locally.
- [`packages/16kb-check`](packages/16kb-check): the old package name. Version 0.2.0 is a thin wrapper that runs `play-preflight 16kb`.

```bash
npm install
npm test
```

MIT. Built for [devbooth.dev](https://devbooth.dev).
