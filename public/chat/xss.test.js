describe('XSS Security Tests', () => {
    // Note: app.js is loaded in test.html, providing keys, transport, etc.
    // We just need to ensure keys are initialized for the test if they aren't.

    it('renderMessage: Экранирует HTML в сообщениях', () => {
        const chatMessages = document.getElementById('chat-messages');
        const originalHTML = chatMessages.innerHTML;
        
        try {
            // Need to mock getMyIdentity for sas
            const originalGetMyIdentity = window.keys.getMyIdentity;
            window.keys.getMyIdentity = () => ({ sas: '🏠' });

            const malMsg = {
                from: 'attacker',
                data: '<img src=x onerror="window.xss_vulnerable=true">',
                time: Date.now(),
                mine: false
            };
            
            // We need to mock a peer for renderMessage to find its username/sas
            const km = window.keys; 
            km.peers.set('attacker', {
                username: '<script>alert(1)</script>',
                sas: '💉',
                trustStatus: 'verified'
            });

            window.renderMessage(malMsg);
            
            const lastMsg = chatMessages.lastElementChild;
            const textContent = lastMsg.querySelector('.msg-text').innerHTML;
            const senderContent = lastMsg.querySelector('.msg-sender').innerHTML;

            assert(!window.xss_vulnerable, "XSS executed via onerror!");
            assert(textContent.includes('&lt;img'), "HTML in message data was not escaped");
            assert(senderContent.includes('&lt;script'), "HTML in username was not escaped");

        } finally {
            chatMessages.innerHTML = originalHTML;
            delete window.xss_vulnerable;
            if (typeof originalGetMyIdentity !== 'undefined') {
                window.keys.getMyIdentity = originalGetMyIdentity;
            }
        }
    });

    it('renderPeerList: Экранирует HTML в списке пиров', () => {
        const peerList = document.getElementById('peer-list');
        const originalHTML = peerList.innerHTML;
        
        try {
            const malPeers = [{
                id: 'attacker2',
                username: '<b>Evil</b>',
                sas: '<svg onload="window.xss_vulnerable_peer=true">',
                trustStatus: 'new'
            }];

            window.renderPeerList(malPeers);
            
            const html = peerList.innerHTML;
            assert(!window.xss_vulnerable_peer, "XSS executed in peer list!");
            // Using includes on innerHTML might be tricky because browser might reformat it,
            // but for escaped chars it should be fine.
            assert(html.includes('&lt;b&gt;Evil'), "Username in peer list was not escaped");
            assert(html.includes('&lt;svg'), "SAS in peer list was not escaped");

        } finally {
            peerList.innerHTML = originalHTML;
            delete window.xss_vulnerable_peer;
        }
    });

    it('renderMessage (system): Экранирует HTML в системных сообщениях', () => {
        const chatMessages = document.getElementById('chat-messages');
        const originalHTML = chatMessages.innerHTML;
        
        try {
            const malSystemMsg = {
                from: 'system',
                data: 'User <img src=x onerror="window.xss_vulnerable_system=true"> joined',
                time: Date.now()
            };
            
            window.renderMessage(malSystemMsg);
            
            const lastMsg = chatMessages.lastElementChild;
            // System messages use innerText currently, but we check if they are safe
            assert(!window.xss_vulnerable_system, "XSS executed via system message!");
            
            // If it uses innerText, the HTML should be displayed as text
            assert(lastMsg.innerHTML.includes('&lt;img'), "HTML in system message was not escaped or incorrectly rendered");

        } finally {
            chatMessages.innerHTML = originalHTML;
            delete window.xss_vulnerable_system;
        }
    });
});
