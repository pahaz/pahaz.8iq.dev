describe('crypto.js (Криптография)', () => {
    const cp = new WebCryptoProvider();

    it('Генерация ключей: Identity и Ephemeral', async () => {
        const idKey = await cp.generateIdentityKeyPair();
        assert(idKey.publicKey instanceof CryptoKey, "Public Identity Key is CryptoKey");
        assert(idKey.privateKey instanceof CryptoKey, "Private Identity Key is CryptoKey");
        
        const ephKey = await cp.generateEphemeralKeyPair();
        assert(ephKey.publicKey instanceof CryptoKey, "Public Ephemeral Key is CryptoKey");
        assert(ephKey.privateKey instanceof CryptoKey, "Private Ephemeral Key is CryptoKey");
    });

    it('Идентичность: computeIdentityId детерминирован', async () => {
        const idKey = await cp.generateIdentityKeyPair();
        const id1 = await cp.computeIdentityId(idKey.publicKey);
        const id2 = await cp.computeIdentityId(idKey.publicKey);
        assert(id1 === id2, "Same key gives same ID");
        assert(typeof id1 === 'string' && id1.length === 64, "ID is 64-char hex string");
    });

    it('SAS: generateSas детерминирован и разный для разных данных', async () => {
        const sas1 = await cp.generateSas("deadbeef");
        const sas2 = await cp.generateSas("deadbeef");
        const sas3 = await cp.generateSas("c0ffee");
        
        assert(JSON.stringify(sas1) === JSON.stringify(sas2), "Same data same SAS");
        assert(JSON.stringify(sas1) !== JSON.stringify(sas3), "Different data different SAS");
        assert(typeof sas1 === 'string' && Array.from(sas1).length === 4, "SAS is a string of 4 emojis");
    });

    it('SAS: Использует расширенный набор emoji (минимум 256)', async () => {
        const seenEmojis = new Set();
        for (let i = 0; i < 1000; i++) {
            const sas = await cp.generateSas(i.toString(16).padStart(2, '0'));
            // sas - это теперь строка эмодзи
            Array.from(sas).forEach(e => seenEmojis.add(e));
        }
        
        assert(seenEmojis.size >= 256, `Ожидалось как минимум 256 разных эмодзи, получено ${seenEmojis.size}`);
    });

    it('ECDH: deriveSharedSecret дает одинаковые ключи', async () => {
        const alice = await cp.generateEphemeralKeyPair();
        const bob = await cp.generateEphemeralKeyPair();

        const secretA = await cp.deriveSharedSecret(alice.privateKey, bob.publicKey);
        const secretB = await cp.deriveSharedSecret(bob.privateKey, alice.publicKey);

        const expA = await cp.exportKey(secretA);
        const expB = await cp.exportKey(secretB);
        assert(expA === expB, "Derived secrets match");
    });

    it('AES-GCM: Шифрование и дешифровка', async () => {
        const key = await cp.generateSymmetricKey();
        const data = new TextEncoder().encode("Hello P2P");
        
        const encrypted = await cp.encrypt(key, data);
        const decrypted = await cp.decrypt(key, encrypted);
        
        assert(new TextDecoder().decode(decrypted) === "Hello P2P", "Decrypted text matches original");
    });

    it('AES-GCM: Ошибка при неверном ключе или данных', async () => {
        const key1 = await cp.generateSymmetricKey();
        const key2 = await cp.generateSymmetricKey();
        const data = new TextEncoder().encode("Secret");
        
        const encrypted = await cp.encrypt(key1, data);
        
        try {
            await cp.decrypt(key2, encrypted);
            assert(false, "Should throw error with wrong key");
        } catch (e) {
            assert(true, "Caught expected error");
        }

        const tampered = new Uint8Array(encrypted);
        tampered[15] ^= 0xFF; // Tamper with ciphertext
        try {
            await cp.decrypt(key1, tampered.buffer);
            assert(false, "Should throw error with tampered data");
        } catch (e) {
            assert(true, "Caught expected error for MITM");
        }
    });
});
