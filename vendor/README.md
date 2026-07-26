# Ableton developer dependencies

This public repository does not redistribute the Ableton Extensions SDK or CLI.
Developers with authorized access must obtain both archives through Ableton's
official developer channel and keep them outside this repository.

Set absolute local paths, then run:

```powershell
$env:ABLETON_SDK_TGZ = 'X:/authorized/ableton-extensions-sdk-1.0.0-beta.0.tgz'
$env:ABLETON_CLI_TGZ = 'X:/authorized/ableton-extensions-cli-1.0.0-beta.0.tgz'
npm run setup:ableton
npm run ci:release
```

The public gate (`npm run ci:public`) intentionally works without these files.
Do not commit, attach, mirror or otherwise redistribute the archives.
