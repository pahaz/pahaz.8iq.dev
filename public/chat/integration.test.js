describe('Real Network E2E Flow (Alice & Bob)', () => {
    const BROKER = 'wss://broker.hivemq.com:8884/mqtt';

    async function createClient(name) {
        const cp = new WebCryptoProvider();
        const transport = new MqttTransport();
        const keys = new LocalKeyManager(cp);
        const messages = [];
        const peers = { list: [] };
        
        const handlers = {
            onMessage: (m) => messages.push(m),
            onPeerListUpdated: (p) => { peers.list = p; },
            onAlert: (a) => console.warn(`[${name}] ALERT:`, a)
        };
        
        const client = new AppP2PClient(transport, cp, keys, handlers);
        const ident = await client.generateNewIdentity(name);
        await client.saveIdentity(ident);
        await transport.connect([BROKER]);
        await client.init();
        
        return { client, transport, keys, messages, peers };
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function waitFor(predicate, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (predicate()) return true;
            await delay(100);
        }
        return false;
    }

    it('Полный цикл: Discovery -> Handshake -> Trust -> Chat', async () => {
        const room = 'test-room-' + crypto.randomUUID();
        console.log("Testing in room:", room);

        const alice = await createClient("Alice");
        const bob = await createClient("Bob");

        try {
            // Step 1: Join
            await alice.client.joinRoom(room);
            await bob.client.joinRoom(room);

            // Wait for discovery
            const discovered = await waitFor(() => 
                alice.peers.list.some(p => p.username === "Bob") && 
                bob.peers.list.some(p => p.username === "Alice")
            );

            assert(discovered, "Alice and Bob discovered each other");

            // Wait for system messages
            const systemMessagesReceived = await waitFor(() => 
                alice.messages.some(m => m.from === 'system' && m.data.includes("Bob") && m.data.includes("joined the chat")) &&
                bob.messages.some(m => m.from === 'system' && m.data.includes("Alice") && m.data.includes("joined the chat"))
            );
            assert(systemMessagesReceived, "System messages about joining received");

            // Check system messages for SAS
            const bobInAliceSystem = alice.messages.find(m => m.from === 'system' && m.data.includes("Bob") && m.data.includes("joined the chat"));
            const bobPeerInAlice = alice.peers.list.find(p => p.username === "Bob");
            const bobSasStr = bobPeerInAlice.sas;
            assert(bobInAliceSystem.data.includes(bobSasStr), "Alice sees Bob's SAS in system message");

            const aliceInBobSystem = bob.messages.find(m => m.from === 'system' && m.data.includes("Alice") && m.data.includes("joined the chat"));
            const alicePeerInBob = bob.peers.list.find(p => p.username === "Alice");
            const aliceSasStr = alicePeerInBob.sas;
            assert(aliceInBobSystem.data.includes(aliceSasStr), "Bob sees Alice's SAS in system message");

            const aliceId = alice.keys.getMyIdentity().id;
            const bobId = bob.keys.getMyIdentity().id;

            // Wait for handshake
            const handshaked = await waitFor(() => 
                alice.peers.list.find(p => p.id === bobId)?.sharedSecrets.length > 0 &&
                bob.peers.list.find(p => p.id === aliceId)?.sharedSecrets.length > 0
            );

            assert(handshaked, "Handshake completed (Shared Secret derived)");

            // Step 2: Blind chat (No trust yet)
            await alice.client.sendTextMessage(room, "Hello Bob, you can't read this yet");
            await delay(1000);
            
            assert(bob.messages.some(m => m.data.includes("🔒")), "Bob sees encrypted message");

            // Step 3: Alice trusts Bob
            await alice.client.markPeerTrust(bobId, 'verified');
            // Wait for SenderKey to be shared
            await delay(1000);

            await alice.client.sendTextMessage(room, "Now I trust you Bob");
            const bobReceived = await waitFor(() => 
                bob.messages.some(m => m.data === "Now I trust you Bob")
            );
            assert(bobReceived, "Bob received decrypted message from Alice");

            // Check that Alice doesn't have duplicate of her own message
            const aliceOwnMessages = alice.messages.filter(m => m.data === "Now I trust you Bob");
            assert(aliceOwnMessages.length === 1, "Alice should see her own message only once");

            // Bob still can't be read by Alice
            await bob.client.sendTextMessage(room, "Can you hear me Alice?");
            await delay(1000);
            assert(alice.messages.some(m => m.data.includes("🔒")), "Alice sees encrypted message from Bob");

            // Step 4: Bob trusts Alice
            await bob.client.markPeerTrust(aliceId, 'verified');
            await delay(1000);

            await bob.client.sendTextMessage(room, "I trust you too Alice");
            const aliceReceived = await waitFor(() => 
                alice.messages.some(m => m.data === "I trust you too Alice")
            );
            assert(aliceReceived, "Alice received decrypted message from Bob");

        } finally {
            await alice.client.leaveRoom();
            await bob.client.leaveRoom();
            alice.transport.disconnect();
            bob.transport.disconnect();
        }
    });
});
