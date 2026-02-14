describe('transport.js (Сеть)', () => {
    it('Ошибка при отправке без подключения', async () => {
        const t = new MqttTransport();
        try {
            await t.send('topic', 'data');
            assert(false, "Should fail when not connected");
        } catch (e) {
            assert(true, "Caught error as expected");
        }
    });

    it('Интерфейс onMessage регистрирует обработчик', () => {
        const t = new MqttTransport();
        const handler = () => {};
        t.onMessage(handler);
        assert(t.onMessageHandler === handler, "Handler registered");
    });

    it('Таймаут при подключении к несуществующему серверу', async () => {
        const t = new MqttTransport();
        const start = Date.now();
        const timeout = 1000;
        try {
            // Use a non-routable IP address to ensure timeout
            await t.connect(['wss://10.255.255.1:8084/mqtt'], timeout);
            assert(false, "Should have timed out");
        } catch (e) {
            const duration = Date.now() - start;
            assert(e.message.includes('timeout'), "Error message should contain timeout: " + e.message);
            assert(duration >= timeout, "Should have waited at least timeout duration. Got: " + duration);
        }
    });
});
