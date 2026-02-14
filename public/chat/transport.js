class MqttTransport {
    constructor() {
        this.client = null;
        this.onMessageHandler = null;
    }

    async connect(servers, timeoutMs = 10000) {
        this.disconnect();
        return new Promise((resolve, reject) => {
            let timeoutTriggered = false;
            const timeout = setTimeout(() => {
                timeoutTriggered = true;
                if (this.client) {
                    this.client.end(true); // true means force close
                    this.client = null;
                }
                reject(new Error(`Connection timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            // Use the first available server
            try {
                this.client = mqtt.connect(servers[0], {
                    connectTimeout: timeoutMs,
                    reconnectPeriod: 0 // Do not auto-reconnect during initial connection attempt
                });
                
                this.client.on('connect', () => {
                    if (timeoutTriggered) return;
                    clearTimeout(timeout);
                    console.log('Transport connected to', servers[0]);
                    resolve();
                });

                this.client.on('error', (err) => {
                    if (timeoutTriggered) return;
                    clearTimeout(timeout);
                    reject(err);
                });

                this.client.on('message', (topic, payload) => {
                    if (this.onMessageHandler) {
                        this.onMessageHandler(topic, payload);
                    }
                });
            } catch (e) {
                clearTimeout(timeout);
                reject(e);
            }
        });
    }

    async subscribe(topic) {
        return new Promise((resolve, reject) => {
            this.client.subscribe(topic, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async unsubscribe(topic) {
        return new Promise((resolve, reject) => {
            this.client.unsubscribe(topic, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async send(topic, payload) {
        // payload can be string or Uint8Array
        this.client.publish(topic, payload);
    }

    onMessage(handler) {
        this.onMessageHandler = handler;
    }

    disconnect() {
        if (this.client) {
            this.client.end();
        }
    }
}
