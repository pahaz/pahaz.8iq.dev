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
  ]);

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

    return () => {
      const current = listeners.get(eventName);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) listeners.delete(eventName);
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

  function toggleLocalVideo(ui, state, stopped) {
    const pc = state.peerConnection;
    if (!pc || !pc.getSenders) {
      ui.appendTimelineEvent('Ошибка: нет PeerConnection сессии (игнорировано)');
      return;
    }

    let touched = 0;
    pc.getSenders().forEach((s) => {
      if (s?.track?.kind === 'video') {
        s.track.enabled = !stopped;
        touched++;
      }
    });

    if (!touched) ui.appendTimelineEvent('No local video track to toggle');
    else ui.appendTimelineEvent(stopped ? 'Video stopped (track.enabled=false)' : 'Video resumed');
  }

  function toggleLocalMic(ui, state, muted) {
    const pc = state.peerConnection;
    if (!pc || !pc.getSenders) {
      ui.appendTimelineEvent('Ошибка: нет PeerConnection сессии (игнорировано)');
      return;
    }

    let touched = 0;
    pc.getSenders().forEach((s) => {
      if (s?.track?.kind === 'audio') {
        s.track.enabled = !muted;
        touched++;
      }
    });

    if (!touched) ui.appendTimelineEvent('No local audio track to toggle');
    else ui.appendTimelineEvent(muted ? 'Mic muted (track.enabled=false)' : 'Mic unmuted');
  }

  function toggleSpeaker(ui, muted) {
    const audioEl = el?.remoteAudio || document.getElementById('remote-audio');

    if (!audioEl) {
      ui.appendTimelineEvent('Ошибка: remote-audio элемент не найден! (игнорировано)');
      return;
    }

    const videoEl = el?.remoteVideo || document.getElementById('remote-video');
    if (videoEl) {
      videoEl.muted = true;
    }

    audioEl.muted = !!muted;
    ui.appendTimelineEvent(muted ? 'Speaker muted' : 'Speaker unmuted');
  }

  function playTestTone(ui) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        ui.appendTimelineEvent('Ошибка: Web Audio API не поддерживается (игнорировано)');
        return;
      }

      if (!ui._toneCtx) ui._toneCtx = new AudioContext();
      const ctx = ui._toneCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 1000; // 1 kHz
      gain.gain.value = 0.1;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 1.0);

      ui.appendTimelineEvent('Play local test tone (1 kHz, 1s)');
    } catch (e) {
      ui.appendTimelineEvent('Ошибка тестового тона: ' + e.message);
    }
  }

  const q = (id) => document.getElementById(id);

  const state = {
    config: {
      websocketUrl: '',
      username: '',
      password: '',
      domain: '',
      callTo: '',
      autoRegister: true,
      autoRetryRegister: false,
      registerRetryCount: 3,
      registerRetryDelaySec: 5,
      stunServer: '',
      turnServer: '',
      turnUser: '',
      turnPass: '',
      outboundProxy: ''
    },

    sipLog: [],
    sipLogPaused: false,

    peerConnection: null,
  };
  
  const el = {
    wsUrl: q('ws-url'),
    sipUsername: q('sip-username'),
    sipDomain: q('sip-domain'),
    sipPassword: q('sip-password'),

    btnWsConnect: q('btn-ws-connect'),
    btnWsDisconnect: q('btn-ws-disconnect'),
    btnSipRegister: q('btn-sip-register'),
    btnSipUnregister: q('btn-sip-unregister'),

    autoRegister: q('auto-register'),
    autoRetryRegister: q('auto-retry-register'),
    registerRetries: q('register-retries'),
    registerRetryDelay: q('register-retry-delay'),

    wsStatusDot: q('ws-status-dot'),
    wsStatusText: q('ws-status-text'),
    sipStatusDot: q('sip-status-dot'),
    sipStatusText: q('sip-status-text'),

    summaryAccount: q('summary-account'),
    statusbarCall: q('statusbar-call'),

    callCard: q('call-card'),
    callDirection: q('call-direction'),
    callStatusText: q('call-status-text'),
    callMetaDirection: q('call-meta-direction'),
    callMetaRemote: q('call-meta-remote'),
    callMetaId: q('call-meta-id'),
    callMetaTags: q('call-meta-tags'),
    callMetaVia: q('call-meta-via'),
    callTo: q('call-to'),

    btnCallAudio: q('btn-call-audio'),
    btnCallVideo: q('btn-call-video'),
    btnAnswerAudio: q('btn-answer-audio'),
    btnAnswerVideo: q('btn-answer-video'),
    btnReject: q('btn-reject'),
    btnHangup: q('btn-hangup'),

    callEndReason: q('call-end-reason'),

    dtmfButtons: q('dtmf-buttons'),
    dtmfReceivedLog: q('dtmf-received-log'),

    videoStatusPill: q('video-status-pill'),
    remoteVideoBox: q('remote-video-box'),
    remoteVideoLabel: q('remote-video-label'),
    btnVideoStop: q('btn-video-stop'),
    btnMicMute: q('btn-mic-mute'),
    btnSpkMute: q('btn-spk-mute'),
    btnPlayTone: q('btn-play-tone'),

    btnLogPause: q('btn-log-pause'),
    btnLogClear: q('btn-log-clear'),
    btnLogExport: q('btn-log-export'),
    sipLogTable: q('sip-log-table'),

    timeline: q('timeline'),

    stunServer: q('stun-server'),
    turnServer: q('turn-server'),
    turnUser: q('turn-user'),
    turnPass: q('turn-pass'),
    sipOutboundProxy: q('sip-outbound-proxy'),
  };

  const ui = {
    initState() {
      this.setWsStatus('disconnected', 'Disconnected');
      this.setSipStatus('unregistered', 'Not registered');

      el.btnWsConnect.disabled = false
      el.btnWsDisconnect.disabled = true

      el.btnSipRegister.disabled = false
      el.btnSipUnregister.disabled = false

      this.setCallIdle();

      el.videoStatusPill.textContent = 'Idle';

      this.clearTimeline();
      this.clearSipLogEntries();
    },

    setWsStatus(status, text) {
      if (!el.wsStatusDot || !el.wsStatusText) return;

      el.wsStatusDot.classList.remove('ok', 'warn');
      el.wsStatusText.textContent = text || status;

      switch (status) {
        case 'connected':
          el.wsStatusDot.classList.add('ok');
          el.btnWsConnect.disabled = true;
          el.btnWsDisconnect.disabled = false;
          break;
        case 'connecting':
          el.wsStatusDot.classList.add('warn');
          el.btnWsConnect.disabled = true;
          el.btnWsDisconnect.disabled = false;
          break;
        default:
          el.btnWsConnect.disabled = false;
          el.btnWsDisconnect.disabled = true;
          break;
      }
    },

    setSipStatus(status, text) {
      if (!el.sipStatusDot || !el.sipStatusText) return;

      el.sipStatusDot.classList.remove('ok', 'warn');
      el.sipStatusText.textContent = text || status;

      switch (status) {
        case 'registered':
          el.sipStatusDot.classList.add('ok');
          break;
        case 'registering':
          el.sipStatusDot.classList.add('warn');
          break;
        default:
          break;
      }
    },

    setSummaryCall(text) {
      el.statusbarCall.textContent = text;
    },

    setStats({ registerCount, unRegisterCount, registerFailedCount, rtcSessionCount, incomingCallCount, outgoingCallCount }) {
      // TODO
    },

    setCallIdle() {
      el.callStatusText.textContent = 'Нет активного вызова';
      el.callDirection.textContent = 'No call';
      el.callDirection.classList.remove('pill-success', 'pill-error', 'pill-warn');
      el.callDirection.classList.add('pill-warn');

      // if (el.callMetaDirection) el.callMetaDirection.textContent = '—';
      // if (el.callMetaRemote) el.callMetaRemote.textContent = '—';
      // if (el.callMetaId) el.callMetaId.textContent = '—';
      // if (el.callMetaTags) el.callMetaTags.textContent = '—';
      // if (el.callMetaVia) el.callMetaVia.textContent = '—';
      // if (el.callEndReason) el.callEndReason.textContent = '—';

      el.btnAnswerAudio.disabled = true;
      el.btnAnswerVideo.disabled = true;
      el.btnReject.disabled = true;
      el.btnHangup.disabled = true;
      el.btnCallAudio.disabled = false;
      el.btnCallVideo.disabled = false;

      this.setSummaryCall('Idle');
      this.setVideoStatus('Idle');
      this.setAudioStatus('Idle');
    },

    clearTimeline() {
      if (!el.timeline) return;
      el.timeline.innerHTML = '';
    },

    clearSipLogEntries() {
      if (!el.sipLogTable) return;
      const tbody = el.sipLogTable.querySelector('tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
    },

    appendTimelineEvent(text) {
      const container = el.timeline;
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
      if (!el.sipLogTable) return;
      const tbody = el.sipLogTable.querySelector('tbody');
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

      if (state.sipLogPaused) return;

      const row = document.createElement('tr');

      const timeCell = document.createElement('td');
      timeCell.textContent = timeStr;
      row.appendChild(timeCell);

      const dirCell = document.createElement('td');
      dirCell.textContent = direction === 'out' ? 'Out' : 'In';
      dirCell.className = direction === 'out' ? 'direction-out' : 'direction-in';
      row.appendChild(dirCell);

      const typeCell = document.createElement('td');
      typeCell.textContent = type;
      row.appendChild(typeCell);

      const msgCell = document.createElement('td');
      msgCell.textContent = firstLine;
      msgCell.title = String(message || '');
      msgCell.style.cursor = 'help';
      row.appendChild(msgCell);

      tbody.appendChild(row);

      const container = el.sipLogTable.closest('.log-table-container');
      if (container) container.scrollTop = container.scrollHeight;
    },

    setCallIncoming(info) {
      el.callStatusText.textContent = 'Входящий вызов';
      el.callDirection.textContent = 'Incoming';
      el.callDirection.classList.remove('pill-error', 'pill-warn');
      el.callDirection.classList.add('pill-success');

      el.callMetaDirection.textContent = 'Incoming';
      el.callMetaRemote.textContent = info.remoteDisplayName || info.remoteUri || '—';
      el.callMetaId.textContent = info.callId || '—';
      el.callMetaTags.textContent = info.tags || '—';
      el.callMetaVia.textContent = info.via || '—';
      el.callEndReason.textContent = '—';

      el.btnAnswerAudio.disabled = false;
      el.btnAnswerVideo.disabled = false;
      el.btnReject.disabled = false;
      el.btnHangup.disabled = true;

      el.btnCallAudio.disabled = true;
      el.btnCallVideo.disabled = true;

      this.setSummaryCall('Incoming call');
    },

    setCallOutgoing(info) {
      el.callStatusText.textContent = 'Исходящий вызов';
      el.callDirection.textContent = 'Outgoing';
      el.callDirection.classList.remove('pill-error', 'pill-warn');
      el.callDirection.classList.add('pill-success');

      el.callMetaDirection.textContent = 'Outgoing';
      el.callMetaRemote.textContent = info.remoteDisplayName || info.remoteUri || '—';
      el.callMetaId.textContent = info.callId || '—';
      el.callMetaTags.textContent = info.tags || '—';
      el.callMetaVia.textContent = info.via || '—';
      el.callEndReason.textContent = '—';

      el.btnAnswerAudio.disabled = true;
      el.btnAnswerVideo.disabled = true;
      el.btnReject.disabled = true;
      el.btnHangup.disabled = false;

      el.btnCallAudio.disabled = true;
      el.btnCallVideo.disabled = true;

      this.setSummaryCall('Outgoing call');
    },

    setCallEstablished(info) {
      el.callStatusText.textContent = 'Вызов установлен';
      el.callDirection.textContent = info && info.direction === 'incoming' ? 'Incoming' : 'Outgoing';
      el.callDirection.classList.remove('pill-error', 'pill-warn');
      el.callDirection.classList.add('pill-success');

      if (el.callMetaId && info.callId) el.callMetaId.textContent = info.callId || '—';
      if (el.callMetaTags && info.tags) el.callMetaTags.textContent = info.tags || '—';
      if (el.callMetaVia && info.via) el.callMetaVia.textContent = info.via || '—';

      el.btnAnswerAudio.disabled = true;
      el.btnAnswerVideo.disabled = true;
      el.btnReject.disabled = true;
      el.btnHangup.disabled = false;

      this.setSummaryCall('In call');
    },

    setCallTerminated(info) {
      const reason = (info && info.reason) || 'Call ended';
      if (el.callMetaId && info.callId) el.callMetaId.textContent = info.callId || '—';
      if (el.callMetaTags && info.tags) el.callMetaTags.textContent = info.tags || '—';
      if (el.callMetaVia && info.via) el.callMetaVia.textContent = info.via || '—';
      if (el.callEndReason) el.callEndReason.textContent = reason;
      this.setCallIdle();
    },

    addDtmfReceived(tone) {
      this._dtmfHistory = this._dtmfHistory || '';
      this._dtmfHistory = (this._dtmfHistory + tone).slice(-20);

      const badge = el.dtmfReceivedLog;
      if (!badge) return;
      const valueEl = badge.querySelector('.badge-value') || badge;
      valueEl.textContent = this._dtmfHistory;
    },

    getConfig() {
      const cfg = state.config;

      const websocketUrl = (el.wsUrl && el.wsUrl.value.trim()) || cfg.websocketUrl || '';
      const username = (el.sipUsername && el.sipUsername.value.trim()) || cfg.username || '';
      const domain = (el.sipDomain && el.sipDomain.value.trim()) || cfg.domain || '';
      const password = (el.sipPassword && el.sipPassword.value) || cfg.password || '';
      const callTo = (el.callTo && el.callTo.value.trim()) || cfg.callTo || '';

      const autoRegister = el.autoRegister != null ? !!el.autoRegister.checked : !!cfg.autoRegister;
      const autoRetryRegister = el.autoRetryRegister != null ? !!el.autoRetryRegister.checked : !!cfg.autoRetryRegister;

      const registerRetryCount = el.registerRetries != null
          ? (parseInt(el.registerRetries.value, 10) || cfg.registerRetryCount || 3)
          : (cfg.registerRetryCount || 3);

      const registerRetryDelaySec = el.registerRetryDelay != null
          ? (parseInt(el.registerRetryDelay.value, 10) || cfg.registerRetryDelaySec || 5)
          : (cfg.registerRetryDelaySec || 5);

      const stunServer = (el.stunServer && el.stunServer.value.trim()) || cfg.stunServer || '';
      const turnServer = (el.turnServer && el.turnServer.value.trim()) || cfg.turnServer || '';
      const turnUser = (el.turnUser && el.turnUser.value.trim()) || cfg.turnUser || '';
      const turnPass = (el.turnPass && el.turnPass.value) || cfg.turnPass || '';
      const outboundProxy = (el.sipOutboundProxy && el.sipOutboundProxy.value.trim()) || cfg.outboundProxy || '';

      const sipUri = (username && domain) ? `sip:${username}@${domain}` : '';

      cfg.websocketUrl = websocketUrl;
      cfg.username = username;
      cfg.password = password;
      cfg.domain = domain;
      cfg.callTo = callTo;

      cfg.autoRegister = autoRegister;
      cfg.autoRetryRegister = autoRetryRegister;
      cfg.registerRetryCount = registerRetryCount;
      cfg.registerRetryDelaySec = registerRetryDelaySec;

      cfg.stunServer = stunServer;
      cfg.turnServer = turnServer;
      cfg.turnUser = turnUser;
      cfg.turnPass = turnPass;
      cfg.outboundProxy = outboundProxy;

      if (el.summaryAccount && username && domain) {
        el.summaryAccount.textContent = `${username}@${domain}`;
      }

      return {
        sipUri,
        sipUsername: username,
        sipDomain: domain,
        sipPassword: password,

        websocketUrl,
        callTo,

        autoRegister,
        autoRetryRegister,
        registerRetryCount,
        registerRetryDelaySec,

        stunServer,
        turnServer,
        turnUser,
        turnPass,
        outboundProxy,
      };
    },

    setVideoStatus(text, mode) {
      const pill = el.videoStatusPill;
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

    setAudioStatus(_text, _mode) {
      // audio-pill в текущей разметке отсутствует
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
              ? `dec=${fmt(vIn.framesDecoded, 0)}, drop=${fmt(vIn.framesDropped, 0)}, recv=${fmt(vIn.framesReceived, 0)}`
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
        } else if (kind === 'audio') {
          const aIn = inDir;

          // Samples & Duration -> put into 'frames' row
          const mkSamples = (d) =>
              (d && (d.totalSamplesReceived != null || d.totalSamplesDuration != null))
                  ? `samples=${fmt(d.totalSamplesReceived, 0)}, dur=${fmt(d.totalSamplesDuration, 2)}`
                  : null;

          setCell(prefix, 'frames', 'in', mkSamples(aIn));

          // Energy & Delay -> put into 'res' row
          const mkLevels = (d) =>
              (d && (d.totalAudioEnergy != null || d.totalProcessingDelay != null))
                  ? `nrg=${fmt(d.totalAudioEnergy, 3)}, delay=${fmt(d.totalProcessingDelay, 2)}`
                  : null;

          setCell(prefix, 'res', 'in', mkLevels(aIn));
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
      if (el && el.remoteVideoLabel && video.in) {
        const vin = video.in;
        const label = vin.resFpsText || (vin.res ? vin.res : null) || '—';
        el.remoteVideoLabel.textContent = `Remote: ${label}`;
      }
    },

    /**
     * Прикрепить входящий video stream к remote video box.
     * Обычно будет вызываться из JsSIP-клиента.
     */
    _attachRemoteVideoStream(stream) {
      const box = el.remoteVideoBox;
      if (!box || !stream) return;

      // спрячем placeholder
      const placeholder = box.querySelector('.video-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      const remoteVideo = document.getElementById('remote-video');
      if (remoteVideo) {
        el.remoteVideo = remoteVideo;
      }

      if (!el.remoteVideo) {
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
        el.remoteVideo = video;
      }

      const videoEl = el.remoteVideo;
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
      const box = el.remoteVideoBox;
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

        const localTracks = el.localVideo?.srcObject ? el.localVideo?.srcObject.getTracks() : [];
        const localSignature = localTracks.map(t => t.id).sort().join(',');

        if (signature && localSignature && localSignature === signature) {
          // Ничего нового, просто выходим — не трогаем srcObject
          return;
        }
      } catch (e) {
        // если что-то пошло не так, просто продолжаем
        console.warn('[UI] local video attach warn', e);
      }

      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        el.localVideo = localVideo;
      }

      if (!el.localVideo) {
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
        el.localVideo = video;
      }

      const videoEl = el.localVideo;
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
      const remoteAudio = document.getElementById('remote-audio');
      if (remoteAudio) {
        el.remoteAudio = remoteAudio;
      }

      if (!el.remoteAudio) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.style.display = 'none';
        audio.id = 'remote-audio';
        document.body.appendChild(audio);
        el.remoteAudio = audio;
      }

      const audioEl = el.remoteAudio;
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
     * Мониторинг Media Stats по RTCPeerConnection.getStats().
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
        audioRInRttMaxMs: null,
        audioROutRttMaxMs: null,
        videoRInRttMaxMs: null,
        videoROutRttMaxMs: null,
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

        console.log({ codecs, audioInRtp, audioOutRtp, videoInRtp, videoOutRtp, audioRemoteInRtp, audioRemoteOutRtp, videoRemoteInRtp, videoRemoteOutRtp });

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
          } else if (kind === 'audio' && direction === 'in') {
            return {
              ...base,
              totalSamplesReceived: rtp.totalSamplesReceived,
              totalSamplesDuration: rtp.totalSamplesDuration,
              totalAudioEnergy: rtp.totalAudioEnergy,
              totalProcessingDelay: rtp.totalProcessingDelay
            };
          }

          // AUDIO (пока без MOS, можно добавить позже)
          return base;
        };

        // remote-inbound-rtp: качество нашего OUT глазами сервера
        const buildRemoteInboundStats = (rtp, prevRttKey, kind) => {
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

          if (rttMs != null) {
            prev[prevRttKey] =
                prev[prevRttKey] != null
                    ? Math.max(prev[prevRttKey], rttMs)
                    : rttMs;
          }

          const base = {
            kbps: null,
            codec: null,
            packets: null, // remote-inbound-rtp в твоём примере не имеет packets*
            packetsLost: rtp.packetsLost ?? null,
            lossPct,
            jitterMs,
            rttMs,
            rttMaxMs: prev[prevRttKey] || null,
          };

          if (kind === 'video') {
            // Обычно remote-inbound-rtp не содержит frameWidth/Height, оставляем null
            return base;
          }

          return base;
        };

        // remote-outbound-rtp: качество нашего IN глазами сервера
        const buildRemoteOutboundStats = (rtp, prevKey, prevRttKey, kind) => {
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

          // Текущий RTT
          let rttMs = null;
          if (typeof rtp.roundTripTime === 'number') {
            rttMs = rtp.roundTripTime * 1000;
          } else if (
              // Фоллбэк, если чистого roundTripTime нет, но есть total (хотя это снова будет среднее, лучше брать roundTripTime)
              typeof rtp.totalRoundTripTime === 'number' &&
              typeof rtp.roundTripTimeMeasurements === 'number' &&
              rtp.roundTripTimeMeasurements > 0
          ) {
            // Если браузер не дает мгновенный, берем среднее как approximate
            rttMs = (rtp.totalRoundTripTime / rtp.roundTripTimeMeasurements) * 1000;
          }

          if (rttMs != null) {
            prev[prevRttKey] =
                prev[prevRttKey] != null
                    ? Math.max(prev[prevRttKey], rttMs)
                    : rttMs;
          }

          return {
            kbps,
            codec: null,
            packets,
            packetsLost: null,
            lossPct: null,
            jitterMs: null,
            rttMs,
            rttMaxMs: prev[prevRttKey] || null,
          };
        };

        // ===== строим итоговые структуры =====

        const videoIn = buildLocalDirStats(videoInRtp, 'in', 'video');
        const videoOut = buildLocalDirStats(videoOutRtp, 'out', 'video');
        const videoRIn = buildRemoteInboundStats(videoRemoteInRtp, 'videoRInRttMaxMs', 'video');
        const videoROut = buildRemoteOutboundStats(videoRemoteOutRtp, 'remoteVideoOut', 'videoROutRttMaxMs', 'video');

        const audioIn = buildLocalDirStats(audioInRtp, 'in', 'audio');
        const audioOut = buildLocalDirStats(audioOutRtp, 'out', 'audio');
        const audioRIn = buildRemoteInboundStats(audioRemoteInRtp, 'audioRInRttMaxMs', 'audio');
        const audioROut = buildRemoteOutboundStats(audioRemoteOutRtp, 'remoteAudioOut', 'audioROutRttMaxMs', 'audio');

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
      state.peerConnection = pc

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

    on(eventName, handler) {
      return subscribe(eventName, handler);
    }
  };

  const actions = {
    onWsConnectClick () {
      console.log('[UI] WS Connect clicked');
      emit('ws-connect-click', { state, ui });
    },
    onWsDisconnectClick () {
      console.log('[UI] WS Disconnect clicked');
      emit('ws-disconnect-click', { state, ui });
    },
    onSipRegisterClick () {
      console.log('[UI] SIP Register clicked');
      emit('sip-register-click', { state, ui });
    },
    onSipUnregisterClick () {
      console.log('[UI] SIP Unregister clicked');
      emit('sip-unregister-click', { state, ui });
    },
    onCallAudioClick () {
      const target = ui.getConfig().callTo
      console.log('[UI] Call (audio) to', target);
      emit('call-audio-click', { state, ui, target });
    },
    onCallVideoClick () {
      const target = ui.getConfig().callTo
      console.log('[UI] Call (video) to', target);
      emit('call-video-click', { state, ui, target });
    },
    onAnswerAudioClick () {
      console.log('[UI] Answer (audio)');
      emit('answer-audio-click', { state, ui });
    },
    onAnswerVideoClick () {
      console.log('[UI] Answer (video)');
      emit('answer-video-click', { state, ui });
    },
    onRejectClick () {
      console.log('[UI] Reject incoming call');
      emit('reject-click', { state, ui });
    },
    onHangupClick () {
      console.log('[UI] Hangup');
      emit('hangup-click', { state, ui });
    },
    onDtmfButtonClick (tone) {
      console.log('[UI] Send DTMF', tone);
      emit('dtmf-click', { state, ui, tone });
    },
  };

  function bindEvents() {
    el.btnWsConnect.addEventListener('click', actions.onWsConnectClick);
    el.btnWsDisconnect.addEventListener('click', actions.onWsDisconnectClick);

    el.btnSipRegister.addEventListener('click', actions.onSipRegisterClick);
    el.btnSipUnregister.addEventListener('click', actions.onSipUnregisterClick);

    el.btnCallAudio.addEventListener('click', actions.onCallAudioClick);
    el.btnCallVideo.addEventListener('click', actions.onCallVideoClick);
    el.btnAnswerAudio.addEventListener('click', actions.onAnswerAudioClick);
    el.btnAnswerVideo.addEventListener('click', actions.onAnswerVideoClick);
    el.btnReject.addEventListener('click', actions.onRejectClick);
    el.btnHangup.addEventListener('click', actions.onHangupClick);

    el.btnLogPause.addEventListener('click', () => {
      console.log('[UI] SIP log pause:', state?.sipLogPaused);
      state.sipLogPaused = !state.sipLogPaused;
      const btn = el.btnLogPause;
      if (btn) {
        btn.textContent = state.sipLogPaused ? 'Resume' : 'Pause';
        btn.classList.toggle('active', state.sipLogPaused);
      }
    });

    el.btnLogClear.addEventListener('click', () => {
      console.log('[UI] Clear SIP log');
      ui.clearSipLogEntries();
    });

    el.btnLogExport.addEventListener('click', () => {
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
    });

    el.btnVideoStop.addEventListener('click', () => {
      console.log('[UI] btnVideoStop clicked');
      const btn = el.btnVideoStop;
      const isStopped = btn.dataset.stopped === '1';
      const next = !isStopped;

      btn.dataset.stopped = next ? '1' : '';
      btn.textContent = next ? 'Start video' : 'Stop video';

      toggleLocalVideo(ui, state, next);
    });

    el.btnMicMute.addEventListener('click', () => {
      console.log('[UI] btnMicMute clicked');
      const btn = el.btnMicMute;
      const isMuted = btn.dataset.muted === '1';
      const next = !isMuted;

      btn.dataset.muted = next ? '1' : '';
      btn.textContent = next ? 'Unmute mic' : 'Mute mic';

      toggleLocalMic(ui, state, next);
    });

    el.btnSpkMute.addEventListener('click', () => {
      console.log('[UI] btnSpkMute clicked');
      const btn = el.btnSpkMute;
      const isMuted = btn.dataset.muted === '1';
      const next = !isMuted;

      btn.dataset.muted = next ? '1' : '';
      btn.textContent = next ? 'Unmute speaker' : 'Mute speaker';

      toggleSpeaker(ui, next);
    });

    el.btnPlayTone.addEventListener('click', () => {
      console.log('[UI] btnPlayTone clicked');
      playTestTone(ui);
    });

    el.dtmfButtons.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName.toLowerCase() !== 'button') return;
      const tone = target.textContent && target.textContent.trim();
      if (!tone) return;
      actions.onDtmfButtonClick(tone);
    });

    el.wsUrl.addEventListener('input', () => (state.config.websocketUrl = el.wsUrl.value.trim()));
    el.sipUsername.addEventListener('input', () => (state.config.username = el.sipUsername.value.trim()));
    el.sipDomain.addEventListener('input', () => (state.config.domain = el.sipDomain.value.trim()));
    el.sipPassword.addEventListener('input', () => (state.config.password = el.sipPassword.value));

    el.callTo.addEventListener('input', () => (state.config.callTo = el.callTo.value.trim()));

    el.autoRegister.addEventListener('change', () => (state.config.autoRegister = el.autoRegister.checked));
    el.autoRetryRegister.addEventListener('change', () => (state.config.autoRetryRegister = el.autoRetryRegister.checked));

    el.registerRetries.addEventListener('input', () => (state.config.registerRetryCount = parseInt(el.registerRetries.value, 10) || 3));
    el.registerRetryDelay.addEventListener('input', () => (state.config.registerRetryDelaySec = parseInt(el.registerRetryDelay.value, 10) || 5));

    el.stunServer.addEventListener('input', () => (state.config.stunServer = el.stunServer.value.trim()));
    el.turnServer.addEventListener('input', () => (state.config.turnServer = el.turnServer.value.trim()));
    el.turnUser.addEventListener('input', () => (state.config.turnUser = el.turnUser.value.trim()));
    el.turnPass.addEventListener('input', () => (state.config.turnPass = el.turnPass.value));

    el.sipOutboundProxy.addEventListener('input', () => (state.config.outboundProxy = el.sipOutboundProxy.value.trim()));
  }

  function applyConfigFromQuery() {
    const params = new URLSearchParams(window.location.search);

    const getStr = (name, defValue = '') => {
      if (!params.has(name)) return defValue;
      const v = params.get(name);
      if (v == null) return defValue;
      return v.replace(/^"+|"+$/g, '');
    };

    const getBool = (name, defValue = false) => {
      if (!params.has(name)) return defValue;
      const raw = params.get(name);
      if (raw == null) return defValue;
      const v = raw.replace(/^"+|"+$/g, '').toLowerCase();
      return ['1', 'true', 'yes', 'on'].includes(v);
    };

    const getInt = (name, defValue) => {
      if (!params.has(name)) return defValue;
      const raw = params.get(name);
      if (raw == null) return defValue;
      const v = parseInt(raw.replace(/^"+|"+$/g, ''), 10);
      return Number.isFinite(v) ? v : defValue;
    };

    const cfg = state.config;

    cfg.websocketUrl = getStr('websocketUrl', el.wsUrl ? el.wsUrl.value : '');
    cfg.username = getStr('username', el.sipUsername ? el.sipUsername.value : '');
    cfg.password = getStr('password', el.sipPassword ? el.sipPassword.value : '');
    cfg.domain = getStr('domain', el.sipDomain ? el.sipDomain.value : '');
    cfg.callTo = getStr('callTo', el.callTo ? el.callTo.value : '');
    cfg.outboundProxy = getStr('outboundProxy', el.sipOutboundProxy ? el.sipOutboundProxy.value : '');
    cfg.stunServer = getStr('stunServer', el.stunServer ? el.stunServer.value : '');
    cfg.turnServer = getStr('turnServer', el.turnServer ? el.turnServer.value : '');
    cfg.turnUser = getStr('turnUser', el.turnUser ? el.turnUser.value : '');
    cfg.turnPass = getStr('turnPass', el.turnPass ? el.turnPass.value : '');

    cfg.autoRegister = getBool('autoRegister', el.autoRegister ? el.autoRegister.checked : cfg.autoRegister);
    cfg.autoRetryRegister = getBool('autoRetryRegister', el.autoRetryRegister ? el.autoRetryRegister.checked : cfg.autoRetryRegister);

    cfg.registerRetryCount = getInt('registerRetryCount', cfg.registerRetryCount || 3);
    cfg.registerRetryDelaySec = getInt('registerRetryDelaySec', cfg.registerRetryDelaySec || 5);

    if (el.wsUrl && cfg.websocketUrl) el.wsUrl.value = cfg.websocketUrl;
    if (el.sipUsername && cfg.username) el.sipUsername.value = cfg.username;
    if (el.sipPassword && cfg.password) el.sipPassword.value = cfg.password;
    if (el.sipDomain && cfg.domain) el.sipDomain.value = cfg.domain;

    if (el.callTo && cfg.callTo) el.callTo.value = cfg.callTo;

    if (el.sipOutboundProxy && cfg.outboundProxy) el.sipOutboundProxy.value = cfg.outboundProxy;
    if (el.stunServer && cfg.stunServer) el.stunServer.value = cfg.stunServer;
    if (el.turnServer && cfg.turnServer) el.turnServer.value = cfg.turnServer;
    if (el.turnUser && cfg.turnUser) el.turnUser.value = cfg.turnUser;
    if (el.turnPass && cfg.turnPass) el.turnPass.value = cfg.turnPass;

    if (el.autoRegister) el.autoRegister.checked = !!cfg.autoRegister;
    if (el.autoRetryRegister) el.autoRetryRegister.checked = !!cfg.autoRetryRegister;

    if (el.registerRetries) el.registerRetries.value = String(cfg.registerRetryCount || 3);
    if (el.registerRetryDelay) el.registerRetryDelay.value = String(cfg.registerRetryDelaySec || 5);

    if (el.summaryAccount && cfg.username && cfg.domain) {
      el.summaryAccount.textContent = `${cfg.username}@${cfg.domain}`;
    }
  }

  function init() {
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

    console.log('[UI] UI initialized. Config:', state.config);
  }

  document.addEventListener('DOMContentLoaded', init);

  window.SipTester = {
    _el: el,
    _state: state,
    ui,
  };
})();
