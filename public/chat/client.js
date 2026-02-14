class AppP2PClient {
    constructor(transport, crypto, keys, handlers) {
        this.transport = transport;
        this.crypto = crypto;
        this.keys = keys;
        this.handlers = handlers;
        this.currentRoom = null;
        this.processedMessages = new Set();
        this.pendingEphemeralKeys = new Map(); // peerId -> ephemeralKeyPair
    }

    async init() {
        await this.keys.init();
        this.transport.onMessage((topic, payload) => this.handleIncomingMessage(topic, payload));
    }

    async getMyIdentity() {
        return this.keys.getMyIdentity();
    }

    async generateNewIdentity(username) {
        return await this.keys.generateNewIdentity(username);
    }

    async saveIdentity(identity) {
        await this.keys.saveMyIdentity(identity);
    }

    async regenerateIdentity(username) {
        const identity = await this.generateNewIdentity(username);
        await this.saveIdentity(identity);
        return identity;
    }

    async logout() {
        await this.leaveRoom();
        await this.keys.clearMyIdentity();
        this.processedMessages.clear();
        this.pendingEphemeralKeys.clear();
    }

    async joinRoom(roomId) {
        this.currentRoom = roomId;
        await this.transport.subscribe(`p2p/${roomId}/discovery`);
        await this.transport.subscribe(`p2p/${roomId}/messages`);
        const myId = this.keys.getMyIdentity().id;
        await this.transport.subscribe(`p2p/${roomId}/inbox/${myId}`);
        await this.sendAnnounce(roomId);
    }

    async leaveRoom() {
        if (this.currentRoom) {
            const roomId = this.currentRoom;
            const myId = this.keys.getMyIdentity().id;
            await this.transport.unsubscribe(`p2p/${roomId}/discovery`);
            await this.transport.unsubscribe(`p2p/${roomId}/messages`);
            await this.transport.unsubscribe(`p2p/${roomId}/inbox/${myId}`);
            this.currentRoom = null;
            this.processedMessages.clear();
            this.pendingEphemeralKeys.clear();
            // We should probably also clear the peer list from KeyManager for this room
            // but currently LocalKeyManager.peers is global. 
            // For now, let's at least clear the local caches.
            this.keys.peers.clear(); 
        }
    }

    async sendTextMessage(roomId, text) {
        const myIdentity = this.keys.getMyIdentity();
        const senderKey = await this.keys.getMySenderKey(roomId);
        const encoder = new TextEncoder();
        const payload = await this.crypto.encrypt(senderKey, encoder.encode(text));
        
        const packet = {
            type: "TEXT_MESSAGE",
            msgId: crypto.randomUUID(),
            identityId: myIdentity.id,
            payload: this.crypto.arrayBufferToBase64(payload),
            timestamp: Date.now()
        };
        await this.transport.send(`p2p/${roomId}/messages`, JSON.stringify(packet));
        
        // Add to UI as mine
        this.handlers.onMessage({ roomId, from: myIdentity.id, data: text, time: packet.timestamp, mine: true });
    }

    async sendAnnounce(roomId, targetTopic) {
        const myIdentity = this.keys.getMyIdentity();
        const pubKeyBase64 = await this.crypto.exportKey(myIdentity.keyPair.publicKey);
        const data = JSON.stringify({ username: myIdentity.username });
        const timestamp = Date.now();
        const msgId = crypto.randomUUID();
        
        const signData = new TextEncoder().encode(msgId + timestamp + data + pubKeyBase64);
        const signature = await this.crypto.sign(myIdentity.keyPair.privateKey, signData);
        
        const packet = {
            type: "ANNOUNCE",
            msgId,
            identityKey: pubKeyBase64,
            data,
            timestamp,
            signature: this.crypto.arrayBufferToBase64(signature)
        };
        
        const topic = targetTopic || `p2p/${roomId}/discovery`;
        await this.transport.send(topic, JSON.stringify(packet));
    }

    async sendHandshakeInit(roomId, peerId) {
        const myIdentity = this.keys.getMyIdentity();
        const ephemeralKeyPair = await this.crypto.generateEphemeralKeyPair();
        this.pendingEphemeralKeys.set(peerId, ephemeralKeyPair);
        
        const ephemPubKeyBase64 = await this.crypto.exportKey(ephemeralKeyPair.publicKey);
        const timestamp = Date.now();
        const msgId = crypto.randomUUID();
        
        const signData = new TextEncoder().encode(msgId + timestamp + ephemPubKeyBase64);
        const signature = await this.crypto.sign(myIdentity.keyPair.privateKey, signData);
        
        const packet = {
            type: "HANDSHAKE_INIT",
            msgId,
            identityId: myIdentity.id,
            ephemeralKey: ephemPubKeyBase64,
            timestamp,
            signature: this.crypto.arrayBufferToBase64(signature)
        };
        
        await this.transport.send(`p2p/${roomId}/inbox/${peerId}`, JSON.stringify(packet));
    }

    async sendHandshakeReply(roomId, peerId, remoteEphemeralKeyBase64) {
        const myIdentity = this.keys.getMyIdentity();
        const ephemeralKeyPair = await this.crypto.generateEphemeralKeyPair();
        const ephemPubKeyBase64 = await this.crypto.exportKey(ephemeralKeyPair.publicKey);
        
        // Derive Shared Secret
        const remoteEphemKey = await this.crypto.importKey(remoteEphemeralKeyBase64, 'ephemeral-public');
        const sharedSecret = await this.crypto.deriveSharedSecret(ephemeralKeyPair.privateKey, remoteEphemKey);
        await this.keys.saveSharedSecret(peerId, sharedSecret);
        
        const timestamp = Date.now();
        const msgId = crypto.randomUUID();
        const signData = new TextEncoder().encode(msgId + timestamp + ephemPubKeyBase64);
        const signature = await this.crypto.sign(myIdentity.keyPair.privateKey, signData);
        
        const packet = {
            type: "HANDSHAKE_REPLY",
            msgId,
            identityId: myIdentity.id,
            ephemeralKey: ephemPubKeyBase64,
            timestamp,
            signature: this.crypto.arrayBufferToBase64(signature)
        };
        
        await this.transport.send(`p2p/${roomId}/inbox/${peerId}`, JSON.stringify(packet));
    }

    async sendSenderKeyShare(roomId, peerId) {
        const myIdentity = this.keys.getMyIdentity();
        const senderKey = await this.keys.getMySenderKey(roomId);
        const sharedSecret = await this.keys.getSharedSecret(peerId);
        
        if (!sharedSecret) {
            console.error("No shared secret for peer", peerId);
            return;
        }
        
        const rawSenderKey = await window.crypto.subtle.exportKey("raw", senderKey);
        const encryptedSenderKey = await this.crypto.encrypt(sharedSecret, rawSenderKey);
        
        const packet = {
            type: "SENDER_KEY_SHARE",
            msgId: crypto.randomUUID(),
            identityId: myIdentity.id,
            encryptedSenderKey: this.crypto.arrayBufferToBase64(encryptedSenderKey),
            timestamp: Date.now()
        };
        
        await this.transport.send(`p2p/${roomId}/inbox/${peerId}`, JSON.stringify(packet));
    }

    async markPeerTrust(peerId, status) {
        await this.keys.setPeerTrust(peerId, status);
        if (status === 'verified' && this.currentRoom) {
            await this.sendSenderKeyShare(this.currentRoom, peerId);
        }
        this.handlers.onPeerListUpdated(await this.keys.getAllPeers());
    }

    async handleIncomingMessage(topic, rawData) {
        const textDecoder = new TextDecoder();
        const packet = JSON.parse(textDecoder.decode(rawData));
        
        if (this.processedMessages.has(packet.msgId)) return;
        this.processedMessages.add(packet.msgId);
        
        const myIdentity = this.keys.getMyIdentity();
        // Skip our own messages because we add them to UI locally when sending
        if (packet.identityId === myIdentity?.id) return;
        // For ANNOUNCE, the identityId is not in the packet root, but we can compute it if needed
        // but let's check packet.type first.

        // Timestamp check (optional but recommended)
        if (Date.now() - packet.timestamp > 30000) {
            console.warn("Message too old, ignoring", packet);
            // return; // Some MQTT brokers might replay old messages
        }

        const roomId = topic.split('/')[1];
        
        try {
            switch (packet.type) {
                case "ANNOUNCE":
                    await this.onAnnounce(roomId, packet, topic);
                    break;
                case "HANDSHAKE_INIT":
                    await this.onHandshakeInit(roomId, packet);
                    break;
                case "HANDSHAKE_REPLY":
                    await this.onHandshakeReply(roomId, packet);
                    break;
                case "SENDER_KEY_SHARE":
                    await this.onSenderKeyShare(roomId, packet);
                    break;
                case "TEXT_MESSAGE":
                    await this.onTextMessage(roomId, packet);
                    break;
            }
        } catch (e) {
            console.error("Error handling packet", packet.type, e);
            this.handlers.onAlert?.("Security or logic error: " + e.message);
        }
    }

    async onAnnounce(roomId, packet, topic) {
        const pubKey = await this.crypto.importKey(packet.identityKey, 'identity-public');
        const id = await this.crypto.computeIdentityId(pubKey);
        
        // Skip our own announce
        if (id === this.keys.getMyIdentity().id) return;
        
        const signData = new TextEncoder().encode(packet.msgId + packet.timestamp + packet.data + packet.identityKey);
        const signature = this.crypto.base64ToArrayBuffer(packet.signature);
        const isValid = await this.crypto.verify(pubKey, signature, signData);
        
        if (!isValid) throw new Error("Invalid ANNOUNCE signature");
        
        const meta = JSON.parse(packet.data);
        const peer = await this.keys.ensurePeer(id, pubKey, meta.username);
        
        this.handlers.onPeerListUpdated(await this.keys.getAllPeers());
        
        // If it was in discovery, we should reply with our announce personally if we are not the sender
        if (id !== this.keys.getMyIdentity().id) {
            const safeUsername = meta.username || 'Unknown';
            const sasStr = peer.sas;
            this.handlers.onMessage({ roomId, from: 'system', data: `${safeUsername} ${sasStr} joined the chat`, time: packet.timestamp });

            if (topic.endsWith('/discovery')) {
                await this.sendAnnounce(roomId, `p2p/${roomId}/inbox/${id}`);
                // Also start handshake
                await this.sendHandshakeInit(roomId, id);
            }
        }
    }

    async onHandshakeInit(roomId, packet) {
        const peer = await this.keys.getPeer(packet.identityId);
        if (!peer) return;
        
        const signData = new TextEncoder().encode(packet.msgId + packet.timestamp + packet.ephemeralKey);
        const signature = this.crypto.base64ToArrayBuffer(packet.signature);
        const isValid = await this.crypto.verify(peer.identityKey, signature, signData);
        
        if (!isValid) throw new Error("Invalid HANDSHAKE_INIT signature");
        
        await this.sendHandshakeReply(roomId, packet.identityId, packet.ephemeralKey);
    }

    async onHandshakeReply(roomId, packet) {
        const peer = await this.keys.getPeer(packet.identityId);
        if (!peer) return;
        
        const signData = new TextEncoder().encode(packet.msgId + packet.timestamp + packet.ephemeralKey);
        const signature = this.crypto.base64ToArrayBuffer(packet.signature);
        const isValid = await this.crypto.verify(peer.identityKey, signature, signData);
        
        if (!isValid) throw new Error("Invalid HANDSHAKE_REPLY signature");
        
        const myEphemKeyPair = this.pendingEphemeralKeys.get(packet.identityId);
        if (!myEphemKeyPair) return;
        
        const remoteEphemKey = await this.crypto.importKey(packet.ephemeralKey, 'ephemeral-public');
        const sharedSecret = await this.crypto.deriveSharedSecret(myEphemKeyPair.privateKey, remoteEphemKey);
        await this.keys.saveSharedSecret(packet.identityId, sharedSecret);
        this.pendingEphemeralKeys.delete(packet.identityId);
        
        console.log("Handshake complete with", packet.identityId);
        // If we already trust them, share our key
        if (peer.trustStatus === 'verified') {
            await this.sendSenderKeyShare(roomId, packet.identityId);
        }
    }

    async onSenderKeyShare(roomId, packet) {
        const peer = await this.keys.getPeer(packet.identityId);
        if (!peer) return;
        
        const sharedSecret = await this.keys.getSharedSecret(packet.identityId);
        if (!sharedSecret) return;
        
        const encryptedKey = this.crypto.base64ToArrayBuffer(packet.encryptedSenderKey);
        const decryptedKeyBuffer = await this.crypto.decrypt(sharedSecret, encryptedKey);
        const senderKey = await this.crypto.importKey(this.crypto.arrayBufferToBase64(decryptedKeyBuffer), 'symmetric');
        
        await this.keys.savePeerSenderKey(packet.identityId, roomId, senderKey, packet.timestamp);
        console.log("Received sender key from", peer.username);
    }

    async onTextMessage(roomId, packet) {
        const peer = await this.keys.getPeer(packet.identityId);
        if (!peer) return;
        
        const senderKey = await this.keys.getPeerSenderKey(packet.identityId, roomId, packet.timestamp);
        if (!senderKey) {
            this.handlers.onMessage({ roomId, from: packet.identityId, data: "🔒 Encrypted message (No key)", time: packet.timestamp });
            return;
        }
        
        const encryptedPayload = this.crypto.base64ToArrayBuffer(packet.payload);
        try {
            const decryptedBuffer = await this.crypto.decrypt(senderKey, encryptedPayload);
            const text = new TextDecoder().decode(decryptedBuffer);
            this.handlers.onMessage({ roomId, from: packet.identityId, data: text, time: packet.timestamp });
        } catch (e) {
            this.handlers.onMessage({ roomId, from: packet.identityId, data: "❌ Decryption failed", time: packet.timestamp });
        }
    }
}
