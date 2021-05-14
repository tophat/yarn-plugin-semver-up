import {
    Cache,
    CommandContext,
    Configuration,
    Descriptor,
    DescriptorHash,
    IdentHash,
    MessageName,
    Plugin,
    Project,
    StreamReport,
    Workspace,
    miscUtils,
    structUtils,
} from '@yarnpkg/core'
import { npath, ppath, xfs } from '@yarnpkg/fslib'
import { suggestUtils } from '@yarnpkg/plugin-essentials'
import { Command, Option, Usage } from 'clipanion'
import micromatch from 'micromatch'

interface RuleConfig {
    // How many packages in the group to update. If false, do not impose a limit
    maxPackageUpdates: number | false
    // Whether to keep the upper limit of the semver range, or allow exceeding
    preserveSemVerRange: boolean
}

type RuleGlob = string

interface Config {
    rules: Array<[RuleGlob, RuleConfig]>

    // Defaults to 1, though can be false to apply no limit
    maxRulesApplied: number | false

    // whether to skip changes that update the package.json but not installed dependencies
    skipManifestOnlyChanges: boolean
}

type RulesWithPackages = Array<
    [RuleGlob, { rule: RuleConfig; packages: Set<IdentHash> }]
>

type RulesWithUpdates = Map<RuleGlob, Map<IdentHash, Descriptor>>

interface ChangesetRecord {
    fromRange: string
    toRange: string
    fromVersion: string | null
    toVersion: string
}
type Changeset = Map<string, ChangesetRecord>

const ruleConfigDefaults: RuleConfig = {
    maxPackageUpdates: false,
    preserveSemVerRange: true,
}

class SemverUpCommand extends Command<CommandContext> {
    static paths = [['semver', 'up']]

    static usage: Usage = Command.Usage({
        description: '',
        details: '',
        examples: [],
    })

    configFilename: string = Option.String('--config', 'semver-up.json')

    changesetFilename?: string = Option.String('--changeset', {
        required: false,
    })

    dryRun: boolean = Option.Boolean('--dry-run', false)

    async execute(): Promise<number> {
        try {
            const configuration = await Configuration.find(
                this.context.cwd,
                this.context.plugins,
            )
            const { project } = await Project.find(
                configuration,
                this.context.cwd,
            )
            const cache = await Cache.find(configuration)

            await project.restoreInstallState()

            const config = await this.parseConfigFile()
            const workspace = project.topLevelWorkspace

            const pipeline = async (report: StreamReport) => {
                let rulesWithPackages: RulesWithPackages

                await report.startTimerPromise(
                    'Processing Semver Up Rules',
                    { skipIfEmpty: false },
                    async () => {
                        rulesWithPackages = await this.getRulesWithPackages({
                            config,
                            workspace,
                        })
                    },
                )

                let rulesWithUpdates: RulesWithUpdates

                await report.startTimerPromise(
                    'Finding Updates',
                    { skipIfEmpty: false },
                    async () => {
                        rulesWithUpdates = await this.findUpdateCandidates({
                            workspace,
                            rulesWithPackages,
                            cache,
                        })
                    },
                )

                let changeset: Changeset

                await report.startTimerPromise(
                    'Staging Updates',
                    { skipIfEmpty: false },
                    async () => {
                        changeset = await this.applyUpdates({
                            config,
                            workspace,
                            rulesWithUpdates,
                            report,
                        })
                    },
                )

                await report.startTimerPromise(
                    'Writing Changeset File',
                    { skipIfEmpty: true },
                    async () => {
                        await this.writeChangeset({
                            changeset,
                        })
                    },
                )

                if (!this.dryRun) {
                    await project.install({ cache, report })
                }
            }

            const report = await StreamReport.start(
                { configuration, stdout: this.context.stdout },
                pipeline,
            )

            return report.exitCode()
        } catch (err) {
            this.context.stderr.write(`${String(err)}\n`)
            return 1
        }
    }

    async parseConfigFile(): Promise<Config> {
        const configPPath = ppath.resolve(
            ppath.cwd(),
            npath.toPortablePath(this.configFilename),
        )

        let configFromFile: Record<string, unknown> = {}
        try {
            configFromFile = miscUtils.dynamicRequireNoCache(configPPath)
        } catch (e) {
            configFromFile = {
                rules: [['*', {}]],
            }
        }

        const rulesFromFile = (configFromFile?.rules ?? []) as Array<
            [RuleGlob, Partial<RuleConfig>]
        >

        const config: Config = {
            rules: rulesFromFile.map(([ruleGlob, rule]) => [
                ruleGlob,
                { ...ruleConfigDefaults, ...rule },
            ]),
            maxRulesApplied:
                (configFromFile?.maxRulesApplied as number | undefined) ?? 1,
            skipManifestOnlyChanges:
                (configFromFile?.skipManifestOnlyChanges as
                    | boolean
                    | undefined) ?? false,
        }

        return config
    }

    async getRulesWithPackages({
        config,
        workspace,
    }: {
        config: Config
        workspace: Workspace
    }): Promise<RulesWithPackages> {
        const manifest = workspace.manifest

        const ruleBuckets: RulesWithPackages = config.rules.map(
            ([ruleGlob, rule]) => [ruleGlob, { rule, packages: new Set() }],
        )

        const allDependencies = [
            ...manifest.dependencies.entries(),
            ...manifest.devDependencies.entries(),
        ]

        for (const [identHash, descriptor] of allDependencies) {
            const bucket = ruleBuckets.find(
                ([ruleGlob]) =>
                    micromatch(
                        [structUtils.stringifyIdent(descriptor)],
                        ruleGlob,
                    ).length > 0,
            )
            if (bucket) {
                bucket[1].packages.add(identHash)
            }
        }

        return ruleBuckets
    }

    async findUpdateCandidates({
        workspace,
        rulesWithPackages,
        cache,
    }: {
        workspace: Workspace
        rulesWithPackages: RulesWithPackages
        cache: Cache
    }): Promise<RulesWithUpdates> {
        const descriptors: Map<IdentHash, Descriptor> = new Map([
            ...workspace.manifest.dependencies.entries(),
            ...workspace.manifest.devDependencies.entries(),
        ])

        const groups: RulesWithUpdates = new Map()

        for (const [ruleGlob, { rule, packages }] of rulesWithPackages) {
            const updates = new Map<IdentHash, Descriptor>()

            for (const pkg of packages) {
                const oldDescriptor = descriptors.get(pkg)
                if (!oldDescriptor) continue

                const ident = structUtils.convertToIdent(oldDescriptor)
                const newDescriptor = await suggestUtils.fetchDescriptorFrom(
                    ident,
                    rule.preserveSemVerRange ? oldDescriptor?.range : 'latest',
                    {
                        project: workspace.project,
                        workspace,
                        preserveModifier: true,
                        cache,
                    },
                )

                if (
                    newDescriptor &&
                    oldDescriptor.range !== newDescriptor.range
                ) {
                    updates.set(ident.identHash, newDescriptor)
                }
            }

            if (updates.size) {
                groups.set(ruleGlob, updates)
            }
        }

        return groups
    }

    getInstalledVersion({
        descriptorHash,
        project,
    }: {
        descriptorHash: DescriptorHash
        project: Project
    }): string | null {
        const locatorHash = project.storedResolutions.get(descriptorHash)
        if (locatorHash) {
            const pkg = project.storedPackages.get(locatorHash)
            if (pkg) {
                return pkg.version
            }
        }
        return null
    }

    extractVersionFromRange(range: string): string {
        if (range.match(/^[\^~]/)) {
            return range.substring(1)
        }
        return range
    }

    async applyUpdates({
        config,
        rulesWithUpdates,
        workspace,
        report,
    }: {
        config: Config
        rulesWithUpdates: RulesWithUpdates
        workspace: Workspace
        report: StreamReport
    }): Promise<Changeset> {
        const changeset: Changeset = new Map()
        const globToRule = new Map<RuleGlob, RuleConfig>(config.rules)

        let rulesAppliedCount = 0
        for (const [ruleGlob, updates] of rulesWithUpdates.entries()) {
            const rule = globToRule.get(ruleGlob)
            if (!rule) continue

            if (
                config.maxRulesApplied &&
                rulesAppliedCount >= config.maxRulesApplied
            ) {
                break
            }

            let ruleUpdateCount = 0
            for (const [identHash, descriptor] of updates.entries()) {
                if (
                    rule.maxPackageUpdates &&
                    ruleUpdateCount >= rule.maxPackageUpdates
                ) {
                    break
                }

                const stringifiedIdent = structUtils.stringifyIdent(
                    structUtils.convertToIdent(descriptor),
                )

                const oldDescriptor = workspace.dependencies.get(identHash)
                if (!oldDescriptor) continue

                const fromRange = structUtils.parseRange(oldDescriptor.range)
                    .selector
                const toRange = structUtils.parseRange(descriptor.range)
                    .selector
                const fromVersion = this.getInstalledVersion({
                    descriptorHash: oldDescriptor.descriptorHash,
                    project: workspace.project,
                })
                const toVersion = this.extractVersionFromRange(toRange)

                if (fromVersion === toVersion && config.skipManifestOnlyChanges)
                    continue

                changeset.set(stringifiedIdent, {
                    fromRange,
                    toRange,
                    fromVersion,
                    toVersion,
                })

                report.reportInfo(
                    MessageName.UNNAMED,
                    `[${ruleGlob}] ${stringifiedIdent}: ${fromRange} -> ${toRange}`,
                )

                for (const scopeKey of ['dependencies', 'devDependencies']) {
                    if (
                        workspace.manifest.getForScope(scopeKey).has(identHash)
                    ) {
                        workspace.manifest
                            .getForScope(scopeKey)
                            .set(identHash, descriptor)
                    }
                }

                ruleUpdateCount += 1
            }

            if (ruleUpdateCount) rulesAppliedCount += 1
        }

        return changeset
    }

    async writeChangeset({
        changeset,
    }: {
        changeset: Changeset
    }): Promise<void> {
        if (!this.changesetFilename) return

        const changesetPPath = ppath.resolve(
            ppath.cwd(),
            npath.toPortablePath(this.changesetFilename),
        )
        const changesetData: {
            [k: string]: {
                // eslint-disable-next-line camelcase
                from_version: string | null
                // eslint-disable-next-line camelcase
                from_range: string
                // eslint-disable-next-line camelcase
                to_version: string
                // eslint-disable-next-line camelcase
                to_range: string
                // eslint-disable-next-line camelcase
                release_notes: string | null
            }
        } = {}
        for (const [pkgName, record] of changeset.entries()) {
            changesetData[pkgName] = {
                from_version: record.fromVersion,
                from_range: record.fromRange,
                to_version: record.toVersion,
                to_range: record.toRange,
                release_notes: null,
            }
        }
        await xfs.writeFilePromise(
            changesetPPath,
            JSON.stringify(changesetData, null, 2),
            { encoding: 'utf8' },
        )
    }
}

const plugin: Plugin = {
    hooks: {},
    commands: [SemverUpCommand],
}

export default plugin
