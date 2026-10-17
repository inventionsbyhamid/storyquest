import { mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Media lives on local disk under one root. The database stores paths relative to it. */
export class MediaStore {
  readonly root: string;

  constructor(
    root: string,
    private readonly baseUrl: string,
  ) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  nodeDir(nodeId: string): string {
    return join(this.root, 'nodes', nodeId);
  }

  moviesDir(): string {
    return join(this.root, 'movies');
  }

  absolute(relativePath: string): string {
    return join(this.root, ...relativePath.split('/'));
  }

  relative(absolutePath: string): string {
    return relative(this.root, absolutePath).split(sep).join('/');
  }

  url(relativePath: string | null): string | null {
    if (!relativePath) return null;
    return `${this.baseUrl}/media/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
  }
}
