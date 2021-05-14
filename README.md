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
    "maxRulesApplied": 1
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

You can use dry run mode to not commit changes to the package.jsons.

```sh
yarn semver up --config semver-up.json --dry-run
```

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

To add a contributor to the README, signal the [all-contributors](https://allcontributors.org/) bot by adding comments in your PRs like so:

```
@all-contributors please add <username> for <contribution type>
```
