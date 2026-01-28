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
   * Complete CI/CD Pipeline: Test, Build, Push to Registry, and Deploy to Server
   */
  @func()
  async deployToServer(
    source: Directory,
    registryAddr: string,
    username: string,
    password: Secret,
    sshHost: string,
    sshUser: string,
    sshKey: Secret,
    sshPort?: number,
  ): Promise<string> {
    // 1. Build and push to registry
    const imageRef = await this.deploy(
      source,
      registryAddr,
      username,
      password,
    );

    // 2. Deploy to server via SSH
    const port = sshPort ?? 22;
    const imageName = `${registryAddr}/${username.toLowerCase()}/my-nest-app:latest`;

    const deployScript = `
      echo "${await password.plaintext()}" | docker login ${registryAddr} -u ${username} --password-stdin
      docker pull ${imageName}
      docker stop nest-app 2>/dev/null || true
      docker rm nest-app 2>/dev/null || true
      docker run -d --name nest-app --restart unless-stopped -p 3000:3000 ${imageName}
      docker image prune -f
    `;

    await dag
      .container()
      .from('alpine:latest')
      .withExec(['apk', 'add', '--no-cache', 'openssh-client'])
      .withExec(['mkdir', '-p', '/root/.ssh'])
      .withMountedSecret('/tmp/ssh_key', sshKey)
      .withExec([
        'sh',
        '-c',
        'cp /tmp/ssh_key /root/.ssh/id_rsa && chmod 600 /root/.ssh/id_rsa',
      ])
      .withExec([
        'sh',
        '-c',
        `ssh-keyscan -p ${port} ${sshHost} > /root/.ssh/known_hosts 2>/dev/null || true`,
      ])
      .withExec([
        'ssh',
        '-o',
        'StrictHostKeyChecking=no',
        '-i',
        '/root/.ssh/id_rsa',
        '-p',
        port.toString(),
        `${sshUser}@${sshHost}`,
        deployScript,
      ])
      .sync();

    return `Deployed ${imageRef} to ${sshHost}`;
  }

  /**
   * Build and Push to Registry
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
    const buildContainer = this.base(source)
      .withExec(['pnpm', 'install', '--prod=false'])
      .withExec(['pnpm', 'run', 'build']);

    const buildDir = buildContainer.directory('dist');
    const nodeModules = buildContainer.directory('node_modules');

    // 3. Create the Production Image
    // We use a clean node:24-alpine for a smaller production footprint
    const prodImage = dag
      .container()
      .from('node:24-alpine')
      .withDirectory('/app', buildDir)
      .withDirectory('/app/node_modules', nodeModules)
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
      .withEnvVariable('PATH', '/pnpm:$PATH', { expand: true })
      .withLabel(
        'org.opencontainers.image.source',
        'https://github.com/fucosan/ci-cd',
      );
  }
}
