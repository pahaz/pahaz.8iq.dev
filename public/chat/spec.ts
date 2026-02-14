// 1. Типы данных (Domain Types)

// --- Примитивы ---
type Bytes = ArrayBuffer;
type HexString = string; // SHA-256 hash (ID)
type Topic = string;     // MQTT path
type Timestamp = number; // Date.now()

// --- Ключи ---
type IdentityKeyPair = CryptoKeyPair; // Ed25519 (Sign/Verify)
type SessionKeyPair = CryptoKeyPair;  // ECDH (Derive)
type SymmetricKey = CryptoKey;        // AES-GCM (Encrypt/Decrypt)

// --- Хранение Истории (для ротации) ---
interface KeyHistoryRecord {
  key: SymmetricKey;
  validFrom: Timestamp;
}

// --- Состояние Собеседника ---
interface Peer {
  id: HexString;           // IdentityId
  identityKey: CryptoKey;  // Public Key для проверки подписей
  username: string;        // Имя из метаданных
  sas: string;             // Emoji SAS

  // Статус TOFU
  trustStatus: 'new' | 'verified' | 'blocked';

  // Глобальные секреты (для лички и Handshake).
  // Не зависят от комнаты.
  sharedSecrets: KeyHistoryRecord[];

  // Ключи для чтения сообщений в чатах.
  // Map<RoomId, History[]> — у пира может быть свой SenderKey для каждой комнаты
  senderKeys: Map<string, KeyHistoryRecord[]>;
}

// --- Паспорт пользователя ---
interface Identity {
  id: HexString;            // IdentityId
  keyPair: IdentityKeyPair; // private and public key pair
  username: string;         // Имя из метаданных
  sas: string;              // Emoji SAS
}

// 2. MessageTransport (Курьер) «Глупая труба». Отвечает только за доставку байтов.

abstract class MessageTransport {
  /**
   * Подключение к списку брокеров (Failover).
   */
  abstract connect(servers: string[]): Promise<void>;

  /**
   * Подписка на паттерн топиков.
   * Используем wildcards, например "p2p/+/discovery" для всех комнат.
   */
  abstract subscribe(topic: Topic): Promise<void>;

  abstract unsubscribe(topic: Topic): Promise<void>;

  abstract send(topic: Topic, payload: Bytes): Promise<void>;

  /**
   * Единый вход для всех сообщений.
   * Маршрутизацию делает P2PClient.
   */
  abstract onMessage(handler: (topic: Topic, payload: Bytes) => void): void;
}


// 3. CryptoProvider (Математик). Обертка над Web Crypto API. Чистые функции без состояния.

abstract class CryptoProvider {
  // --- Генерация ---
  abstract generateIdentityKeyPair(): Promise<IdentityKeyPair>;
  abstract generateEphemeralKeyPair(): Promise<SessionKeyPair>;
  abstract generateSymmetricKey(): Promise<SymmetricKey>;

  // --- Идентификация ---
  /**
   * Вычисляет IdentityId (SHA-256) из Public IdentityKey.
   */
  abstract computeIdentityId(publicKey: CryptoKey): Promise<HexString>;

  /**
   * Универсальная генерация SAS (Emoji Fingerprint).
   * data — это либо IdentityId (для проверки паспорта), либо SharedSecret (для проверки связи).
   * Например: '🥑🚗🔥🗿'
   */
  abstract generateSas(data: Bytes | HexString): Promise<string>;

  // --- ECDH (Общий секрет) ---
  /**
   * Скрещиваем мой Private Ephemeral и чужой Public Ephemeral.
   * Получаем AES ключ.
   */
  abstract deriveSharedSecret(myPrivate: CryptoKey, remotePublic: CryptoKey): Promise<SymmetricKey>;

  // --- Криптография ---
  abstract sign(privateKey: CryptoKey, data: Bytes): Promise<Bytes>;
  abstract verify(publicKey: CryptoKey, signature: Bytes, data: Bytes): Promise<boolean>;

  // AES-GCM: Возвращает [IV + Ciphertext]
  abstract encrypt(key: SymmetricKey, data: Bytes): Promise<Bytes>;
  abstract decrypt(key: SymmetricKey, encryptedPackage: Bytes): Promise<Bytes>;

  // Методы для конвертации ключей в формат JWK (JSON Web Key) или Raw (через exportKey / importKey) перед их сохранением в хранилище или отправкой по сети в составе пакетов
  abstract importKey(format: string, keyData: JsonWebKey): Promise<CryptoKey>;
  abstract exportKey(format: string, key: CryptoKey): Promise<JsonWebKey>;
}


// 4. KeyManager (Завхоз). Управляет состоянием, TOFU и историей ключей для разных комнат.

abstract class KeyManager {
  // --- Я (My Identity) ---
  /**
   * Инициализация ключей.
   */
  abstract init(): Promise<void>;

  /**
   * Генерирует новый IdentityKey, возвращает новые данные.
   */
  abstract generateNewIdentity(): Promise<Identity>;
  abstract saveMyIdentity(identity: Identity): Promise<void>;
  abstract clearMyIdentity(): Promise<void>;
  abstract getMyIdentity(): Identity;

  /**
   * Получить мой SenderKey для конкретной комнаты.
   * Если ключа нет — создает новый.
   */
  abstract getMySenderKey(roomId: string): SymmetricKey;

  /**
   * Ротация: создает новый ключ для комнаты, отправляет старый в архив.
   * Возвращает новый ключ (чтобы P2PClient мог его разослать).
   */
  abstract rotateMySenderKey(roomId: string): Promise<SymmetricKey>;

  // --- Собеседники (TOFU) ---

  /**
   * Главная проверка безопасности.
   * 1. Если peerId новый -> регистрируем.
   * 2. Если peerId есть и ключ совпал -> ок.
   * 3. Если peerId есть, но ключ другой -> SECURITY ERROR.
   * 4. Проверяем, что username еще не занят (проверка коллизии)
   */
  abstract ensurePeer(id: HexString, key: CryptoKey, username?: string): Promise<Peer>;

  abstract getPeer(id: HexString): Promise<Peer | undefined>;
  abstract getAllPeers(): Promise<Peer[]>;

  // Ручное доверие (Verified) или Блок (Blocked)
  abstract setPeerTrust(id: HexString, status: 'verified' | 'blocked'): Promise<void>;

  // --- Ключи Собеседников (Lookup) ---

  abstract saveSharedSecret(peerId: HexString, secret: SymmetricKey): Promise<void>;

  // Получить SharedSecret (для Handshake/KeyShare), актуальный на момент timestamp
  abstract getSharedSecret(peerId: HexString, timestamp?: number): Promise<SymmetricKey | undefined>;

  // Сохранить чужой SenderKey для конкретной комнаты
  abstract savePeerSenderKey(peerId: HexString, roomId: string, key: SymmetricKey, timestamp: number): Promise<void>;

  // Найти ключ, чтобы расшифровать сообщение в чате
  abstract getPeerSenderKey(peerId: HexString, roomId: string, timestamp: number): Promise<SymmetricKey | undefined>;
}


// 5. P2PClient (Фасад приложения). Класс, который использует разработчик UI. Скрывает сложность протокола.

interface ClientEvents {
  onPeerListUpdated: (peers: Peer[]) => void;
  onMessage: (msg: { roomId: string, from: string, data: string, time: number }) => void;
  onAlert: (msg: string) => void; // Ошибки (MITM и т.д.)
}

abstract class P2PClient {
  constructor(
    transport: MessageTransport,
    crypto: CryptoProvider,
    keys: KeyManager,
    handlers: ClientEvents,
  ) {}

  // --- Setup ---
  abstract init(): Promise<void>;

  abstract getMyIdentity(): Promise<Peer>;
  abstract regenerateIdentity(username: string): Promise<Peer>;

  // --- Комнаты ---

  /**
   * Вход в комнату.
   * 1. Subscribe p2p/{roomId}/+
   * 2. Announce (Я пришел)
   */
  abstract joinRoom(roomId: string): Promise<void>;
  abstract leaveRoom(roomId: string): Promise<void>;

  // Список для получения списка всех сообщений чата.
  abstract getChatMessages(roomId: string): Promise<{ user: Identity; payload: any; type: string; timestamp: number; msgId: string; }>;

  /**
   * Отправка текстового сообщения.
   */
  abstract sendTextMessage(roomId: string, text: string): Promise<void>;

  abstract sendAnnounce(roomId: string): Promise<void>;
  abstract sendHandshakeInit(roomId: string, peerId: HexString): Promise<void>;
  abstract sendSenderKeyShare(roomId: string, peerId: HexString): Promise<void>;

  // --- Верификация ---

  /**
   * Получить SAS (Identity Fingerprint) собеседника для сверки.
   * Используется для визуальной проверки "Паспорта".
   */
  abstract getPeerFingerprint(peerId: HexString): Promise<string>;

  /**
   * Пользователь нажал "Verified".
   * 1. Ставит статус verified в KeyManager.
   * 2. Если мы в одной комнате -> отправляет ему мой SenderKey (Key Share).
   */
  abstract markPeerTrust(peerId: HexString, status: 'verified' | 'blocked'): Promise<void>;

  // --- Внутренний Роутер (Private) ---

  // Обработка входящих сообщений.
  // 1. Проверяем msgId, чтобы не обрабатывать дважды одно сообщение
  // 2. Проверяем timestamp, что сообщение не старше 5 сек.
  protected abstract handleIncomingMessage(topic: Topic, rawData: Bytes): Promise<void>;

  // Обработчики пакетов:

  // ANNOUNCE: Если пир новый -> Handshake. Если старый -> проверяем, есть ли у него ключ от этой комнаты.
  protected abstract onAnnounce(roomId: string, payload: any): Promise<void>;

  // HANDSHAKE: Обмен Ephemeral keys -> Shared Secret
  protected abstract onHandshakeInit(roomId: string, packet: any): Promise<void>;
  protected abstract onHandshakeReply(roomId: string, packet: any): Promise<void>;

  // SENDER_KEY_SHARE: Получили чужой микрофон для комнаты.
  protected abstract onSenderKeyShare(roomId: string, packet: any): Promise<void>;

  // TEXT_MESSAGE: Расшифровка текста
  protected abstract onTextMessage(roomId: string, payload: any): Promise<void>;
}
