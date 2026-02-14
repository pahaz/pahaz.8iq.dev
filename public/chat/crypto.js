class WebCryptoProvider {
    async generateIdentityKeyPair() {
        return await window.crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256",
            },
            true,
            ["sign", "verify"]
        );
    }

    async generateEphemeralKeyPair() {
        return await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256",
            },
            true,
            ["deriveKey"]
        );
    }

    async generateSymmetricKey() {
        return await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256,
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async computeIdentityId(publicKey) {
        const exported = await window.crypto.subtle.exportKey("spki", publicKey);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", exported);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateSas(data) {
        let buffer;
        if (typeof data === 'string') {
            // Конвертируем Hex строку в Uint8Array
            buffer = new Uint8Array(data.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        } else {
            buffer = new Uint8Array(data);
        }

        // Хэшируем через нативный Web Crypto API
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));

        // Превращаем первые 8 байт (64 бита) хэша в большое число.
        // Это дает нам огромный запас энтропии, полностью исключая modulo bias.
        const hexHash = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
        let entropy = BigInt("0x" + hexHash);

        // Ровно 333 эмодзи (как в Telegram), разбитые на понятные категории
        const emojis333 = [
            // 1-50: Люди и Лица
            "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬",
            // 51-100: Животные
            "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷","🕸","🦂","🐢","🐍","🦎","🦖","🦕",
            // 101-150: Водные животные и Птицы
            "🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐓","🦃","🦚","🦜","🦢","🦩","🕊","🐇","🦝","🦨",
            // 151-200: Еда и Напитки
            "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🥪",
            // 201-250: Фастфуд, Сладости
            "🥙","🧆","🌮","🌯","🥗","🥘","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕️","🍵","🧃","🥤","🍶","🍺","🍻",
            // 251-300: Природа, Погода, Растения
            "🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🎍","🎋","🍃","🍂","🍁","🍄","🐚","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐","💫","⭐️","🌟","✨","⚡️","☄️","💥",
            // 301-333: Транспорт и Символы
            "🔥","🌪","🌈","☀️","🌤","⛅️","🌥","☁️","🌦","🌧","⛈","🌩","🌨","❄️","☃️","⛄️","🌬","💨","💧","💦","☔️","☂️","🌊","🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐"
        ];

        const sas = [];
        // Извлекаем 4 эмодзи делением с остатком
        for (let i = 0; i < 4; i++) {
            sas.push(emojis333[Number(entropy % 333n)]);
            entropy = entropy / 333n;
        }

        return sas.join('');
    }

    async deriveSharedSecret(myPrivate, remotePublic) {
        return await window.crypto.subtle.deriveKey(
            {
                name: "ECDH",
                public: remotePublic,
            },
            myPrivate,
            {
                name: "AES-GCM",
                length: 256,
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async sign(privateKey, data) {
        return await window.crypto.subtle.sign(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" },
            },
            privateKey,
            data
        );
    }

    async verify(publicKey, signature, data) {
        return await window.crypto.subtle.verify(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" },
            },
            publicKey,
            signature,
            data
        );
    }

    async encrypt(key, data) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            key,
            data
        );
        const result = new Uint8Array(iv.length + encrypted.byteLength);
        result.set(iv);
        result.set(new Uint8Array(encrypted), iv.length);
        return result.buffer;
    }

    async decrypt(key, encryptedPackage) {
        const data = new Uint8Array(encryptedPackage);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        return await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            key,
            ciphertext
        );
    }

    // Helpers for key serialization
    async exportKey(key) {
        const format = key.type === 'public' ? 'spki' : (key.type === 'private' ? 'pkcs8' : 'raw');
        const exported = await window.crypto.subtle.exportKey(format, key);
        return this.arrayBufferToBase64(exported);
    }

    async importKey(base64, type, usage) {
        const buffer = this.base64ToArrayBuffer(base64);
        let algorithm;
        let format;
        if (type === 'identity-public') {
            algorithm = { name: "ECDSA", namedCurve: "P-256" };
            format = "spki";
            usage = ["verify"];
        } else if (type === 'identity-private') {
            algorithm = { name: "ECDSA", namedCurve: "P-256" };
            format = "pkcs8";
            usage = ["sign"];
        } else if (type === 'ephemeral-public') {
            algorithm = { name: "ECDH", namedCurve: "P-256" };
            format = "spki";
            usage = [];
        } else if (type === 'symmetric') {
            algorithm = { name: "AES-GCM" };
            format = "raw";
            usage = ["encrypt", "decrypt"];
        }
        return await window.crypto.subtle.importKey(format, buffer, algorithm, true, usage);
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
