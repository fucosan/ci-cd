import {
  dag,
  Container,
  Directory,
  object,
  func,
  Secret,
} from '@dagger.io/dagger';

@object()
export class MyNestApp {
  /**
   * Complete Pipeline: Test, then Build, then Deploy to a Registry
   */
  @func()
  async deploy(
    source: Directory,
    registryAddr: string,
    username: string,
    password: Secret,
  ): Promise<string> {
    // 1. Run Tests first
    await this.test(source);

    // 2. Build the app
    const buildDir = this.build(source);

    // 3. Create the Production Image
    // We use a clean node:24-alpine for a smaller production footprint
    const prodImage = dag
      .container()
      .from('node:24-alpine')
      .withDirectory('/app', buildDir)
      .withWorkdir('/app')
      // Set the command to run your NestJS app
      .withEntrypoint(['node', 'main.js']);

    // 4. Publish to GHCR
    // Note: Use lowercase for the image name as GHCR is case-sensitive
    const imageName = `${username.toLowerCase()}/my-nest-app:latest`;

    return await prodImage
      .withRegistryAuth(registryAddr, username, password)
      .publish(`${registryAddr}/${imageName}`);
  }

  @func()
  async test(source: Directory): Promise<string> {
    return await this.base(source)
      .withExec(['pnpm', 'install'])
      .withExec(['pnpm', 'run', 'test'])
      .stdout();
  }

  @func()
  build(source: Directory): Directory {
    return this.base(source)
      .withExec(['pnpm', 'install'])
      .withExec(['pnpm', 'run', 'build'])
      .directory('dist');
  }

  private base(source: Directory): Container {
    return dag
      .container()
      .from('node:24-slim')
      .withExec(['corepack', 'enable'])
      .withDirectory('/src', source, {
        exclude: ['node_modules', 'dist', '.dagger'],
      })
      .withWorkdir('/src')
      .withMountedCache('/pnpm/store', dag.cacheVolume('pnpm_store'))
      .withEnvVariable('PNPM_HOME', '/pnpm')
      .withEnvVariable('PATH', '/pnpm:$PATH', { expand: true });
  }
}
