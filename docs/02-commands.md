# Commands

| Command | What it does | Options |
|---|---|---|
| `spm i [name]` | Installs a package into the packages folder; with no name, every package in `spm.lock.json` | `--ver <version>`: a specific version; `--latest`: the newest commit instead of the locked one |
| `spm rm <name>` | Removes an installed package and its lockfile entry | `--g`: also removes it from the registry **and deletes its GitHub repository** |
| `spm list` | Lists installed packages and their folders | |
| `spm get <name>` | Shows an installed package's `.spm` and the latest version in the registry | |
| `spm lock` | Shows the versions recorded in `spm.lock.json` | |
| `spm verify` | Checks that the installed packages still match `spm.lock.json` | |
| `spm create <name>` | Creates a package | `--local`: a `.spm` in the packages folder; `--github`: the GitHub repository for it; `--github-repo <owner/name>`, `--description <text>`, `--ver <version>`: values for the `.spm` |
| `spm publish <name>` | Publishes a package to GitHub and the registry, or updates it: one commit with exactly the package folder (without `.git`, `node_modules/`, `slim-dist/`, `spm.lock.json` and what `.gitignore` ignores), then the tag `v<version>` | |
| `spm login` | Connects your GitHub account | `--check`: tells whether you are signed in |
| `spm logout` | Disconnects your GitHub account | |

`spm --version`, `spm --help` and `spm help <command>` work as usual. Commands take the bare package name (`std`); code and most messages write it with `@` (`@std`).

A typical session:

```bash
spm i std                 # install
spm list                  # see what is installed
spm rm std                # remove it again

spm login                 # connect GitHub, once
spm create mylib --local  # write packages/mylib/.spm
spm create mylib --github # create the repository named in it
spm publish mylib         # push it and register the name
```

`spm rm <name> --g` is for a package you own and want gone everywhere: it deletes the GitHub repository too, and that can't be undone.

Next: [Versions and the lockfile](03-versions.md).
