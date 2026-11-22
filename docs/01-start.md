# Getting started

## Installing spm

spm is its own npm package, separate from the compiler:

```bash
npm i -g @slim-lang/spm
spm --version
```

It needs Node.js 22.12+ and Git. Signing in to GitHub (for publishing) keeps the token in the system's credential store.

## Installing a package

Run spm in a Slim project, the folder with `slimconfig.json`:

```bash
spm i std
```

Then use the package by its name with a leading `@`:

```js
use { int } from @std/converters

log(int("42"))
```

What `spm i std` does:

1. Asks the registry where `std` lives: a GitHub repository and its latest version.
2. Downloads the tag `v<version>` of that repository (the newest commit of `main` when there is no such tag) and unpacks it into a temporary folder.
3. Moves it to `packages/std`. The folder is `packages` unless `slimconfig.json` names another one with `packages` or `names.packages`.
4. Writes the version, the repository, the commit and a hash of the files to `spm.lock.json` (see [Versions and the lockfile](03-versions.md)).

Only plain files and folders inside the package are unpacked: links, absolute paths and paths with `..` are skipped, and a package name can't point outside the packages folder. A failed install leaves the old version in place.

`@slim/...` is not a package: those are the modules of Slim itself (`@slim/server`, `@slim/router`, `@slim/forms`), and a package can't take that name.

Next: [Commands](02-commands.md).
