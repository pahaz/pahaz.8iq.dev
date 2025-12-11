// sip-jssip-client.js
// Логика работы с JsSIP поверх UI-слоя из sip-tester.js

(function () {
  'use strict';

  if (!window.SipTester) {
    console.error('[SIP Tester] window.SipTester не найден. Подключи sip-tester.js раньше.');
    return;
  }

  if (!window.JsSIP) {
    console.error('[SIP Tester] JsSIP не найден. Подключи jssip.min.js раньше.');
    if (window.SipTester.ui && window.SipTester.ui.appendTimelineEvent) {
      window.SipTester.ui.appendTimelineEvent('JsSIP не загружен (нет window.JsSIP)');
    }
    return;
  }

  const { ui } = window.SipTester;
  const JsSIP = window.JsSIP;

  // Можно включить debug JsSIP при необходимости:
  // JsSIP.debug.enable('JsSIP:*');

  function context(reqOrRes) {
    const callId = reqOrRes?.call_id || undefined;
    const tags = (reqOrRes?.from_tag || reqOrRes?.to_tag) ? `${reqOrRes?.from_tag || '-'}/${reqOrRes?.to_tag || '-'}` : undefined;
    const via = reqOrRes?.via ? `${reqOrRes?.via?.protocol}/${reqOrRes?.via?.transport} ${reqOrRes?.via?.host}${reqOrRes?.via?.port ? ':' + reqOrRes?.via?.port : '' } branch=${reqOrRes?.via?.branch}` : undefined;
    return { tags, via, callId };
  }

  class SipJsClient {
    constructor(ui) {
      this.call = {};
      this.ui = ui;
      this.ua = null;
      this.session = null;
      this.remoteAudio = null;
      this.currentDirection = null; // 'incoming' | 'outgoing'
      this._registerRetries = 0;
    }

    _getConfigFromUi() {
      const formConfig = this.ui.getConfig ? this.ui.getConfig() : null;
      if (!formConfig) {
        this.ui.appendTimelineEvent('Ошибка создания UA: Не удалось собрать конфигурацию (ui.getConfig вернул null)');
        return null;
      }

      const {
        websocketUrl,
        sipUri,
        sipUsername,
        sipDomain,
        sipPassword,
        outboundProxy,
      } = formConfig;

      if (!websocketUrl || !sipUsername || !sipDomain) {
        this.ui.appendTimelineEvent('Ошибка создания UA: Не заданы websocketUrl / username / domain');
        return null;
      }

      const effectiveSipUri = sipUri || `sip:${sipUsername}@${sipDomain}`;
      const socket = new JsSIP.WebSocketInterface(websocketUrl);

      this._attackSipSocketEvents(socket);

      const configuration = {
        sockets: [socket],
        uri: effectiveSipUri,
        password: sipPassword,
        register: false,
        session_timers: false,
        connection_recovery_min_interval: 1,
        connection_recovery_max_interval: 30
      };

      // Outbound proxy:
      // Если пользователь ввёл ws:// или wss:// — используем как outbound_proxy_set.
      if (outboundProxy && /^wss?:/i.test(outboundProxy)) {
        configuration.outbound_proxy_set = outboundProxy;
        configuration.use_preloaded_route = true;
      }

      // Если он ввёл sip:... — логичнее трактовать как registrar_server
      if (outboundProxy && /^sip:/i.test(outboundProxy)) {
        configuration.registrar_server = outboundProxy;
        configuration.use_preloaded_route = true;
      }

      return configuration;
    }

    _buildPcConfig() {
      const formConfig = this.ui.getConfig ? this.ui.getConfig() : null;
      if (!formConfig) {
        this.ui.appendTimelineEvent('Ошибка создания UA: Не удалось собрать конфигурацию (ui.getConfig вернул null)');
        return undefined;
      }

      const cfg = formConfig;
      const iceServers = [];

      if (cfg.stunServer) {
        iceServers.push({ urls: cfg.stunServer });
      }

      if (cfg.turnServer) {
        const turn = { urls: cfg.turnServer };
        if (cfg.turnUser) turn.username = cfg.turnUser;
        if (cfg.turnPass) turn.credential = cfg.turnPass;
        iceServers.push(turn);
      }

      if (!iceServers.length) return undefined;

      return { iceServers };
    }

    _ensureUa() {
      if (this.ua) return this.ua;

      const configuration = this._getConfigFromUi();
      if (!configuration) return null;

      const ua = new JsSIP.UA(configuration);
      this.ua = ua;

      this._attachUaEvents(ua);

      return ua;
    }

    _attackSipSocketEvents(socket) {
      // ------------------------------------------------------
      // Перехват отправки/получения для SIP Log
      // ------------------------------------------------------

      // 1. Исходящие (socket.send)
      const originalSend = socket.send.bind(socket);
      socket.send = (data) => {
        if (this.ui.addSipLogEntry) {
          this.ui.addSipLogEntry('out', data);
        }
        return originalSend(data);
      };

      // 2. Входящие (socket.ondata)
      // JsSIP пишет свой коллбэк в socket.ondata. Перехватываем сеттер.
      let _ondata = null;
      Object.defineProperty(socket, 'ondata', {
        get: () => _ondata,
        set: (fn) => {
          // Оборачиваем коллбэк JsSIP
          _ondata = (data) => {
            if (this.ui.addSipLogEntry) {
              this.ui.addSipLogEntry('in', data);
            }
            if (fn) fn(data);
          };
        },
        configurable: true
      });
    }

    _attachUaEvents(ua) {
      ua.on('connected', (e) => this._onUaConnected(e));
      ua.on('disconnected', (e) => this._onUaDisconnected(e));
      ua.on('registered', (e) => this._onUaRegistered(e));
      ua.on('unregistered', (e) => this._onUaUnregistered(e));
      ua.on('registrationFailed', (e) => this._onUaRegistrationFailed(e));
      ua.on('newRTCSession', (e) => this._onUaNewRTCSession(e));
      // при желании можно доп. события: 'newMessage', 'sipEvent'
    }

    // ---------------- UA actions ----------------

    connect() {
      const ua = this._ensureUa();
      if (!ua) return;

      this.ui.appendTimelineEvent('WS connect requested');

      try {
        ua.start();
      } catch (err) {
        console.error('[JsSIP] ua.start() error', err);
        this.ui.appendTimelineEvent('Ошибка запуска UA: ' + err.message);
      }
    }

    disconnect() {
      // Завершаем активный вызов, если есть
      if (this.session) {
        try {
          this.session.terminate();
        } catch (e) {
          console.warn('Error terminating session on disconnect()', e);
        }
        this.session = null;
      }

      if (this.ua) {
        try {
          this.ua.stop();
        } catch (e) {
          console.warn('Error stopping UA', e);
          this.ui.appendTimelineEvent('Ошибка остановки UA: ' + e.message);
        }
        this.ua = null;
      }

      this.ui.appendTimelineEvent('WS disconnected (manual)');
    }

    register() {
      const ua = this._ensureUa();
      if (!ua) return;

      if (!ua.isConnected()) {
        console.warn('[JsSIP] Cannot register: UA not connected');
        this.ui.appendTimelineEvent('Попытка регистрации до WS соединения (проигнорирована)');
        return;
      }

      this.ui.appendTimelineEvent('REGISTER requested');

      try {
        ua.register()
      } catch (err) {
        console.error('[JsSIP] register() error', err);
        this.ui.appendTimelineEvent('Ошибка REGISTER: ' + err.message);
      }
    }
    unregister() {
      if (!this.ua) return;

      this.ui.appendTimelineEvent('Unregister requested');
      try {
        this.ua.unregister({ all: true });
      } catch (err) {
        console.error('[JsSIP] unregister() error', err);
        this.ui.appendTimelineEvent('Ошибка UNREGISTER: ' + err.message);
      }
    }

    // ---------------- Call actions ----------------

    callAudio(target) {
      this._makeCall(target, false);
    }

    callVideo(target) {
      this._makeCall(target, true);
    }

    _makeCall(target, withVideo) {
      const ua = this.ua || this._ensureUa();
      if (!ua) return;

      if (this.session) {
        this.ui.appendTimelineEvent('Попытка нового вызова в момент звонка (игнорируем)');
        return;
      }

      const uri = target;
      if (!uri) {
        this.ui.appendTimelineEvent('Не задан URI для вызова (вызов отменен)');
        return;
      }

      const mediaConstraints = {
        audio: true,
        video: !!withVideo
      };

      this.ui.appendTimelineEvent(
        `Исходящий ${withVideo ? 'audio+video' : 'audio'} вызов на ${uri}`
      );

      const pcConfig = this._buildPcConfig();

      const options = {
        mediaConstraints,
        pcConfig,
      };

      try {
        // newRTCSession с originator='local' придёт сюда же
        ua.call(uri, options);
      } catch (err) {
        console.error('[JsSIP] call() error', err);
        this.ui.appendTimelineEvent('Ошибка вызова: ' + err.message);
      }
    }

    answerAudio() {
      this._answer(false);
    }

    answerVideo() {
      this._answer(true);
    }

    _answer(withVideo) {
      const session = this.session;
      if (!session) return;

      // если уже принятый — ничего не делаем
      if (session.isEstablished && session.isEstablished()) {
        console.log('[SIP] Session already established');
        this.ui.appendTimelineEvent('Попытка ответить на принятый вызов (игнорируем)');
        return;
      }

      const mediaConstraints = {
        audio: true,
        video: !!withVideo
      };

      this.ui.appendTimelineEvent(
        `Ответ на входящий вызов (${withVideo ? 'audio+video' : 'audio'})`
      );

      const pcConfig = this._buildPcConfig();

      try {
        session.answer({ mediaConstraints, pcConfig });
      } catch (err) {
        console.error('[JsSIP] answer() error', err);
        this.ui.appendTimelineEvent('Ошибка ответа на вызов: ' + err.message);
      }
    }

    reject() {
      const session = this.session;
      if (!session) return;
      this.ui.appendTimelineEvent('Входящий вызов отклонён');
      try {
        session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      } catch (err) {
        console.error('[JsSIP] reject() error', err);
        this.ui.appendTimelineEvent('Ошибка отклонения вызова: ' + err.message);
      }
    }

    hangup() {
      const session = this.session;
      if (!session) return;
      this.ui.appendTimelineEvent('Завершение вызова');
      try {
        session.terminate();
      } catch (err) {
        console.error('[JsSIP] terminate() error', err);
        this.ui.appendTimelineEvent('Ошибка завершения вызова: ' + err.message);
      }
    }

    sendDtmf(tone) {
      const session = this.session;
      if (!session) return;
      this.ui.appendTimelineEvent('Отправка DTMF: ' + tone);
      try {
        session.sendDTMF(tone);
      } catch (err) {
        console.error('[JsSIP] sendDTMF() error', err);
        this.ui.appendTimelineEvent('Ошибка DTMF: ' + err.message);
      }
    }

    // ---------------- UA event handlers ----------------

    _onUaConnected(e) {
      this.ui.setWsStatus('connected', 'WS connected');
      this.ui.appendTimelineEvent('WebSocket connected');

      // Если после реконнекта UA считает, что регистрация жива — обновим UI
      if (this.ua.isRegistered()) {
        this._onUaRegistered();
      }

      const autoRegister = this.ui.getConfig().autoRegister;

      if (autoRegister) {
        this.register();
      }
    }

    _onUaDisconnected(e) {
      this.ui.setWsStatus('disconnected', 'Disconnected');
      this.ui.setSipStatus('unregistered', 'Not registered');
      this.ui.appendTimelineEvent('WebSocket disconnected');
    }

    _onUaRegistered(e) {
      this.ui.setSipStatus('registered', 'Registered');
      this.ui.appendTimelineEvent('SIP registered');
      this._registerCount = (this._registerCount || 0) + 1;
      this.ui.setStats({ registerCount: this._registerCount });
    }

    _onUaUnregistered(e) {
      this.ui.setSipStatus('unregistered', 'Unregistered');
      this.ui.appendTimelineEvent('SIP unregistered');
      this._unRegisterCount = (this._unRegisterCount || 0) + 1;
      this.ui.setStats({ unRegisterCount: this._unRegisterCount });
    }

    _onUaRegistrationFailed(e) {
      const code = e.response && e.response.status_code;
      const reason =
        (e.response && e.response.reason_phrase) || e.cause || 'Registration failed';
      const text = code ? `Registration failed (${code} ${reason})` : reason;

      this.ui.setSipStatus('unregistered', 'Failed');
      this.ui.appendTimelineEvent(text);
      this._registerFailedCount = (this._registerFailedCount || 0) + 1;
      this.ui.setStats({ registerFailedCount: this._registerFailedCount });

      // Auto-retry REGISTER, если включено
      const autoRetry = this.ui.getConfig().autoRetryRegister;

      if (autoRetry) {
        const maxRetries = this.ui.getConfig().registerRetryCount || 3;
        const delaySec = this.ui.getConfig().registerRetryDelaySec || 5;
        this._registerRetries = this._registerRetries || 0;

        if (this._registerRetries < maxRetries) {
          this._registerRetries += 1;
          const attempt = this._registerRetries;
          this.ui.appendTimelineEvent(
            `Попытка повторной регистрации #${attempt} через ${delaySec} с`
          );
          setTimeout(() => {
            this.register();
          }, delaySec * 1000);
        } else {
          this.ui.appendTimelineEvent('Достигнут лимит попыток регистрации');
        }
      }
    }

    _onUaNewRTCSession(e) {
      console.log('[SIP] New RTC session', e.session.id, e.originator);

      const session = e.session;
      const originator = e.originator; // 'local' | 'remote'

      this._rtcSessionCount = (this._rtcSessionCount || 0) + 1;
      this.ui.setStats({ rtcSessionCount: this._rtcSessionCount });

      // Если уже есть активная сессия — вторую отклоняем (busy)
      if (this.session && this.session !== session) {
        console.warn('[SIP] Second session arrived, terminating as busy');
        ui.appendTimelineEvent('Second session arrived, terminating as busy 486');
        if (originator === 'remote') {
          try {
            session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
          } catch (e) {
            console.warn('[SIP] Terminate error', e);
          }
        } else {
          try {
            session.terminate();
          } catch (e) {
            console.warn('[SIP] Terminate error', e);
          }
        }
        return;
      }

      console.log(session?._request)
      const { callId, tags, via } = context(session?._request)

      this.session = session;
      this.call.callId = callId;
      this.call.remoteIdentity = session.remote_identity;
      this.call.startTime = null;
      this.call.endReason = null;

      const remoteUri = this._getRemoteUri(session);
      const remoteDisplayName = this._getRemoteDisplayName(session);

      if (originator === 'remote') {
        this.currentDirection = 'incoming';
        this.call.direction = 'incoming';
        this.call.state = 'incoming';

        ui.setCallIncoming({
          remoteUri,
          remoteDisplayName,
          callId, tags, via,
        });
        ui.appendTimelineEvent('Входящий вызов от ' + (remoteDisplayName || remoteUri));
        this._incomingCallCount = (this._incomingCallCount || 0) + 1;
        this.ui.setStats({ incomingCallCount: this._incomingCallCount });
      } else {
        this.currentDirection = 'outgoing';
        this.call.direction = 'outgoing';
        this.call.state = 'outgoing';

        ui.setCallOutgoing({
          remoteUri,
          remoteDisplayName,
          callId, tags, via,
        });
        ui.appendTimelineEvent('Исходящая сессия на ' + (remoteDisplayName || remoteUri));
        this._outgoingCallCount = (this._outgoingCallCount || 0) + 1;
        this.ui.setStats({ outgoingCallCount: this._outgoingCallCount });
      }

      this._attachSessionEvents(session);
    }

    // ---------------- Session helpers ----------------

    _attachSessionEvents(session) {
      session.on('progress', (e) => {
        this.ui.appendTimelineEvent('Call progress');
      });

      session.on('accepted', (e) => {
        this.call.state = 'established';
        this.call.startTime = Date.now();
        // e.response if remote else request
        const { callId, tags, via } = context(e.response || this.session?._request);
        this.ui.setCallEstablished({ direction: this.currentDirection, callId, tags, via });
        this.ui.appendTimelineEvent('Call accepted');
      });

      session.on('confirmed', (e) => {
        // Вызов подтверждён (ACK получен), можно считать вызов окончательно установленным
        this.ui.appendTimelineEvent('Call confirmed');
      });

      session.on('failed', (e) => {
        const cause =
          e.cause ||
          (e.message && e.message.reason_phrase) ||
          'Failed';
        this.call.state = 'idle';
        this.call.endReason = cause;
        this.session = null;

        this.ui.setCallTerminated({ reason: cause });
        this.ui.appendTimelineEvent('Call failed: ' + cause);
      });

      session.on('ended', (e) => {
        const cause =
          e.cause ||
          (e.message && e.message.reason_phrase) ||
          'Ended';
        this.call.state = 'idle';
        this.call.endReason = cause;
        this.session = null;

        this.ui.setCallTerminated({ reason: cause });
        this.ui.appendTimelineEvent('Call ended: ' + cause);
      });

      session.on('peerconnection', (e) => {
        const pc = e.peerconnection;
        if (!pc) return;

        this.ui.bindPeerConnection(pc)
      });

      // не создан ли уже PC (актуально для исходящих)
      if (session.connection) {
        // RTCPeerConnection уже есть — биндим его напрямую
        this.ui.bindPeerConnection(session.connection);
      }

      session.on('newDTMF', (e) => {
        const tone = e.dtmf && e.dtmf.tone;
        if (tone) {
          this.ui.addDtmfReceived(tone);
          this.ui.appendTimelineEvent('DTMF received: ' + tone);
        }
      });
    }

    _getRemoteUri(session) {
      try {
        const id = session.remote_identity;
        if (id && id.uri) return id.uri.toString();
      } catch (_) {}
      return 'unknown';
    }

    _getRemoteDisplayName(session) {
      try {
        const id = session.remote_identity;
        if (!id) return null;
        const uri = id.uri && id.uri.toString();
        const name = id.display_name || id._display_name;
        if (name && uri) return `${name} <${uri}>`;
        return uri || name || null;
      } catch (_) {
        return null;
      }
    }
  }

  // --------------------------------------------------------
  // Инстанцируем клиент и подменяем actions.*
  // --------------------------------------------------------

  const client = new SipJsClient(ui);
  window.SipTester.client = client;

  // Пробрасываем UI-экшены на клиента
  ui.on('ws-connect-click', () => client.connect());
  ui.on('ws-disconnect-click', () => client.disconnect());

  ui.on('sip-register-click', () => client.register());
  ui.on('sip-unregister-click', () => client.unregister());

  ui.on('call-audio-click', ({ target } = {}) => {
    client.callAudio(target);
  });

  ui.on('call-video-click', ({ target } = {}) => {
    client.callVideo(target);
  });

  ui.on('answer-audio-click', () => {
    client.answerAudio();
  });

  ui.on('answer-video-click', () => {
    client.answerVideo();
  });

  ui.on('reject-click', () => {
    client.reject();
  });

  ui.on('hangup-click', () => {
    client.hangup();
  });

  ui.on('dtmf-click', ({ tone } = {}) => {
    if (!tone) return;
    client.sendDtmf(tone);
  });

  console.log('[SIP] JsSIP client initialized');
})();
