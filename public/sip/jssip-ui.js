// sip-tester.js
// Заготовка под логику с JsSIP (пока без самого JsSIP)

(function () {
  'use strict';

  const ALLOWED_EVENTS = new Set([
    'ws-connect-click',
    'ws-disconnect-click',
    'sip-register-click',
    'sip-unregister-click',
    'call-audio-click',
    'call-video-click',
    'answer-audio-click',
    'answer-video-click',
    'reject-click',
    'hangup-click',
    'dtmf-click',
    'log-clear-click',
    'log-pause-click',
    'log-export-click',
  ]);

  /**
   * Глобальное "приложение" для тестера
   * Здесь:
   *  - state: внутренняя модель состояния
   *  - ui: методы обновления
   */

  const listeners = new Map();

  function subscribe(eventName, handler) {
    if (!ALLOWED_EVENTS.has(eventName)) {
      throw new Error(
          `[UI] Unknown eventName "${eventName}". ` +
          `Допустимые события: ${Array.from(ALLOWED_EVENTS).join(', ')}`
      );
    }

    if (typeof handler !== 'function') return () => {};
    let list = listeners.get(eventName);
    if (!list) {
      list = new Set();
      listeners.set(eventName, list);
    }
    list.add(handler);
    // возвращаем unsubscribe
    return () => {
      const current = listeners.get(eventName);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        listeners.delete(eventName);
      }
    };
  }

  function emit(eventName, payload) {
    const list = listeners.get(eventName);
    if (!list || list.size === 0) return;
    for (const handler of Array.from(list)) {
      try {
        handler(payload);
      } catch (err) {
        console.error('[UI] listener error for', eventName, err);
      }
    }
  }

  const state = {
    config: {
      websocketUrl: '',
      username: '',
      password: '',
      domain: '',
      callTo: '',
      autoRegister: true,
      autoReconnect: true,
      autoRetryRegister: false,
      registerRetryCount: 3,
      registerRetryDelaySec: 5,
      audioInputId: null,
      audioOutputId: null,
    },
    sipLog: [],          // массив записей лога
    sipLogPaused: false, // сейчас лог не на паузе
  };

  /**
   * DOM-ссылки и методы обновления UI
   */
  const ui = {
    el: {
      // Connection / регистрация
      wsUrl: null,
      sipUsername: null,
      sipDomain: null,
      sipPassword: null,

      btnWsConnect: null,
      btnWsDisconnect: null,
      btnSipRegister: null,
      btnSipUnregister: null,

      autoRegister: null,
      autoReconnect: null,
      autoRetryRegister: null,
      registerRetries: null,
      registerRetryDelay: null,

      wsStatusDot: null,
      wsStatusText: null,
      sipStatusDot: null,
      sipStatusText: null,
      lastRegisterResponse: null,

      summaryAccount: null,
      summaryCall: null,
      statRegisterCount: null,
      statErrors: null,

      // Call / DTMF
      callCard: null,
      callDirection: null,
      callStatusText: null,
      callMetaDirection: null,
      callMetaRemote: null,
      callMetaId: null,
      callMetaTags: null,
      callMetaVia: null,
      callTo: null,

      btnCallAudio: null,
      btnCallVideo: null,
      btnAnswerAudio: null,
      btnAnswerVideo: null,
      btnReject: null,
      btnHangup: null,

      callSipState: null,
      callEndReason: null,

      dtmfMethod: null,
      dtmfVolume: null,
      dtmfButtons: null,
      dtmfReceivedLog: null,

      // Video
      videoStatusPill: null,
      localVideo: null,
      remoteAudio: null,
      remoteVideo: null,
      remoteVideoBox: null,
      remoteVideoLabel: null,
      btnVideoStart: null,
      btnVideoStop: null,
      btnVideoSwitch: null,
      btnVideoSnapshot: null,
      videoOutStats: null,
      videoInStats: null,
      videoCodec: null,
      videoResFps: null,

      // Audio
      audioStatusPill: null,
      audioInput: null,
      audioOutput: null,
      btnMicMute: null,
      btnSpkMute: null,
      btnPlayTone: null,
      meterMicValue: null,
      meterMicFill: null,
      meterInValue: null,
      meterInFill: null,
      audioOutStats: null,
      audioInStats: null,
      audioCodec: null,
      audioMos: null,

      // SIP log
      filterIn: null,
      filterOut: null,
      filterMethod: null,
      filterCode: null,
      btnLogPause: null,
      btnLogClear: null,
      btnLogExport: null,
      sipLogTable: null,

      // RTP / Media
      rtpStream: null,
      rtpAutoRefresh: null,
      btnRtpReset: null,
      rtpSsrc: null,
      rtpCodec: null,
      rtpBitrate: null,
      rtpPackets: null,
      rtpLoss: null,
      rtpJitter: null,
      rtpRtt: null,
      rtpRttMax: null,

      // Timeline
      timeline: null,

      // Scenarios
      scenarioName: null,
      scenarioCalls: null,
      scenarioHold: null,
      scenarioTarget: null,
      btnScenarioRun: null,
      btnScenarioStop: null,
      btnScenarioSave: null,
      scenarioList: null,

      // Advanced
      stunServer: null,
      turnServer: null,
      turnUser: null,
      turnPass: null,
      sipOutboundProxy: null,
      sipTransport: null,
      tlsAllowSelfsigned: null,
      tlsSkipVerify: null,
      keepaliveInterval: null,
      optionsInterval: null,
      btnExportLogs: null,
      btnAddNote: null,
      btnCopyLastError: null,

      // Status bar
      statusbarCall: null,
    },

    /**
     * Инициализация: найти DOM-элементы по id
     */
    cacheDom() {
      const q = (id) => document.getElementById(id);

      // Connection / регистрация
      this.el.wsUrl = q('ws-url');
      this.el.sipUsername = q('sip-username');
      this.el.sipDomain = q('sip-domain');
      this.el.sipPassword = q('sip-password');

      this.el.btnWsConnect = q('btn-ws-connect');
      this.el.btnWsDisconnect = q('btn-ws-disconnect');
      this.el.btnSipRegister = q('btn-sip-register');
      this.el.btnSipUnregister = q('btn-sip-unregister');

      this.el.autoRegister = q('auto-register');
      this.el.autoReconnect = q('auto-reconnect');
      this.el.autoRetryRegister = q('auto-retry-register');
      this.el.registerRetries = q('register-retries');
      this.el.registerRetryDelay = q('register-retry-delay');

      this.el.wsStatusDot = q('ws-status-dot');
      this.el.wsStatusText = q('ws-status-text');
      this.el.sipStatusDot = q('sip-status-dot');
      this.el.sipStatusText = q('sip-status-text');
      this.el.lastRegisterResponse = q('last-register-response');

      this.el.summaryAccount = q('summary-account');
      this.el.summaryCall = q('summary-call');

      // Call / DTMF
      this.el.callCard = q('call-card');
      this.el.callDirection = q('call-direction');
      this.el.callStatusText = q('call-status-text');
      this.el.callMetaDirection = q('call-meta-direction');
      this.el.callMetaRemote = q('call-meta-remote');
      this.el.callMetaId = q('call-meta-id');
      this.el.callMetaTags = q('call-meta-tags');
      this.el.callMetaVia = q('call-meta-via');
      this.el.callTo = q('call-to');

      this.el.btnCallAudio = q('btn-call-audio');
      this.el.btnCallVideo = q('btn-call-video');
      this.el.btnAnswerAudio = q('btn-answer-audio');
      this.el.btnAnswerVideo = q('btn-answer-video');
      this.el.btnReject = q('btn-reject');
      this.el.btnHangup = q('btn-hangup');

      this.el.callSipState = q('call-sip-state');
      this.el.callEndReason = q('call-end-reason');

      this.el.dtmfMethod = q('dtmf-method');
      this.el.dtmfVolume = q('dtmf-volume');
      this.el.dtmfButtons = q('dtmf-buttons');
      this.el.dtmfReceivedLog = q('dtmf-received-log');

      // Video
      this.el.videoStatusPill = q('video-status-pill');
      this.el.remoteVideoBox = q('remote-video-box');
      this.el.remoteVideoLabel = q('remote-video-label');
      this.el.btnVideoStart = q('btn-video-start');
      this.el.btnVideoStop = q('btn-video-stop');
      this.el.btnVideoSwitch = q('btn-video-switch');
      this.el.btnVideoSnapshot = q('btn-video-snapshot');
      this.el.videoOutStats = q('video-out-stats');
      this.el.videoInStats = q('video-in-stats');
      this.el.videoCodec = q('video-codec');
      this.el.videoResFps = q('video-res-fps');

      // Audio
      this.el.audioStatusPill = q('audio-status-pill');
      this.el.audioInput = q('audio-input');
      this.el.audioOutput = q('audio-output');
      this.el.btnMicMute = q('btn-mic-mute');
      this.el.btnSpkMute = q('btn-spk-mute');
      this.el.btnPlayTone = q('btn-play-tone');
      this.el.meterMicValue = q('meter-mic-value');
      this.el.meterMicFill = q('meter-mic-fill');
      this.el.meterInValue = q('meter-in-value');
      this.el.meterInFill = q('meter-in-fill');
      this.el.audioOutStats = q('audio-out-stats');
      this.el.audioInStats = q('audio-in-stats');
      this.el.audioCodec = q('audio-codec');
      this.el.audioMos = q('audio-mos');

      // SIP log
      this.el.filterIn = q('filter-in');
      this.el.filterOut = q('filter-out');
      this.el.filterMethod = q('filter-method');
      this.el.filterCode = q('filter-code');
      this.el.btnLogPause = q('btn-log-pause');
      this.el.btnLogClear = q('btn-log-clear');
      this.el.btnLogExport = q('btn-log-export');
      this.el.sipLogTable = q('sip-log-table');

      // RTP / Media
      this.el.rtpStream = q('rtp-stream');
      this.el.rtpAutoRefresh = q('rtp-auto-refresh');
      this.el.btnRtpReset = q('btn-rtp-reset');
      this.el.rtpSsrc = q('rtp-ssrc');
      this.el.rtpCodec = q('rtp-codec');
      this.el.rtpBitrate = q('rtp-bitrate');
      this.el.rtpPackets = q('rtp-packets');
      this.el.rtpLoss = q('rtp-loss');
      this.el.rtpJitter = q('rtp-jitter');
      this.el.rtpRtt = q('rtp-rtt');
      this.el.rtpRttMax = q('rtp-rtt-max');

      // Timeline
      this.el.timeline = q('timeline');

      // Scenarios
      this.el.scenarioName = q('scenario-name');
      this.el.scenarioCalls = q('scenario-calls');
      this.el.scenarioHold = q('scenario-hold');
      this.el.scenarioTarget = q('scenario-target');
      this.el.btnScenarioRun = q('btn-scenario-run');
      this.el.btnScenarioStop = q('btn-scenario-stop');
      this.el.btnScenarioSave = q('btn-scenario-save');
      this.el.scenarioList = q('scenario-list');

      // Advanced
      this.el.stunServer = q('stun-server');
      this.el.turnServer = q('turn-server');
      this.el.turnUser = q('turn-user');
      this.el.turnPass = q('turn-pass');
      this.el.sipOutboundProxy = q('sip-outbound-proxy');
      this.el.sipTransport = q('sip-transport');
      this.el.tlsAllowSelfsigned = q('tls-allow-selfsigned');
      this.el.tlsSkipVerify = q('tls-skip-verify');
      this.el.keepaliveInterval = q('keepalive-interval');
      this.el.optionsInterval = q('options-interval');
      this.el.btnExportLogs = q('btn-export-logs');
      this.el.btnAddNote = q('btn-add-note');
      this.el.btnCopyLastError = q('btn-copy-last-error');

      // Status bar
      this.el.statusbarCall = q('statusbar-call');
    },

    /**
     * Установить начальные состояния UI (до подключения / регистрации)
     */
    initState() {
      // WebSocket / SIP
      this.setWsStatus('disconnected', 'Disconnected');
      this.setSipStatus('unregistered', 'Not registered');
      this.setSummaryCall('None');
      this.setStats({ registerCount: 0, callCount: 0, callOk: 0, errors: 0 });

      // Кнопки подключения: пока позволяем нажимать Connect, блокируем Disconnect
      this.el.btnWsConnect && (this.el.btnWsConnect.disabled = false);
      this.el.btnWsDisconnect && (this.el.btnWsDisconnect.disabled = true);

      // Кнопки регистрации
      this.el.btnSipRegister && (this.el.btnSipRegister.disabled = false);
      this.el.btnSipUnregister && (this.el.btnSipUnregister.disabled = false);

      // Call / DTMF
      this.setCallIdle();

      // Видео / аудио статусы
      if (this.el.videoStatusPill) this.el.videoStatusPill.textContent = 'Idle';
      if (this.el.audioStatusPill) this.el.audioStatusPill.textContent = 'Idle';

      // Очистка демо-данных (timeline, sip logs)
      if (this.el.timeline) {
        this.clearTimeline();
      }
      if (this.el.sipLogTable) {
        this.clearSipLogEntries();
      }

      // Tabs

    },

    /**
     * Обновление статуса WebSocket на экране
     * status: 'disconnected' | 'connecting' | 'connected'
     */
    setWsStatus(status, text) {
      if (!this.el.wsStatusDot || !this.el.wsStatusText) return;

      this.el.wsStatusDot.classList.remove('ok', 'warn');

      switch (status) {
        case 'connected':
          this.el.wsStatusDot.classList.add('ok');
          // Enable Disconnect, disable Connect
          if (this.el.btnWsConnect) this.el.btnWsConnect.disabled = true;
          if (this.el.btnWsDisconnect) this.el.btnWsDisconnect.disabled = false;
          break;
        case 'connecting':
          this.el.wsStatusDot.classList.add('warn');
          // Disable Connect, enable Disconnect
          if (this.el.btnWsConnect) this.el.btnWsConnect.disabled = true;
          if (this.el.btnWsDisconnect) this.el.btnWsDisconnect.disabled = false;
          break;
        default:
          // по умолчанию - красный (см. CSS по умолчанию)
          // Enable Connect, disable Disconnect
          if (this.el.btnWsConnect) this.el.btnWsConnect.disabled = false;
          if (this.el.btnWsDisconnect) this.el.btnWsDisconnect.disabled = true;
          break;
      }
      this.el.wsStatusText.textContent = text || status;
    },

    /**
     * Обновление статуса SIP регистрации
     * status: 'unregistered' | 'registering' | 'registered'
     */
    setSipStatus(status, text) {
      if (!this.el.sipStatusDot || !this.el.sipStatusText) return;

      this.el.sipStatusDot.classList.remove('ok', 'warn');

      switch (status) {
        case 'registered':
          this.el.sipStatusDot.classList.add('ok');
          break;
        case 'registering':
          this.el.sipStatusDot.classList.add('warn');
          break;
        default:
          // оставляем красный
          break;
      }
      this.el.sipStatusText.textContent = text || status;
    },

    setSummaryCall(text) {
      if (this.el.summaryCall) this.el.summaryCall.textContent = text;
      if (this.el.statusbarCall) this.el.statusbarCall.textContent = text;
    },

    setStats({ registerCount, unRegisterCount, registerFailedCount, rtcSessionCount, incomingCallCount, outgoingCallCount }) {
      // TODO
    },

    setCallIdle() {
      if (this.el.callStatusText) this.el.callStatusText.textContent = 'Нет активного вызова';
      if (this.el.callDirection) {
        this.el.callDirection.textContent = 'No call';
        this.el.callDirection.classList.remove('pill-success', 'pill-error', 'pill-warn');
        this.el.callDirection.classList.add('pill-warn');
      }

      if (this.el.callMetaDirection) this.el.callMetaDirection.textContent = '—';
      if (this.el.callMetaRemote) this.el.callMetaRemote.textContent = '—';
      if (this.el.callMetaId) this.el.callMetaId.textContent = '—';
      if (this.el.callMetaTags) this.el.callMetaTags.textContent = '—';
      if (this.el.callMetaVia) this.el.callMetaVia.textContent = '—';
      if (this.el.callSipState) this.el.callSipState.textContent = 'Idle';
      if (this.el.callEndReason) this.el.callEndReason.textContent = '—';

      // Блокируем кнопки, завязанные на активный звонок
      if (this.el.btnAnswerAudio) this.el.btnAnswerAudio.disabled = true;
      if (this.el.btnAnswerVideo) this.el.btnAnswerVideo.disabled = true;
      if (this.el.btnReject) this.el.btnReject.disabled = true;
      if (this.el.btnHangup) this.el.btnHangup.disabled = true;

      // Исходящие Call-кнопки оставляем активными (логика ограничения будет позже)
      if (this.el.btnCallAudio) this.el.btnCallAudio.disabled = false;
      if (this.el.btnCallVideo) this.el.btnCallVideo.disabled = false;

      this.setSummaryCall('Idle');
    },

    clearTimeline() {
      if (!this.el.timeline) return;
      this.el.timeline.innerHTML = '';
    },

    clearSipLogEntries() {
      if (!this.el.sipLogTable) return;
      const tbody = this.el.sipLogTable.querySelector('tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
    },

    appendTimelineEvent(text) {
      const container = this.el.timeline;
      if (!container) return;

      const item = document.createElement('div');
      item.className = 'timeline-item';

      const timeEl = document.createElement('div');
      timeEl.className = 'timeline-time';

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      timeEl.textContent = `${hh}:${mm}:${ss}`;

      const textEl = document.createElement('div');
      textEl.className = 'timeline-text';
      textEl.textContent = text;

      item.appendChild(timeEl);
      item.appendChild(textEl);
      container.appendChild(item);
      container.scrollTop = container.scrollHeight;
    },

    addSipLogEntry(direction, message) {
      if (!this.el.sipLogTable) return;
      const tbody = this.el.sipLogTable.querySelector('tbody');
      if (!tbody) return;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = `${hh}:${mm}:${ss}.${ms}`;

      const lines = String(message || '').split('\r\n');
      const firstLine = lines[0] || '';

      let type = 'Request';
      if (firstLine.startsWith('SIP/2.0')) {
        type = 'Response';
      }

      state.sipLog.push({
        time: timeStr,
        direction,      // 'in' | 'out'
        type,           // 'Request' | 'Response'
        firstLine,      // первая строка
        raw: String(message || '')
      });

      // 👉 Если лог на паузе — НЕ рисуем в таблице
      if (state.sipLogPaused) {
        return;
      }

      // ----- ниже прежняя отрисовка строки -----
      const row = document.createElement('tr');

      // Time
      const timeCell = document.createElement('td');
      timeCell.textContent = timeStr;
      row.appendChild(timeCell);

      // Dir
      const dirCell = document.createElement('td');
      dirCell.textContent = direction === 'out' ? 'Out' : 'In';
      dirCell.className = direction === 'out' ? 'direction-out' : 'direction-in';
      row.appendChild(dirCell);

      // Type
      const typeCell = document.createElement('td');
      typeCell.textContent = type;
      row.appendChild(typeCell);

      // Message (first line)
      const msgCell = document.createElement('td');
      msgCell.textContent = firstLine;
      msgCell.title = String(message || ''); // полный SIP в подсказке
      msgCell.style.cursor = 'help';
      row.appendChild(msgCell);

      tbody.appendChild(row);

      // Auto-scroll
      const container = this.el.sipLogTable.closest('.log-table-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    },

    setCallIncoming(info) {
      const el = this.el;

      if (el.callStatusText) el.callStatusText.textContent = 'Входящий вызов';

      if (el.callDirection) {
        el.callDirection.textContent = 'Incoming';
        el.callDirection.classList.remove('pill-error', 'pill-warn');
        el.callDirection.classList.add('pill-success');
      }

      if (el.callMetaDirection) el.callMetaDirection.textContent = 'Incoming';
      if (el.callMetaRemote) el.callMetaRemote.textContent =
          info.remoteDisplayName || info.remoteUri || '—';
      if (el.callMetaId) el.callMetaId.textContent = info.callId || '—';
      if (el.callMetaTags) el.callMetaTags.textContent = info.tags || '—';
      if (el.callMetaVia) el.callMetaVia.textContent = info.via || '—';
      if (el.callSipState) el.callSipState.textContent = 'Ringing';

      // Кнопки: можно ответить/отклонить, нельзя инициировать новый
      if (el.btnAnswerAudio) el.btnAnswerAudio.disabled = false;
      if (el.btnAnswerVideo) el.btnAnswerVideo.disabled = false;
      if (el.btnReject) el.btnReject.disabled = false;
      if (el.btnHangup) el.btnHangup.disabled = true;

      if (el.btnCallAudio) el.btnCallAudio.disabled = true;
      if (el.btnCallVideo) el.btnCallVideo.disabled = true;

      this.setSummaryCall('Incoming call');
    },

    setCallOutgoing(info) {
      const el = this.el;

      if (el.callStatusText) el.callStatusText.textContent = 'Исходящий вызов';

      if (el.callDirection) {
        el.callDirection.textContent = 'Outgoing';
        el.callDirection.classList.remove('pill-error', 'pill-warn');
        el.callDirection.classList.add('pill-success');
      }

      if (el.callMetaDirection) el.callMetaDirection.textContent = 'Outgoing';
      if (el.callMetaRemote) el.callMetaRemote.textContent =
          info.remoteDisplayName || info.remoteUri || '—';
      if (el.callMetaId) el.callMetaId.textContent = info.callId || '—';
      if (el.callMetaTags) el.callMetaTags.textContent = info.tags || '—';
      if (el.callMetaVia) el.callMetaVia.textContent = info.via || '—';
      if (el.callSipState) el.callSipState.textContent = 'Dialing';

      // Кнопки: нельзя инициировать ещё один вызов, можно повесить/отменить
      if (el.btnAnswerAudio) el.btnAnswerAudio.disabled = true;
      if (el.btnAnswerVideo) el.btnAnswerVideo.disabled = true;
      if (el.btnReject) el.btnReject.disabled = true;
      if (el.btnHangup) el.btnHangup.disabled = false;

      if (el.btnCallAudio) el.btnCallAudio.disabled = true;
      if (el.btnCallVideo) el.btnCallVideo.disabled = true;

      this.setSummaryCall('Outgoing call');
    },

    setCallEstablished(info) {
      const el = this.el;

      if (el.callStatusText) el.callStatusText.textContent = 'Вызов установлен';
      if (el.callSipState) el.callSipState.textContent = 'In call';

      if (el.callDirection) {
        el.callDirection.textContent =
            info && info.direction === 'incoming' ? 'Incoming' : 'Outgoing';
        el.callDirection.classList.remove('pill-error', 'pill-warn');
        el.callDirection.classList.add('pill-success');
      }

      if (el.callMetaId && info.callId) el.callMetaId.textContent = info.callId || '—';
      if (el.callMetaTags && info.tags) el.callMetaTags.textContent = info.tags || '—';
      if (el.callMetaVia && info.via) el.callMetaVia.textContent = info.via || '—';

      // Кнопки: только Hangup активен
      if (el.btnHangup) el.btnHangup.disabled = false;
      if (el.btnAnswerAudio) el.btnAnswerAudio.disabled = true;
      if (el.btnAnswerVideo) el.btnAnswerVideo.disabled = true;
      if (el.btnReject) el.btnReject.disabled = true;

      this.setSummaryCall('In call');
    },

    setCallTerminated(info) {
      const reason = (info && info.reason) || 'Call ended';
      if (this.el.callEndReason) this.el.callEndReason.textContent = reason;
      this.setCallIdle();
    },

    addDtmfReceived(tone) {
      this._dtmfHistory = this._dtmfHistory || '';
      this._dtmfHistory = (this._dtmfHistory + tone).slice(-20); // последние 20 символов

      const badge = this.el.dtmfReceivedLog;
      if (!badge) return;
      const valueEl = badge.querySelector('.badge-value') || badge;
      valueEl.textContent = this._dtmfHistory;
    },

    /**
     * Собрать конфиг из текущего состояния UI + state.config.
     * Это НЕ создаёт JsSIP.WebSocketInterface, а возвращает чистые данные,
     * которые потом можно использовать в sip-jssip-client.js.
     */
    getConfig() {
      const el = this.el;
      const cfg = state.config;

      // Базовые поля
      const websocketUrl =
          (el.wsUrl && el.wsUrl.value.trim()) ||
          cfg.websocketUrl ||
          '';

      const username =
          (el.sipUsername && el.sipUsername.value.trim()) ||
          cfg.username ||
          '';

      const domain =
          (el.sipDomain && el.sipDomain.value.trim()) ||
          cfg.domain ||
          '';

      const password =
          (el.sipPassword && el.sipPassword.value) ||
          cfg.password ||
          '';

      const callTo =
          (el.callTo && el.callTo.value.trim()) ||
          cfg.callTo ||
          '';

      // Флаги автоматизации
      const autoRegister =
          el.autoRegister != null
              ? !!el.autoRegister.checked
              : !!cfg.autoRegister;

      const autoReconnect =
          el.autoReconnect != null
              ? !!el.autoReconnect.checked
              : !!cfg.autoReconnect;

      const autoRetryRegister =
          el.autoRetryRegister != null
              ? !!el.autoRetryRegister.checked
              : !!cfg.autoRetryRegister;

      const registerRetryCount =
          el.registerRetries != null
              ? (parseInt(el.registerRetries.value, 10) || cfg.registerRetryCount || 3)
              : (cfg.registerRetryCount || 3);

      const registerRetryDelaySec =
          el.registerRetryDelay != null
              ? (parseInt(el.registerRetryDelay.value, 10) || cfg.registerRetryDelaySec || 5)
              : (cfg.registerRetryDelaySec || 5);

      // Advanced: STUN / TURN / SIP / TLS
      const stunServer =
          (el.stunServer && el.stunServer.value.trim()) ||
          cfg.stunServer ||
          '';

      const turnServer =
          (el.turnServer && el.turnServer.value.trim()) ||
          cfg.turnServer ||
          '';

      const turnUser =
          (el.turnUser && el.turnUser.value.trim()) ||
          cfg.turnUser ||
          '';

      const turnPass =
          (el.turnPass && el.turnPass.value) ||
          cfg.turnPass ||
          '';

      const outboundProxy =
          (el.sipOutboundProxy && el.sipOutboundProxy.value.trim()) ||
          cfg.outboundProxy ||
          '';

      const transport =
          (el.sipTransport && el.sipTransport.value) ||
          cfg.transport ||
          'wss';

      const keepaliveInterval =
          el.keepaliveInterval != null
              ? (parseInt(el.keepaliveInterval.value, 10) || cfg.keepaliveInterval || 30)
              : (cfg.keepaliveInterval || 30);

      const optionsInterval =
          el.optionsInterval != null
              ? (parseInt(el.optionsInterval.value, 10) || cfg.optionsInterval || 60)
              : (cfg.optionsInterval || 60);

      // SIP URI
      const sipUri = (username && domain) ? `sip:${username}@${domain}` : '';

      // Синхронизируем всё обратно в state.config, чтобы это было источником правды
      cfg.websocketUrl = websocketUrl;
      cfg.username = username;
      cfg.password = password;
      cfg.domain = domain;
      cfg.callTo = callTo;

      cfg.autoRegister = autoRegister;
      cfg.autoReconnect = autoReconnect;
      cfg.autoRetryRegister = autoRetryRegister;
      cfg.registerRetryCount = registerRetryCount;
      cfg.registerRetryDelaySec = registerRetryDelaySec;

      cfg.stunServer = stunServer;
      cfg.turnServer = turnServer;
      cfg.turnUser = turnUser;
      cfg.turnPass = turnPass;
      cfg.outboundProxy = outboundProxy;
      cfg.transport = transport;
      cfg.keepaliveInterval = keepaliveInterval;
      cfg.optionsInterval = optionsInterval;

      // Можно сразу обновить summaryAccount, если есть данные
      if (this.el.summaryAccount && username && domain) {
        this.el.summaryAccount.textContent = `${username}@${domain}`;
      }

      // Возвращаем удобный объект для JsSIP-клиента
      return {
        // SIP учётка
        sipUri,
        sipUsername: username,
        sipDomain: domain,
        sipPassword: password,

        // WebSocket / общие
        websocketUrl,
        callTo,

        // Автоматизация
        autoRegister,
        autoReconnect,
        autoRetryRegister,
        registerRetryCount,
        registerRetryDelaySec,

        // Advanced (WebRTC / SIP / TLS)
        stunServer,
        turnServer,
        turnUser,
        turnPass,
        outboundProxy,
        transport,
        keepaliveInterval,
        optionsInterval
      };
    },

    getCallTo() {
      return this.getConfig().callTo;
    },

    /**
     * Статус видео (подпись в pill)
     * mode: 'ok' | 'warn' | 'error' (опционально, влияет на цвет)
     */
    setVideoStatus(text, mode) {
      const pill = this.el.videoStatusPill;
      if (!pill) return;

      pill.textContent = text || '—';

      pill.classList.remove('pill-success', 'pill-warn', 'pill-error');
      switch (mode) {
        case 'ok':
          pill.classList.add('pill-success');
          break;
        case 'warn':
          pill.classList.add('pill-warn');
          break;
        case 'error':
          pill.classList.add('pill-error');
          break;
        default:
          // оставляем базовый .pill без модификаторов
          break;
      }
    },

    /**
     * Статус аудио (pill Audio)
     * mode: 'ok' | 'warn' | 'error'
     */
    setAudioStatus(text, mode) {
      const pill = this.el.audioStatusPill;
      if (!pill) return;

      pill.textContent = text || '—';

      pill.classList.remove('pill-success', 'pill-warn', 'pill-error');
      switch (mode) {
        case 'ok':
          pill.classList.add('pill-success');
          break;
        case 'warn':
          pill.classList.add('pill-warn');
          break;
        case 'error':
          pill.classList.add('pill-error');
          break;
        default:
          break;
      }
    },

    setAVStats(stats) {
      const video = (stats && stats.video) || {};
      const audio = (stats && stats.audio) || {};

      const fmt = (v, d = 1) => {
        if (v == null) return '—';
        if (typeof v === 'number' && v.toFixed) return v.toFixed(d);
        return String(v);
      };

      const setCell = (prefix, metric, dir, val, digits) => {
        const id = `${prefix}-${metric}-${dir}`; // пример: video-kbps-in
        const el = document.getElementById(id);
        if (!el) return;
        if (val == null) {
          el.textContent = '—';
          return;
        }
        if (typeof val === 'number' && digits != null && val.toFixed) {
          el.textContent = val.toFixed(digits);
        } else {
          el.textContent = String(val);
        }
      };

      const fillDirection = (prefix, metric, dirKey, dirObj, field, digits) => {
        if (!dirObj) {
          setCell(prefix, metric, dirKey, null);
        } else {
          setCell(prefix, metric, dirKey, dirObj[field], digits);
        }
      };

      const fillStreamStats = (prefix, s, r, kind) => {
        // s = { in, out }, r = { rIn, rOut }
        const inDir = s.in || {};
        const outDir = s.out || {};
        const rinDir = s.rIn || r.rIn || {};
        const routDir = s.rOut || r.rOut || {};

        // Bitrate
        fillDirection(prefix, 'kbps', 'in', inDir, 'kbps', 0);
        fillDirection(prefix, 'kbps', 'out', outDir, 'kbps', 0);
        fillDirection(prefix, 'kbps', 'rin', rinDir, 'kbps', 0);
        fillDirection(prefix, 'kbps', 'rout', routDir, 'kbps', 0);

        // Packets
        fillDirection(prefix, 'pkts', 'in', inDir, 'packets', 0);
        fillDirection(prefix, 'pkts', 'out', outDir, 'packets', 0);
        fillDirection(prefix, 'pkts', 'rin', rinDir, 'packets', 0);
        fillDirection(prefix, 'pkts', 'rout', routDir, 'packets', 0);

        // Lost
        fillDirection(prefix, 'lost', 'in', inDir, 'packetsLost', 0);
        fillDirection(prefix, 'lost', 'out', outDir, 'packetsLost', 0);
        fillDirection(prefix, 'lost', 'rin', rinDir, 'packetsLost', 0);
        fillDirection(prefix, 'lost', 'rout', routDir, 'packetsLost', 0);

        // Loss %
        fillDirection(prefix, 'loss', 'in', inDir, 'lossPct', 1);
        fillDirection(prefix, 'loss', 'out', outDir, 'lossPct', 1);
        fillDirection(prefix, 'loss', 'rin', rinDir, 'lossPct', 1);
        fillDirection(prefix, 'loss', 'rout', routDir, 'lossPct', 1);

        // Jitter
        fillDirection(prefix, 'jitter', 'in', inDir, 'jitterMs', 1);
        fillDirection(prefix, 'jitter', 'out', outDir, 'jitterMs', 1);
        fillDirection(prefix, 'jitter', 'rin', rinDir, 'jitterMs', 1);
        fillDirection(prefix, 'jitter', 'rout', routDir, 'jitterMs', 1);

        // RTT / RTT max
        fillDirection(prefix, 'rtt', 'in', inDir, 'rttMs', 1);
        fillDirection(prefix, 'rtt', 'out', outDir, 'rttMs', 1);
        fillDirection(prefix, 'rtt', 'rin', rinDir, 'rttMs', 1);
        fillDirection(prefix, 'rtt', 'rout', routDir, 'rttMs', 1);

        fillDirection(prefix, 'rttmax', 'in', inDir, 'rttMaxMs', 1);
        fillDirection(prefix, 'rttmax', 'out', outDir, 'rttMaxMs', 1);
        fillDirection(prefix, 'rttmax', 'rin', rinDir, 'rttMaxMs', 1);
        fillDirection(prefix, 'rttmax', 'rout', routDir, 'rttMaxMs', 1);

        // Codec
        fillDirection(prefix, 'codec', 'in', inDir, 'codec');
        fillDirection(prefix, 'codec', 'out', outDir, 'codec');
        fillDirection(prefix, 'codec', 'rin', rinDir, 'codec');
        fillDirection(prefix, 'codec', 'rout', routDir, 'codec');

        if (kind === 'video') {
          // Resolution
          fillDirection(prefix, 'res', 'in', inDir, 'res');
          fillDirection(prefix, 'res', 'out', outDir, 'res');
          fillDirection(prefix, 'res', 'rin', rinDir, 'res');
          fillDirection(prefix, 'res', 'rout', routDir, 'res');

          // FPS
          fillDirection(prefix, 'fps', 'in', inDir, 'fps', 0);
          fillDirection(prefix, 'fps', 'out', outDir, 'fps', 0);
          fillDirection(prefix, 'fps', 'rin', rinDir, 'fps', 0);
          fillDirection(prefix, 'fps', 'rout', routDir, 'fps', 0);

          // Frames summary (dec/sent)
          const vIn = inDir;
          const vOut = outDir;
          const vRIn = rinDir;
          const vROut = routDir;

          const mkFramesIn = vIn.framesDecoded != null || vIn.framesReceived != null
              ? `dec=${fmt(vIn.framesDecoded, 0)}, recv=${fmt(vIn.framesReceived, 0)}`
              : null;
          const mkFramesOut = vOut.framesEncoded != null || vOut.framesSent != null
              ? `enc=${fmt(vOut.framesEncoded, 0)}, sent=${fmt(vOut.framesSent, 0)}`
              : null;
          const mkFramesRIn = vRIn.framesDecoded != null || vRIn.framesReceived != null
              ? `dec=${fmt(vRIn.framesDecoded, 0)}, recv=${fmt(vRIn.framesReceived, 0)}`
              : null;
          const mkFramesROut = vROut.framesEncoded != null || vROut.framesSent != null
              ? `enc=${fmt(vROut.framesEncoded, 0)}, sent=${fmt(vROut.framesSent, 0)}`
              : null;

          setCell(prefix, 'frames', 'in', mkFramesIn);
          setCell(prefix, 'frames', 'out', mkFramesOut);
          setCell(prefix, 'frames', 'rin', mkFramesRIn);
          setCell(prefix, 'frames', 'rout', mkFramesROut);

          // NACK / PLI / FIR
          const mkRepair = (d) =>
              (d && (d.nackCount != null || d.pliCount != null || d.firCount != null))
                  ? `nack=${fmt(d.nackCount, 0)}, pli=${fmt(d.pliCount, 0)}, fir=${fmt(d.firCount, 0)}`
                  : null;

          setCell(prefix, 'repair', 'in', mkRepair(vIn));
          setCell(prefix, 'repair', 'out', mkRepair(vOut));
          setCell(prefix, 'repair', 'rin', mkRepair(vRIn));
          setCell(prefix, 'repair', 'rout', mkRepair(vROut));

          // Freezes / Pauses
          const mkFreeze = (d) =>
              (d && (d.freezeCount != null || d.pauseCount != null))
                  ? `freeze=${fmt(d.freezeCount, 0)}, pause=${fmt(d.pauseCount, 0)}`
                  : null;

          setCell(prefix, 'freeze', 'in', mkFreeze(vIn));
          setCell(prefix, 'freeze', 'out', mkFreeze(vOut));
          setCell(prefix, 'freeze', 'rin', mkFreeze(vRIn));
          setCell(prefix, 'freeze', 'rout', mkFreeze(vROut));

          // Key frames
          const mkKeys = (d, encField, decField) =>
              (d && (d[encField] != null || d[decField] != null))
                  ? `enc=${fmt(d[encField], 0)}, dec=${fmt(d[decField], 0)}`
                  : null;

          setCell(prefix, 'keyframes', 'in', mkKeys(vIn, 'keyFramesEncoded', 'keyFramesDecoded'));
          setCell(prefix, 'keyframes', 'out', mkKeys(vOut, 'keyFramesEncoded', 'keyFramesDecoded'));
          setCell(prefix, 'keyframes', 'rin', mkKeys(vRIn, 'keyFramesEncoded', 'keyFramesDecoded'));
          setCell(prefix, 'keyframes', 'rout', mkKeys(vROut, 'keyFramesEncoded', 'keyFramesDecoded'));
        }
      };

      // VIDEO
      fillStreamStats(
          'video',
          { in: video.in, out: video.out, rIn: video.rIn, rOut: video.rOut },
          { rIn: video.rIn, rOut: video.rOut },
          'video'
      );

      // AUDIO
      fillStreamStats(
          'audio',
          { in: audio.in, out: audio.out, rIn: audio.rIn, rOut: audio.rOut },
          { rIn: audio.rIn, rOut: audio.rOut },
          'audio'
      );

      // Обновляем подпись remote video (то, что реально видим)
      if (this.el && this.el.remoteVideoLabel && video.in) {
        const vin = video.in;
        const label = vin.resFpsText || (vin.res ? vin.res : null) || '—';
        this.el.remoteVideoLabel.textContent = `Remote: ${label}`;
      }
    },

    /**
     * Прикрепить входящий video stream к remote video box.
     * Обычно будет вызываться из JsSIP-клиента.
     */
    _attachRemoteVideoStream(stream) {
      const box = this.el.remoteVideoBox;
      if (!box || !stream) return;

      // спрячем placeholder
      const placeholder = box.querySelector('.video-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      // создаём или переиспользуем <video> для remote
      if (!this.el.remoteVideo) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.dataset.role = 'remote-video';

        // вставим в начало box
        box.insertBefore(video, box.firstChild);
        this.el.remoteVideo = video;
      }

      const videoEl = this.el.remoteVideo;
      if (!videoEl) return;

      videoEl.srcObject = stream;

      const p = videoEl.play();
      if (p && p.catch) {
        p.catch((err) => {
          console.warn('[UI] Remote video play() blocked by browser', err);
        });
      }

      this.setVideoStatus('Receiving video', 'ok');
    },

    /**
     * Прикрепить локальный video stream к мини-превью (local preview).
     * Ищем .video-mini внутри remoteVideoBox.
     */
    _attachLocalVideoStream(stream) {
      const box = this.el.remoteVideoBox;
      if (!box || !stream) return;

      const miniBox = box.querySelector('.video-mini');
      if (!miniBox) {
        console.warn('[UI] .video-mini container not found for local preview');
        return;
      }

      // убираем placeholder "Local preview"
      const inner = miniBox.querySelector('.video-mini-inner');
      if (inner) inner.style.display = 'none';

      // ---- защита от дерганий: проверяем, изменились ли треки ----
      try {
        const tracks = stream.getTracks ? stream.getTracks() : [];
        const signature = tracks.map(t => t.id).sort().join(',');

        const localTracks = this.el.localVideo.srcObject ? this.el.localVideo.srcObject.getTracks() : [];
        const localSignature = localTracks.map(t => t.id).sort().join(',');

        if (signature && localSignature && localSignature === signature) {
          // Ничего нового, просто выходим — не трогаем srcObject
          return;
        }
      } catch (e) {
        // если что-то пошло не так, просто продолжаем
        console.warn('[UI] local video attach warn', e);
      }

      // создаём <video> только один раз
      if (!this.el.localVideo) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true; // локальное видео всегда mute, чтобы не фонить
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.dataset.role = 'local-video';

        // очищаем miniBox от старого содержимого (кроме, если хотим оставить рамку)
        // miniBox.innerHTML = '';
        miniBox.appendChild(video);
        this.el.localVideo = video;
      }

      const videoEl = this.el.localVideo;
      videoEl.srcObject = stream;

      const p = videoEl.play();
      if (p && p.catch) {
        p.catch((err) => {
          console.warn('[UI] local video play() blocked', err);
        });
      }

      this.setVideoStatus && this.setVideoStatus('Sending video', 'ok');
    },

    /**
     * Привязать входящий аудиопоток к скрытому <audio>.
     */
    _attachRemoteAudioStream(stream) {
      // создадим/переиспользуем скрытый audio-элемент
      if (!this.el.remoteAudio) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.style.display = 'none';
        audio.id = 'remote-audio';
        document.body.appendChild(audio);
        this.el.remoteAudio = audio;
      }

      const audioEl = this.el.remoteAudio;
      audioEl.srcObject = stream;

      const p = audioEl.play();
      if (p && p.catch) {
        p.catch((err) => {
          console.warn('[UI] Remote audio play() blocked', err);
        });
      }

      this.setAudioStatus('Receiving audio', 'ok');
    },

    /**
     * Заполнить списки аудио-устройств.
     * devices: {
     *   inputs:  [{ deviceId, label }, ...],
     *   outputs: [{ deviceId, label }, ...],
     *   selectedInputId?: string,
     *   selectedOutputId?: string
     * }
     */
    _populateAudioDevices(devices) {
      const { inputs, outputs, selectedInputId, selectedOutputId } = devices || {};

      const inputSelect = this.el.audioInput;
      const outputSelect = this.el.audioOutput;

      if (inputSelect && Array.isArray(inputs)) {
        // очищаем старые options
        while (inputSelect.firstChild) {
          inputSelect.removeChild(inputSelect.firstChild);
        }

        if (inputs.length === 0) {
          const opt = document.createElement('option');
          opt.textContent = 'No input devices';
          opt.value = '';
          inputSelect.appendChild(opt);
          inputSelect.disabled = true;
        } else {
          inputSelect.disabled = false;
          inputs.forEach((d, idx) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId || '';
            opt.textContent =
                d.label && d.label.trim()
                    ? d.label
                    : `Microphone ${idx + 1}`;
            inputSelect.appendChild(opt);
          });

          if (selectedInputId) {
            const option = Array.from(inputSelect.options).find(
                (o) => o.value === selectedInputId
            );
            if (option) {
              inputSelect.value = selectedInputId;
            }
          } else {
            // выбираем первый по умолчанию
            inputSelect.selectedIndex = 0;
          }
        }
      }

      if (outputSelect && Array.isArray(outputs)) {
        while (outputSelect.firstChild) {
          outputSelect.removeChild(outputSelect.firstChild);
        }

        if (outputs.length === 0) {
          const opt = document.createElement('option');
          opt.textContent = 'Default output';
          opt.value = '';
          outputSelect.appendChild(opt);
          outputSelect.disabled = false; // можно оставить включённым
        } else {
          outputSelect.disabled = false;
          outputs.forEach((d, idx) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId || '';
            opt.textContent =
                d.label && d.label.trim()
                    ? d.label
                    : `Output ${idx + 1}`;
            outputSelect.appendChild(opt);
          });

          if (selectedOutputId) {
            const option = Array.from(outputSelect.options).find(
                (o) => o.value === selectedOutputId
            );
            if (option) {
              outputSelect.value = selectedOutputId;
            }
          } else {
            outputSelect.selectedIndex = 0;
          }
        }
      }
    },

    /**
     * Однократная инициализация списка аудиоустройств.
     * 1) Пытаемся запросить доступ к микрофону (чтобы появились label'ы)
     * 2) Делаем enumerateDevices()
     */
    _initAudioDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        this.setAudioStatus('mediaDevices API not available', 'warn');
        return;
      }

      const doEnumerate = () => {
        navigator.mediaDevices.enumerateDevices()
            .then((devices) => {
              const inputs = [];
              const outputs = [];

              devices.forEach((d) => {
                if (d.kind === 'audioinput') {
                  inputs.push({ deviceId: d.deviceId, label: d.label });
                } else if (d.kind === 'audiooutput') {
                  outputs.push({ deviceId: d.deviceId, label: d.label });
                }
              });

              this._populateAudioDevices({
                inputs,
                outputs,
                selectedInputId: state.config.audioInputId,
                selectedOutputId: state.config.audioOutputId
              });

              this.setAudioStatus('Devices detected', 'ok');
            })
            .catch((err) => {
              console.error('[UI] enumerateDevices error', err);
              this.setAudioStatus('Device enumeration error', 'error');
            });
      };

      // Чтобы получить читаемые label'ы, нужно запросить разрешение на микрофон.
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .then((stream) => {
            // сразу останавливаем треки, нам нужен только факт разрешения
            stream.getTracks().forEach((t) => t.stop());
            doEnumerate();
          })
          .catch((err) => {
            console.warn('[UI] getUserMedia audio error', err);
            // даже без разрешения можем вызвать enumerateDevices, просто label'ы будут пустые
            doEnumerate();
          });
    },

    /**
     * Переинициализация устройств (например, по событию devicechange)
     */
    _refreshAudioDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

      navigator.mediaDevices.enumerateDevices()
          .then((devices) => {
            const inputs = [];
            const outputs = [];

            devices.forEach((d) => {
              if (d.kind === 'audioinput') {
                inputs.push({ deviceId: d.deviceId, label: d.label });
              } else if (d.kind === 'audiooutput') {
                outputs.push({ deviceId: d.deviceId, label: d.label });
              }
            });

            this._populateAudioDevices({
              inputs,
              outputs,
              selectedInputId: state.config.audioInputId,
              selectedOutputId: state.config.audioOutputId
            });
          })
          .catch((err) => {
            console.error('[UI] refreshAudioDevices enumerate error', err);
          });
    },

    /**
     * Запускает периодический сбор статистики из RTCPeerConnection.getStats()
     * и заполняет:
     *  - Video OUT / Video IN (video-... элементы)
     *  - Audio OUT / Audio IN (audio-... элементы)
     */
    _startMediaStatsMonitor(pc) {
      if (!pc || typeof pc.getStats !== 'function') {
        console.warn('[UI] startMediaStatsMonitor: no pc.getStats');
        return;
      }

      // Не запускать второй раз на тот же pc
      if (pc._avStatsInterval) return;

      console.log('[UI] startMediaStatsMonitor');

      const ui = this;

      const prev = {
        audioIn: null,
        audioOut: null,
        videoIn: null,
        videoOut: null,
        audioInRttMaxMs: null,
        audioOutRttMaxMs: null,
        videoInRttMaxMs: null,
        videoOutRttMaxMs: null,
        timestamp: null
      };

      const collect = async () => {
        if (pc.signalingState === 'closed') {
          clearInterval(pc._avStatsInterval);
          pc._avStatsInterval = null;
          return;
        }

        let stats;
        try {
          stats = await pc.getStats();
        } catch (err) {
          console.warn('[stats] getStats error', err);
          return;
        }

        const now = Date.now();

        // ---- коллекции отчётов ----
        const codecs = {};

        let audioInRtp = null;
        let audioOutRtp = null;
        let videoInRtp = null;
        let videoOutRtp = null;

        let audioRemoteInRtp = null;   // remote-inbound-rtp (качество нашего OUT глазами сервера)
        let audioRemoteOutRtp = null;  // remote-outbound-rtp (качество нашего IN глазами сервера)
        let videoRemoteInRtp = null;
        let videoRemoteOutRtp = null;

        stats.forEach((report) => {
          switch (report.type) {
            case 'codec':
              codecs[report.id] = report;
              break;

            case 'inbound-rtp': {
              const kind = report.kind || report.mediaType;
              if (kind === 'audio' && !audioInRtp) audioInRtp = report;
              if (kind === 'video' && !videoInRtp) videoInRtp = report;
              break;
            }

            case 'outbound-rtp': {
              const kind = report.kind || report.mediaType;
              if (kind === 'audio' && !audioOutRtp) audioOutRtp = report;
              if (kind === 'video' && !videoOutRtp) videoOutRtp = report;
              break;
            }

            case 'remote-inbound-rtp': {
              const kind = report.kind || report.mediaType;
              if (kind === 'audio' && !audioRemoteInRtp) audioRemoteInRtp = report;
              if (kind === 'video' && !videoRemoteInRtp) videoRemoteInRtp = report;
              break;
            }

            case 'remote-outbound-rtp': {
              const kind = report.kind || report.mediaType;
              if (kind === 'audio' && !audioRemoteOutRtp) audioRemoteOutRtp = report;
              if (kind === 'video' && !videoRemoteOutRtp) videoRemoteOutRtp = report;
              break;
            }

            default:
              break;
          }
        });

        // console.log('[stats]', codecs, audioInRtp, audioOutRtp, videoInRtp, videoOutRtp, audioRemoteInRtp, audioRemoteOutRtp, videoRemoteInRtp, videoRemoteOutRtp);

        // ===== helpers =====

        const extractResFps = (r) => {
          if (!r) return { res: null, fps: null, resFpsText: null };
          const w = r.frameWidth;
          const h = r.frameHeight;
          const fpsRaw =
              r.framesPerSecond != null
                  ? r.framesPerSecond
                  : r.framesSentPerSecond || r.framesReceivedPerSecond;

          let res = null;
          let fps = null;
          let resFpsText = null;

          if (w && h) {
            res = `${w}x${h}`;
            if (fpsRaw) {
              fps =
                  typeof fpsRaw === 'number' && fpsRaw.toFixed
                      ? Number(fpsRaw.toFixed(0))
                      : fpsRaw;
              resFpsText = `${res} @ ${fps}fps`;
            } else {
              resFpsText = res;
            }
          }

          return { res, fps, resFpsText };
        };

        const calcBitrateLocal = (prevEntry, bytesNow) => {
          if (bytesNow == null) {
            return { kbps: null, bytes: null };
          }
          if (!prevEntry || prev.timestamp == null || prevEntry.bytes == null) {
            return { kbps: null, bytes: bytesNow }; // первый заход
          }

          const deltaBytes = bytesNow - prevEntry.bytes;
          const deltaMs = now - prev.timestamp;
          if (deltaMs <= 0 || deltaBytes < 0) {
            return { kbps: null, bytes: bytesNow };
          }

          const bitsPerSecond = (deltaBytes * 8 * 1000) / deltaMs;
          const kbps = bitsPerSecond / 1000;
          return { kbps, bytes: bytesNow };
        };

        const extractCommonCountersLocal = (rtp, direction, kind) => {
          if (!rtp) {
            return {
              packets: null,
              packetsLost: null,
              lossPct: null,
              jitterMs: null,
              rttMs: null
            };
          }

          const isInbound = direction === 'in';
          const packets = isInbound
              ? (rtp.packetsReceived || 0)
              : (rtp.packetsSent || 0);
          const packetsLost = rtp.packetsLost || 0;
          const total = packets + packetsLost;
          const lossPct = total > 0 ? (packetsLost / total) * 100 : null;

          const jitterMs =
              typeof rtp.jitter === 'number' ? rtp.jitter * 1000 : null;

          // В локальных inbound/outbound-rtp roundTripTime обычно нет или не очень полезен
          const rttMs =
              typeof rtp.roundTripTime === 'number'
                  ? rtp.roundTripTime * 1000
                  : null;

          return {
            packets,
            packetsLost,
            lossPct,
            jitterMs,
            rttMs
          };
        };

        const extractVideoCounters = (rtp, direction) => {
          if (!rtp) {
            return {
              framesEncoded: null,
              framesDecoded: null,
              framesDropped: null,
              framesReceived: null,
              framesSent: null,
              nackCount: null,
              pliCount: null,
              firCount: null,
              freezeCount: null,
              pauseCount: null,
              keyFramesEncoded: null,
              keyFramesDecoded: null
            };
          }

          const isInbound = direction === 'in';
          const isOutbound = direction === 'out';

          return {
            framesEncoded: isOutbound ? rtp.framesEncoded ?? null : null,
            framesDecoded: isInbound ? rtp.framesDecoded ?? null : null,
            framesDropped: isInbound ? rtp.framesDropped ?? null : null,
            framesReceived: isInbound ? rtp.framesReceived ?? null : null,
            framesSent: isOutbound ? rtp.framesSent ?? null : null,
            keyFramesEncoded: isOutbound ? rtp.keyFramesEncoded ?? null : null,
            keyFramesDecoded: isInbound ? rtp.keyFramesDecoded ?? null : null,
            nackCount: rtp.nackCount ?? null,
            pliCount: rtp.pliCount ?? null,
            firCount: rtp.firCount ?? null,
            freezeCount: rtp.freezeCount ?? null,
            pauseCount: rtp.pauseCount ?? null
          };
        };

        const buildLocalDirStats = (rtp, direction, kind) => {
          if (!rtp) return null;

          const isInbound = direction === 'in';
          const prevKey =
              kind === 'audio'
                  ? (isInbound ? 'audioIn' : 'audioOut')
                  : (isInbound ? 'videoIn' : 'videoOut');
          const prevRttKey =
              kind === 'audio'
                  ? (isInbound ? 'audioInRttMaxMs' : 'audioOutRttMaxMs')
                  : (isInbound ? 'videoInRttMaxMs' : 'videoOutRttMaxMs');

          const bytesNow = isInbound ? rtp.bytesReceived : rtp.bytesSent;
          const bitrateRes = calcBitrateLocal(prev[prevKey], bytesNow);
          prev[prevKey] = { bytes: bitrateRes.bytes };

          const common = extractCommonCountersLocal(rtp, direction, kind);

          if (common.rttMs != null) {
            prev[prevRttKey] =
                prev[prevRttKey] != null
                    ? Math.max(prev[prevRttKey], common.rttMs)
                    : common.rttMs;
          }

          let codec = null;
          if (rtp.codecId && codecs[rtp.codecId]) {
            const c = codecs[rtp.codecId];
            codec = c.mimeType || c.name || null;
          }

          const base = {
            kbps: bitrateRes.kbps,
            codec,
            packets: common.packets,
            packetsLost: common.packetsLost,
            lossPct: common.lossPct,
            jitterMs: common.jitterMs,
            rttMs: common.rttMs,
            rttMaxMs: prev[prevRttKey] || null
          };

          if (kind === 'video') {
            const { res, fps, resFpsText } = extractResFps(rtp);
            const vc = extractVideoCounters(rtp, direction);
            return {
              ...base,
              res,
              fps,
              resFpsText,
              ...vc
            };
          }

          // AUDIO (пока без MOS, можно добавить позже)
          return base;
        };

        // remote-inbound-rtp: качество нашего OUT глазами сервера
        const buildRemoteInboundStats = (rtp, kind) => {
          if (!rtp) return null;

          const lossPct =
              typeof rtp.fractionLost === 'number'
                  ? rtp.fractionLost * 100
                  : null;

          const jitterMs =
              typeof rtp.jitter === 'number'
                  ? rtp.jitter * 1000
                  : null;

          const rttMs =
              typeof rtp.roundTripTime === 'number'
                  ? rtp.roundTripTime * 1000
                  : null;

          let rttMaxMs = null;
          if (
              typeof rtp.totalRoundTripTime === 'number' &&
              typeof rtp.roundTripTimeMeasurements === 'number' &&
              rtp.roundTripTimeMeasurements > 0
          ) {
            rttMaxMs =
                (rtp.totalRoundTripTime / rtp.roundTripTimeMeasurements) * 1000;
          }

          const base = {
            kbps: null,
            codec: null,
            packets: null, // remote-inbound-rtp в твоём примере не имеет packets*
            packetsLost: rtp.packetsLost ?? null,
            lossPct,
            jitterMs,
            rttMs,
            rttMaxMs
          };

          if (kind === 'video') {
            // Обычно remote-inbound-rtp не содержит frameWidth/Height, оставляем null
            return base;
          }

          return base;
        };

        // remote-outbound-rtp: качество нашего IN глазами сервера
        const buildRemoteOutboundStats = (rtp, prevKey, kind) => {
          if (!rtp) return null;

          // Битрейт можно при желании считать по bytesSent remote-side,
          // но в примере totalRoundTripTime = 0, так что RTT там неинформативен.
          let kbps = null;
          let bytesNow = null;

          if (typeof rtp.bytesSent === 'number') {
            bytesNow = rtp.bytesSent;
            const prevEntry = prev[prevKey];
            if (prevEntry && prev.timestamp != null && prevEntry.bytes != null) {
              const deltaBytes = bytesNow - prevEntry.bytes;
              const deltaMs = now - prev.timestamp;
              if (deltaMs > 0 && deltaBytes >= 0) {
                const bitsPerSecond = (deltaBytes * 8 * 1000) / deltaMs;
                kbps = bitsPerSecond / 1000;
              }
            }
            prev[prevKey] = { bytes: bytesNow };
          }

          const packets = rtp.packetsSent ?? null;

          let rttMs = null;
          if (
              typeof rtp.totalRoundTripTime === 'number' &&
              typeof rtp.roundTripTimeMeasurements === 'number' &&
              rtp.roundTripTimeMeasurements > 0
          ) {
            rttMs =
                (rtp.totalRoundTripTime / rtp.roundTripTimeMeasurements) * 1000;
          }

          return {
            kbps,
            codec: null,
            packets,
            packetsLost: null,
            lossPct: null,
            jitterMs: null,
            rttMs,
            rttMaxMs: null
          };
        };

        // ===== строим итоговые структуры =====

        const videoIn = buildLocalDirStats(videoInRtp, 'in', 'video');
        const videoOut = buildLocalDirStats(videoOutRtp, 'out', 'video');
        const videoRIn = buildRemoteInboundStats(videoRemoteInRtp, 'video'); // server view of our OUT
        const videoROut = buildRemoteOutboundStats(videoRemoteOutRtp, 'remoteVideoOut', 'video'); // server view of our IN

        const audioIn = buildLocalDirStats(audioInRtp, 'in', 'audio');
        const audioOut = buildLocalDirStats(audioOutRtp, 'out', 'audio');
        const audioRIn = buildRemoteInboundStats(audioRemoteInRtp, 'audio');
        const audioROut = buildRemoteOutboundStats(audioRemoteOutRtp, 'remoteAudioOut', 'audio');

        prev.timestamp = now;
        prev.remoteVideoOut = videoROut;
        prev.remoteAudioOut = audioROut;

        if (ui && typeof ui.setAVStats === 'function') {
          ui.setAVStats({
            video: { in: videoIn, out: videoOut, rIn: videoRIn, rOut: videoROut },
            audio: { in: audioIn, out: audioOut, rIn: audioRIn, rOut: audioROut }
          });
        }
      };

      pc._avStatsInterval = setInterval(collect, 1000);
      // Можно сразу один раз собрать
      collect().catch(() => {});
    },

    /**
     * Привязка RTCPeerConnection к UI.
     * Мы не управляем pc, а только слушаем и показываем медиа.
     */
    bindPeerConnection(pc) {
      if (!pc) return;

      // Чтобы не оборачивать один и тот же pc дважды
      if (pc._uiBound) {
        console.log('[UI] bindPeerConnection: already bound');
        return;
      }
      pc._uiBound = true;

      console.log('[UI] bindPeerConnection', pc);

      const ui = this;

      // ---------- REMOTE: входящие треки ----------
      pc.addEventListener('track', (ev) => {
        const stream = ev.streams && ev.streams[0];
        if (!stream) return;

        const hasVideo = stream.getVideoTracks && stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks && stream.getAudioTracks().length > 0;

        if (hasVideo && ui._attachRemoteVideoStream) {
          ui._attachRemoteVideoStream(stream);
        }

        if (hasAudio && ui._attachRemoteAudioStream) {
          ui._attachRemoteAudioStream(stream);
        }

        ui.setAudioStatus && ui.setAudioStatus('Receiving audio', 'ok');
        if (hasVideo && ui.setVideoStatus) {
          ui.setVideoStatus('Receiving video', 'ok');
        }
      });

      // ---------- LOCAL: то, что мы отправляем ----------
      const refreshLocal = () => {
        const senders = pc.getSenders ? pc.getSenders() : [];
        const tracks = senders
            .map((s) => s.track)
            .filter((t) => t && (t.kind === 'video' || t.kind === 'audio'));

        if (!tracks.length) return false;

        const localStream = new MediaStream(tracks);

        if (localStream.getVideoTracks().length > 0 && ui._attachLocalVideoStream) {
          ui._attachLocalVideoStream(localStream);
          ui.setVideoStatus && ui.setVideoStatus('Sending video', 'ok');
        }
        if (localStream.getAudioTracks().length > 0 && ui.setAudioStatus) {
          ui.setAudioStatus('Sending audio', 'ok');
        }

        return true;
      };

      // 1) Попробуем сразу — вдруг треки уже есть (часто так бывает для входящего)
      refreshLocal();

      // 2) Перехват addTrack — самый надёжный способ узнать, что JsSIP добавил локальный трек
      if (!pc._uiAddTrackWrapped && pc.addTrack) {
        pc._uiAddTrackWrapped = true;
        const origAddTrack = pc.addTrack.bind(pc);

        pc.addTrack = function (...args) {
          const sender = origAddTrack(...args);
          try {
            refreshLocal();
          } catch (err) {
            console.warn('[UI] error in wrapped addTrack', err);
          }
          return sender;
        };
      }

      // 3) Перехват addTransceiver (некоторые реализации используют его)
      if (!pc._uiAddTransceiverWrapped && pc.addTransceiver) {
        pc._uiAddTransceiverWrapped = true;
        const origAddTransceiver = pc.addTransceiver.bind(pc);

        pc.addTransceiver = function (...args) {
          const transceiver = origAddTransceiver(...args);
          try {
            refreshLocal();
          } catch (err) {
            console.warn('[UI] error in wrapped addTransceiver', err);
          }
          return transceiver;
        };
      }

      // 4) Слушаем изменение signalingState и negotiationneeded как дополнительные триггеры
      const onStateChange = () => {
        try {
          refreshLocal();
        } catch (err) {
          console.warn('[UI] refreshLocal on signalingstatechange error', err);
        }
      };

      const onNegotiationNeeded = () => {
        try {
          refreshLocal();
        } catch (err) {
          console.warn('[UI] refreshLocal on negotiationneeded error', err);
        }
      };

      pc.addEventListener('signalingstatechange', onStateChange);
      pc.addEventListener('negotiationneeded', onNegotiationNeeded);

      // 5) Лёгкий поллинг как последняя страховка
      const localPoll = setInterval(() => {
        if (pc.signalingState === 'closed') {
          clearInterval(localPoll);
          pc.removeEventListener('signalingstatechange', onStateChange);
          pc.removeEventListener('negotiationneeded', onNegotiationNeeded);
          return;
        }
        try {
          if (refreshLocal()) {
            // Не останавливаем принудительно: вдруг позже добавят видеотрек
            // Но если хочешь — можно раскомментировать:
            // clearInterval(localPoll);
            // pc.removeEventListener('signalingstatechange', onStateChange);
            // pc.removeEventListener('negotiationneeded', onNegotiationNeeded);
          }
        } catch (err) {
          console.warn('[UI] refreshLocal in poll error', err);
        }
      }, 500);

      this._startMediaStatsMonitor(pc);
    },

    on (eventName, handler) {
      return subscribe(eventName, handler);
    }
  };

  /**
   * Обработчики действий (пока заглушки).
   * Здесь потом будем звать JsSIP (создание UA, звонки и т.д.).
   */
  const actions = {
    onWsConnectClick() {
      console.log('[UI] WS Connect clicked');
      emit('ws-connect-click', { state, ui });
    },
    onWsDisconnectClick() {
      console.log('[UI] WS Disconnect clicked');
      emit('ws-disconnect-click', { state, ui });
    },
    onSipRegisterClick() {
      console.log('[UI] SIP Register clicked');
      emit('sip-register-click', { state, ui });
    },
    onSipUnregisterClick() {
      console.log('[UI] SIP Unregister clicked');
      emit('sip-unregister-click', { state, ui });
    },
    onCallAudioClick() {
      const target = ui.getConfig().callTo
      console.log('[UI] Call (audio) to', target);
      emit('call-audio-click', { state, ui, target });
    },
    onCallVideoClick() {
      const target = ui.getConfig().callTo
      console.log('[UI] Call (video) to', target);
      emit('call-video-click', { state, ui, target });
    },
    onAnswerAudioClick() {
      console.log('[UI] Answer (audio)');
      emit('answer-audio-click', { state, ui });
    },
    onAnswerVideoClick() {
      console.log('[UI] Answer (video)');
      emit('answer-video-click', { state, ui });
    },
    onRejectClick() {
      console.log('[UI] Reject incoming call');
      emit('reject-click', { state, ui });
    },
    onHangupClick() {
      console.log('[UI] Hangup');
      emit('hangup-click', { state, ui });
    },
    onDtmfButtonClick(tone) {
      console.log('[UI] Send DTMF', tone);
      emit('dtmf-click', { state, ui, tone });
    },
    onLogClearClick() {
      console.log('[UI] Clear SIP log');
      ui.clearSipLogEntries();
      // emit('log-clear-click', { state, ui });
    },
    onLogPauseClick() {
      console.log('[UI] SIP log pause:', state?.sipLogPaused);
      state.sipLogPaused = !state.sipLogPaused;
      const btn = ui.el.btnLogPause;
      if (btn) {
        btn.textContent = state.sipLogPaused ? 'Resume' : 'Pause';
        btn.classList.toggle('active', state.sipLogPaused);
      }
      // emit('log-pause-click', { state, ui, paused: state.sipLogPaused });
    },
    onLogExportClick() {
      console.log('[UI] SIP log export', state.sipLog?.length);

      const entries = state.sipLog || [];
      if (!entries.length) {
        return;
      }

      const lines = [];
      lines.push('# SIP Log export');
      lines.push(`# Entries: ${entries.length}`);
      lines.push('');

      entries.forEach((e) => {
        const dirLabel = e.direction === 'out' ? 'OUT' : 'IN';
        lines.push(`[${e.time}] ${dirLabel} ${e.type} ${e.firstLine}`);
        if (e.raw && e.raw !== e.firstLine) {
          lines.push(e.raw);
        }
        lines.push(''); // пустая строка между сообщениями
      });

      const text = lines.join('\n');

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `sip-log-${ts}.log`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // emit('log-export-click', { state, ui, entriesCount: entries.length });
    },
  };

  /**
   * Назначаем обработчики на DOM-элементы
   */
  function bindEvents() {
    const el = ui.el;

    if (el.btnWsConnect) el.btnWsConnect.addEventListener('click', actions.onWsConnectClick);
    if (el.btnWsDisconnect) el.btnWsDisconnect.addEventListener('click', actions.onWsDisconnectClick);

    if (el.btnSipRegister) el.btnSipRegister.addEventListener('click', actions.onSipRegisterClick);
    if (el.btnSipUnregister) el.btnSipUnregister.addEventListener('click', actions.onSipUnregisterClick);

    if (el.btnCallAudio) el.btnCallAudio.addEventListener('click', actions.onCallAudioClick);
    if (el.btnCallVideo) el.btnCallVideo.addEventListener('click', actions.onCallVideoClick);
    if (el.btnAnswerAudio) el.btnAnswerAudio.addEventListener('click', actions.onAnswerAudioClick);
    if (el.btnAnswerVideo) el.btnAnswerVideo.addEventListener('click', actions.onAnswerVideoClick);
    if (el.btnReject) el.btnReject.addEventListener('click', actions.onRejectClick);
    if (el.btnHangup) el.btnHangup.addEventListener('click', actions.onHangupClick);

    if (el.btnLogPause) el.btnLogPause.addEventListener('click', actions.onLogPauseClick);
    if (el.btnLogClear) el.btnLogClear.addEventListener('click', actions.onLogClearClick);
    if (el.btnLogExport) el.btnLogExport.addEventListener('click', actions.onLogExportClick);

    // DTMF кнопки: делегирование по контейнеру
    if (el.dtmfButtons) {
      el.dtmfButtons.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.tagName.toLowerCase() !== 'button') return;
        const tone = target.textContent && target.textContent.trim();
        if (!tone) return;
        actions.onDtmfButtonClick(tone);
      });
    }

    // Синхронизация полей ввода со state.config при изменении
    if (el.wsUrl) el.wsUrl.addEventListener('input', () => state.config.websocketUrl = el.wsUrl.value.trim());
    if (el.sipUsername) el.sipUsername.addEventListener('input', () => state.config.username = el.sipUsername.value.trim());
    if (el.sipDomain) el.sipDomain.addEventListener('input', () => state.config.domain = el.sipDomain.value.trim());
    if (el.sipPassword) el.sipPassword.addEventListener('input', () => state.config.password = el.sipPassword.value);

    if (el.callTo) {
      el.callTo.addEventListener('input', () => {
        state.config.callTo = el.callTo.value.trim();
      });
    }

    if (el.autoRegister) el.autoRegister.addEventListener('change', () => state.config.autoRegister = el.autoRegister.checked);
    if (el.autoReconnect) el.autoReconnect.addEventListener('change', () => state.config.autoReconnect = el.autoReconnect.checked);
    if (el.autoRetryRegister) el.autoRetryRegister.addEventListener('change', () => state.config.autoRetryRegister = el.autoRetryRegister.checked);

    if (el.registerRetries) el.registerRetries.addEventListener('input', () => state.config.registerRetryCount = parseInt(el.registerRetries.value, 10) || 3);
    if (el.registerRetryDelay) el.registerRetryDelay.addEventListener('input', () => state.config.registerRetryDelaySec = parseInt(el.registerRetryDelay.value, 10) || 5);

    // Advanced: STUN / TURN
    if (el.stunServer) {
      el.stunServer.addEventListener('input', () => {
        state.config.stunServer = el.stunServer.value.trim();
      });
    }

    if (el.turnServer) {
      el.turnServer.addEventListener('input', () => {
        state.config.turnServer = el.turnServer.value.trim();
      });
    }

    if (el.turnUser) {
      el.turnUser.addEventListener('input', () => {
        state.config.turnUser = el.turnUser.value.trim();
      });
    }

    if (el.turnPass) {
      el.turnPass.addEventListener('input', () => {
        state.config.turnPass = el.turnPass.value;
      });
    }

    // SIP outbound / transport
    if (el.sipOutboundProxy) {
      el.sipOutboundProxy.addEventListener('input', () => {
        state.config.outboundProxy = el.sipOutboundProxy.value.trim();
      });
    }

  }

  /**
   * Парсим GET-параметры и применяем к state.config + полям ввода.
   *
   * Ожидаемые параметры:
   *  - websocketUrl
   *  - username
   *  - password
   *  - domain
   *  - callTo
   *  - autoRegister
   *  - autoReconnect
   *  - autoRetryRegister
   */
  function applyConfigFromQuery() {
    const params = new URLSearchParams(window.location.search);

    const getStr = (name, defValue = '') => {
      if (!params.has(name)) return defValue;
      const v = params.get(name);
      if (v == null) return defValue;
      // снимаем возможные кавычки из примера типа "user"
      return v.replace(/^"+|"+$/g, '');
    };

    const getBool = (name, defValue = false) => {
      if (!params.has(name)) return defValue;
      const raw = params.get(name);
      if (raw == null) return defValue;
      const v = raw.replace(/^"+|"+$/g, '').toLowerCase();
      return ['1', 'true', 'yes', 'on'].includes(v);
    };

    const cfg = state.config;

    cfg.websocketUrl = getStr('websocketUrl', ui.el.wsUrl ? ui.el.wsUrl.value : '');
    cfg.username = getStr('username', ui.el.sipUsername ? ui.el.sipUsername.value : '');
    cfg.password = getStr('password', ui.el.sipPassword ? ui.el.sipPassword.value : '');
    cfg.domain = getStr('domain', ui.el.sipDomain ? ui.el.sipDomain.value : '');
    cfg.callTo = getStr('callTo', ui.el.callTo ? ui.el.callTo.value : '');
    cfg.outboundProxy = getStr('outboundProxy', ui.el.sipOutboundProxy ? ui.el.sipOutboundProxy.value : '');
    cfg.stunServer = getStr('stunServer', ui.el.stunServer ? ui.el.stunServer.value : '');
    cfg.turnServer = getStr('turnServer', ui.el.turnServer ? ui.el.turnServer.value : '');
    cfg.turnUser = getStr('turnUser', ui.el.turnUser ? ui.el.turnUser.value : '');
    cfg.turnPass = getStr('turnPass', ui.el.turnPass ? ui.el.turnPass.value : '');

    cfg.autoRegister = getBool('autoRegister', ui.el.autoRegister ? ui.el.autoRegister.checked : cfg.autoRegister);
    cfg.autoReconnect = getBool('autoReconnect', ui.el.autoReconnect ? ui.el.autoReconnect.checked : cfg.autoReconnect);
    cfg.autoRetryRegister = getBool('autoRetryRegister', ui.el.autoRetryRegister ? ui.el.autoRetryRegister.checked : cfg.autoRetryRegister);

    // Применяем в UI (если элементы существуют)
    if (ui.el.wsUrl && cfg.websocketUrl) ui.el.wsUrl.value = cfg.websocketUrl;
    if (ui.el.sipUsername && cfg.username) ui.el.sipUsername.value = cfg.username;
    if (ui.el.sipPassword && cfg.password) ui.el.sipPassword.value = cfg.password;
    if (ui.el.sipDomain && cfg.domain) ui.el.sipDomain.value = cfg.domain;

    if (ui.el.callTo && cfg.callTo) ui.el.callTo.value = cfg.callTo;
    if (ui.el.sipOutboundProxy && cfg.outboundProxy) ui.el.sipOutboundProxy.value = cfg.outboundProxy;
    if (ui.el.stunServer && cfg.stunServer) ui.el.stunServer.value = cfg.stunServer;
    if (ui.el.turnServer && cfg.turnServer) ui.el.turnServer.value = cfg.turnServer;
    if (ui.el.turnUser && cfg.turnUser) ui.el.turnUser.value = cfg.turnUser;
    if (ui.el.turnPass && cfg.turnPass) ui.el.turnPass.value = cfg.turnPass;

    if (ui.el.autoRegister) ui.el.autoRegister.checked = !!cfg.autoRegister;
    if (ui.el.autoReconnect) ui.el.autoReconnect.checked = !!cfg.autoReconnect;
    if (ui.el.autoRetryRegister) ui.el.autoRetryRegister.checked = !!cfg.autoRetryRegister;

    // Обновим summary-account, если есть user + domain
    if (ui.el.summaryAccount && cfg.username && cfg.domain) {
      ui.el.summaryAccount.textContent = `${cfg.username}@${cfg.domain}`;
    }
  }

  /**
   * Init entry point
   */
  function init() {
    ui.cacheDom();
    ui.initState();
    applyConfigFromQuery();
    bindEvents();

    // // Автоматическое определение аудиоустройств
    // ui._initAudioDevices();
    //
    // // Если устройства меняются (втыкаем/вытыкаем гарнитуру) — обновляем списки
    // if (navigator.mediaDevices) {
    //   if (navigator.mediaDevices.addEventListener) {
    //     navigator.mediaDevices.addEventListener('devicechange', () => {
    //       ui._refreshAudioDevices();
    //     });
    //   } else if ('ondevicechange' in navigator.mediaDevices) {
    //     navigator.mediaDevices.ondevicechange = () => {
    //       ui._refreshAudioDevices();
    //     };
    //   }
    // }

    console.log('[SIP Tester] UI initialized. Config:', state.config);
  }

  // Инициализация после загрузки DOM
  document.addEventListener('DOMContentLoaded', init);

  // На всякий случай экспортируем в window для дебага / консоли
  window.SipTester = {
    _state: state,
    ui,
  };
})();
