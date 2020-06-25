"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnProcess = exports.SpawnError = void 0;
const childProcess = require("child_process");
const ramda_1 = require("ramda");
class SpawnError extends Error {
    constructor(message, stdout, stderr) {
        super(message);
        this.stdout = stdout;
        this.stderr = stderr;
    }
    toString() {
        return `${this.message}\n${this.stderr}`;
    }
}
exports.SpawnError = SpawnError;
/**
 * Executes a child process without limitations on stdout and stderr.
 * On error (exit code is not 0), it rejects with a SpawnProcessError that contains the stdout and stderr streams,
 * on success it returns the streams in an object.
 * @param {string} command - Command
 * @param {string[]} [args] - Arguments
 * @param {Object} [options] - Options for child_process.spawn
 */
function spawnProcess(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = childProcess.spawn(command, args, options);
        let stdout = '';
        let stderr = '';
        // Configure stream encodings
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        // Listen to stream events
        child.stdout.on('data', data => {
            stdout += data;
        });
        child.stderr.on('data', data => {
            stderr += data;
        });
        child.on('error', err => {
            reject(err);
        });
        child.on('close', exitCode => {
            if (exitCode !== 0) {
                reject(new SpawnError(`${command} ${ramda_1.join(' ', args)} failed with code ${exitCode}`, stdout, stderr));
            }
            else {
                resolve({ stdout, stderr });
            }
        });
    });
}
exports.spawnProcess = spawnProcess;
