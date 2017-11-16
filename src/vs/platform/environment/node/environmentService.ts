/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentService, ParsedArgs, IDebugParams, IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';
import * as crypto from 'crypto';
import * as paths from 'vs/base/node/paths';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import URI from 'vs/base/common/uri';
import { generateUuid, isUUID } from 'vs/base/common/uuid';
import { memoize } from 'vs/base/common/decorators';
import pkg from 'vs/platform/node/package';
import product from 'vs/platform/node/product';

// Read this before there's any chance it is overwritten
// Related to https://github.com/Microsoft/vscode/issues/30624
const xdgRuntimeDir = process.env['XDG_RUNTIME_DIR'];

function getNixIPCHandle(userDataPath: string, type: string): string {
	if (xdgRuntimeDir) {
		return path.join(xdgRuntimeDir, `${pkg.name}-${pkg.version}-${type}.sock`);
	}

	return path.join(userDataPath, `${pkg.version}-${type}.sock`);
}

function getWin32IPCHandle(userDataPath: string, type: string): string {
	const scope = crypto.createHash('md5').update(userDataPath).digest('hex');
	return `\\\\.\\pipe\\${scope}-${pkg.version}-${type}-sock`;
}

function getIPCHandle(userDataPath: string, type: string): string {
	if (process.platform === 'win32') {
		return getWin32IPCHandle(userDataPath, type);
	} else {
		return getNixIPCHandle(userDataPath, type);
	}
}

export function getInstallSourcePath(userDataPath: string): string {
	return path.join(userDataPath, 'installSource');
}

export class EnvironmentService implements IEnvironmentService {

	_serviceBrand: any;

	get args(): ParsedArgs { return this._args; }

	@memoize
	get appRoot(): string { return path.dirname(URI.parse(require.toUrl('')).fsPath); }

	get execPath(): string { return this._execPath; }

	@memoize
	get userHome(): string { return os.homedir(); }

	@memoize
	get userDataPath(): string { return parseUserDataDir(this._args, process); }

	get appNameLong(): string { return product.nameLong; }

	get appQuality(): string { return product.quality; }

	@memoize
	get appSettingsHome(): string { return path.join(this.userDataPath, 'User'); }

	@memoize
	get appSettingsPath(): string { return path.join(this.appSettingsHome, 'settings.json'); }

	@memoize
	get settingsSearchBuildId(): number { return product.settingsSearchBuildId; }

	@memoize
	get settingsSearchUrl(): string { return product.settingsSearchUrl; }

	@memoize
	get appKeybindingsPath(): string { return path.join(this.appSettingsHome, 'keybindings.json'); }

	@memoize
	get isExtensionDevelopment(): boolean { return !!this._args.extensionDevelopmentPath; }

	@memoize
	get backupHome(): string { return path.join(this.userDataPath, 'Backups'); }

	@memoize
	get backupWorkspacesPath(): string { return path.join(this.backupHome, 'workspaces.json'); }

	@memoize
	get workspacesHome(): string { return path.join(this.userDataPath, 'Workspaces'); }

	@memoize
	get extensionsPath(): string { return parsePathArg(this._args['extensions-dir'], process) || process.env['VSCODE_EXTENSIONS'] || path.join(this.userHome, product.dataFolderName, 'extensions'); }

	@memoize
	get extensionDevelopmentPath(): string { return this._args.extensionDevelopmentPath ? path.normalize(this._args.extensionDevelopmentPath) : this._args.extensionDevelopmentPath; }

	@memoize
	get extensionTestsPath(): string { return this._args.extensionTestsPath ? path.normalize(this._args.extensionTestsPath) : this._args.extensionTestsPath; }

	get disableExtensions(): boolean { return this._args['disable-extensions']; }

	get skipGettingStarted(): boolean { return this._args['skip-getting-started']; }

	@memoize
	get debugExtensionHost(): IExtensionHostDebugParams { return parseExtensionHostPort(this._args, this.isBuilt); }

	@memoize
	get debugSearch(): IDebugParams { return parseSearchPort(this._args, this.isBuilt); }

	get isBuilt(): boolean { return !process.env['VSCODE_DEV']; }
	get verbose(): boolean { return this._args.verbose; }
	get wait(): boolean { return this._args.wait; }
	get logExtensionHostCommunication(): boolean { return this._args.logExtensionHostCommunication; }

	get performance(): boolean { return this._args.performance; }

	@memoize
	get profileStartup(): { prefix: string, dir: string } | undefined {
		if (this._args['prof-startup']) {
			return {
				prefix: process.env.VSCODE_PROFILES_PREFIX,
				dir: os.homedir()
			};
		} else {
			return undefined;
		}
	}

	@memoize
	get mainIPCHandle(): string { return getIPCHandle(this.userDataPath, 'main'); }

	@memoize
	get sharedIPCHandle(): string { return getIPCHandle(this.userDataPath, 'shared'); }

	@memoize
	get nodeCachedDataDir(): string { return this.isBuilt ? path.join(this.userDataPath, 'CachedData', product.commit || new Array(41).join('0')) : undefined; }

	get disableUpdates(): boolean { return !!this._args['disable-updates']; }
	get disableCrashReporter(): boolean { return !!this._args['disable-crash-reporter']; }

	readonly machineUUID: string;

	readonly installSource: string;

	constructor(private _args: ParsedArgs, private _execPath: string) {
		const machineIdPath = path.join(this.userDataPath, 'machineid');

		try {
			this.machineUUID = fs.readFileSync(machineIdPath, 'utf8');

			if (!isUUID(this.machineUUID)) {
				throw new Error('Not a UUID');
			}
		} catch (err) {
			this.machineUUID = generateUuid();

			try {
				fs.writeFileSync(machineIdPath, this.machineUUID, 'utf8');
			} catch (err) {
				// noop
			}
		}

		try {
			this.installSource = fs.readFileSync(getInstallSourcePath(this.userDataPath), 'utf8').slice(0, 30);
		} catch (err) {
			this.installSource = '';
		}
	}
}

export function parseExtensionHostPort(args: ParsedArgs, isBuild: boolean): IExtensionHostDebugParams {
	return parseDebugPort(args.debugPluginHost, args.debugBrkPluginHost, 5870, isBuild, args.debugId);
}

export function parseSearchPort(args: ParsedArgs, isBuild: boolean): IDebugParams {
	return parseDebugPort(args.debugSearch, args.debugBrkSearch, 5876, isBuild);
}

export function parseDebugPort(debugArg: string, debugBrkArg: string, defaultBuildPort: number, isBuild: boolean, debugId?: string): IExtensionHostDebugParams {
	const portStr = debugBrkArg || debugArg;
	const port = Number(portStr) || (!isBuild ? defaultBuildPort : null);
	const brk = port ? Boolean(!!debugBrkArg) : false;
	return { port, break: brk, debugId };
}

function parsePathArg(arg: string, process: NodeJS.Process): string {
	if (!arg) {
		return undefined;
	}

	// Determine if the arg is relative or absolute, if relative use the original CWD
	// (VSCODE_CWD), not the potentially overridden one (process.cwd()).
	const resolved = path.resolve(arg);

	if (path.normalize(arg) === resolved) {
		return resolved;
	} else {
		return path.resolve(process.env['VSCODE_CWD'] || process.cwd(), arg);
	}
}

export function parseUserDataDir(args: ParsedArgs, process: NodeJS.Process): string {
	return parsePathArg(args['user-data-dir'], process) || path.resolve(paths.getDefaultUserDataPath(process.platform));
}
