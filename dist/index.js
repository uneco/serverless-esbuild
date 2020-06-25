"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EsbuildPlugin = void 0;
const esbuild_1 = require("esbuild");
const fs = require("fs-extra");
const globby = require("globby");
const path = require("path");
const ramda_1 = require("ramda");
const helper_1 = require("./helper");
const packExternalModules_1 = require("./packExternalModules");
const SERVERLESS_FOLDER = '.serverless';
const BUILD_FOLDER = '.build';
const DEFAULT_BUILD_OPTIONS = {
    bundle: true,
    target: 'es2019',
    external: ['aws-sdk'],
    packager: 'yarn',
};
class EsbuildPlugin {
    constructor(serverless, options) {
        var _a, _b;
        this.serverless = serverless;
        this.options = options;
        this.packExternalModules = packExternalModules_1.packExternalModules.bind(this);
        const concatUniq = ramda_1.compose(ramda_1.uniq, ramda_1.concat);
        const withDefaultOptions = ramda_1.mergeWith(concatUniq, DEFAULT_BUILD_OPTIONS);
        this.buildOptions = withDefaultOptions((_b = (_a = this.serverless.service.custom) === null || _a === void 0 ? void 0 : _a.esbuild) !== null && _b !== void 0 ? _b : {});
        this.hooks = {
            'before:run:run': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            }),
            'before:offline:start': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            }),
            'before:offline:start:init': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            }),
            'before:package:createDeploymentArtifacts': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            }),
            'after:package:createDeploymentArtifacts': () => __awaiter(this, void 0, void 0, function* () {
                yield this.cleanup();
            }),
            'before:deploy:function:packageFunction': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            }),
            'after:deploy:function:packageFunction': () => __awaiter(this, void 0, void 0, function* () {
                yield this.cleanup();
            }),
            'before:invoke:local:invoke': () => __awaiter(this, void 0, void 0, function* () {
                yield this.bundle();
                yield this.packExternalModules();
                yield this.copyExtras();
            })
        };
    }
    get functions() {
        if (this.options.function) {
            return {
                [this.options.function]: this.serverless.service.getFunction(this.options.function)
            };
        }
        return this.serverless.service.functions;
    }
    get rootFileNames() {
        return helper_1.extractFileNames(this.originalServicePath, this.serverless.service.provider.name, this.functions);
    }
    prepare() {
        // exclude serverless-esbuild
        for (const fnName in this.functions) {
            const fn = this.serverless.service.getFunction(fnName);
            fn.package = fn.package || {
                exclude: [],
                include: [],
            };
            // Add plugin to excluded packages or an empty array if exclude is undefined
            fn.package.exclude = [...new Set([...fn.package.exclude || [], 'node_modules/serverless-esbuild'])];
        }
    }
    bundle() {
        return __awaiter(this, void 0, void 0, function* () {
            this.prepare();
            this.serverless.cli.log('Compiling with esbuild...');
            if (!this.originalServicePath) {
                // Save original service path and functions
                this.originalServicePath = this.serverless.config.servicePath;
                // Fake service path so that serverless will know what to zip
                this.serverless.config.servicePath = path.join(this.originalServicePath, BUILD_FOLDER);
            }
            yield Promise.all(this.rootFileNames.map(entry => {
                const config = Object.assign(Object.assign({}, this.buildOptions), { entryPoints: [entry], outdir: path.join(this.originalServicePath, BUILD_FOLDER, path.dirname(entry)), platform: 'node' });
                return esbuild_1.build(config);
            }));
            this.serverless.cli.log('Compiling completed.');
        });
    }
    /** Link or copy extras such as node_modules or package.include definitions */
    copyExtras() {
        return __awaiter(this, void 0, void 0, function* () {
            const { service } = this.serverless;
            // include any "extras" from the "include" section
            if (service.package.include && service.package.include.length > 0) {
                const files = yield globby(service.package.include);
                for (const filename of files) {
                    const destFileName = path.resolve(path.join(BUILD_FOLDER, filename));
                    const dirname = path.dirname(destFileName);
                    if (!fs.existsSync(dirname)) {
                        fs.mkdirpSync(dirname);
                    }
                    if (!fs.existsSync(destFileName)) {
                        fs.copySync(path.resolve(filename), path.resolve(path.join(BUILD_FOLDER, filename)));
                    }
                }
            }
        });
    }
    /**
     * Move built code to the serverless folder, taking into account individual
     * packaging preferences.
     */
    moveArtifacts() {
        return __awaiter(this, void 0, void 0, function* () {
            const { service } = this.serverless;
            yield fs.copy(path.join(this.originalServicePath, BUILD_FOLDER, SERVERLESS_FOLDER), path.join(this.originalServicePath, SERVERLESS_FOLDER));
            if (this.options.function) {
                const fn = service.getFunction(this.options.function);
                fn.package.artifact = path.join(this.originalServicePath, SERVERLESS_FOLDER, path.basename(fn.package.artifact));
                return;
            }
            if (service.package.individually) {
                const functionNames = service.getAllFunctions();
                functionNames.forEach(name => {
                    service.getFunction(name).package.artifact = path.join(this.originalServicePath, SERVERLESS_FOLDER, path.basename(service.getFunction(name).package.artifact));
                });
                return;
            }
            service.package.artifact = path.join(this.originalServicePath, SERVERLESS_FOLDER, path.basename(service.package.artifact));
        });
    }
    cleanup() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.moveArtifacts();
            // Restore service path
            this.serverless.config.servicePath = this.originalServicePath;
            // Remove temp build folder
            fs.removeSync(path.join(this.originalServicePath, BUILD_FOLDER));
        });
    }
}
exports.EsbuildPlugin = EsbuildPlugin;
module.exports = EsbuildPlugin;
