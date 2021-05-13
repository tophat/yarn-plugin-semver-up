import { CommandContext, Configuration, Plugin, Project } from '@yarnpkg/core'
import { Command, Usage } from 'clipanion'

class SemverUpCommand extends Command<CommandContext> {
    static paths = [['semver', 'up']]

    static usage: Usage = Command.Usage({
        description: '',
        details: '',
        examples: [],
    })

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

            this.context.stdout.write('Done\n')
            return 0
        } catch (err) {
            this.context.stderr.write(`${String(err)}\n`)
            return 1
        }
    }
}

const plugin: Plugin = {
    hooks: {},
    commands: [SemverUpCommand],
}

export default plugin
