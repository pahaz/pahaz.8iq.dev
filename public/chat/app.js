// Orchestrator and UI glue
const transport = new MqttTransport();
const cryptoProvider = new WebCryptoProvider();
const keys = new LocalKeyManager(cryptoProvider);

const handlers = {
    onPeerListUpdated: (peers) => {
        renderPeerList(peers);
    },
    onMessage: (msg) => {
        renderMessage(msg);
    },
    onAlert: (msg) => {
        showError(msg);
    }
};

const client = new AppP2PClient(transport, cryptoProvider, keys, handlers);

// --- Utils ---
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// --- UI Elements ---
const screens = {
    reg: document.getElementById('screen-registration'),
    discovery: document.getElementById('screen-discovery'),
    chat: document.getElementById('screen-chat'),
    unavailable: document.getElementById('screen-unavailable')
};

const modalError = document.getElementById('modal-error');
const errorMessage = document.getElementById('error-message');
const btnErrorClose = document.getElementById('btn-error-close');

function showScreen(screenId) {
    Object.values(screens).forEach(s => {
        if (s) s.classList.add('hidden');
    });
    if (screens[screenId]) {
        screens[screenId].classList.remove('hidden');
    }
}

function showError(msg) {
    if (errorMessage) errorMessage.innerText = msg;
    if (modalError) modalError.classList.remove('hidden');
}

if (btnErrorClose) {
    btnErrorClose.onclick = () => {
        if (modalError) modalError.classList.add('hidden');
    };
}

// --- Registration Logic ---
const inputUsername = document.getElementById('username');
const regSas = document.getElementById('reg-sas');
const btnRegenerate = document.getElementById('btn-regenerate');
const btnContinue = document.getElementById('btn-continue');

let pendingIdentity = null;

async function updateRegSas() {
    pendingIdentity = await client.generateNewIdentity("Temporary");
    if (regSas) regSas.innerText = pendingIdentity.sas;
}

if (btnRegenerate) btnRegenerate.onclick = updateRegSas;

if (btnContinue) {
    btnContinue.onclick = async () => {
        const username = inputUsername?.value.trim();
        if (!username) return showError("Enter nickname");
        if (!pendingIdentity) await updateRegSas();
        
        pendingIdentity.username = username;
        await client.saveIdentity(pendingIdentity);
        
        showScreen('discovery');
        // Save to localStorage for persistence
        localStorage.setItem('last_username', username);
    };
}

// --- Discovery Logic ---
const inputRoom = document.getElementById('room-id');
const inputServer = document.getElementById('mqtt-server');
const btnJoin = document.getElementById('btn-join');

if (btnJoin) {
    btnJoin.onclick = async () => {
    const roomId = inputRoom?.value.trim();
    const serverUrl = inputServer?.value.trim();
    if (!serverUrl) return showError("Enter MQTT server address");
    if (!/^[a-zA-Z0-9-]+$/.test(roomId)) return showError("Invalid room name (latin, numbers, dashes only)");
    
    // Show connecting status on button
    const originalText = btnJoin.innerText;
    btnJoin.innerText = "Connecting...";
    btnJoin.disabled = true;

    try {
        await transport.connect([serverUrl], 15000); // 15s timeout
    } catch (e) {
        btnJoin.innerText = originalText;
        btnJoin.disabled = false;
        return showError("Failed to connect to MQTT server: " + e.message);
    }
    
    btnJoin.innerText = originalText;
    btnJoin.disabled = false;
    
    const roomNameEl = document.getElementById('current-room-name');
    if (roomNameEl) roomNameEl.innerText = `Room: ${roomId}`;
    await client.joinRoom(roomId);
    
    const myIdentity = await client.getMyIdentity();
    const myNameEl = document.getElementById('my-name');
    const mySasEl = document.getElementById('my-sas');
    if (myNameEl) myNameEl.innerText = myIdentity.username;
    if (mySasEl) mySasEl.innerText = myIdentity.sas;
    
    showScreen('chat');
    localStorage.setItem('last_room', roomId);
    localStorage.setItem('last_mqtt_server', serverUrl);
};
}

// --- Logout/Leave Logic ---
const btnLogout = document.getElementById('btn-logout');
const btnLeave = document.getElementById('btn-leave');

if (btnLeave) {
    btnLeave.onclick = async () => {
        if (!confirm("Leave this room?")) return;
        await client.leaveRoom();
        
        // Clear room-specific UI
        if (chatMessages) chatMessages.innerHTML = '';
        if (peerList) peerList.innerHTML = '';
        
        showScreen('discovery');
    };
}

if (btnLogout) {
    btnLogout.onclick = async () => {
        if (!confirm("Are you sure you want to logout and clear all state?")) return;
        await client.logout();
        
        // Clear UI
        if (chatMessages) chatMessages.innerHTML = '';
        if (peerList) peerList.innerHTML = '';
        if (inputUsername) inputUsername.value = '';
        if (inputRoom) inputRoom.value = '';
        
        showScreen('reg');
        await updateRegSas();
    };
}

// --- Chat Logic ---
const peerList = document.getElementById('peer-list');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');

// --- Export to window for tests ---
if (window.__TEST__ || window.location.pathname.endsWith('test.html')) {
    window.keys = keys;
    window.client = client;
    window.peerList = peerList;
    window.chatMessages = chatMessages;
    window.chatForm = chatForm;
    window.renderMessage = renderMessage;
    window.renderPeerList = renderPeerList;
}

function renderPeerList(peers) {
    if (!peerList) return;
    peerList.innerHTML = '';
    // Sort: Verified -> New -> Blocked
    const sorted = [...peers].sort((a, b) => {
        const order = { 'verified': 0, 'new': 1, 'blocked': 2 };
        return order[a.trustStatus] - order[b.trustStatus];
    });

    sorted.forEach(peer => {
        const li = document.createElement('li');
        li.className = 'peer-item';
        const safeName = escapeHTML(peer.username);
        const safeSas = escapeHTML(peer.sas);
        li.innerHTML = `
            <div class="peer-avatar">${safeName[0].toUpperCase()}</div>
            <div class="peer-info">
                <div class="peer-name-row">
                    <span class="peer-name">${safeName}</span>
                    <span class="peer-sas">${safeSas}</span>
                </div>
                <div class="peer-status" style="color: var(--${peer.trustStatus}-color)">${peer.trustStatus}</div>
            </div>
            <div class="peer-actions">
                <button class="btn-trust verify" onclick="client.markPeerTrust('${peer.id}', 'verified')">✅</button>
                <button class="btn-trust block" onclick="client.markPeerTrust('${peer.id}', 'blocked')">❌</button>
            </div>
        `;
        peerList.appendChild(li);
    });
}

function renderMessage(msg) {
    if (!chatMessages) return;
    const div = document.createElement('div');
    if (msg.from === 'system') {
        div.className = 'message system';
        const safeText = escapeHTML(msg.data);
        div.innerHTML = `<div class="msg-text">${safeText}</div>`;
    } else {
        div.className = `message ${msg.mine ? 'mine' : 'other'}`;
        const peer = keys.peers.get(msg.from);
        const senderName = msg.mine ? 'You' : (peer?.username || msg.from.substring(0, 8));
        let senderSas = msg.mine ? (keys.getMyIdentity()?.sas || '') : (peer?.sas || '');
        
        const safeName = escapeHTML(senderName);
        const safeSas = escapeHTML(senderSas);
        const safeText = escapeHTML(msg.data);

        div.innerHTML = `
            ${!msg.mine ? `<div class="msg-sender">${safeName}<span class="msg-sas">${safeSas}</span></div>` : ''}
            <div class="msg-text">${safeText}</div>
        `;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (chatForm) {
    chatForm.onsubmit = async (e) => {
        e.preventDefault();
        const text = messageInput?.value.trim();
        if (!text) return;
        await client.sendTextMessage(client.currentRoom, text);
        if (messageInput) messageInput.value = '';
    };
}

// Mobile menu
const btnHamburger = document.getElementById('btn-hamburger');
const btnMobileClose = document.getElementById('btn-mobile-close');
const sidebar = document.getElementById('sidebar');

if (btnHamburger) {
    btnHamburger.onclick = () => {
        if (sidebar) sidebar.classList.add('open');
    };
}
if (btnMobileClose) {
    btnMobileClose.onclick = () => {
        if (sidebar) sidebar.classList.remove('open');
    };
}

// --- App Start ---
async function startApp() {
    // If we are in test environment, don't auto-start
    if (window.__TEST__ || window.location.pathname.endsWith('test.html')) return;

    showScreen('unavailable');
    return;

    await client.init();
    const myIdentity = await client.getMyIdentity();
    
    if (!myIdentity) {
        showScreen('reg');
        updateRegSas();
    } else {
        // Auto-fill discovery if we have identity
        const lastRoom = localStorage.getItem('last_room');
        if (lastRoom) {
            inputRoom.value = lastRoom;
        }
        
        // Update my info in sidebar even if not joined room yet
        // but sidebar is only visible in 'chat' screen normally.
        // Let's ensure it's updated when we eventually show it.
        document.getElementById('my-name').innerText = myIdentity.username;
        document.getElementById('my-sas').innerText = myIdentity.sas;
        
        showScreen('discovery');
    }

    // Load last server
    const lastServer = localStorage.getItem('last_mqtt_server') || 'wss://mqtt.8iq.dev/mqtt';
    if (inputServer) {
        inputServer.value = lastServer;
    }
}

startApp().catch(console.error);
