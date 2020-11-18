/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */


import { SharedMap } from "@fluidframework/map";
import { ChannelFactoryRegistry, ITestFluidObject, TinyliciousTestObjectProvider } from "@fluidFramework/test-utils";
import { requestFluidObject } from "@fluidframework/runtime-utils";
// eslint-disable-next-line import/no-internal-modules
import { createTestFluidDataStoreFactory, ITestContainerConfig, DataObjectFactoryType } from "./test/compatUtils";

const mapId = "mapKey";
const registry: ChannelFactoryRegistry = [[mapId, SharedMap.getFactory()]];
const testContainerConfig: ITestContainerConfig = {
    fluidDataObjectType: DataObjectFactoryType.Test,
    registry,
};

const runtimeFactory = () => createTestFluidDataStoreFactory(registry);

const testObjectProvider = new TinyliciousTestObjectProvider(runtimeFactory);

async function main() {
    const container1 = await testObjectProvider.makeTestContainer(testContainerConfig);
    const dataObject1 = await requestFluidObject<ITestFluidObject>(container1, "default");
    const sharedMap1 = await dataObject1.getSharedObject<SharedMap>(mapId);
    const container2 = await testObjectProvider.loadTestContainer(testContainerConfig);
    const dataObject2 = await requestFluidObject<ITestFluidObject>(container2, "default");
    const sharedMap2 = await dataObject2.getSharedObject<SharedMap>(mapId);

    let iteration = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        dataObject1.context.hostRuntime.orderSequentially(() => {
            for (let i = 0; i < 10; i++) {
                sharedMap1.set(`a{i}`, i);
            }
        });
        dataObject2.context.hostRuntime.orderSequentially(() => {
            for (let i = 0; i < 10; i++) {
                sharedMap2.set(`a{i}`, i + 100);
            }
        });
        iteration++;

        if (iteration % 10 === 0) {
            console.log(iteration);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

main().catch((e) => { console.error("ERROR:", e); });
