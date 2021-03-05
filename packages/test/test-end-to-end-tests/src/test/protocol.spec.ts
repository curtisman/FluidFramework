/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import {
    MessageType,
    IDocumentMessage,
    IDocumentSystemMessage,
    IClientJoin,
    ISequencedDocumentMessage,
    ISummaryTree,
    SummaryType,
    IClient,
    ISequencedClient,
} from "@fluidframework/protocol-definitions";
import { IDocumentDeltaConnection, IDocumentService } from "@fluidframework/driver-definitions";
import { ITestDriver } from "@fluidframework/test-driver-definitions";
import { createDocumentId } from "@fluidframework/test-utils";

const sequencedClient: ISequencedClient = {
    client: {
        mode: "write",
        details: {
            capabilities: { interactive: true },
        },
        permission: [],
        scopes: [],
        user: { id: "fake" },
    },
    sequenceNumber: 0,
};
const emptySummaryTree: ISummaryTree = {
    type: SummaryType.Tree,
    tree: {
        ".app": {
            type: SummaryType.Tree,
            tree: {},
        },
        ".protocol": {
            type: SummaryType.Tree,
            tree: {
                attributes: {
                    type: SummaryType.Blob,
                    content: JSON.stringify({ branch: "", minimumSequenceNumber: 0, sequenceNumber: 0 }),
                },
                quorumValues: {
                    content: JSON.stringify([]),
                    type: SummaryType.Blob,
                },
                // These shouldn't be necessary, but ODSP seems to need it.
                quorumMembers: {
                    content: JSON.stringify([["fake", sequencedClient]]),
                    type: SummaryType.Blob,
                },
                quorumProposals: {
                    content: JSON.stringify([]),
                    type: SummaryType.Blob,
                },
            },
        },
    },
};

describe("Protocol - Delta connections", () => {
    let driver: ITestDriver;
    let service: IDocumentService;
    let connection: IDocumentDeltaConnection;
    let clientSequenceNumber: number;
    before(async () => {
        driver = getFluidTestDriver() as unknown as ITestDriver;
        const factory = driver.createDocumentServiceFactory();
        const request = driver.createCreateNewRequest(createDocumentId());
        const resolvedUrl = await driver.createUrlResolver().resolve(request);
        assert(resolvedUrl);
        service = await factory.createContainer(emptySummaryTree, resolvedUrl);
    });
    beforeEach(async () => {
        const client: IClient = {
            mode: "write",
            details: {
                capabilities: { interactive: true },
            },
            permission: [],
            scopes: [],
            user: { id: "original" },
        };
        connection = await service.connectToDeltaStream(client);

        clientSequenceNumber = 0;
    });
    afterEach(() => {
        if (connection) {
            connection.close();
        }
    });

    const testInvalidMessage = async (name: string, testMessage: IDocumentMessage) => {
        return new Promise<void>((res, rej) => {
            const opHandler = (docId, messages: ISequencedDocumentMessage[]) => {
                for (const message of messages) {
                    if (message.type !== testMessage.type) {
                        continue;
                    }
                    connection.off("op", opHandler);
                    connection.off("nack", nackHandler);
                    rej(new Error(`Invalid message sequenced: ${name}`));
                }
            };

            const nackHandler = (docId, messages) => {
                connection.off("op", opHandler);
                connection.off("nack", nackHandler);
                res();
            };
            connection.on("op", opHandler);
            connection.on("nack", nackHandler);
            connection.submit([testMessage]);
        });
    };
    it("Invalid - Client generated join", async () => {
        const clientDetail: IClientJoin = {
            clientId: "blah",
            detail: {
                mode: "write",
                details: {
                    capabilities: { interactive: true },
                },
                permission: [""],
                scopes: [""],
                user: {
                    id: "blah",
                },
            },
        };
        const clientJoin: IDocumentSystemMessage = {
            clientSequenceNumber: ++clientSequenceNumber,
            // eslint-disable-next-line no-null/no-null
            contents: null,
            data: JSON.stringify(clientDetail),
            referenceSequenceNumber: -1,
            type: MessageType.ClientJoin,
        };
        await testInvalidMessage("Client generated join", clientJoin);
    });
    it("Invalid - overwritten clientId", async () => {
        const oldClientId = connection.clientId;
        try {
            // Hacking the clientId: Assuming it is using driver-base
            (connection as any).details.clientId = "blah";
            const op: IDocumentMessage = {
                clientSequenceNumber: ++clientSequenceNumber,
                // eslint-disable-next-line no-null/no-null
                contents: null,
                referenceSequenceNumber: -1,
                type: MessageType.Operation,
            };
            await testInvalidMessage("overwritten clientId", op);
        } finally {
            (connection as any).details.clientId = oldClientId;
        }
    });
    it("Invalid - Client generated leave", async () => {
        const clientLeave: IDocumentSystemMessage = {
            clientSequenceNumber: ++clientSequenceNumber,
            // eslint-disable-next-line no-null/no-null
            contents: null,
            data: JSON.stringify(connection.clientId),
            referenceSequenceNumber: -1,
            type: MessageType.ClientLeave,
        };
        await testInvalidMessage("Client generated leave", clientLeave);
    });
});
