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
exports.Yarn = void 0;
const ramda_1 = require("ramda");
const utils_1 = require("../utils");
/**
 * Yarn packager.
 *
 * Yarn specific packagerOptions (default):
 *   flat (false) - Use --flat with install
 *   ignoreScripts (false) - Do not execute scripts during install
 */
class Yarn {
    get lockfileName() {
        return 'yarn.lock';
    }
    get copyPackageSectionNames() {
        return ['resolutions'];
    }
    get mustCopyModules() {
        return false;
    }
    getProdDependencies(cwd, depth) {
        return __awaiter(this, void 0, void 0, function* () {
            const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
            const args = ['list', `--depth=${depth || 1}`, '--json', '--production'];
            // If we need to ignore some errors add them here
            const ignoredYarnErrors = [];
            let processOutput;
            try {
                processOutput = yield utils_1.spawnProcess(command, args, { cwd });
            }
            catch (err) {
                if (err instanceof utils_1.SpawnError) {
                    // Only exit with an error if we have critical npm errors for 2nd level inside
                    const errors = ramda_1.split('\n', err.stderr);
                    const failed = ramda_1.reduce((f, error) => {
                        if (f) {
                            return true;
                        }
                        return (!ramda_1.isEmpty(error) &&
                            !ramda_1.any(ignoredError => ramda_1.startsWith(`npm ERR! ${ignoredError.npmError}`, error), ignoredYarnErrors));
                    }, false, errors);
                    if (!failed && !ramda_1.isEmpty(err.stdout)) {
                        return { stdout: err.stdout };
                    }
                }
                throw err;
            }
            const depJson = processOutput.stdout;
            const parsedTree = JSON.parse(depJson);
            const convertTrees = ramda_1.reduce((__, tree) => {
                const splitModule = ramda_1.split('@', tree.name);
                // If we have a scoped module we have to re-add the @
                if (ramda_1.startsWith('@', tree.name)) {
                    splitModule.splice(0, 1);
                    splitModule[0] = '@' + splitModule[0];
                }
                __[ramda_1.head(splitModule)] = {
                    version: ramda_1.join('@', ramda_1.tail(splitModule)),
                    dependencies: convertTrees(tree.children)
                };
                return __;
            }, {});
            const trees = ramda_1.pathOr([], ['data', 'trees'], parsedTree);
            const result = {
                problems: [],
                dependencies: convertTrees(trees)
            };
            return result;
        });
    }
    rebaseLockfile(pathToPackageRoot, lockfile) {
        const fileVersionMatcher = /[^"/]@(?:file:)?((?:\.\/|\.\.\/).*?)[":,]/gm;
        const replacements = [];
        let match;
        // Detect all references and create replacement line strings
        while ((match = fileVersionMatcher.exec(lockfile)) !== null) {
            replacements.push({
                oldRef: match[1],
                newRef: ramda_1.replace(/\\/g, '/', `${pathToPackageRoot}/${match[1]}`)
            });
        }
        // Replace all lines in lockfile
        return ramda_1.reduce((__, replacement) => ramda_1.replace(__, replacement.oldRef, replacement.newRef), lockfile, replacements);
    }
    install(cwd) {
        return __awaiter(this, void 0, void 0, function* () {
            const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
            const args = ['install', '--frozen-lockfile', '--non-interactive'];
            yield utils_1.spawnProcess(command, args, { cwd });
        });
    }
    // "Yarn install" prunes automatically
    prune(cwd) {
        return this.install(cwd);
    }
    runScripts(cwd, scriptNames) {
        return __awaiter(this, void 0, void 0, function* () {
            const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
            yield Promise.all(scriptNames.map(scriptName => utils_1.spawnProcess(command, ['run', scriptName], { cwd })));
        });
    }
}
exports.Yarn = Yarn;
