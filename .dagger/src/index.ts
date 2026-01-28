import { dag, Container, Directory, object, func } from '@dagger.io/dagger';

@object()
export class MyNestApp {
  /**
   * Run unit tests for the NestJS application using pnpm on Node 24 LTS
   */
  @func()
  async test(source: Directory): Promise<string> {
    return await this.base(source)
      .withExec(['pnpm', 'install'])
      .withExec(['pnpm', 'run', 'test'])
      .stdout();
  }

  /**
   * Build the NestJS application using pnpm on Node 24 LTS
   */
  @func()
  build(source: Directory): Directory {
    return this.base(source)
      .withExec(['pnpm', 'install'])
      .withExec(['pnpm', 'run', 'build'])
      .directory('dist');
  }

  /**
   * Helper function to create the base container with Node 24 and pnpm
   */
  private base(source: Directory): Container {
    const pnpmCache = dag.cacheVolume('pnpm_store');

    return dag
      .container()
      .from('node:24-slim') // Updated to latest LTS
      .withExec(['corepack', 'enable'])
      .withDirectory('/src', source, {
        exclude: ['node_modules', 'dist', '.dagger'],
      })
      .withWorkdir('/src')
      .withEnvVariable('PNPM_HOME', '/pnpm')
      .withMountedCache('/pnpm/store', pnpmCache)
      .withEnvVariable('PATH', '/pnpm:$PATH', { expand: true });
  }
}
