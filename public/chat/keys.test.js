describe('keys.js (Менеджер состояний)', () => {
    const cp = new WebCryptoProvider();

    it('Сохранение и загрузка Identity', async () => {
        const km1 = new LocalKeyManager(cp);
        const ident = await km1.generateNewIdentity("TestUser");
        await km1.saveMyIdentity(ident);
        
        const km2 = new LocalKeyManager(cp);
        await km2.init();
        const loaded = km2.getMyIdentity();
        
        assert(loaded.username === "TestUser", "Username matches");
        assert(loaded.id === ident.id, "ID matches");
        assert(loaded.keyPair.publicKey instanceof CryptoKey, "Public key loaded as CryptoKey");
    });

    it('TOFU: Регистрация нового пира и ошибка при смене ключа', async () => {
        const km = new LocalKeyManager(cp);
        const idKey1 = await cp.generateIdentityKeyPair();
        const id = await cp.computeIdentityId(idKey1.publicKey);
        
        const peer = await km.ensurePeer(id, idKey1.publicKey, "Alice");
        assert(peer.trustStatus === 'new', "New peer has status 'new'");
        
        // Same key - OK
        await km.ensurePeer(id, idKey1.publicKey, "Alice 2");
        const p = await km.getPeer(id);
        assert(p.username === "Alice 2", "Username updated");

        // Different key - ERROR
        const idKey2 = await cp.generateIdentityKeyPair();
        try {
            await km.ensurePeer(id, idKey2.publicKey, "Alice Impostor");
            assert(false, "Should throw error on key mismatch");
        } catch (e) {
            assert(e.message.includes("SECURITY ERROR"), "Caught security error");
        }
    });

    it('SenderKey: Сохранение и получение по timestamp', async () => {
        const km = new LocalKeyManager(cp);
        const roomId = "test-room";
        const peerId = "peer-1";
        const key1 = await cp.generateSymmetricKey();
        const key2 = await cp.generateSymmetricKey();
        
        // Need to ensure peer exists first
        const idKey = await cp.generateIdentityKeyPair();
        await km.ensurePeer(peerId, idKey.publicKey);

        await km.savePeerSenderKey(peerId, roomId, key1, 1000);
        await km.savePeerSenderKey(peerId, roomId, key2, 2000);

        const fetched1 = await km.getPeerSenderKey(peerId, roomId, 1500);
        assert(fetched1 === key1, "Correct key for t=1500");

        const fetched2 = await km.getPeerSenderKey(peerId, roomId, 2500);
        assert(fetched2 === key2, "Correct key for t=2500");
    });
});
