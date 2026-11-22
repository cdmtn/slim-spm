# slim-spm

The package manager of [Slim](https://github.com/cdmtn/slim-lang): installs packages from GitHub into a project, locks their versions and publishes your own.

## Setup

```console
npm i -g @slim-lang/spm
spm --version
```

Requires Node.js 22.12+ and Git. The compiler (`@slim-lang/core`) is a separate package and doesn't need spm.

## Quick example

```console
spm i std
```

```js
use { positive } from @std/types/numerical
use { int } from @std/converters

let pages: positive = int("12")
```

`spm i std` downloads the `std` package into `packages/std` and records the exact commit in `spm.lock.json`.

## Documentation

The full guide is in [`docs/`](docs/index.md):

- [Getting started](docs/01-start.md): installing spm and a package, what happens on the way
- [Commands](docs/02-commands.md): every command and option
- [Versions and the lockfile](docs/03-versions.md): `spm.lock.json`, `verify`, `--latest`
- [Publishing](docs/04-publishing.md): the `.spm` file, `create`, `publish`, the registry

## Tests

```console
npm test
```
