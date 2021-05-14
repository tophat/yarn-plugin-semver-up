import {
    Cache,
    CommandContext,
    Configuration,
    Descriptor,
    IdentHash,
    MessageName,
    Plugin,
    Project,
    StreamReport,
    Workspace,
    miscUtils,
    structUtils,
} from '@yarnpkg/core'
import { npath, ppath } from '@yarnpkg/fslib'
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
}

type RulesWithPackages = Array<
    [RuleGlob, { rule: RuleConfig; packages: Set<IdentHash> }]
>

type RulesWithUpdates = Map<RuleGlob, Map<IdentHash, Descriptor>>

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

                await report.startTimerPromise(
                    'Staging Updates',
                    { skipIfEmpty: false },
                    async () => {
                        await this.applyUpdates({
                            config,
                            workspace,
                            rulesWithUpdates,
                            report,
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
    }): Promise<void> {
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

                for (const dependencyScope of [
                    'dependencies',
                    'devDependencies',
                ]) {
                    const dependencies = workspace.manifest.getForScope(
                        dependencyScope,
                    )
                    const oldDescriptor = dependencies.get(identHash)
                    if (!oldDescriptor) continue
                    dependencies.set(identHash, descriptor)
                    ruleUpdateCount += 1

                    report.reportInfo(
                        MessageName.UNNAMED,
                        `[${ruleGlob}] ${stringifiedIdent}: ${oldDescriptor.range} -> ${descriptor.range}`,
                    )
                }
            }

            if (ruleUpdateCount) rulesAppliedCount += 1
        }
    }
}

const plugin: Plugin = {
    hooks: {},
    commands: [SemverUpCommand],
}

export default plugin
