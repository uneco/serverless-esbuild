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
exports.packExternalModules = void 0;
const fse = require("fs-extra");
const now = require("lodash.now");
const path = require("path");
const ramda_1 = require("ramda");
const Packagers = require("./packagers");
function rebaseFileReferences(pathToPackageRoot, moduleVersion) {
    if (/^(?:file:[^/]{2}|\.\/|\.\.\/)/.test(moduleVersion)) {
        const filePath = ramda_1.replace(/^file:/, '', moduleVersion);
        return ramda_1.replace(/\\/g, '/', `${ramda_1.startsWith('file:', moduleVersion) ? 'file:' : ''}${pathToPackageRoot}/${filePath}`);
    }
    return moduleVersion;
}
/**
 * Add the given modules to a package json's dependencies.
 */
function addModulesToPackageJson(externalModules, packageJson, pathToPackageRoot) {
    ramda_1.forEach(externalModule => {
        const splitModule = ramda_1.split('@', externalModule);
        // If we have a scoped module we have to re-add the @
        if (ramda_1.startsWith('@', externalModule)) {
            splitModule.splice(0, 1);
            splitModule[0] = '@' + splitModule[0];
        }
        let moduleVersion = ramda_1.join('@', ramda_1.tail(splitModule));
        // We have to rebase file references to the target package.json
        moduleVersion = rebaseFileReferences(pathToPackageRoot, moduleVersion);
        packageJson.dependencies = packageJson.dependencies || {};
        packageJson.dependencies[ramda_1.head(splitModule)] = moduleVersion;
    }, externalModules);
}
/**
 * Resolve the needed versions of production dependencies for external modules.
 * @this - The active plugin instance
 */
function getProdModules(externalModules, packagePath, dependencyGraph) {
    const packageJsonPath = path.join(process.cwd(), packagePath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packageJson = require(packageJsonPath);
    const prodModules = [];
    // only process the module stated in dependencies section
    if (!packageJson.dependencies) {
        return [];
    }
    // Get versions of all transient modules
    ramda_1.forEach(externalModule => {
        const moduleVersion = packageJson.dependencies[externalModule.external];
        if (moduleVersion) {
            prodModules.push(`${externalModule.external}@${moduleVersion}`);
            // Check if the module has any peer dependencies and include them too
            try {
                const modulePackagePath = path.join(path.dirname(path.join(process.cwd(), packagePath)), 'node_modules', externalModule.external, 'package.json');
                const peerDependencies = require(modulePackagePath).peerDependencies;
                if (!ramda_1.isEmpty(peerDependencies)) {
                    this.options.verbose && this.serverless.cli.log(`Adding explicit peers for dependency ${externalModule.external}`);
                    const peerModules = getProdModules.call(this, ramda_1.compose(ramda_1.map(([external]) => ({ external })), ramda_1.toPairs)(peerDependencies), packagePath, dependencyGraph);
                    Array.prototype.push.apply(prodModules, peerModules);
                }
            }
            catch (e) {
                this.serverless.cli.log(`WARNING: Could not check for peer dependencies of ${externalModule.external}`);
            }
        }
        else {
            if (!packageJson.devDependencies || !packageJson.devDependencies[externalModule.external]) {
                prodModules.push(externalModule.external);
            }
            else {
                // To minimize the chance of breaking setups we whitelist packages available on AWS here. These are due to the previously missing check
                // most likely set in devDependencies and should not lead to an error now.
                const ignoredDevDependencies = ['aws-sdk'];
                if (!ramda_1.includes(externalModule.external, ignoredDevDependencies)) {
                    // Runtime dependency found in devDependencies but not forcefully excluded
                    this.serverless.cli.log(`ERROR: Runtime dependency '${externalModule.external}' found in devDependencies.`);
                    throw new this.serverless.classes.Error(`Serverless-webpack dependency error: ${externalModule.external}.`);
                }
                this.options.verbose &&
                    this.serverless.cli.log(`INFO: Runtime dependency '${externalModule.external}' found in devDependencies. It has been excluded automatically.`);
            }
        }
    }, externalModules);
    return prodModules;
}
/**
 * We need a performant algorithm to install the packages for each single
 * function (in case we package individually).
 * (1) We fetch ALL packages needed by ALL functions in a first step
 * and use this as a base npm checkout. The checkout will be done to a
 * separate temporary directory with a package.json that contains everything.
 * (2) For each single compile we copy the whole node_modules to the compile
 * directory and create a (function) compile specific package.json and store
 * it in the compile directory. Now we start npm again there, and npm will just
 * remove the superfluous packages and optimize the remaining dependencies.
 * This will utilize the npm cache at its best and give us the needed results
 * and performance.
 */
function packExternalModules() {
    return __awaiter(this, void 0, void 0, function* () {
        const externals = ramda_1.without(['aws-sdk'], this.buildOptions.external);
        if (!externals) {
            return;
        }
        // Read plugin configuration
        const packagePath = './package.json';
        const packageJsonPath = path.join(process.cwd(), packagePath);
        // Determine and create packager
        const packager = yield Packagers.get(this.buildOptions.packager);
        // Fetch needed original package.json sections
        const sectionNames = packager.copyPackageSectionNames;
        const packageJson = this.serverless.utils.readFileSync(packageJsonPath);
        const packageSections = ramda_1.pick(sectionNames, packageJson);
        if (!ramda_1.isEmpty(packageSections)) {
            this.options.verbose &&
                this.serverless.cli.log(`Using package.json sections ${ramda_1.join(', ', ramda_1.keys(packageSections))}`);
        }
        // Get first level dependency graph
        this.options.verbose && this.serverless.cli.log(`Fetch dependency graph from ${packageJsonPath}`);
        const dependencyGraph = yield packager.getProdDependencies(path.dirname(packageJsonPath), 1);
        // (1) Generate dependency composition
        const externalModules = ramda_1.map(external => ({ external }), externals);
        const compositeModules = ramda_1.uniq(getProdModules.call(this, externalModules, packagePath, dependencyGraph));
        if (ramda_1.isEmpty(compositeModules)) {
            // The compiled code does not reference any external modules at all
            this.serverless.cli.log('No external modules needed');
            return;
        }
        // (1.a) Install all needed modules
        const compositeModulePath = this.serverless.config.servicePath;
        const compositePackageJson = path.join(compositeModulePath, 'package.json');
        // (1.a.1) Create a package.json
        const compositePackage = ramda_1.mergeRight({
            name: this.serverless.service.service,
            version: '1.0.0',
            description: `Packaged externals for ${this.serverless.service.service}`,
            private: true,
        }, packageSections);
        const relativePath = path.relative(compositeModulePath, path.dirname(packageJsonPath));
        addModulesToPackageJson(compositeModules, compositePackage, relativePath);
        this.serverless.utils.writeFileSync(compositePackageJson, JSON.stringify(compositePackage, null, 2));
        // (1.a.2) Copy package-lock.json if it exists, to prevent unwanted upgrades
        const packageLockPath = path.join(path.dirname(packageJsonPath), packager.lockfileName);
        const exists = yield fse.pathExists(packageLockPath);
        if (exists) {
            this.serverless.cli.log('Package lock found - Using locked versions');
            try {
                let packageLockFile = this.serverless.utils.readFileSync(packageLockPath);
                packageLockFile = packager.rebaseLockfile(relativePath, packageLockFile);
                if (ramda_1.is(Object)(packageLockFile)) {
                    packageLockFile = JSON.stringify(packageLockFile, null, 2);
                }
                this.serverless.utils.writeFileSync(path.join(compositeModulePath, packager.lockfileName), packageLockFile);
            }
            catch (err) {
                this.serverless.cli.log(`Warning: Could not read lock file: ${err.message}`);
            }
        }
        const start = now();
        this.serverless.cli.log('Packing external modules: ' + compositeModules.join(', '));
        yield packager.install(compositeModulePath);
        this.options.verbose && this.serverless.cli.log(`Package took [${now() - start} ms]`);
        // Prune extraneous packages - removes not needed ones
        const startPrune = now();
        yield packager.prune(compositeModulePath);
        this.options.verbose &&
            this.serverless.cli.log(`Prune: ${compositeModulePath} [${now() - startPrune} ms]`);
        // GOOGLE: Copy modules only if not google-cloud-functions
        //         GCF Auto installs the package json
        if (ramda_1.path(['service', 'provider', 'name'], this.serverless) === 'google') {
            yield fse.remove(path.join(compositeModulePath, 'node_modules'));
        }
    });
}
exports.packExternalModules = packExternalModules;
