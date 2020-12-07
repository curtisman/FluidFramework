/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { LeafTask } from "./leafTask";
import { TscTask, TscDependentTask } from "./tscTask";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import * as JSON5 from "json5";

abstract class LintBaseTask extends TscDependentTask {
    protected addDependentTasks(dependentTasks: LeafTask[]) {
        for (const child of this.node.dependentPackages) {
            // TODO: Need to look at the output from tsconfig
            if (this.addChildTask(dependentTasks, child, "tsc")) {
                this.logVerboseDependency(child, "tsc");
            }
        }
        super.addDependentTasks(dependentTasks);
    }
};

export class TsLintTask extends LintBaseTask {
    protected get doneFile() {
        // TODO: This assume there is only one tslint task per package
        return "tslint.done.build.log";
    }

    protected get configFileFullPath() {
        return this.getPackageFileFullPath("tslint.json");
    }
}

export class EsLintTask extends LintBaseTask {
    private _configFileFullPath: string | undefined
    protected get doneFile() {
        // TODO: This assume there is only one eslint task per package
        return "eslint.done.build.log";
    }

    protected get configFileFullPath() {
        if (!this._configFileFullPath) {
            const possibleConfig = [".eslintrc", ".eslintrc.js", ".eslintrc.json"];
            for (const configFile of possibleConfig) {
                const configFileFullPath = this.getPackageFileFullPath(configFile);
                if (existsSync(configFileFullPath)) {
                    this._configFileFullPath = configFileFullPath;
                    break;
                }
            }
            if (!this._configFileFullPath) {
                throw new Error(`Unable to find config file for eslint ${this.command}`);
            }
        }
        return this._configFileFullPath;
    }

    protected addDependentTasks(dependentTasks: LeafTask[]) {
        let config: any;
        try {
            if (path.parse(this.configFileFullPath).ext !== ".js") {
                // TODO: cleanup double read for TscDependentTask.getDoneFileContent and there.
                const configFile = readFileSync(this.configFileFullPath, "utf8");
                config = JSON5.parse(configFile);
            } else {
                config = require(this.configFileFullPath);
                if (config === undefined) {
                    throw new Error("Exports not found");
                }
            }
        } catch (e) {
            throw new Error(`Unable to parse options from ${this.configFileFullPath}. ${e}`)
        }
        if (config.parserOptions?.project) {
            for (const tsConfigPath of config.parserOptions?.project) {
                const fullTsConfigPath = this.getPackageFileFullPath(tsConfigPath);
                const task = this.node.findTask("tsc", { tsConfig: fullTsConfigPath });
                if (!task) {
                    throw new Error(`Unable to find tsc task matching ${fullTsConfigPath} specified in ${this.configFileFullPath}`);
                }
                this.tscTasks.push(task as TscTask);
                this.logVerboseDependency(this.node, task.command);
            }
        } else {
            super.addDependentTasks(dependentTasks);
        }
    }
}

export class TsFormatTask extends LintBaseTask {
    protected get doneFile() {
        // TODO: This assume there is only one tsfmt task per package
        return "tsfmt.done.build.log";
    }

    protected get configFileFullPath() {
        // Currently there's no package-level config file, so just use tsconfig.json
        return this.getPackageFileFullPath("tsconfig.json");
    }
}
