import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { EnvError, parseEnv } from '../config/env';
import { generateCode } from '../apps/allowance/code-format';
import { CliModule } from './cli.module';
import { consoleOutput, describeFailure } from './cli-support';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // `create-code --generate-only` needs neither stores nor environment.
  if (args[0] === 'create-code' && args.includes('--generate-only') && !args.includes('--from-env')) {
    consoleOutput.line(generateCode());
    return;
  }

  // Every command validates the whole environment first, with the production rules.
  try {
    parseEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      for (const problem of error.problems) consoleOutput.error(problem);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  await CommandFactory.run(CliModule, {
    logger: ['error'],
    cliName: 'cli',
    serviceErrorHandler: (error: unknown) => {
      const { lines, exitCode } = describeFailure(error);
      for (const line of lines) consoleOutput.error(line);
      process.exitCode = exitCode;
    },
  });
}

main()
  .catch((error: unknown) => {
    const { lines, exitCode } = describeFailure(error);
    for (const line of lines) consoleOutput.error(line);
    process.exitCode = exitCode;
  })
  .finally(() => {
    // Open store connections must not keep the process alive after the command is done.
    process.exit(process.exitCode ?? 0);
  });
