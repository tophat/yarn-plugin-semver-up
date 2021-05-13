import {
    CommandContext,
    Configuration,
    Descriptor,
    Manifest,
    Plugin,
    Project,
    miscUtils,
} from '@yarnpkg/core'
import { npath, ppath } from '@yarnpkg/fslib'
import { Command, Option, Usage } from 'clipanion'

type Config = {
    packagePrefix?: string
    allowMajor?: boolean
    allowMinor?: boolean
    allowPatch?: boolean
    maxPackagesUpdated?: number
}

const defaultConfig: Config = {
    allowMajor: false,
    allowMinor: true,
    allowPatch: true,
    maxPackagesUpdated: 1,
}

class SemverUpCommand extends Command<CommandContext> {
    static paths = [['semver', 'up']]

    static usage: Usage = Command.Usage({
        description: '',
        details: '',
        examples: [],
    })

    configFile?: string = Option.String('--config', { required: false })

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

            await project.restoreInstallState()

            const config = await this.parseConfigFile()
            await this.getUpdateCandidates(
                config,
                project.topLevelWorkspace.manifest,
            )

            this.context.stdout.write('Done\n')
            return 0
        } catch (err) {
            this.context.stderr.write(`${String(err)}\n`)
            return 1
        }
    }

    async parseConfigFile(): Promise<Config> {
        const configFile = this.configFile ? this.configFile : '.semver-up.json'

        const configPPath = ppath.resolve(
            ppath.cwd(),
            npath.toPortablePath(configFile),
        )

        let packageConfig: Config = {}
        try {
            packageConfig = miscUtils.dynamicRequireNoCache(configPPath)
        } catch (e) {
            this.context.stdout.write(
                '.semver-up.json file not detected, using default config\n',
            )
        }

        const config = {
            ...defaultConfig,
            ...packageConfig,
        }

        if (!config.allowMajor && !config.allowMinor && !config.allowPatch) {
            throw new Error(
                'One of [allowMajor, allowMinor, allowPatch] must be set to true',
            )
        }

        this.context.stdout.write(
            `Using config: ${JSON.stringify(config, null, 4)}\n`,
        )
        return config
    }

    async getUpdateCandidates(
        config: Config,
        manifest: Manifest,
    ): Promise<Descriptor[]> {
        const candidates: Descriptor[] = []
        const possiblePackages = [
            ...manifest.dependencies.values(),
            ...manifest.devDependencies.values(),
        ]
        if (config.packagePrefix) {
            for (const dependency of possiblePackages) {
                if (dependency.name.startsWith(config.packagePrefix))
                    candidates.push(dependency)
            }
        } else {
            candidates.push(...possiblePackages)
        }

        this.context.stdout.write(
            `Candidate packages for upgrade are:\n${candidates
                .map(candidate => candidate.name)
                .join('\n')}\n`,
        )
        return candidates
    }
}

const plugin: Plugin = {
    hooks: {},
    commands: [SemverUpCommand],
}

export default plugin
