/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import assert from "assert";
import { IUrlResolver, IDocumentServiceFactory, IDocumentDeltaConnection } from "@fluidframework/driver-definitions";
import { RouterliciousDocumentServiceFactory } from "@fluidframework/routerlicious-driver";
import {
    IDocumentMessage,
    ISequencedDocumentMessage,
    MessageType,
} from "@fluidframework/protocol-definitions";
import { InsecureTokenProvider, InsecureUrlResolver } from "@fluidframework/test-runtime-utils";
import { v4 as uuid } from "uuid";
import { TestObjectProviderCommon } from "./baseTestObjectProvider";
import { debug } from "./debug";
import { fluidEntryPoint } from "./localCodeLoader";
import { OpProcessingController } from "./opProcessingController";

class DeltaConnectionMonitor {
    private pendingCount: number = 0;
    private _latestSequenceNumber = -1;
    constructor() {
    }

    public initialize(deltaConnection: IDocumentDeltaConnection, latestSequenceNumber: number) {
        // Monkey patch the deltaConnection to track pending work by monitoring inbound and outbound ops
        const oldSubmit = deltaConnection.submit.bind(deltaConnection);
        deltaConnection.submit = (messages: IDocumentMessage[]) => {
            oldSubmit(messages);
            this.outbound(messages, deltaConnection);
        };
        deltaConnection.on("op", (documentId: string, messages: ISequencedDocumentMessage[]) => {
            setImmediate(() => this.inbound(messages, deltaConnection));
        });

        this._latestSequenceNumber = latestSequenceNumber;
        this.trace("ADD", deltaConnection.clientId);
    }

    public get latestSequenceNumber() {
        return this._latestSequenceNumber;
    }

    public hasPendingWork() {
        return this.pendingCount !== 0;
    }

    private inbound(messages: ISequencedDocumentMessage[], deltaConnection: IDocumentDeltaConnection) {
        for (const message of messages) {
            this._latestSequenceNumber = message.sequenceNumber;
            if (message.clientId !== undefined && message.clientId !== deltaConnection.clientId) {
                this.trace("SEQ", deltaConnection.clientId, message.type);
                continue;
            }

            // Need to filter system messages
            switch (message.type) {
                // These are generated by the server, don't count
                case MessageType.ClientJoin:
                case MessageType.ClientLeave:
                case MessageType.NoOp:
                case MessageType.NoClient:
                    this.trace("SEQ", deltaConnection.clientId, message.type);
                    break;
                default:
                    assert(this.pendingCount);
                    this.pendingCount--;
                    this.trace("IN", deltaConnection.clientId, message.type);
            }
        }
    }

    private outbound(messages: IDocumentMessage[], deltaConnection: IDocumentDeltaConnection) {
        for (const message of messages) {
            switch (message.type) {
                case MessageType.NoOp:
                    break;
                case MessageType.Summarize:
                    this.pendingCount += 2; // expect SummaryAck too.
                    this.trace("OUT", deltaConnection.clientId, message.type);
                    break;
                default:
                    this.pendingCount++;
                    this.trace("OUT", deltaConnection.clientId, message.type);
                    break;
            }
        }
    }

    public trace(action: string, clientId: string, op?: string) {
        debug(`DeltaConnectionMonitor: ${action.padEnd(3)}: ${clientId} `
            + `pending:${this.pendingCount} seq:${this.latestSequenceNumber} ${op ?? ""}`);
    }
}

class DeltaConnectionMonitorManager {
    private readonly deltaConnectionManager = new Set<DeltaConnectionMonitor>();

    public add(monitor: DeltaConnectionMonitor) {
        this.deltaConnectionManager.add(monitor);
    }

    public remove(monitor: DeltaConnectionMonitor) {
        this.deltaConnectionManager.delete(monitor);
    }

    public async hasPendingWork() {
        let latestSequenceNumber = -1;
        for (const monitor of this.deltaConnectionManager) {
            if (monitor.hasPendingWork()) {
                return true;
            }
            if (latestSequenceNumber === -1) {
                latestSequenceNumber = monitor.latestSequenceNumber;
            } else if (latestSequenceNumber !== monitor.latestSequenceNumber) {
                return true;
            }
        }
        return false;
    }

    public get latestSequenceNumber() {
        let latest = -1;
        for (const monitor of this.deltaConnectionManager) {
            if (monitor.latestSequenceNumber > latest) {
                latest = monitor.latestSequenceNumber;
            }
        }
        return latest;
    }
}

function mixinDeltaConnectionMonitor(
    documentServiceFactory: IDocumentServiceFactory,
    manager: DeltaConnectionMonitorManager,
) {
    const oldCreateDocumentService = documentServiceFactory.createDocumentService.bind(documentServiceFactory);
    documentServiceFactory.createDocumentService = async (...args) => {
        const documentService = await oldCreateDocumentService(...args);
        const oldConnectToDeltaStream = documentService.connectToDeltaStream.bind(documentService);
        documentService.connectToDeltaStream = async (...args2) => {
            // Need to create the delta connection monitor first and add it to the manager
            // So that we know we are trying to connect and thus has pending work
            const monitor = new DeltaConnectionMonitor();
            manager.add(monitor);

            const deltaConnection = await oldConnectToDeltaStream(...args2);

            // initialize the monitor with deltaConnection, and initialize the latest seq with all that we have seen
            // as the new client will eventually catch up and all the op before is inconsequential
            monitor.initialize(deltaConnection, manager.latestSequenceNumber);

            // Monkey patch close to remove the monitor.
            const oldClose = deltaConnection.close.bind(deltaConnection);
            deltaConnection.close = () => {
                monitor.trace("DEL", deltaConnection.clientId);
                oldClose();
                manager.remove(monitor);
            };
            return deltaConnection;
        };
        return documentService;
    };
}

export class TinyliciousTestObjectProvider<TestContainerConfigType>
    extends TestObjectProviderCommon<TestContainerConfigType> {
    private _documentId: string | undefined;
    private _documentServiceFactory: IDocumentServiceFactory | undefined;
    private _urlResolver: IUrlResolver | undefined;
    private _opProcessingController: OpProcessingController | undefined;
    private deltaConnectionMonitorManager: DeltaConnectionMonitorManager = new DeltaConnectionMonitorManager();

    constructor(
        createFluidEntryPoint: (testContainerConfig?: TestContainerConfigType) => fluidEntryPoint,
    ) {
        super(createFluidEntryPoint);
    }

    get documentId() {
        if (this._documentId === undefined) {
            this._documentId = uuid();
        }
        return this._documentId;
    }

    get documentLoadUrl() {
        return `fluid-test://localhost/tinylicious/${this.documentId}`;
    }

    get documentServiceFactory() {
        if (!this._documentServiceFactory) {
            const tinyliciousTokenProvider = new InsecureTokenProvider(
                "tinylicious",
                this.documentId,
                "12345",
                { id: "test" });
            this._documentServiceFactory = new RouterliciousDocumentServiceFactory(tinyliciousTokenProvider);
            mixinDeltaConnectionMonitor(this._documentServiceFactory, this.deltaConnectionMonitorManager);
        }
        return this._documentServiceFactory;
    }

    get urlResolver() {
        if (!this._urlResolver) {
            this._urlResolver = new InsecureUrlResolver(
                "http://localhost:3000",
                "http://localhost:3000",
                "http://localhost:3000",
                "tinylicious",
                "12345",
                true);
        }
        return this._urlResolver;
    }

    get opProcessingController() {
        if (!this._opProcessingController) {
            this._opProcessingController = new OpProcessingController(this.deltaConnectionMonitorManager);
        }
        return this._opProcessingController;
    }

    public async reset() {
        this.deltaConnectionMonitorManager = new DeltaConnectionMonitorManager();
        this._documentServiceFactory = undefined;
        this._opProcessingController = undefined;
        this._documentId = undefined;
    }
}
