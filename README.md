# yarn-plugin-semver-up

[![Discord](https://img.shields.io/discord/809577721751142410)](https://discord.gg/YhK3GFcZrk)

Yarn Berry plugin to update dependencies.

## Installation

```sh
yarn plugin import https://raw.githubusercontent.com/tophat/yarn-plugin-semver-up/master/bundles/%40yarnpkg/plugin-semver-up.js
```

## Usage

```sh
yarn semver up --config semver-up.json
```

Define a `semver-up.json` config file like so:

```json
{
    "rules": [
        ["@babel/*", {
            "maxPackageUpdates": false,
            "preserveSemVerRange": true
        }]
    ],
    "maxRulesApplied": 1,
    "skipManifestOnlyChanges": false
}
```

"rules" takes an array of tuples of the form `[Package Name Glob, Config]`. You can set a default rule group via a wildcard like so:

```json
{
    "rules": [
        ["@babel/*", {
            "preserveSemVerRange": false
        }],
        ["*", {
            "preserveSemVerRange": true
        }],
    ],
    "maxRulesApplied": 1
}
```

The rules are ordered by precedence. The first rule that matches is used when grouping packages.

If you set `maxPackageUpdates` for a group, you can limit the number of packages within that group that are allowed to be updated. It defaults to "false" which means no limit.

If you set `maxRulesApplied`, you can limit how many groups to update. It defaults to `1` with the idea that we want to keep pull requests constrainted to related dependencies. You can disable it by setting `maxRulesApplied` to false, thus removing the limit.

If you set `skipManifestOnlyChanges` to true, changes that would only raise the version in the package.json but not the yarn.lock (because the resolved version has already been updated), will be skipped.

You can use dry run mode to not commit changes to the package.jsons.

```sh
yarn semver up --config semver-up.json --dry-run
```

You can specify a changeset output file that'll output what's been changed.

```sh
yarn semver up --config semver-up.json --changeset out.json
```

Use `-` to output the changeset to stdout:

```sh
yarn semver up --config semver-up.json --changeset=-
```

If you don't specify a semver-up, you can pass rule globs into the command line. This overrides the config.

```sh
yarn semver up --dry-run --no-preserve-semver "react*" "@babel/*"
```

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dbasilio"><img src="https://avatars.githubusercontent.com/u/8311284?v=4?s=100" width="100px;" alt="Daniel Basilio"/><br /><sub><b>Daniel Basilio</b></sub></a><br /><a href="#ideas-dbasilio" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/tophat/yarn-plugin-semver-up/commits?author=dbasilio" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://noahnu.com"><img src="https://avatars.githubusercontent.com/u/1297096?v=4?s=100" width="100px;" alt="Noah"/><br /><sub><b>Noah</b></sub></a><br /><a href="https://github.com/tophat/yarn-plugin-semver-up/commits?author=noahnu" title="Code">💻</a> <a href="#infra-noahnu" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.karnov.club/"><img src="https://avatars.githubusercontent.com/u/6210361?v=4?s=100" width="100px;" alt="Marc Cataford"/><br /><sub><b>Marc Cataford</b></sub></a><br /><a href="#infra-mcataford" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#maintenance-mcataford" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

To add a contributor to the README, signal the [all-contributors](https://allcontributors.org/) bot by adding comments in your PRs like so:

```
@all-contributors please add <username> for <contribution type>
```
