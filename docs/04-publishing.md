# Publishing

## The .spm file

A package is a folder in the packages folder with a `.spm` file:

```text
name = "mylib"
description = "What it does"
version = "1.0.0"

@ github
    repo = "owner/mylib"
    organization = "false"
```

- `name` and `version` are required; `description` is optional. Values are in double quotes.
- `@ github` names the repository it is published to. `organization = "true"` creates it in the organization named by `owner` instead of your account.
- Lines starting with `#` are comments. Other keys are an error.

The package's `main.slim` is what `use ... from @mylib` imports; `@mylib/a/b` is `a/b.slim` or `a/b/main.slim`.

## Creating and publishing

```bash
spm login
spm create mylib --local
spm create mylib --github
spm publish mylib
```

1. `spm login` connects your GitHub account (a device code in the browser). The token stays in the system's credential store.
2. `spm create --local` writes `packages/mylib/.spm`; `--github-repo`, `--description` and `--ver` fill it in.
3. `spm create --github` creates the repository named in `.spm`.
4. `spm publish` needs the GitHub App **slim-package-manager** installed on that repository; the first time, spm opens the page to install it. It then pushes the package's files, registers the name in the registry (or updates its version) and tags the commit `v<version>`.

To release a new version, raise `version` in `.spm` and run `spm publish` again.

## The registry

The registry at `https://spm.yurba.one` only maps a name to a repository and its latest version: the code stays on GitHub. A name belongs to whoever published it first. Packages can live in any account or organization; the standard library, for example, is the `std` package in [spm-libs/std](https://github.com/spm-libs/std).

Next: [Commands](02-commands.md).
