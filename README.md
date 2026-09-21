# @sudobility/writing_formats

Import and export script file formats to and from [`writing_core`](../writing_core)'s `DocumentJSON`.
Platform-free: bytes and strings in, bytes and strings out. Works in browsers, Bun and React Native.

| Format | Read | Write |
|---|---|---|
| Fountain (`.fountain`) | yes | yes |
| Final Draft (`.fdx`) | yes | yes |
| Fade In (`.fadein`) | yes | no |

## Usage

```ts
import { detectFormat, importFountain, exportFdx, importFadeIn } from '@sudobility/writing_formats';

const { document, report } = importFountain(text);        // DocumentJSON + ConversionReport
const { xml } = exportFdx(document);                      // -> Final Draft XML
const fadein = importFadeIn(new Uint8Array(buffer));      // .fadein is a zip
detectFormat(bytesOrString, 'script.txt');                // { format, confidence, candidates }
```

Every call returns a `ConversionReport`: `diagnostics` (severity `info | warn | loss | error`, a stable `code`, a `feature`
group and a `count`), `stats` and a `summary`. Unsupported features never throw; they appear as `warn` or `loss`. Only input
that is not the format at all throws a `FormatError`.

## Development

Local packages only: `writing_core` is resolved by path (`../writing_core/src/index.ts`) in `tsconfig.json` and
`vitest.config.ts`.

```sh
bun install
bunx tsc --noEmit    # typecheck only; this repo never emits
bunx vitest run
```

## License

BUSL-1.1
