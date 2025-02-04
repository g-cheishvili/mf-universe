/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra, Zackary Jackson @ScriptedAlchemy
*/
//@ts-ignore
import RuntimeGlobals = require('webpack/lib/RuntimeGlobals');
import type Compilation from 'webpack/lib/Compilation';
import RemoteModule from './RemoteModule';
//@ts-ignore
import RuntimeModule = require('webpack/lib/RuntimeModule');
//@ts-ignore
import Template = require('webpack/lib/Template');

/** @typedef {import("webpack/lib/Chunk")} Chunk */
/** @typedef {import("./RemoteModule")} RemoteModule */

class RemoteRuntimeModule extends RuntimeModule {
  constructor() {
    super('remotes loading');
  }

  /**
   * @returns {string | null} runtime code
   */
  override generate(): string | null {
    const { compilation, chunkGraph } = this;
    const { runtimeTemplate, moduleGraph } = compilation as Compilation;
    const chunkToRemotesMapping: Record<string, any> = {};
    const idToExternalAndNameMapping: Record<string | number, any> = {};
    const allChunks = [
      ...Array.from(this.chunk?.getAllAsyncChunks() || []),
      ...Array.from(this.chunk?.getAllInitialChunks() || []),
    ];

    for (const chunk of allChunks) {
      const modules = chunkGraph?.getChunkModulesIterableBySourceType(
        chunk,
        'remote',
      );
      if (!modules) {
        continue;
      }
      // @ts-ignore
      const remotes = (chunkToRemotesMapping[chunk.id] = []);
      for (const m of modules) {
        const module: RemoteModule = m as RemoteModule;
        const name = module.internalRequest;
        const id = chunkGraph ? chunkGraph.getModuleId(module) : undefined;
        const { shareScope } = module;
        const dep = module.dependencies[0];
        const externalModule = moduleGraph.getModule(dep);
        const externalModuleId =
          chunkGraph && externalModule
            ? chunkGraph.getModuleId(externalModule)
            : undefined;
        if (id !== undefined) {
          //@ts-ignore
          remotes.push(id);
          idToExternalAndNameMapping[id] = [shareScope, name, externalModuleId];
        }
      }
    }
    return Template.asString([
      `var chunkMapping = ${JSON.stringify(
        chunkToRemotesMapping,
        null,
        '\t',
      )};`,
      `var idToExternalAndNameMapping = ${JSON.stringify(
        idToExternalAndNameMapping,
        null,
        '\t',
      )};`,
      `${
        RuntimeGlobals.ensureChunkHandlers
      }.remotes = ${runtimeTemplate.basicFunction('chunkId, promises', [
        `if(${RuntimeGlobals.hasOwnProperty}(chunkMapping, chunkId)) {`,
        Template.indent([
          `chunkMapping[chunkId].forEach(${runtimeTemplate.basicFunction('id', [
            `var getScope = ${RuntimeGlobals.currentRemoteGetScope};`,
            'if(!getScope) getScope = [];',
            'var data = idToExternalAndNameMapping[id];',
            'if(getScope.indexOf(data) >= 0) return;',
            'getScope.push(data);',
            `if(data.p) return promises.push(data.p);`,
            `var onError = ${runtimeTemplate.basicFunction('error', [
              'if(!error) error = new Error("Container missing");',
              'if(typeof error.message === "string")',
              Template.indent(
                `error.message += '\\nwhile loading "' + data[1] + '" from ' + data[2];`,
              ),
              `${
                RuntimeGlobals.moduleFactories
              }[id] = ${runtimeTemplate.basicFunction('', ['throw error;'])}`,
              'data.p = 0;',
            ])};`,
            `var handleFunction = ${runtimeTemplate.basicFunction(
              'fn, arg1, arg2, d, next, first',
              [
                'try {',
                Template.indent([
                  'var promise = fn(arg1, arg2);',
                  'if(promise && promise.then) {',
                  Template.indent([
                    `var p = promise.then(${runtimeTemplate.returningFunction(
                      'next(result, d)',
                      'result',
                    )}, onError);`,
                    `if(first) promises.push(data.p = p); else return p;`,
                  ]),
                  '} else {',
                  Template.indent(['return next(promise, d, first);']),
                  '}',
                ]),
                '} catch(error) {',
                Template.indent(['onError(error);']),
                '}',
              ],
            )}`,
            `var onExternal = ${runtimeTemplate.returningFunction(
              `external ? handleFunction(${RuntimeGlobals.initializeSharing}, data[0], 0, external, onInitialized, first) : onError()`,
              'external, _, first',
            )};`,
            `var onInitialized = ${runtimeTemplate.returningFunction(
              `handleFunction(external.get, data[1], getScope, 0, onFactory, first)`,
              '_, external, first',
            )};`,
            `var onFactory = ${runtimeTemplate.basicFunction('factory', [
              'data.p = 1;',
              `${
                RuntimeGlobals.moduleFactories
              }[id] = ${runtimeTemplate.basicFunction('module', [
                'module.exports = factory();',
              ])}`,
            ])};`,
            `handleFunction(${RuntimeGlobals.require}, data[2], 0, 0, onExternal, 1);`,
          ])});`,
        ]),
        '}',
      ])}`,
    ]);
  }
}

export default RemoteRuntimeModule;
