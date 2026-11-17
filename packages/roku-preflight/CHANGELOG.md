# Changelog

## 1.0.0

First release of roku-preflight.

- `npx roku-preflight check [path|zip]` runs a static certification preflight on a SceneGraph project folder or zip: required manifest fields and versions, `rsg_version=1.3`, FHD/HD icon and splash sizes, the 4 MB package cap, deep linking hooks, sunset legacy screens, other deprecated APIs (including `InitClientCertificates()`, a warning until April 1, 2027 and a failure after that), the `AppLaunchComplete` beacon, Memory Monitor, RAF and Roku Pay heuristics, and the screensaver manifest.
- Text output matches play-preflight: header and summary first, then FAIL, WARN and INFO (with official and devbooth links), a compact PASS list, and SKIP checks on one line. The summary is repeated at the bottom when stdout is not a TTY, or with `--format github`. `--verbose` (`-v`) shows links on every check and which rules snapshot was used.
- `--json`, `--format github`, `--strict`, `--only`, `--skip`, `--offline`, `--no-color`. Exit codes: `0` ok, `1` FAIL or WARN with `--strict`, `2` usage or runtime error.
- Online, dates and sizes come from `https://devbooth.dev/api/roku-rules`. The request is a GET and sends nothing about your project. If you pass `--offline`, the site can't be reached, or the schema is unknown, the snapshot bundled at publish time is used instead.
- The report always says Roku's official Static Analysis is still required when you submit. The tool does not measure launch time, playback, memory use, or the Dashboard minimum firmware setting.
