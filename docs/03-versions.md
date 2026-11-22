# Versions and the lockfile

`spm i <name>` records each package's version, repository, commit and a hash of its files in `spm.lock.json` in the project folder. Commit the file, so that everyone on the project gets the same code.

```bash
spm lock
```

- Installing a locked package again takes the same commit, and fails if its files no longer match the hash.
- `spm i <name> --latest` takes the newest commit instead and updates the entry.
- `spm i <name> --ver 1.2.0` installs the tag `v1.2.0`.
- `spm i` with no name installs everything in `spm.lock.json`, for a fresh checkout.
- `spm verify` checks that the installed files still match the hashes, so a package edited by hand shows up.

`spm rm <name>` removes the entry together with the folder.

Next: [Publishing](04-publishing.md).
