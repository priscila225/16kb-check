# roku-preflight

Check a Roku app against current certification rules before you submit. One command, on your machine.

```bash
npx roku-preflight check
```

It reads your `manifest`, source (`.brs`, `.bs`, `.xml`) and artwork, or a `.zip` package, and prints a scannable report: **FAIL**, **WARN** and **INFO** first, with details and links, then a compact **PASS** list and each **SKIP** on its own line. Links to Roku's official page and a plain-English explainer on [devbooth.dev](https://devbooth.dev) appear on findings; `--verbose` shows them on every check. Any FAIL exits with code 1, so it drops straight into CI.

This is a static check. It does not replace [Roku's official Static Analysis](https://developer.roku.com/dev/docs/static-analysis-tool), App Behavior Analysis, or human cert review, which are still required when you submit. It also does not measure launch time, playback, memory use, or the Dashboard minimum firmware setting.

## What it checks

| Id | Check | Fails when | Warns when |
|---|---|---|---|
| `manifest-required` | Manifest fields | required fields (`title`, version numbers) are missing, or the manifest has no trailing newline. Icon and splash fields are checked only by `artwork`, so they are not reported twice | |
| `version` | Version number | `major_version` / `minor_version` / `build_version` are missing or all zeros (criterion 6.1). It cannot tell whether you incremented the version since the last store build | |
| `rsg-version` | RSG version | `rsg_version` is missing or not `1.3` (required since Oct 1, 2026) | |
| `artwork` | Icons and splash screens | HD icon is not 290x218, FHD splash is not 1920x1080, HD splash is not 1280x720, a listed file is missing or the wrong size, or artwork is transparent (criterion 6.4) | FHD icon (`mm_icon_focus_fhd`, 540x405) is missing (recommended; store apps can pass cert with the HD icon), SD splash (`720x480`) is missing, or an image's size could not be read |
| `package-size` | Package size | the zip (or a zip built from the project folder) is over 4 MB (criterion 3.7) | |
| `deep-linking` | Deep linking | `supports_input_launch=1`, `roInput` / `roInputEvent` handling, or a `Main` / `RunUserInterface` entry that reads `contentId` and `mediaType` is missing. This is presence only, not "the deep link actually plays" | |
| `deprecated-legacy-screens` | Legacy screens | sunset components such as `roVideoScreen`, `roPosterScreen`, `roGridScreen` or `roSpringboardScreen` are found in your own source | the same APIs are found only in vendored or third-party code |
| `deprecated-apis` | Deprecated APIs | documented deprecated APIs such as `ShowChannelStoreSpringboard`, `LaunchApp`, `Eval()`, `file://` URLs or in-app ECP are found in your own source, or `InitClientCertificates()` is used there on or after Apr 1, 2027 | `InitClientCertificates()` is used in your own source before Apr 1, 2027, or a deprecated API is found only in vendored or third-party code (the usual fix is updating that SDK) |
| `launch-beacon` | Launch beacon | `AppLaunchComplete` is not signaled in source. This does not measure the 15-second launch limit | |
| `memory-monitor` | Memory Monitor | `roAppMemoryMonitor` is not used (required since Oct 1, 2026) | |
| `raf` | Roku Advertising Framework | the project looks like it serves ads but is missing the RAF import, `Roku_Ads()` constructor, `bs_libs_required=roku_ads_lib`, or a `StitchedAdsInit` / `StitchedAdHandledEvent` pair | `enableAdMeasurements` is missing (region and kids status cannot be known from the project). A no-ads app is skipped |
| `roku-pay` | Roku Pay | | purchase calls such as `doOrder`, `getCatalog` or `getPurchases` are present without `doRecovery`. ChannelStore used only for `getUserData` or account linking, and bare "subscription" wording in analytics or marketing copy, are skipped |
| `screensaver-manifest` | Screensaver manifest | `screensaver_title` is set and `title` is also present, or version fields are missing. Regular apps skip this check | |

## Sample output

```
roku-preflight check  ·  Example Channel  ·  project  ·  version 1.2.3  rsg 1.3
10 pass · 0 warn · 0 fail · 3 skip
This is a static preflight check. Roku's official Static Analysis is still required when you submit.

PASS  Manifest fields             Required fields and trailing newline are in place
PASS  Version number              1.2.3 (this check cannot tell whether you incremented it since the last store build)
PASS  RSG version                 rsg_version=1.3, required since Oct 1, 2026
PASS  Icons and splash screens    Required icons and splash screens match the official sizes and are not transparent
PASS  Package size                2.6 KB (packaged zip built from this folder). Limit is 4 MB
PASS  Deep linking                supports_input_launch=1, roInput handling, and Main launch args for contentId and mediaType are present. This does not prove a deep link actually plays
PASS  Legacy screens              No sunset legacy screen components were found
PASS  Deprecated APIs             No documented deprecated APIs were found. InitClientCertificates() becomes a blocking error on Apr 1, 2027
PASS  Launch beacon               AppLaunchComplete is signaled in source. This does not measure launch time (official criterion is 15 seconds to a fully rendered home screen)
PASS  Memory Monitor              roAppMemoryMonitor is used (required since Oct 1, 2026)
SKIP  Roku Advertising Framework  not used
SKIP  Roku Pay                    not used
SKIP  Screensaver manifest        Not a standalone screensaver

Checked fully offline. Nothing left this machine.
```

The summary line is at the top. When stdout is not a TTY, or with `--format github`, it is also printed at the bottom so CI log tails still show it.

`--verbose` (or `-v`) adds Rule and devbooth links on every check, and a line naming whether live rules from devbooth.dev or the bundled snapshot were used. `--format github` prints `::error` / `::warning` / `::notice` annotations with file and line when known, then the same report.

## Usage

```bash
# From your channel root (the folder with a manifest file)
npx roku-preflight check

# Another folder
npx roku-preflight check path/to/channel

# A sideload or packaged zip
npx roku-preflight check path/to/channel.zip

# Machine-readable output
npx roku-preflight check --json

# GitHub Actions annotations
npx roku-preflight check --format github

# Show every link and which rules snapshot was used
npx roku-preflight check --verbose

# Pick checks
npx roku-preflight check --only manifest-required,artwork,package-size
npx roku-preflight check --skip raf,roku-pay

# No network at all
npx roku-preflight check --offline
```

| Option | What it does |
|---|---|
| `[path]`, `--path <path>` | Channel folder or `.zip` (default: current folder) |
| `--json` | JSON with `{ id, status, title, detail, deadline, source, link, items }` per check. Checks that have a file location also include `locations` |
| `--format text\|github` | `text` (default) or `github`, which emits `::error` / `::warning` / `::notice` annotations with file and line when known, plus the report |
| `--verbose`, `-v` | Show Rule / devbooth links on all checks, and which rules snapshot was used |
| `--strict` | Exit 1 on WARN too |
| `--only <ids>` / `--skip <ids>` | Comma-separated check ids |
| `--offline` | No network. Uses the Roku dates bundled in this release |
| `--no-color` | Plain output. Color is also off when stdout is not a TTY, or when `NO_COLOR` is set |

Exit codes: `0` no failures (warnings are ok unless `--strict`), `1` at least one FAIL (or a WARN with `--strict`), `2` bad usage or a runtime error (missing project, unreadable zip, unknown flag).

Requires Node 18 or newer.

Online, the dates and sizes used by the checks come from `https://devbooth.dev/api/roku-rules`, so a site update reaches you without a new npm release. If the site can't be reached, the schema isn't recognized, or you pass `--offline`, the snapshot bundled at publish time is used instead. `--verbose` prints which one was used and when it was last updated. The `/api/roku-rules` endpoint may still be forthcoming; until then the bundled snapshot is used automatically.

## CI example

```yaml
name: Roku preflight

on:
  push:
  pull_request:

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Roku certification checks
        run: npx --yes roku-preflight check --format github
```

## Privacy

Everything runs on your machine. Your manifest, sources, artwork and zip are never uploaded.

The only network call is a GET on `https://devbooth.dev/api/roku-rules` for the current dates and sizes. That request sends nothing about your project. `--offline` skips the network completely and uses the dates bundled in this release.

## License

MIT. Built for [devbooth.dev](https://devbooth.dev).
