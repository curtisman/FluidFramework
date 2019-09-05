/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { SimpleModuleInstantiationFactory, } from "@prague/aqueduct";
import { GithubCommentInstantiationFactory } from "./main";
// tslint:disable-next-line: no-var-requires no-require-imports
const pkg = require("../package.json");
export const chaincodeName = pkg.name;
/**
 * This does setup for the Container. The SimpleModuleInstantiationFactory also
 * enables dynamic loading in the EmbeddedComponentLoader.
 *
 * There are two important things here:
 * 1. Default Component name
 * 2. Map of string to factory for all components
 */
export const fluidExport = new SimpleModuleInstantiationFactory(chaincodeName, new Map([
    [chaincodeName,
        Promise.resolve(GithubCommentInstantiationFactory)],
]));
// Export necessary members from main.tsx:
export { GithubComment, GithubCommentInstantiationFactory, } from "./main";
//# sourceMappingURL=index.js.map