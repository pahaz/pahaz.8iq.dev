class LocalKeyManager {
    constructor(cryptoProvider) {
        this.crypto = cryptoProvider;
        this.myIdentity = null;
        this.peers = new Map(); // id -> Peer
        this.mySenderKeys = new Map(); // roomId -> SymmetricKey
    }

    async init() {
        const saved = localStorage.getItem('p2p_identity');
        if (saved) {
            const data = JSON.parse(saved);
            const publicKey = await this.crypto.importKey(data.publicKey, 'identity-public');
            const privateKey = await this.crypto.importKey(data.privateKey, 'identity-private');
            this.myIdentity = {
                id: data.id,
                username: data.username,
                sas: data.sas,
                keyPair: { publicKey, privateKey }
            };
        }
    }

    async generateNewIdentity(username) {
        const keyPair = await this.crypto.generateIdentityKeyPair();
        const id = await this.crypto.computeIdentityId(keyPair.publicKey);
        const sas = await this.crypto.generateSas(id);
        this.myIdentity = { id, username, sas, keyPair };
        return this.myIdentity;
    }

    async saveMyIdentity(identity) {
        this.myIdentity = identity;
        const publicKey = await this.crypto.exportKey(identity.keyPair.publicKey);
        const privateKey = await this.crypto.exportKey(identity.keyPair.privateKey);
        localStorage.setItem('p2p_identity', JSON.stringify({
            id: identity.id,
            username: identity.username,
            sas: identity.sas,
            publicKey,
            privateKey
        }));
    }

    async clearMyIdentity() {
        this.myIdentity = null;
        localStorage.removeItem('p2p_identity');
    }

    getMyIdentity() {
        return this.myIdentity;
    }

    async getMySenderKey(roomId) {
        if (!this.mySenderKeys.has(roomId)) {
            const key = await this.crypto.generateSymmetricKey();
            this.mySenderKeys.set(roomId, key);
        }
        return this.mySenderKeys.get(roomId);
    }

    async rotateMySenderKey(roomId) {
        const key = await this.crypto.generateSymmetricKey();
        this.mySenderKeys.set(roomId, key);
        return key;
    }

    async ensurePeer(id, key, username) {
        if (this.peers.has(id)) {
            const peer = this.peers.get(id);
            const exportedExisting = await this.crypto.exportKey(peer.identityKey);
            const exportedNew = await this.crypto.exportKey(key);
            if (exportedExisting !== exportedNew) {
                throw new Error("SECURITY ERROR: Identity key mismatch for peer " + id);
            }
            if (username) peer.username = username;
            return peer;
        }
        const sas = await this.crypto.generateSas(id);
        const peer = {
            id,
            identityKey: key,
            username: username || 'Unknown',
            sas,
            trustStatus: 'new',
            sharedSecrets: [],
            senderKeys: new Map()
        };
        this.peers.set(id, peer);
        return peer;
    }

    async getPeer(id) {
        return this.peers.get(id);
    }

    async getAllPeers() {
        return Array.from(this.peers.values());
    }

    async setPeerTrust(id, status) {
        const peer = this.peers.get(id);
        if (peer) {
            peer.trustStatus = status;
        }
    }

    async saveSharedSecret(peerId, secret) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.sharedSecrets.push({ key: secret, validFrom: Date.now() });
        }
    }

    async getSharedSecret(peerId, timestamp) {
        const peer = this.peers.get(peerId);
        if (!peer || peer.sharedSecrets.length === 0) return undefined;
        // For simplicity, return the latest one for now
        return peer.sharedSecrets[peer.sharedSecrets.length - 1].key;
    }

    async savePeerSenderKey(peerId, roomId, key, timestamp) {
        const peer = this.peers.get(peerId);
        if (peer) {
            if (!peer.senderKeys.has(roomId)) {
                peer.senderKeys.set(roomId, []);
            }
            peer.senderKeys.get(roomId).push({ key, validFrom: timestamp });
        }
    }

    async getPeerSenderKey(peerId, roomId, timestamp) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.senderKeys.has(roomId)) return undefined;
        const keys = peer.senderKeys.get(roomId);
        // Find the key that was valid at the given timestamp
        for (let i = keys.length - 1; i >= 0; i--) {
            if (keys[i].validFrom <= timestamp) {
                return keys[i].key;
            }
        }
        return keys[keys.length - 1].key;
    }
}
