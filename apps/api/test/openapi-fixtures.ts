import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { API_CONTROLLERS } from '../src/app.ts';
import { taskCommands, sessionCommands } from '../src/projects/commands.ts';

export function restRouteInventory() {
  const actual: string[] = [];
  for (const controller of API_CONTROLLERS) {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name as keyof typeof controller.prototype];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const route = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const path = '/' + [prefix, route].filter((p) => p && p !== '/').join('/');
      const paths = path.endsWith('/:command')
        ? Object.keys(path.includes('/tasks/') ? taskCommands : sessionCommands).map((command) =>
            path.replace(':command', command),
          )
        : [path];
      for (const p of paths)
        actual.push(
          `${RequestMethod[method]!.toLowerCase()} ${p.replace(/:([A-Za-z]+)/g, '{$1}')}`,
        );
    }
  }
  return actual;
}
