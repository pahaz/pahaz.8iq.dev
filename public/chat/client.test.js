describe('client.js (Оркестратор протокола)', () => {
    class MockTransport {
        constructor() { this.sent = []; this.subs = []; this.unsubs = []; }
        async connect() {}
        async subscribe(t) { this.subs.push(t); }
        async unsubscribe(t) { this.unsubs.push(t); }
        async send(t, p) { this.sent.push({ topic: t, payload: p }); }
        onMessage(h) { this.handler = h; }
    }

    const cp = new WebCryptoProvider();

    it('joinRoom: Подписывается и отправляет ANNOUNCE', async () => {
        const tr = new MockTransport();
        const km = new LocalKeyManager(cp);
        await km.generateNewIdentity("Alice");
        const client = new AppP2PClient(tr, cp, km, {});
        
        await client.joinRoom("matrix");
        
        assert(tr.subs.includes("p2p/matrix/discovery"), "Subscribed to discovery");
        assert(tr.sent.length === 1, "Sent one message");
        const packet = JSON.parse(tr.sent[0].payload);
        assert(packet.type === "ANNOUNCE", "Packet is ANNOUNCE");
        assert(packet.identityKey.length > 0, "Has identity key");
    });

    it('Сценарий Handshake: Ответ на HANDSHAKE_INIT', async () => {
        const tr = new MockTransport();
        const km = new LocalKeyManager(cp);
        const aliceIdentity = await km.generateNewIdentity("Alice");
        const client = new AppP2PClient(tr, cp, km, { onPeerListUpdated: () => {} });

        // Simulate knowing Bob
        const bobIdKey = await cp.generateIdentityKeyPair();
        const bobId = await cp.computeIdentityId(bobIdKey.publicKey);
        await km.ensurePeer(bobId, bobIdKey.publicKey, "Bob");

        // Simulate Bob's HANDSHAKE_INIT
        const bobEphemKey = await cp.generateEphemeralKeyPair();
        const bobEphemPub = await cp.exportKey(bobEphemKey.publicKey);
        const timestamp = Date.now();
        const msgId = "msg-123";
        const signData = new TextEncoder().encode(msgId + timestamp + bobEphemPub);
        const signature = await cp.sign(bobIdKey.privateKey, signData);

        const packet = {
            type: "HANDSHAKE_INIT",
            msgId,
            identityId: bobId,
            ephemeralKey: bobEphemPub,
            timestamp,
            signature: cp.arrayBufferToBase64(signature)
        };

        await client.handleIncomingMessage(`p2p/matrix/inbox/${aliceIdentity.id}`, new TextEncoder().encode(JSON.stringify(packet)));

        // Alice should send HANDSHAKE_REPLY to Bob's inbox
        const reply = tr.sent.find(s => s.topic === `p2p/matrix/inbox/${bobId}`);
        assert(reply !== undefined, "Sent reply to Bob");
        const replyPacket = JSON.parse(reply.payload);
        assert(replyPacket.type === "HANDSHAKE_REPLY", "Packet is HANDSHAKE_REPLY");
    });

    it('saveIdentity: Сохраняет переданную личность', async () => {
        const tr = new MockTransport();
        const km = new LocalKeyManager(cp);
        const client = new AppP2PClient(tr, cp, km, {});
        
        const ident = await client.generateNewIdentity("Alice");
        const originalSas = ident.sas;
        ident.username = "Alice Updated";
        await client.saveIdentity(ident);
        
        const saved = await client.getMyIdentity();
        assert(saved.username === "Alice Updated", "Username saved");
        assert(saved.sas === originalSas, "SAS preserved");
        assert(saved.id === ident.id, "ID preserved");
    });

    it('leaveRoom: Очищает состояние комнаты', async () => {
        const tr = new MockTransport();
        const km = new LocalKeyManager(cp);
        await km.generateNewIdentity("Alice");
        const client = new AppP2PClient(tr, cp, km, {});
        
        await client.joinRoom("room1");
        // Simulate some state
        client.processedMessages.add("msg1");
        await km.ensurePeer("peer1", (await cp.generateIdentityKeyPair()).publicKey);
        
        await client.leaveRoom();
        
        assert(client.currentRoom === null, "Room is null");
        assert(client.processedMessages.size === 0, "Processed messages cleared");
        assert((await km.getAllPeers()).length === 0, "Peers cleared");
    });
});
