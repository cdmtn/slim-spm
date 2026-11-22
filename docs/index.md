# Slim Package Manager

`spm` installs, locks and publishes [Slim](https://github.com/cdmtn/slim-lang) packages. A package is Slim source in a GitHub repository; a registry maps its name to that repository. `spm` puts installed packages in the project's packages folder, where `use ... from @name` finds them.

```bash
npm i -g @slim-lang/spm
spm i std
```

```js
use { even } from @std/types/numerical
```

| Page | What it covers |
|---|---|
| [Getting started](01-start.md) | Installing spm, installing a package, what happens on the way |
| [Commands](02-commands.md) | Every command and option |
| [Versions and the lockfile](03-versions.md) | `spm.lock.json`, `spm verify`, `--latest` |
| [Publishing](04-publishing.md) | The `.spm` file, `spm create`, `spm publish`, the registry |

## Where to go next

- [Getting started](01-start.md)
