const btnUpload       = document.getElementById('btn-upload');
const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const btnSaveConfig   = document.getElementById('btn-save-config');
const btnAttachPod    = document.getElementById('btn-attach-pod');
const btnResetPreview = document.getElementById('btn-reset-preview');
const btnModeRealtime = document.getElementById('btn-mode-realtime');
const btnModeQuality  = document.getElementById('btn-mode-quality');
const btnLicenseLogin = document.getElementById('btn-license-login');
const btnLicenseLogout = document.getElementById('btn-license-logout');
const btnNotifBell    = document.getElementById('btn-notif-bell');
const btnCloseNotif   = document.getElementById('btn-close-notif');
const keyContactOverlay = document.getElementById('key-contact-overlay');
const btnCloseKeyContact = document.getElementById('btn-close-key-contact');
const btnOpenWhatsapp = document.getElementById('btn-open-whatsapp');
const licenseResultOverlay = document.getElementById('license-result-overlay');
const licenseResultPopup = document.getElementById('license-result-popup');
const licenseResultIcon = document.getElementById('license-result-icon');
const licenseResultMessage = document.getElementById('license-result-message');
const btnCloseLicenseResult = document.getElementById('btn-close-license-result');
const btnOkLicenseResult = document.getElementById('btn-ok-license-result');
const notifBadge      = document.getElementById('notif-badge');
const notifOverlay    = document.getElementById('notif-overlay');
const notifPopupBody  = document.getElementById('notif-popup-body');
const btnOpenTutorial = document.getElementById('btn-open-tutorial');
const btnCloseTutorial = document.getElementById('btn-close-tutorial');
const btnOpenDrivers  = document.getElementById('btn-open-drivers');
const tutorialOverlay = document.getElementById('tutorial-overlay');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const statusBadge     = document.getElementById('status-badge');
const currentPodLabel = document.getElementById('current-pod');
const log             = document.getElementById('log');
const localVideo      = document.getElementById('local-video');
const remoteCanvas    = document.getElementById('remote-canvas');
const videoEmpty      = document.getElementById('video-empty');
const idleState       = document.getElementById('idle-state');
const sessionLoader   = document.getElementById('session-loader');
const loaderText      = document.getElementById('loader-text');
const loaderSub       = document.getElementById('loader-sub');
const loaderElapsed   = document.getElementById('loader-elapsed');
const camPlaceholder  = document.getElementById('cam-placeholder');
const launchOverlay   = document.getElementById('launch-overlay');
const launchStatus    = document.getElementById('launch-status');
const launchAscii     = document.getElementById('launch-ascii');
const launchLoader    = document.getElementById('launch-loader');
const cfgBackendUrl   = document.getElementById('cfg-backend-url');
const cfgApiToken     = document.getElementById('cfg-api-token');
const cfgLicenseKey   = document.getElementById('cfg-license-key');
const cfgObsPort      = document.getElementById('cfg-obs-port');
const cfgWarmPodId    = document.getElementById('cfg-warm-pod-id');
const cfgCamera       = document.getElementById('cfg-camera');
const licenseStatus   = document.getElementById('license-status');
const usageLoginHint  = document.getElementById('usage-login-hint');
const voiceUsageLine  = document.getElementById('voice-usage-line');
const voiceResetLine  = document.getElementById('voice-reset-line');
const sessionUsageLine = document.getElementById('session-usage-line');
const sessionResetLine = document.getElementById('session-reset-line');
const configNote      = document.getElementById('config-note');
const obsUrlLabel     = document.getElementById('obs-url');

const ctrlBrightness  = document.getElementById('ctrl-brightness');
const ctrlContrast    = document.getElementById('ctrl-contrast');
const ctrlSaturation  = document.getElementById('ctrl-saturation');
const valBrightness   = document.getElementById('val-brightness');
const valContrast     = document.getElementById('val-contrast');
const valSaturation   = document.getElementById('val-saturation');

const stSendFps       = document.getElementById('st-send-fps');
const stRecvFps       = document.getElementById('st-recv-fps');
const stLatency       = document.getElementById('st-latency');
const stMode          = document.getElementById('st-mode');
const stConnScore     = document.getElementById('st-conn-score');
const ovSendFps       = document.getElementById('ov-send-fps');
const ovRecvFps       = document.getElementById('ov-recv-fps');
const ovLatency       = document.getElementById('ov-latency');
const ovMode          = document.getElementById('ov-mode');
const connScorePill   = document.getElementById('conn-score-pill');
const scoreRingFg     = document.getElementById('score-ring-fg');
const scorePct        = document.getElementById('score-pct');
const connGrade       = document.getElementById('conn-grade');
const connHint        = document.getElementById('conn-hint');
const reconnectBanner = document.getElementById('reconnect-banner');
const reconnectMsg    = document.getElementById('reconnect-msg');
const btnReconnect    = document.getElementById('btn-reconnect');
const privacyShield   = document.getElementById('privacy-shield');
const shieldTitle     = document.getElementById('shield-title');
const shieldSub       = document.getElementById('shield-sub');
const shieldScore     = document.getElementById('shield-score');
const btnPrivacyShield = document.getElementById('btn-privacy-shield');
const modeSummary     = document.getElementById('mode-summary');
const audioMeter      = document.getElementById('audio-meter');
const meterBars       = Array.from(document.querySelectorAll('.meter-bar'));
const btnInstructions = document.getElementById('btn-instructions');

// LipSync Studio DOM (loaded later in the studio section)

function setStatus(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className = cls || '';
}

function setLog(msg) {
  log.textContent = msg;
}

// --- Video area state management ---
let _elapsedTimer = null;

function showIdleState() {
  videoEmpty.style.display = 'flex';
  idleState.style.display = 'flex';
  sessionLoader.classList.remove('visible');
  camPlaceholder.style.display = 'flex';
  if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
  loaderElapsed.textContent = '';
}

function showLoadingState(title, subtitle) {
  videoEmpty.style.display = 'flex';
  idleState.style.display = 'none';
  sessionLoader.classList.add('visible');
  camPlaceholder.style.display = 'flex';
  loaderText.textContent = title || 'Starting session...';
  loaderSub.textContent = subtitle || 'Provisioning a GPU pod. This usually takes 30–90 seconds.';
  loaderElapsed.textContent = '0s';

  const t0 = Date.now();
  if (_elapsedTimer) clearInterval(_elapsedTimer);
  _elapsedTimer = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    loaderElapsed.textContent = min > 0 ? `${min}m ${s}s` : `${sec}s`;
  }, 1000);
}

function updateLoaderText(title, subtitle) {
  if (title) loaderText.textContent = title;
  if (subtitle) loaderSub.textContent = subtitle;
}

function hideVideoEmpty() {
  videoEmpty.style.display = 'none';
  camPlaceholder.style.display = 'none';
  if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
}

function setCurrentPod(podId, endpoint) {
  if (!currentPodLabel) return;
  if (!podId) {
    currentPodLabel.textContent = 'Pod: —';
    currentPodLabel.title = 'No active pod';
    return;
  }

  const endpointText = endpoint?.ip && endpoint?.port ? ` · ${endpoint.ip}:${endpoint.port}` : '';
  currentPodLabel.textContent = `Pod: ${podId}${endpointText}`;
  currentPodLabel.title = `Pod ID: ${podId}${endpointText}`;
}

function setLoading(loading) {
  btnStart.disabled = loading;
  btnStop.disabled = loading;
  btnUpload.disabled = loading;
  if (btnSaveConfig) btnSaveConfig.disabled = loading;
  if (btnAttachPod) btnAttachPod.disabled = loading;
}

function setConfigNote(message) {
  if (configNote) configNote.textContent = message;
}

function applyConfigToUI(config) {
  if (!config) return;
  if (cfgBackendUrl) cfgBackendUrl.value = config.backendUrl || '';
  if (cfgApiToken) cfgApiToken.value = config.apiToken || '';
  if (cfgLicenseKey) cfgLicenseKey.value = config.licenseKey || '';
  if (cfgObsPort) cfgObsPort.value = String(config.obsPort || 7891);
  if (cfgWarmPodId) cfgWarmPodId.value = config.warmPodId || '';
  if (obsUrlLabel) obsUrlLabel.textContent = config.obsUrl || `http://localhost:${config.obsPort || 7891}`;
  const pathHint = config.configPath ? `Saved locally at ${config.configPath}` : 'Saved locally on this machine.';
  setConfigNote(`${pathHint}\nAPI token is auto-filled when you login with your product key. Stop any active session before changing these values.`);
}

let licenseLoggedIn = false;
let licenseUser = null;
let keyContactPopupShown = false;
let usagePollTimer = null;
let usageRefreshInFlight = false;

function setLicenseStatus(text) {
  if (licenseStatus) licenseStatus.textContent = text;
}

function isSessionUnlocked() {
  return licenseLoggedIn || !!String(cfgApiToken?.value || '').trim();
}

function showKeyContactPopup(force = false) {
  if (!keyContactOverlay) return;
  if (keyContactPopupShown && !force) return;
  keyContactPopupShown = true;
  keyContactOverlay.classList.add('visible');
}

function hideKeyContactPopup() {
  if (!keyContactOverlay) return;
  keyContactOverlay.classList.remove('visible');
}

function showLicenseResultPopup(valid, message) {
  if (!licenseResultOverlay || !licenseResultPopup) return;
  licenseResultPopup.classList.remove('valid', 'invalid');
  licenseResultPopup.classList.add(valid ? 'valid' : 'invalid');
  if (licenseResultIcon) licenseResultIcon.textContent = valid ? '✓' : '!';
  if (licenseResultMessage) licenseResultMessage.textContent = String(message || (valid ? 'Product key is valid.' : 'Product key is invalid.'));
  licenseResultOverlay.classList.add('visible');
}

function hideLicenseResultPopup() {
  if (!licenseResultOverlay) return;
  licenseResultOverlay.classList.remove('visible');
}

function maybeShowKeyContactPopup(message) {
  const text = String(message || '');
  if (/contact saint h|whatsapp: 09065786976|account is unavailable/i.test(text)) {
    showKeyContactPopup(true);
  }
}

function updateLicenseUI() {
  const unlocked = isSessionUnlocked();
  btnStart.disabled = !unlocked;
  btnUpload.disabled = !unlocked;
  btnLicenseLogin.style.display = licenseLoggedIn ? 'none' : 'block';
  btnLicenseLogout.style.display = licenseLoggedIn ? 'block' : 'none';

  if (licenseLoggedIn && licenseUser) {
    const who = licenseUser.email ? `${licenseUser.name} (${licenseUser.email})` : licenseUser.name;
    setLicenseStatus(`✅ Logged in: ${who}`);
  } else if (unlocked) {
    setLicenseStatus('Using API token (admin mode).');
  } else {
    setLicenseStatus('⛔ Not logged in. Enter product key to unlock.');
  }
}

function formatUsageDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatUsageTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function renderUsageState(state = {}) {
  const requiresLogin = !!state.requiresLogin;
  const usage = state.usage || null;

  if (usageLoginHint) {
    if (licenseLoggedIn) {
      usageLoginHint.textContent = 'Your limits refresh automatically in realtime.';
    } else if (isSessionUnlocked()) {
      usageLoginHint.textContent = 'Usage tracking is shown for product-key accounts.';
    } else {
      usageLoginHint.textContent = 'Login with your product key to see your voice and session limits.';
    }
  }

  if (requiresLogin || !usage) {
    if (voiceUsageLine) voiceUsageLine.textContent = 'Voice: —';
    if (voiceResetLine) voiceResetLine.textContent = 'Voice reset: —';
    if (sessionUsageLine) sessionUsageLine.textContent = 'Session: —';
    if (sessionResetLine) sessionResetLine.textContent = 'Session reset: —';
    return;
  }

  const voice = usage.voice || {};
  const session = usage.session || {};
  if (voiceUsageLine) {
    voiceUsageLine.textContent = `Voice: ${Number(voice.used || 0).toLocaleString()} / ${Number(voice.limit || 0).toLocaleString()} chars used • ${Number(voice.remaining || 0).toLocaleString()} left`;
  }
  if (voiceResetLine) {
    voiceResetLine.textContent = `Voice reset: in ${formatUsageDuration(voice.resetInMs)} • ${formatUsageTimestamp(voice.resetAt)}`;
  }

  if (session.active) {
    if (sessionUsageLine) sessionUsageLine.textContent = `Session: active • ${formatUsageDuration(session.activeRemainingMs)} left in this 1-hour window`;
    if (sessionResetLine) sessionResetLine.textContent = `Cooldown reset: ${formatUsageTimestamp(session.cooldownUntil)}`;
    return;
  }

  if (Number(session.cooldownRemainingMs || 0) > 0) {
    if (sessionUsageLine) sessionUsageLine.textContent = `Session: cooldown active • next start in ${formatUsageDuration(session.cooldownRemainingMs)}`;
    if (sessionResetLine) sessionResetLine.textContent = `Cooldown reset: ${formatUsageTimestamp(session.cooldownUntil)}`;
    return;
  }

  if (sessionUsageLine) sessionUsageLine.textContent = 'Session: ready • up to 1 hour available';
  if (sessionResetLine) sessionResetLine.textContent = 'Cooldown reset: ready now';
}

async function refreshUsage(options = {}) {
  if (!window.chimera?.getUsage) return;
  if (!licenseLoggedIn) {
    renderUsageState({ requiresLogin: true });
    return;
  }
  if (usageRefreshInFlight) return;

  usageRefreshInFlight = true;
  try {
    const result = await window.chimera.getUsage();
    renderUsageState(result || {});
  } catch (err) {
    renderUsageState({ usage: null, requiresLogin: true });
    if (!options.silent) {
      console.error('Failed to refresh usage:', err);
    }
  } finally {
    usageRefreshInFlight = false;
  }
}

function startUsagePolling() {
  if (usagePollTimer) clearInterval(usagePollTimer);
  usagePollTimer = setInterval(() => {
    refreshUsage({ silent: true }).catch(() => {});
  }, 1000);
}

if (btnCloseKeyContact) {
  btnCloseKeyContact.addEventListener('click', hideKeyContactPopup);
}

if (keyContactOverlay) {
  keyContactOverlay.addEventListener('click', (e) => {
    if (e.target === keyContactOverlay) hideKeyContactPopup();
  });
}

if (btnCloseLicenseResult) btnCloseLicenseResult.addEventListener('click', hideLicenseResultPopup);
if (btnOkLicenseResult) btnOkLicenseResult.addEventListener('click', hideLicenseResultPopup);
if (licenseResultOverlay) {
  licenseResultOverlay.addEventListener('click', (e) => {
    if (e.target === licenseResultOverlay) hideLicenseResultPopup();
  });
}

if (btnOpenWhatsapp) {
  btnOpenWhatsapp.addEventListener('click', async () => {
    const url = 'https://wa.me/2349065786976?text=Hi%20Saint%20H.%20I%20need%20a%20product%20key%20for%20Project%20Purplefinger.';
    try {
      if (window.chimera?.openExternal) {
        const result = await window.chimera.openExternal(url);
        if (result && result.ok === false) throw new Error(result.error || 'Unable to launch WhatsApp');
      } else {
        throw new Error('External opener unavailable');
      }
    } catch (err) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(`${url}\nWhatsApp: 09065786976`);
          setLog('WhatsApp link copied. Open it manually or message 09065786976.');
        } else {
          setLog('Open WhatsApp manually: 09065786976');
        }
      } catch (_) {
        setLog('Open WhatsApp manually: 09065786976');
      }
    }
  });
}

// --- Notification sound (short chime via Web Audio API) ---
let _audioCtx = null;
function playNotifSound() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
    osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

// --- Session beep sounds (Web Audio API) ---
let _beepInterval = null;

function _ensureAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playBeep(freq = 660, duration = 0.12, volume = 0.15) {
  try {
    const ctx = _ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function playDoubleBeep() {
  playBeep(880, 0.1, 0.15);
  setTimeout(() => playBeep(880, 0.1, 0.15), 160);
}

function startBeeping() {
  stopBeeping();
  playBeep(520, 0.08, 0.10);
  _beepInterval = setInterval(() => playBeep(520, 0.08, 0.10), 800);
}

function stopBeeping() {
  if (_beepInterval) { clearInterval(_beepInterval); _beepInterval = null; }
}

// --- Audio Level Meter (microphone visualizer) ---
let _micStream = null;
let _micSource = null;
let _micAnalyser = null;
let _micAnimFrame = null;
const METER_BAR_COUNT = 8;
// Frequency bands to sample (low-to-high voice range)
const METER_BANDS = [2, 4, 6, 9, 12, 16, 20, 25];

async function startAudioMeter() {
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const ctx = _ensureAudioCtx();
    _micSource = ctx.createMediaStreamSource(_micStream);
    _micAnalyser = ctx.createAnalyser();
    _micAnalyser.fftSize = 128;
    _micAnalyser.smoothingTimeConstant = 0.7;
    _micSource.connect(_micAnalyser);
    // Do NOT connect to destination — we only visualize, no playback

    if (audioMeter) audioMeter.classList.add('visible');
    _drawMeter();
  } catch (err) {
    console.log('Audio meter unavailable:', err.message);
  }
}

function _drawMeter() {
  if (!_micAnalyser) return;
  const data = new Uint8Array(_micAnalyser.frequencyBinCount);
  _micAnalyser.getByteFrequencyData(data);

  for (let i = 0; i < METER_BAR_COUNT; i++) {
    const bin = METER_BANDS[i] || i;
    const val = data[bin] || 0;
    const pct = Math.max(3, (val / 255) * 100);
    const bar = meterBars[i];
    if (bar) {
      bar.style.height = `${pct}%`;
      // Color: green → yellow → red
      if (pct > 75) bar.style.background = '#f87171';
      else if (pct > 50) bar.style.background = '#fbbf24';
      else bar.style.background = '#34d399';
    }
  }

  _micAnimFrame = requestAnimationFrame(_drawMeter);
}

function stopAudioMeter() {
  if (_micAnimFrame) { cancelAnimationFrame(_micAnimFrame); _micAnimFrame = null; }
  if (_micSource) { try { _micSource.disconnect(); } catch (_) {} _micSource = null; }
  if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
  _micAnalyser = null;
  if (audioMeter) audioMeter.classList.remove('visible');
  // Reset bars
  meterBars.forEach(b => { if (b) { b.style.height = '3px'; b.style.background = '#34d399'; } });
}

// ═══════════════════════════════════════════════════════════════
// LIPSYNC STUDIO — ElevenLabs TTS with karaoke teleprompter
// User enters text → picks voice → generates audio with word
// timestamps → plays back with synchronized word highlighting
// so they can lip-sync on a video call.
// ═══════════════════════════════════════════════════════════════

let _vcVoices       = [];       // full voice catalog from ElevenLabs
let _vcVoiceId      = null;
let _vcGenderFilter = 'all';
let _vcAccentFilter = 'all';
let _vcPreviewAudio = null;

// LipSync Studio state
let _lsAudioCtx     = null;     // AudioContext for playback
let _lsSourceNode   = null;     // current BufferSourceNode
let _lsAudioBuffer  = null;     // decoded AudioBuffer
let _lsAudioBytes   = null;     // raw MP3 bytes (Uint8Array) for download
let _lsWords        = [];       // [{word, start, end}, ...]
let _lsDuration     = 0;
let _lsPlaying      = false;
let _lsPaused       = false;
let _lsStartTime    = 0;        // audioCtx.currentTime when play started
let _lsPauseOffset  = 0;        // seconds into track when paused
let _lsLoop         = false;
let _lsSpeed        = 1;
let _lsAnimFrame    = null;
let _lsGenerating   = false;

// DOM refs — LipSync Studio
const lsTextInput       = document.getElementById('ls-text-input');
const lsCharCount       = document.getElementById('ls-char-count');
const lsGenerateBtn     = document.getElementById('ls-generate-btn');
const lsStatus          = document.getElementById('ls-status');
const lsTeleprompterWrap = document.getElementById('ls-teleprompter-wrap');
const lsTeleprompter    = document.getElementById('ls-teleprompter');
const lsPlayBtn         = document.getElementById('ls-play-btn');
const lsPlayIcon        = document.getElementById('ls-play-icon');
const lsStopBtn         = document.getElementById('ls-stop-btn');
const lsLoopBtn         = document.getElementById('ls-loop-btn');
const lsProgressBar     = document.getElementById('ls-progress-bar');
const lsTime            = document.getElementById('ls-time');
const lsDownloadBtn     = document.getElementById('ls-download-btn');
const lsVoiceNoteTip    = document.getElementById('ls-voicenote-tip');
const vcVoiceList       = document.getElementById('vc-voice-list');
const vcEmpty           = document.getElementById('vc-empty');
const vcHeaderBadge     = document.getElementById('vc-header-badge');
const vcFilters         = document.getElementById('vc-filters');
const vcAccentFilters   = document.getElementById('vc-accent-filters');

// --- Load voices from backend ---
// Special featured voices (from ElevenLabs shared library — usable by voice_id directly)
const _SPECIAL_VOICES = [
  {
    voice_id: 'zSSZ9gJu9KsDvWdoSFFN',
    name: 'Elon Musk',
    gender: 'male',
    accent: 'american',
    age: 'young',
    description: 'Custom clone – natural & conversational',
    preview_url: '',
    _special: true,
    _badge: '⭐',
    _label: 'FEATURED',
  },
];

async function loadVoices() {
  if (vcEmpty) vcEmpty.textContent = 'Loading voices...';
  try {
    const data = await window.chimera.getVoices();
    // Prepend special voices, then regular ones
    _vcVoices = [..._SPECIAL_VOICES, ...(data.voices || [])];
    // Auto-select Elon voice by default
    if (!_vcVoiceId) _vcVoiceId = 'zSSZ9gJu9KsDvWdoSFFN';
    renderVoiceList();
    _updateGenerateBtn();
  } catch (err) {
    console.error('Failed to load voices:', err);
    maybeShowKeyContactPopup(err.message);
    if (vcEmpty) vcEmpty.textContent = err.message || 'Failed to load voices.';
  }
}

// --- Render filtered voice list ---
function renderVoiceList() {
  if (!vcVoiceList) return;
  const filtered = _vcVoices.filter(v => {
    if (_vcGenderFilter !== 'all' && v.gender !== _vcGenderFilter) return false;
    if (_vcAccentFilter !== 'all' && !v.accent.includes(_vcAccentFilter)) return false;
    return true;
  });

  if (filtered.length === 0) {
    vcVoiceList.innerHTML = '<div class="vc-empty">No voices match these filters.</div>';
    return;
  }

  vcVoiceList.innerHTML = filtered.map(v => {
    const genderClass = v.gender === 'male' ? 'male' : v.gender === 'female' ? 'female' : 'other';
    const initials = v.name.slice(0, 2).toUpperCase();
    const accent = v.accent ? v.accent.charAt(0).toUpperCase() + v.accent.slice(1) : '';
    const meta = [v.gender ? v.gender.charAt(0).toUpperCase() + v.gender.slice(1) : '', accent, v.age, v.description].filter(Boolean).join(' · ');
    const selected = v.voice_id === _vcVoiceId ? ' selected' : '';
    const special = v._special ? ' special' : '';
    const badge = v._special ? `<span class="vc-voice-badge">${v._badge} ${v._label}</span>` : '';
    return `
      <div class="vc-voice-card${selected}${special}" data-voice-id="${v.voice_id}">
        <div class="vc-voice-avatar ${genderClass}">${initials}</div>
        <div class="vc-voice-info">
          <div class="vc-voice-name">${v.name}${badge}</div>
          <div class="vc-voice-meta">${meta}</div>
        </div>
        ${v.preview_url ? `<button class="vc-voice-preview" data-preview="${v.preview_url}" title="Preview voice"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>` : ''}
      </div>
    `;
  }).join('');

  _updateGenerateBtn();
}

// --- Event delegation for voice list ---
if (vcVoiceList) {
  vcVoiceList.addEventListener('click', (e) => {
    const previewBtn = e.target.closest('.vc-voice-preview');
    if (previewBtn) {
      e.stopPropagation();
      const url = previewBtn.dataset.preview;
      if (url) playVoicePreview(url);
      return;
    }
    const card = e.target.closest('.vc-voice-card');
    if (card) {
      _vcVoiceId = card.dataset.voiceId;
      vcVoiceList.querySelectorAll('.vc-voice-card').forEach(c => c.classList.toggle('selected', c === card));
      _updateGenerateBtn();
    }
  });
}

// --- Filter buttons ---
if (vcFilters) {
  vcFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.vc-filter-btn');
    if (!btn) return;
    _vcGenderFilter = btn.dataset.filter;
    vcFilters.querySelectorAll('.vc-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderVoiceList();
  });
}
if (vcAccentFilters) {
  vcAccentFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.vc-filter-btn');
    if (!btn) return;
    _vcAccentFilter = btn.dataset.accent;
    vcAccentFilters.querySelectorAll('.vc-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderVoiceList();
  });
}

// --- Preview voice sample ---
function playVoicePreview(url) {
  if (_vcPreviewAudio) { _vcPreviewAudio.pause(); _vcPreviewAudio = null; }
  _vcPreviewAudio = new Audio(url);
  _vcPreviewAudio.volume = 0.7;
  _vcPreviewAudio.play().catch(() => {});
  _vcPreviewAudio.onended = () => { _vcPreviewAudio = null; };
}

// --- Char count on textarea ---
if (lsTextInput) {
  lsTextInput.addEventListener('input', () => {
    if (lsCharCount) lsCharCount.textContent = lsTextInput.value.length;
    _updateGenerateBtn();
  });
}

// --- Enable/disable generate button based on state ---
function _updateGenerateBtn() {
  if (!lsGenerateBtn) return;
  const hasText = lsTextInput && lsTextInput.value.trim().length > 0;
  const hasVoice = !!_vcVoiceId;
  lsGenerateBtn.disabled = !hasText || !hasVoice || _lsGenerating;
}

// --- Generate TTS ---
if (lsGenerateBtn) {
  lsGenerateBtn.addEventListener('click', async () => {
    const text = lsTextInput ? lsTextInput.value.trim() : '';
    if (!text || !_vcVoiceId || _lsGenerating) return;

    // Stop any current playback
    _lsStop();

    _lsGenerating = true;
    lsGenerateBtn.disabled = true;
    lsGenerateBtn.classList.add('generating');
    lsGenerateBtn.innerHTML = '<svg class="spin" viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> Generating...';
    if (lsStatus) lsStatus.textContent = 'Sending to ElevenLabs...';

    try {
      const result = await window.chimera.ttsGenerate(text, _vcVoiceId);
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Generation failed');
      }

      if (lsStatus) lsStatus.textContent = 'Decoding audio...';

      // Decode base64 audio
      const binaryStr = atob(result.audio_base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      // Keep raw bytes for download
      _lsAudioBytes = bytes.slice();

      if (!_lsAudioCtx) _lsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      _lsAudioBuffer = await _lsAudioCtx.decodeAudioData(bytes.buffer);
      _lsWords = result.words || [];
      _lsDuration = result.duration || _lsAudioBuffer.duration;

      // Build teleprompter
      _lsBuildTeleprompter();

      // Show controls + enable download
      if (lsTeleprompterWrap) lsTeleprompterWrap.style.display = '';
      if (lsDownloadBtn) lsDownloadBtn.disabled = false;
      if (lsVoiceNoteTip) lsVoiceNoteTip.classList.add('visible');
      if (lsStatus) lsStatus.textContent = `Ready — ${_lsWords.length} words, ${_formatTime(_lsDuration)}`;
      _lsUpdateTimeDisplay(0);

    } catch (err) {
      console.error('TTS generation error:', err);
      maybeShowKeyContactPopup(err.message);
      if (lsStatus) lsStatus.textContent = '❌ ' + (err.message || 'Generation failed');
    } finally {
      refreshUsage({ silent: true }).catch(() => {});
      _lsGenerating = false;
      lsGenerateBtn.classList.remove('generating');
      lsGenerateBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg> Generate Speech';
      _updateGenerateBtn();
    }
  });
}

// ── Build teleprompter word spans ──
function _lsBuildTeleprompter() {
  if (!lsTeleprompter) return;
  lsTeleprompter.innerHTML = _lsWords.map((w, i) =>
    `<span class="ls-word" data-idx="${i}">${_escHtml(w.word)}</span> `
  ).join('');
  // Cache span references so _lsTickLoop never touches querySelectorAll
  _lsCachedSpans = Array.from(lsTeleprompter.querySelectorAll('.ls-word'));
  _lsLastActiveIdx = -1;
}

function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Play / Pause ──
if (lsPlayBtn) {
  lsPlayBtn.addEventListener('click', () => {
    if (_lsPlaying && !_lsPaused) {
      _lsPause();
    } else {
      _lsPlay();
    }
  });
}

function _lsPlay() {
  if (!_lsAudioBuffer || !_lsAudioCtx) return;

  // Resume context if suspended
  if (_lsAudioCtx.state === 'suspended') _lsAudioCtx.resume();

  // Disconnect previous source
  if (_lsSourceNode) { try { _lsSourceNode.stop(); } catch (_) {} }

  _lsSourceNode = _lsAudioCtx.createBufferSource();
  _lsSourceNode.buffer = _lsAudioBuffer;
  _lsSourceNode.playbackRate.value = _lsSpeed;
  _lsSourceNode.connect(_lsAudioCtx.destination);

  // Also feed into session recorder if active
  _recConnectLipSyncSource(_lsSourceNode);

  _lsSourceNode.onended = () => {
    if (!_lsPlaying) return;
    if (_lsLoop) {
      _lsPauseOffset = 0;
      _lsPlay(); // restart
    } else {
      _lsStop();
    }
  };

  _lsStartTime = _lsAudioCtx.currentTime - (_lsPauseOffset / _lsSpeed);
  _lsSourceNode.start(0, _lsPauseOffset);

  _lsPlaying = true;
  _lsPaused = false;
  _lsSetPlayIcon(true);
  if (vcHeaderBadge) vcHeaderBadge.classList.add('visible');
  _lsTickLoop();
}

function _lsPause() {
  if (!_lsPlaying || _lsPaused) return;
  _lsPauseOffset = (_lsAudioCtx.currentTime - _lsStartTime) * _lsSpeed;
  if (_lsSourceNode) { try { _lsSourceNode.stop(); } catch (_) {} }
  _lsPaused = true;
  _lsSetPlayIcon(false);
  if (_lsAnimFrame) { cancelAnimationFrame(_lsAnimFrame); _lsAnimFrame = null; }
}

function _lsStop() {
  if (_lsSourceNode) { try { _lsSourceNode.stop(); } catch (_) {} _lsSourceNode = null; }
  _lsPlaying = false;
  _lsPaused = false;
  _lsPauseOffset = 0;
  _lsSetPlayIcon(false);
  if (_lsAnimFrame) { cancelAnimationFrame(_lsAnimFrame); _lsAnimFrame = null; }
  if (lsProgressBar) lsProgressBar.style.transform = 'scaleX(0)';
  _lsUpdateTimeDisplay(0);
  _lsHighlightWord(-1);
  _lsLastActiveIdx = -1;
  if (vcHeaderBadge) vcHeaderBadge.classList.remove('visible');
}

if (lsStopBtn) {
  lsStopBtn.addEventListener('click', _lsStop);
}

// ── Play icon toggle (play ↔ pause) ──
function _lsSetPlayIcon(playing) {
  if (!lsPlayIcon) return;
  if (playing) {
    lsPlayIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; // pause
  } else {
    lsPlayIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; // play
  }
}

// ── Teleprompter sync loop — runs via rAF ──
// PERF: Cache spans, only touch DOM when active word changes.
// Avoids querySelectorAll + classList thrash every frame that was
// killing face-swap FPS (~60 DOM queries/s → layout recalc storms).
let _lsCachedSpans   = [];      // cached NodeList of .ls-word spans
let _lsLastActiveIdx = -1;      // last highlighted word index

function _lsTickLoop() {
  if (!_lsPlaying || _lsPaused) return;

  const elapsed = (_lsAudioCtx.currentTime - _lsStartTime) * _lsSpeed;
  const clamped = Math.min(elapsed, _lsDuration);

  // Update progress bar — use transform instead of width to avoid layout reflow
  if (lsProgressBar) {
    lsProgressBar.style.transform = `scaleX(${clamped / _lsDuration})`;
  }
  _lsUpdateTimeDisplay(clamped);

  // Find active word via binary-ish scan (words are sorted by time)
  let activeIdx = -1;
  for (let i = 0; i < _lsWords.length; i++) {
    if (clamped >= _lsWords[i].start && clamped < _lsWords[i].end) {
      activeIdx = i;
      break;
    }
    if (clamped < _lsWords[i].start) break; // past all candidates
  }

  // Only touch DOM when the active word actually changes
  if (activeIdx !== _lsLastActiveIdx) {
    _lsHighlightWord(activeIdx);
    _lsLastActiveIdx = activeIdx;
  }

  _lsAnimFrame = requestAnimationFrame(_lsTickLoop);
}

// ── Highlight active word, mark previous as spoken ──
// Uses cached span list — never re-queries DOM during playback.
function _lsHighlightWord(idx) {
  if (!lsTeleprompter || _lsCachedSpans.length === 0) return;

  // Only update the previous-active and new-active spans (not all of them)
  const prev = _lsLastActiveIdx;
  if (prev >= 0 && prev < _lsCachedSpans.length) {
    _lsCachedSpans[prev].classList.remove('active');
    _lsCachedSpans[prev].classList.add('spoken');
  }

  if (idx >= 0 && idx < _lsCachedSpans.length) {
    // Mark everything before idx as spoken (handles seek jumps)
    for (let i = 0; i < idx; i++) {
      const s = _lsCachedSpans[i];
      if (!s.classList.contains('spoken')) s.classList.add('spoken');
      s.classList.remove('active');
    }
    // Mark everything after idx as not spoken (handles backward seek)
    for (let i = idx + 1; i < _lsCachedSpans.length; i++) {
      _lsCachedSpans[i].classList.remove('spoken', 'active');
    }
    _lsCachedSpans[idx].classList.remove('spoken');
    _lsCachedSpans[idx].classList.add('active');

    // Scroll only on word change, not every frame
    _lsCachedSpans[idx].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  } else if (idx === -1) {
    // Reset all
    for (let i = 0; i < _lsCachedSpans.length; i++) {
      _lsCachedSpans[i].classList.remove('active', 'spoken');
    }
  }
}

// ── Time display helper ──
function _lsUpdateTimeDisplay(current) {
  if (lsTime) lsTime.textContent = `${_formatTime(current)} / ${_formatTime(_lsDuration)}`;
}

function _formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Progress bar click-to-seek ──
const lsProgressWrap = document.querySelector('.ls-progress-wrap');
if (lsProgressWrap) {
  lsProgressWrap.addEventListener('click', (e) => {
    if (!_lsAudioBuffer) return;
    const rect = lsProgressWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = pct * _lsDuration;
    _lsPauseOffset = seekTo;
    if (_lsPlaying && !_lsPaused) {
      // Restart from new position
      _lsPlay();
    } else {
      // Update display without playing
      if (lsProgressBar) lsProgressBar.style.transform = `scaleX(${pct})`;
      _lsUpdateTimeDisplay(seekTo);
    }
  });
}

// ── Loop button ──
if (lsLoopBtn) {
  lsLoopBtn.addEventListener('click', () => {
    _lsLoop = !_lsLoop;
    lsLoopBtn.classList.toggle('ls-loop-on', _lsLoop);
    lsLoopBtn.classList.toggle('ls-loop-off', !_lsLoop);
  });
}

// ── Speed buttons ──
document.querySelectorAll('.ls-speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _lsSpeed = parseFloat(btn.dataset.speed) || 1;
    document.querySelectorAll('.ls-speed-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (_lsSourceNode && _lsPlaying && !_lsPaused) {
      _lsSourceNode.playbackRate.value = _lsSpeed;
    }
  });
});

// ── Download audio button ──
if (lsDownloadBtn) {
  lsDownloadBtn.addEventListener('click', () => {
    if (!_lsAudioBytes) return;
    const blob = new Blob([_lsAudioBytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `chimera-voice-${ts}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setLog('Audio downloaded → chimera-voice-' + ts + '.mp3');
  });
}

// ── Cleanup helper called from stopStreaming ──
function stopVoiceChanger() {
  _lsStop();
}

function getVoiceName(voiceId) {
  const v = _vcVoices.find(v => v.voice_id === voiceId);
  return v ? v.name : 'Unknown';
}

// Load voices on startup
loadVoices();

// ═══════════════════════════════════════════════════════════════

let _unreadCount = 0;

function updateNotifBadge(count) {
  _unreadCount = count;
  if (notifBadge) {
    notifBadge.textContent = count > 99 ? '99+' : String(count);
    notifBadge.classList.toggle('visible', count > 0);
  }
}

function renderNotificationsPopup(items) {
  if (!notifPopupBody) return;
  notifPopupBody.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No notifications yet.';
    notifPopupBody.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'notif-item' + (item.readAt ? '' : ' unread');
    const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : '—';
    el.innerHTML = `
      <div class="notif-meta"><span>${item.category || 'info'}</span><span>${createdAt}</span></div>
      <div class="notif-msg"></div>
    `;
    const msg = el.querySelector('.notif-msg');
    if (msg) msg.textContent = item.message || '';
    notifPopupBody.appendChild(el);
  });
}

async function refreshNotifications(playSound = false) {
  if (!licenseLoggedIn) {
    _cachedNotifications = [];
    updateNotifBadge(0);
    return;
  }
  try {
    // Fetch ALL notifications (including read) so we can show full history in popup
    const data = await window.chimera.getUserNotifications(true);
    const items = data.notifications || [];
    _cachedNotifications = items;
    const unread = items.filter(n => !n.readAt);
    updateNotifBadge(unread.length);
    if (playSound && unread.length > 0) {
      playNotifSound();
    }
  } catch (err) {
    setLog(`Notification fetch failed: ${err.message}`);
  }
}

async function markAllNotificationsRead() {
  const unread = _cachedNotifications.filter(n => !n.readAt);
  if (!unread.length) return;
  // Mark each unread notification as read
  const promises = unread.map(n => {
    const id = n._id || n.id;
    if (!id) return Promise.resolve();
    return window.chimera.markNotificationRead(id).catch(() => {});
  });
  await Promise.all(promises);
  // Refresh to update state
  await refreshNotifications(false);
}

async function openNotificationsPopup() {
  renderNotificationsPopup(_cachedNotifications);
  notifOverlay.classList.add('visible');
  // Mark all as read when user opens the popup
  await markAllNotificationsRead();
  // Re-render to clear unread styling
  renderNotificationsPopup(_cachedNotifications);
}

function closeNotificationsPopup() {
  notifOverlay.classList.remove('visible');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeLaunchText(el, text, speed = 180) {
  el.textContent = '';
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    await sleep(speed);
  }
  el.classList.add('done');
}

async function runLaunchSequence() {
  if (!launchOverlay) return;

  const sequenceStartedAt = Date.now();
  const minSequenceMs = 15000;

  const loaderSteps = [
    'Loading core systems...',
    'Linking hosted backend...',
    'Priming live swap interface...',
  ];

  launchStatus.textContent = 'Initializing Purplefinger...';
  if (launchAscii) launchAscii.classList.remove('visible');
  if (launchLoader) launchLoader.textContent = '';

  await sleep(350);
  if (launchAscii) launchAscii.classList.add('visible');

  for (const step of loaderSteps) {
    launchStatus.textContent = step;
    if (launchLoader) await typeLaunchText(launchLoader, step, 32);
    await sleep(360);
  }

  launchStatus.textContent = 'Purplefinger ready.';
  if (launchLoader) launchLoader.textContent = 'Opening interface...';

  const remainingMs = Math.max(0, minSequenceMs - (Date.now() - sequenceStartedAt));
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }

  launchOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
//   SESSION RECORDING (video from remoteCanvas + optional audio)
// ═══════════════════════════════════════════════════════════════
const btnRecord     = document.getElementById('btn-record');
const btnRecordLabel = document.getElementById('btn-record-label');
const recTimer      = document.getElementById('rec-timer');
const recTimerText  = document.getElementById('rec-timer-text');
const recAudioWrap  = document.getElementById('rec-audio-wrap');
const recAudioSelect = document.getElementById('rec-audio-select');

let _recMediaRecorder = null;
let _recChunks        = [];
let _recStartedAt     = 0;
let _recTimerInterval = null;
let _recAudioDest     = null;  // MediaStreamAudioDestination
let _recLipSyncMediaNode = null;

// Populate audio output devices for recording source
async function _recPopulateAudioDevices() {
  try {
    // Request mic permission so labels are available
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (_) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
    // Keep the first two built-in options (default-mic, none)
    while (recAudioSelect.options.length > 2) recAudioSelect.remove(2);
    for (const dev of audioInputs) {
      const opt = document.createElement('option');
      opt.value = 'device:' + dev.deviceId;
      opt.textContent = '🎙 ' + (dev.label || 'Mic ' + dev.deviceId.slice(0, 6));
      recAudioSelect.appendChild(opt);
    }
  } catch (_) {}
}

function _recFormatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Beep N times using AudioContext oscillator
function _recBeep(times) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.25;
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      t += 0.22;
    }
    setTimeout(() => ctx.close(), (times * 0.22 + 0.5) * 1000);
  } catch (_) {}
}

function _recStartTimer() {
  _recStartedAt = Date.now();
  recTimer.classList.add('visible');
  recTimerText.textContent = '00:00';
  _recTimerInterval = setInterval(() => {
    recTimerText.textContent = _recFormatTime((Date.now() - _recStartedAt) / 1000);
  }, 500);
}

function _recStopTimer() {
  clearInterval(_recTimerInterval);
  _recTimerInterval = null;
  recTimer.classList.remove('visible');
}

async function _recStart() {
  if (_recMediaRecorder && _recMediaRecorder.state !== 'inactive') return;

  // 1. Get video stream from the remote canvas (the face-swapped output)
  const canvasStream = remoteCanvas.captureStream(30);

  // 2. Build an audio track depending on selector value
  const audioChoice = recAudioSelect.value;
  let combinedStream = canvasStream;

  if (audioChoice === 'default-mic') {
    // Capture from the system default microphone
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...micStream.getAudioTracks(),
      ]);
    } catch (e) {
      console.warn('[Rec] Failed to capture default mic:', e);
    }
  } else if (audioChoice === 'lipsync' && _lsAudioCtx) {
    // Tap into the LipSync AudioContext destination
    _recAudioDest = _lsAudioCtx.createMediaStreamDestination();
    const audioTrack = _recAudioDest.stream.getAudioTracks()[0];
    if (audioTrack) {
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        audioTrack,
      ]);
    }
  } else if (audioChoice.startsWith('device:')) {
    // Capture from a specific input device
    const deviceId = audioChoice.replace('device:', '');
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...micStream.getAudioTracks(),
      ]);
    } catch (e) {
      console.warn('[Rec] Failed to capture audio device:', e);
    }
  }
  // else audioChoice === 'none' → video-only

  // 3. Create MediaRecorder
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';

  _recChunks = [];
  _recMediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });

  _recMediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) _recChunks.push(e.data);
  };

  _recMediaRecorder.onstop = async () => {
    const blob = new Blob(_recChunks, { type: mimeType });
    _recChunks = [];
    _recStopTimer();
    _recUpdateUI(false);

    const saveBar      = document.getElementById('rec-save-bar');
    const saveLabel    = document.getElementById('rec-save-label');
    const saveSub      = document.getElementById('rec-save-sub');
    const saveFill     = document.getElementById('rec-save-progress-fill');
    const saveOpenBtn  = document.getElementById('rec-save-open-btn');
    const saveDismiss  = document.getElementById('rec-save-dismiss');

    // Reset bar state
    if (saveBar) { saveBar.classList.remove('done'); saveBar.classList.add('visible'); }
    if (saveLabel) saveLabel.textContent = 'Saving…';
    if (saveSub) saveSub.textContent = 'Converting to MP4';
    if (saveFill) saveFill.style.width = '0%';

    // Fake progress animation
    let pct = 0;
    const progressIv = setInterval(() => {
      pct = Math.min(pct + Math.random() * 12, 90);
      if (saveFill) saveFill.style.width = pct + '%';
    }, 400);

    // Dismiss handler
    const dismissBar = () => { if (saveBar) { saveBar.classList.remove('visible', 'done'); } };
    if (saveDismiss) saveDismiss.onclick = dismissBar;

    // Convert to ArrayBuffer and send to main process for Save dialog
    let savedPath = null;
    try {
      const buffer = await blob.arrayBuffer();
      const result = await window.chimera.saveRecording(buffer);
      clearInterval(progressIv);

      if (result.ok) {
        savedPath = result.path;
        if (saveFill) saveFill.style.width = '100%';
        if (saveLabel) saveLabel.textContent = 'Saved!';
        if (saveSub) saveSub.textContent = result.path;
        if (saveBar) saveBar.classList.add('done');
        const note = result.note ? ` (${result.note})` : '';
        setLog('Recording saved → ' + result.path + note);

        // Beep 3 times
        _recBeep(3);

        // Open Saved button
        if (saveOpenBtn) {
          saveOpenBtn.onclick = () => {
            if (savedPath && window.chimera.openFile) window.chimera.openFile(savedPath);
          };
        }

        // Auto-dismiss after 15s
        setTimeout(dismissBar, 15000);
      } else if (result.canceled) {
        dismissBar();
      } else {
        clearInterval(progressIv);
        if (saveLabel) saveLabel.textContent = 'Save failed';
        if (saveSub) saveSub.textContent = result.error || 'Unknown error';
        setLog('Recording save failed' + (result.error ? ': ' + result.error : ''));
        setTimeout(dismissBar, 6000);
      }
    } catch (e) {
      clearInterval(progressIv);
      dismissBar();
      console.error('[Rec] Save error:', e);
      setLog('Recording save error: ' + e.message);
    }
  };

  _recMediaRecorder.start(1000); // 1s timeslice
  _recStartTimer();
  _recUpdateUI(true);
  recAudioWrap.classList.add('visible');
  setLog('Recording started');
}

function _recStop() {
  if (!_recMediaRecorder || _recMediaRecorder.state === 'inactive') return;
  _recMediaRecorder.stop();
  // Disconnect lipsync audio tap
  if (_recLipSyncMediaNode) {
    try { _recLipSyncMediaNode.disconnect(_recAudioDest); } catch (_) {}
    _recLipSyncMediaNode = null;
  }
  _recAudioDest = null;
  setLog('Stopping recording...');
}

function _recUpdateUI(recording) {
  if (recording) {
    btnRecord.classList.add('recording');
    btnRecordLabel.textContent = 'Stop';
  } else {
    btnRecord.classList.remove('recording');
    btnRecordLabel.textContent = 'Record';
  }
}

// Hook into LipSync _lsSourceNode to feed audio into the recorder
function _recConnectLipSyncSource(sourceNode) {
  if (!_recAudioDest || recAudioSelect.value !== 'lipsync') return;
  try {
    sourceNode.connect(_recAudioDest);
    _recLipSyncMediaNode = sourceNode;
  } catch (_) {}
}

if (btnRecord) {
  btnRecord.addEventListener('click', () => {
    if (_recMediaRecorder && _recMediaRecorder.state === 'recording') {
      _recStop();
    } else {
      _recStart();
    }
  });
}

// Populate audio devices on load + on device change
_recPopulateAudioDevices();
navigator.mediaDevices.addEventListener('devicechange', _recPopulateAudioDevices);

let fBrightness = 1;
let fContrast = 1;
let fSaturation = 1;

let sentFrames = 0;
let recvFrames = 0;
let lastSentFrames = 0;
let lastRecvFrames = 0;
let lastSentAt = 0;
let statsTimer = null;
let currentProfile = 'realtime';
let currentSendFps = 12;
let currentSendQuality = 0.68;
let currentSendW = 512;
let currentSendH = 288;
let lightProbe = null;
let lightProbeCtx = null;
let currentCaptureFilter = 'none';
let lastLightProbeAt = 0;

// --- Light Quality Gate ---
const lightOverlayEl    = document.getElementById('light-overlay');
const lightOverlayIssueEl = document.getElementById('light-overlay-issue');
const lightOverlayScoreEl = document.getElementById('light-overlay-score');
const lightPillEl       = document.getElementById('light-pill');
const lightPillScoreEl  = document.getElementById('light-pill-score');

let _lightBlocked    = false;   // true → _captureLoop skips ws.send
let _lightScore      = 100;
let _lightIssue      = '';
let _lightState      = 'good';  // 'good' | 'warn' | 'block'
let _lightConsecBad  = 0;       // consecutive probe ticks below block threshold
let _lightConsecGood = 0;       // consecutive probe ticks above unblock threshold
let _lightUnblockedAt = 0;      // timestamp of last unblock (grace period start)

const LIGHT_BLOCK_THRESHOLD   = 48;  // score below this → start counting toward block
const LIGHT_UNBLOCK_THRESHOLD = 64;  // score above this → start counting toward unblock
const LIGHT_WARN_THRESHOLD    = 70;  // score below this → amber pill (but still streaming)
const LIGHT_BAD_CONSEC        = 3;   // 3 bad ticks (~900ms) before blocking
const LIGHT_GOOD_CONSEC       = 2;   // 2 good ticks before unblocking
const LIGHT_GRACE_MS          = 3000; // ms after unblock before re-blocking is allowed

const STREAM_PROFILES = {
  realtime: {
    label: 'Realtime',
    sendFps: 20,
    minFps: 6,
    headroom: 2,
    quality: 0.65,
    width: 512,
    height: 288,
    summary: 'Realtime mode prioritizes steadier motion with lighter detection cadence, mild low-light compensation, and no enhancement overhead.',
  },
  quality: {
    label: 'Quality',
    sendFps: 15,
    minFps: 10,
    headroom: 1,
    quality: 0.78,
    width: 480,
    height: 270,
    summary: 'Quality mode keeps enhancement enabled and trims send rate so the GPU can keep up more consistently.',
  },
};

function ensureOffscreenCanvas() {
  if (!offscreen || offscreen.width !== currentSendW || offscreen.height !== currentSendH) {
    offscreen = new OffscreenCanvas(currentSendW, currentSendH);
    offCtx = offscreen.getContext('2d');
  }
}

function ensureLightProbeCanvas() {
  if (!lightProbe) {
    lightProbe = document.createElement('canvas');
    lightProbe.width = 32;
    lightProbe.height = 18;
    lightProbeCtx = lightProbe.getContext('2d', { willReadFrequently: true });
  }
}

// _updateLightGate: state machine that drives _lightBlocked and the UI
function _updateLightGate(score, issue, avgLuma, rN, gN, bN) {
  _lightScore = score;
  _lightIssue = issue;

  if (score < LIGHT_BLOCK_THRESHOLD) {
    _lightConsecBad++;
    _lightConsecGood = 0;
  } else if (score >= LIGHT_UNBLOCK_THRESHOLD) {
    _lightConsecGood++;
    _lightConsecBad = Math.max(0, _lightConsecBad - 1);
  } else {
    // warn zone — decay both counters; neither triggers a state change
    _lightConsecBad  = Math.max(0, _lightConsecBad - 1);
    _lightConsecGood = 0;
  }

  if (!_lightBlocked && _lightConsecBad >= LIGHT_BAD_CONSEC) {
    // Only re-block after grace period has expired
    if ((Date.now() - _lightUnblockedAt) >= LIGHT_GRACE_MS) {
      _lightBlocked = true;
    }
  } else if (_lightBlocked && _lightConsecGood >= LIGHT_GOOD_CONSEC) {
    _lightBlocked = false;
    _lightUnblockedAt = Date.now();
  }

  _lightState = _lightBlocked ? 'block' : score < LIGHT_WARN_THRESHOLD ? 'warn' : 'good';

  if (_lightBlocked) {
    if (lightOverlayEl && !lightOverlayEl.classList.contains('visible')) {
      lightOverlayEl.classList.add('visible');
    }
    if (lightOverlayIssueEl) lightOverlayIssueEl.textContent = issue || 'Adjust your lighting to resume.';
    if (lightOverlayScoreEl) lightOverlayScoreEl.textContent = `Light quality score: ${score}%`;
  } else {
    // Only touch the DOM if it's currently visible (avoids spurious re-animation triggers)
    if (lightOverlayEl && lightOverlayEl.classList.contains('visible')) {
      lightOverlayEl.classList.remove('visible');
    }
  }

  if (lightPillEl && lightPillEl.style.display !== 'none') {
    const scoreColor = _lightState === 'block' ? '#f87171' : _lightState === 'warn' ? '#fbbf24' : '#34d399';
    if (lightPillScoreEl) {
      lightPillScoreEl.textContent = `${score}%`;
      lightPillScoreEl.style.color = scoreColor;
    }
  }
}

function resetLightGate() {
  _lightBlocked     = false;
  _lightScore       = 100;
  _lightIssue       = '';
  _lightState       = 'good';
  _lightConsecBad   = 0;
  _lightConsecGood  = 0;
  _lightUnblockedAt = 0;
  if (lightOverlayEl) lightOverlayEl.classList.remove('visible');
  if (lightPillEl)    lightPillEl.style.display = 'none';
}

function updateCaptureFilter() {
  if (!captureVideo || captureVideo.readyState < 2) {
    currentCaptureFilter = 'none';
    return;
  }

  const now = Date.now();
  if (now - lastLightProbeAt < 300) return;
  lastLightProbeAt = now;

  ensureLightProbeCanvas();
  if (!lightProbeCtx) { currentCaptureFilter = 'none'; return; }

  lightProbeCtx.filter = 'none';
  lightProbeCtx.drawImage(captureVideo, 0, 0, lightProbe.width, lightProbe.height);
  const { data } = lightProbeCtx.getImageData(0, 0, lightProbe.width, lightProbe.height);

  const W = lightProbe.width;   // 32
  const H = lightProbe.height;  // 18

  // Face zone: centre 60% width × centre 70% height — avoids background edges
  const xMin = Math.floor(W * 0.20); // 6
  const xMax = Math.floor(W * 0.80); // 25
  const yMin = Math.floor(H * 0.15); // 2
  const yMax = Math.floor(H * 0.85); // 15
  const xMid = (xMin + xMax) >> 1;   // 15 — left/right split
  const yZ1  = yMin + Math.floor((yMax - yMin) / 3);      // 6
  const yZ2  = yMin + Math.floor((yMax - yMin) * 2 / 3);  // 10

  // Inner face centre zone — where the actual face sits (center ~35% × 45% of frame)
  // Used to detect backlighting (background brighter than face)
  const xInMin = Math.floor(W * 0.35); // 11
  const xInMax = Math.floor(W * 0.65); // 20
  const yInMin = Math.floor(H * 0.28); // 5
  const yInMax = Math.floor(H * 0.72); // 12

  let lumaSum = 0, rSum = 0, gSum = 0, bSum = 0;
  let clipCount = 0, pixCount = 0;
  let leftLuma = 0, leftCount = 0, rightLuma = 0, rightCount = 0;
  const zLuma = [0, 0, 0], zCount = [0, 0, 0];
  let innerLumaSum = 0, innerCount = 0;

  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = r * 0.299 + g * 0.587 + b * 0.114;
      lumaSum += luma; rSum += r; gSum += g; bSum += b;
      if (luma > 235) clipCount++;
      pixCount++;
      if (x < xMid) { leftLuma += luma; leftCount++; }
      else           { rightLuma += luma; rightCount++; }
      const zi = y < yZ1 ? 0 : y < yZ2 ? 1 : 2;
      zLuma[zi] += luma; zCount[zi]++;
      // Track face centre separately for backlight detection
      if (x >= xInMin && x < xInMax && y >= yInMin && y < yInMax) {
        innerLumaSum += luma; innerCount++;
      }
    }
  }

  if (pixCount === 0) { currentCaptureFilter = 'none'; return; }

  const avgLuma = lumaSum / pixCount;

  // --- Brightness compensation filter (existing logic, realtime only) ---
  if (currentProfile === 'realtime') {
    if (avgLuma < 72)      currentCaptureFilter = 'brightness(1.24) contrast(1.12) saturate(1.05)';
    else if (avgLuma < 96) currentCaptureFilter = 'brightness(1.12) contrast(1.06) saturate(1.03)';
    else                   currentCaptureFilter = 'none';
  } else {
    currentCaptureFilter = 'none';
  }

  // --- Light quality scoring (runs in both profiles) ---
  const avgR = rSum / pixCount, avgG = gSum / pixCount, avgB = bSum / pixCount;
  const rgbTotal = avgR + avgG + avgB + 1;
  const rN = avgR / rgbTotal, gN = avgG / rgbTotal, bN = avgB / rgbTotal;
  const neutral = 1 / 3;
  const castStrength = Math.max(Math.abs(rN - neutral), Math.abs(gN - neutral), Math.abs(bN - neutral));

  const lL = leftCount  ? leftLuma  / leftCount  : 0;
  const lR = rightCount ? rightLuma / rightCount : 0;
  const shadowAsymmetry = Math.abs(lL - lR) / Math.max(lL, lR, 1);

  const clipRatio   = clipCount / pixCount;
  const zAvgs       = zLuma.map((s, i) => zCount[i] > 0 ? s / zCount[i] : avgLuma);
  const minZoneLuma = Math.min(...zAvgs);

  // Luma score 0–40: optimal 80–185, smooth ramps either side
  let lumaScore;
  if      (avgLuma < 35)  lumaScore = 0;
  else if (avgLuma < 60)  lumaScore = (avgLuma - 35) / 25 * 20;
  else if (avgLuma < 80)  lumaScore = 20 + (avgLuma - 60) / 20 * 20;
  else if (avgLuma <= 185) lumaScore = 40;
  else if (avgLuma <= 215) lumaScore = 40 - (avgLuma - 185) / 30 * 20;
  else                    lumaScore = Math.max(0, 20 - (avgLuma - 215) / 40 * 20);

  // Color cast 0–30: neutral = 30, castStrength 0.19+ = 0
  const castScore     = Math.max(0, 30 - castStrength * 158);
  // Shadow asymmetry 0–15: symmetric = 15, extreme asymmetry = 0
  const shadowScore   = Math.max(0, 15 - shadowAsymmetry * 32);
  // Highlight clipping 0–10
  const clipScore     = Math.max(0, 10 - clipRatio * 50);
  // Min zone (darkest face band) 0–5
  const minZoneScore  = minZoneLuma < 20 ? 0 : Math.min(5, (minZoneLuma - 20) / 20 * 5);

  // Backlight detection: face centre darker than surrounding zone = light is behind the subject
  const faceCenterAvg = innerCount > 0 ? innerLumaSum / innerCount : avgLuma;
  const outerAvg = (pixCount - innerCount) > 0
    ? (lumaSum - innerLumaSum) / (pixCount - innerCount)
    : avgLuma;
  // Penalty kicks in when outer zone is >20 luma units brighter than face centre
  const backlightDiff    = Math.max(0, outerAvg - faceCenterAvg - 20);
  const backlightPenalty = Math.min(25, backlightDiff * 0.85);

  const score = Math.round(Math.min(100, Math.max(0,
    lumaScore + castScore + shadowScore + clipScore + minZoneScore - backlightPenalty,
  )));

  // Issue text — most dominant problem first
  let issue = '';
  if (backlightPenalty > 10) {
    issue = 'Backlit — your light source is behind you, face a light instead';
  } else if (avgLuma < 55) {
    issue = 'Room is too dark — you need more light on your face';
  } else if (avgLuma > 215) {
    issue = 'Overexposed — reduce direct light or step back from it';
  } else if (castStrength > 0.12) {
    if      (bN > rN + 0.06 && bN > gN + 0.03) issue = 'Blue light detected — use a neutral white light source';
    else if (rN > gN + 0.05 && rN > bN + 0.06) issue = 'Warm/red light detected — use neutral white light';
    else if (gN > rN + 0.04 && gN > bN + 0.04) issue = 'Green tint detected — use a neutral white light source';
    else                                         issue = 'Colored ambient light — use a neutral white light source';
  } else if (shadowAsymmetry > 0.40) {
    issue = 'Harsh side shadows — add a fill light on your dark side';
  } else if (minZoneLuma < 30) {
    issue = 'Part of your face is too dark — ensure even lighting';
  }

  _updateLightGate(score, issue, avgLuma, rN, gN, bN);
}

function applyPreviewFilter() {
  remoteCanvas.style.filter =
    `brightness(${fBrightness}) contrast(${fContrast}) saturate(${fSaturation})`;
}

function setPreviewDefaults() {
  fBrightness = 1;
  fContrast = 1;
  fSaturation = 1;
  ctrlBrightness.value = '1.00';
  ctrlContrast.value = '1.00';
  ctrlSaturation.value = '1.00';
  valBrightness.textContent = '1.00';
  valContrast.textContent = '1.00';
  valSaturation.textContent = '1.00';
  applyPreviewFilter();
}

function resetStats() {
  sentFrames = 0;
  recvFrames = 0;
  lastSentFrames = 0;
  lastRecvFrames = 0;
  lastSentAt = 0;
  stSendFps.textContent = '—';
  stRecvFps.textContent = '—';
  stLatency.textContent = '—';
  stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
  ovSendFps.textContent = '—';
  ovRecvFps.textContent = '—';
  ovLatency.textContent = '—';
  ovMode.textContent = STREAM_PROFILES[currentProfile].label;
}

function updateModeUI() {
  btnModeRealtime.classList.toggle('active', currentProfile === 'realtime');
  btnModeQuality.classList.toggle('active', currentProfile === 'quality');
  modeSummary.textContent = STREAM_PROFILES[currentProfile].summary;
  stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
  ovMode.textContent = STREAM_PROFILES[currentProfile].label;
}

// Self-pacing capture loop: fires next encode immediately after previous one
// completes, then waits only if encode was faster than the target interval.
// Eliminates the setInterval + _encodes backpressure drop problem where slow
// encodes caused most timer ticks to be thrown away.
let _captureLoopActive = false;

function restartCaptureTimer() {
  // No-op: loop reads currentSendFps dynamically, no restart needed.
}

async function _captureLoop() {
  while (_captureLoopActive) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !captureVideo || captureVideo.readyState < 2) {
      await new Promise((r) => setTimeout(r, 33));
      continue;
    }

    const t0 = performance.now();

    ensureOffscreenCanvas();
    updateCaptureFilter();   // also runs light quality analysis + updates _lightBlocked
    offCtx.filter = currentCaptureFilter;
    offCtx.drawImage(captureVideo, 0, 0, currentSendW, currentSendH);
    offCtx.filter = 'none';

    // Skip encode + send when light conditions are too poor.
    // The drawImage above still runs so the light probe stays fresh.
    if (!_lightBlocked) {
      try {
        const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: currentSendQuality });
        sentFrames++;
        lastSentAt = Date.now();
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(blob);
      } catch (_) { /* ignore */ }
    }

    // Pace to at most currentSendFps; if encode took longer just continue immediately.
    const elapsed = performance.now() - t0;
    const minInterval = 1000 / currentSendFps;
    if (elapsed < minInterval) {
      await new Promise((r) => setTimeout(r, minInterval - elapsed));
    }
  }
}

async function setProfile(profile, pushToBackend = true) {
  if (!STREAM_PROFILES[profile]) return;
  currentProfile = profile;
  currentSendFps = STREAM_PROFILES[profile].sendFps;
  currentSendQuality = STREAM_PROFILES[profile].quality;
  currentSendW = STREAM_PROFILES[profile].width;
  currentSendH = STREAM_PROFILES[profile].height;
  ensureOffscreenCanvas();
  updateModeUI();
  restartCaptureTimer();

  if (pushToBackend) {
    try {
      await window.chimera.setStreamProfile(profile);
    } catch (err) {
      setLog('Failed to set mode: ' + err.message);
    }
  }
}

function startStats() {
  if (statsTimer) clearInterval(statsTimer);
  resetStats();
  showConnScore();
  resetLightGate();
  if (lightPillEl) lightPillEl.style.display = 'flex';
  _connHistory = [];
  _stallCount = 0;
  hideReconnectBanner();
  statsTimer = setInterval(() => {
    const sendFps = sentFrames - lastSentFrames;
    const recvFps = recvFrames - lastRecvFrames;
    lastSentFrames = sentFrames;
    lastRecvFrames = recvFrames;

    const latency = lastSentAt ? Date.now() - lastSentAt : 0;

    stSendFps.textContent = `${sendFps} fps`;
    stRecvFps.textContent = `${recvFps} fps`;
    stLatency.textContent = latency ? `${latency} ms` : '—';
    stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
    ovSendFps.textContent = `${sendFps} fps`;
    ovRecvFps.textContent = `${recvFps} fps`;
    ovLatency.textContent = latency ? `${latency} ms` : '—';

    // --- Connectivity score ---
    updateConnScore(sendFps, recvFps, latency);

    if (recvFps > 0) {
      const profile = STREAM_PROFILES[currentProfile];
      const recommendedFps = Math.max(
        profile.minFps,
        Math.min(profile.sendFps, recvFps + profile.headroom),
      );
      if (Math.abs(recommendedFps - currentSendFps) >= 1) {
        currentSendFps = recommendedFps;
        stMode.textContent = `${profile.label} · ${currentSendFps} cap`;
        restartCaptureTimer();
      }
    }
  }, 1000);
}

// --- Connectivity Score Engine ---
const CONN_RING_CIRCUMFERENCE = 97.4; // 2 * π * 15.5
let _connHistory = [];      // last N snapshots: { score }
let _stallCount = 0;        // consecutive seconds with 0 recv
const CONN_HISTORY_LEN = 8; // smoothing window (seconds)

function computeConnScore(sendFps, recvFps, latencyMs) {
  const profile = STREAM_PROFILES[currentProfile];
  const targetFps = profile.sendFps;

  // Component 1: Throughput ratio (0-40 pts)
  // How many frames come back vs what we send
  const ratio = sendFps > 0 ? Math.min(recvFps / sendFps, 1) : (recvFps > 0 ? 1 : 0);
  const throughputScore = ratio * 40;

  // Component 2: Recv FPS vs target (0-30 pts)
  // Penalise if recv is well below what the mode expects
  const fpsScore = Math.min(recvFps / Math.max(targetFps * 0.6, 1), 1) * 30;

  // Component 3: Latency (0-20 pts)
  // <80ms = perfect, >500ms = 0
  let latScore = 20;
  if (latencyMs > 500) latScore = 0;
  else if (latencyMs > 300) latScore = 5;
  else if (latencyMs > 200) latScore = 10;
  else if (latencyMs > 120) latScore = 15;
  else if (latencyMs > 80) latScore = 18;

  // Component 4: Stall penalty (0-10 pts)
  // Consecutive zero-recv seconds
  const stallScore = Math.max(0, 10 - _stallCount * 5);

  return Math.round(Math.min(100, throughputScore + fpsScore + latScore + stallScore));
}

function getGrade(score) {
  if (score >= 80) return { label: 'Excellent', cls: 'excellent', hint: '' };
  if (score >= 60) return { label: 'Good', cls: 'good', hint: 'Stable connection' };
  if (score >= 35) return { label: 'Fair', cls: 'fair', hint: 'Check your internet speed' };
  return { label: 'Poor', cls: 'poor', hint: 'High packet loss — consider reconnecting' };
}

function updateConnScore(sendFps, recvFps, latencyMs) {
  // Track stalls
  if (recvFps === 0 && sendFps > 0) {
    _stallCount++;
  } else {
    _stallCount = Math.max(0, _stallCount - 1);
  }

  const raw = computeConnScore(sendFps, recvFps, latencyMs);
  _connHistory.push(raw);
  if (_connHistory.length > CONN_HISTORY_LEN) _connHistory.shift();

  // Smoothed average
  const avg = Math.round(_connHistory.reduce((a, b) => a + b, 0) / _connHistory.length);

  // Update ring
  const offset = CONN_RING_CIRCUMFERENCE - (CONN_RING_CIRCUMFERENCE * avg / 100);
  if (scoreRingFg) {
    scoreRingFg.style.strokeDashoffset = offset;
    const grade = getGrade(avg);
    scoreRingFg.style.stroke = avg >= 80 ? '#34d399' : avg >= 60 ? '#60a5fa' : avg >= 35 ? '#fbbf24' : '#f87171';
    scorePct.textContent = `${avg}`;
    connGrade.textContent = grade.label;
    connGrade.className = `conn-grade ${grade.cls}`;
    connHint.textContent = grade.hint;
  }

  // Update sidebar stat
  if (stConnScore) {
    const grade = getGrade(avg);
    stConnScore.textContent = `${avg}% ${grade.label}`;
  }

  // Show reconnect banner if score critically low for sustained period
  if (avg <= 20 && _connHistory.length >= 4) {
    showReconnectBanner('Feed stalled — connection degraded');
  } else if (_stallCount >= 5) {
    showReconnectBanner('No frames received — stream may be frozen');
  } else {
    hideReconnectBanner();
  }

  // Privacy Shield — hide video output when connection is poor
  updatePrivacyShield(avg);
}

function showConnScore() {
  if (connScorePill) connScorePill.classList.add('visible');
}

function hideConnScore() {
  if (connScorePill) connScorePill.classList.remove('visible');
  if (scoreRingFg) scoreRingFg.style.strokeDashoffset = CONN_RING_CIRCUMFERENCE;
  if (scorePct) scorePct.textContent = '—';
  if (connGrade) { connGrade.textContent = '—'; connGrade.className = 'conn-grade'; }
  if (connHint) connHint.textContent = '';
  if (stConnScore) stConnScore.textContent = '—';
}

function showReconnectBanner(msg) {
  if (reconnectMsg) reconnectMsg.textContent = msg;
  if (reconnectBanner) reconnectBanner.classList.add('visible');
}

function hideReconnectBanner() {
  if (reconnectBanner) reconnectBanner.classList.remove('visible');
}

// --- Privacy Shield ---
let _shieldActive = false;
const SHIELD_ENGAGE_THRESHOLD = 25;  // score at or below → engage
const SHIELD_RELEASE_THRESHOLD = 50; // score at or above → release
const SHIELD_MIN_SAMPLES = 3;        // need this many history entries

function updatePrivacyShield(score) {
  if (!_privacyShieldEnabled) {
    if (_shieldActive) hidePrivacyShield();
    return;
  }

  if (!_shieldActive && score <= SHIELD_ENGAGE_THRESHOLD && _connHistory.length >= SHIELD_MIN_SAMPLES) {
    showPrivacyShield(score);
  } else if (_shieldActive && score >= SHIELD_RELEASE_THRESHOLD) {
    hidePrivacyShield();
  } else if (_shieldActive) {
    // Update the score readout while shield is showing
    if (shieldScore) shieldScore.textContent = `Connection quality: ${score}% — waiting for improvement`;
  }
}

function showPrivacyShield(score) {
  _shieldActive = true;
  if (privacyShield) privacyShield.classList.add('visible');
  if (shieldTitle) shieldTitle.textContent = 'Video Hidden — Poor Connection';
  if (shieldSub) shieldSub.textContent = 'Your stream is temporarily hidden to protect your identity while the connection recovers. Video will resume automatically when quality improves.';
  if (shieldScore) shieldScore.textContent = `Connection quality: ${score}%`;
}

function hidePrivacyShield() {
  _shieldActive = false;
  if (privacyShield) privacyShield.classList.remove('visible');
}

async function doReconnect() {
  // Grab the endpoint before we tear things down
  const ip = gpuIp || _lastGpuIp;
  const port = gpuPort || _lastGpuPort;
  if (!ip || !port) return;

  hideReconnectBanner();
  hidePrivacyShield();
  setLog('Reconnecting stream...');
  setStatus('Reconnecting...', 'loading');

  // Tear down current WS + camera
  _captureLoopActive = false;
  stopStats();
  stopAudioMeter();
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }
  localVideo.srcObject = null;
  localVideo.classList.remove('active');
  offscreen = null;
  offCtx = null;
  gpuIp = null;
  gpuPort = null;

  // Small pause to let the WS fully close
  await new Promise(r => setTimeout(r, 500));

  try {
    await startStreaming(ip, port);
    setStatus('Active', 'active');
  } catch (err) {
    setStatus('Error', 'error');
    setLog('Reconnect failed: ' + err.message);
    // Keep the endpoint available for another retry
    _lastGpuIp = ip;
    _lastGpuPort = port;
    showReconnectBanner('Reconnect failed — tap to try again');
  }
}

function stopStats() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  resetStats();
}

ctrlBrightness.addEventListener('input', (e) => {
  fBrightness = parseFloat(e.target.value);
  valBrightness.textContent = fBrightness.toFixed(2);
  applyPreviewFilter();
});

ctrlContrast.addEventListener('input', (e) => {
  fContrast = parseFloat(e.target.value);
  valContrast.textContent = fContrast.toFixed(2);
  applyPreviewFilter();
});

ctrlSaturation.addEventListener('input', (e) => {
  fSaturation = parseFloat(e.target.value);
  valSaturation.textContent = fSaturation.toFixed(2);
  applyPreviewFilter();
});

btnResetPreview.addEventListener('click', () => setPreviewDefaults());
btnModeRealtime.addEventListener('click', () => setProfile('realtime'));
btnModeQuality.addEventListener('click', () => setProfile('quality'));
btnReconnect.addEventListener('click', () => doReconnect());

// --- Privacy Shield toggle (header button) ---
let _privacyShieldEnabled = true;
const shieldTooltipStatus = document.getElementById('shield-tooltip-status');
btnPrivacyShield.addEventListener('click', () => {
  _privacyShieldEnabled = !_privacyShieldEnabled;
  btnPrivacyShield.classList.toggle('shield-active', _privacyShieldEnabled);
  if (shieldTooltipStatus) {
    shieldTooltipStatus.textContent = _privacyShieldEnabled ? '● ON' : '● OFF';
    shieldTooltipStatus.classList.toggle('off', !_privacyShieldEnabled);
  }
  if (!_privacyShieldEnabled) hidePrivacyShield();
});
btnSaveConfig.addEventListener('click', async () => {
  if (ws || localStream || gpuIp) {
    setConfigNote('Stop the current session before changing connection settings.');
    return;
  }

  btnSaveConfig.disabled = true;
  setConfigNote('Saving connection settings...');
  try {
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: cfgLicenseKey.value,
      obsPort: cfgObsPort.value,
      warmPodId: cfgWarmPodId.value,
    });
    applyConfigToUI(saved);
    setLog('Connection settings saved.');
  } catch (err) {
    setConfigNote(`Failed to save settings: ${err.message}`);
  } finally {
    btnSaveConfig.disabled = false;
  }
});

btnAttachPod.addEventListener('click', async () => {
  const podId = String(cfgWarmPodId.value || '').trim();
  if (!podId) {
    setConfigNote('Enter a warm pod ID before attaching it.');
    return;
  }
  if (ws || localStream || gpuIp) {
    setConfigNote('Stop the current session before attaching a different pod.');
    return;
  }

  btnAttachPod.disabled = true;
  setConfigNote('Attaching warm pod...');
  try {
    const result = await window.chimera.attachWarmPod(podId);
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: cfgLicenseKey.value,
      obsPort: cfgObsPort.value,
      warmPodId: podId,
    });
    applyConfigToUI(saved);
    setCurrentPod(result.podId, result.endpoint);
    setLog(`Warm pod attached — ${result.endpoint.ip}:${result.endpoint.port}`);
    setConfigNote(`Warm pod attached: ${podId}`);
  } catch (err) {
    setConfigNote(`Failed to attach warm pod: ${err.message}`);
  } finally {
    btnAttachPod.disabled = false;
  }
});

btnLicenseLogin.addEventListener('click', async () => {
  const key = String(cfgLicenseKey?.value || '').trim().toUpperCase();
  if (!key) {
    setLog('Enter your product key first.');
    return;
  }
  btnLicenseLogin.disabled = true;
  try {
    const result = await window.chimera.licenseLogin(key);
    licenseLoggedIn = true;
    licenseUser = result.user || null;
    hideKeyContactPopup();
    updateLicenseUI();
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: key,
      obsPort: cfgObsPort.value,
      warmPodId: cfgWarmPodId.value,
    });
    applyConfigToUI(saved);
    setLog('Product key login successful.');
    showLicenseResultPopup(true, 'Product key valid. Voices unlocked and refreshed.');
    await loadVoices();
    await refreshNotifications(true);
    await refreshUsage();
  } catch (err) {
    licenseLoggedIn = false;
    licenseUser = null;
    updateLicenseUI();
    renderUsageState({ requiresLogin: true });
    showKeyContactPopup(true);
    showLicenseResultPopup(false, err.message || 'Invalid product key.');
    setLog(`Product key login failed: ${err.message}`);
  } finally {
    btnLicenseLogin.disabled = false;
  }
});

btnLicenseLogout.addEventListener('click', async () => {
  btnLicenseLogout.disabled = true;
  try {
    await window.chimera.licenseLogout();
    licenseLoggedIn = false;
    licenseUser = null;
    updateLicenseUI();
    renderUsageState({ requiresLogin: true });
    showKeyContactPopup(true);
    _cachedNotifications = [];
    updateNotifBadge(0);
    renderNotificationsPopup([]);
    setLog('Product key session logged out.');
  } catch (err) {
    setLog(`Logout failed: ${err.message}`);
  } finally {
    btnLicenseLogout.disabled = false;
  }
});

btnNotifBell.addEventListener('click', () => {
  openNotificationsPopup().catch(() => {});
});

btnCloseNotif.addEventListener('click', () => {
  closeNotificationsPopup();
});

// Close notification popup on backdrop click
notifOverlay.addEventListener('click', (e) => {
  if (e.target === notifOverlay) closeNotificationsPopup();
});

// Close notification popup on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && notifOverlay.classList.contains('visible')) {
    closeNotificationsPopup();
  }
});

// --- Camera enumeration ---
// Virtual camera names to deprioritize (pushed to bottom of dropdown).
const VIRTUAL_CAM_KEYWORDS = ['droidcam', 'obs virtual', 'obs-camera', 'virtual', 'snap camera', 'manycam', 'xsplit'];

function isVirtualCam(label) {
  const lower = (label || '').toLowerCase();
  return VIRTUAL_CAM_KEYWORDS.some(kw => lower.includes(kw));
}

async function enumerateCameras() {
  try {
    // Need a brief getUserMedia to get labelled devices on first load
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tempStream.getTracks().forEach(t => t.stop());
  } catch (_) {}

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');

  // Sort: real cameras first, virtual cameras last
  cameras.sort((a, b) => {
    const aVirt = isVirtualCam(a.label) ? 1 : 0;
    const bVirt = isVirtualCam(b.label) ? 1 : 0;
    return aVirt - bVirt;
  });

  // Populate dropdown
  cfgCamera.innerHTML = '';
  cameras.forEach((cam, idx) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    const label = cam.label || `Camera ${idx + 1}`;
    opt.textContent = isVirtualCam(label) ? `⚠ ${label}` : label;
    cfgCamera.appendChild(opt);
  });

  // Auto-select first non-virtual camera
  const firstReal = cameras.find(c => !isVirtualCam(c.label));
  if (firstReal) {
    cfgCamera.value = firstReal.deviceId;
  }
}

// --- WebSocket stream state ---
let ws           = null;
let localStream  = null;
let captureVideo = null;  // hidden <video> to draw from
let captureTimer = null;  // unused but kept to avoid reference errors in restartCaptureTimer
let gpuIp        = null;
let gpuPort      = null;
let _lastGpuIp   = null;
let _lastGpuPort = null;
let offscreen    = null;
let offCtx       = null;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;
  _lastGpuIp = ip;
  _lastGpuPort = port;

  setLog('Requesting camera...');
  startBeeping(); // beep while waiting for camera + stream connection
  const videoConstraints = {
    width:     { ideal: 960, max: 1280 },
    height:    { ideal: 540, max: 720 },
    frameRate: { ideal: 20, max: 20 },
  };
  // Use user-selected camera; fall back to default if none selected
  const selectedDeviceId = cfgCamera?.value;
  if (selectedDeviceId) {
    videoConstraints.deviceId = { exact: selectedDeviceId };
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });

  localVideo.srcObject = localStream;
  localVideo.classList.add('active');
  camPlaceholder.style.display = 'none';

  // Hidden video element — OffscreenCanvas draws from this
  captureVideo = document.createElement('video');
  captureVideo.srcObject = localStream;
  captureVideo.muted = true;
  captureVideo.playsInline = true;
  await captureVideo.play();

  // OffscreenCanvas — hardware-accelerated JPEG encoding in Chromium
  ensureOffscreenCanvas();

  // Display canvas for inbound swapped frames
  remoteCanvas.width  = 640;
  remoteCanvas.height = 360;
  const displayCtx = remoteCanvas.getContext('2d');

  ws = new WebSocket(`ws://${ip}:${port}/ws`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    stopBeeping();
    hideVideoEmpty();
    setLog(`Streaming — ${ip}:${port}`);
    startStats();
    startAudioMeter();
    _captureLoopActive = true;
    _captureLoop();
  };

  ws.onmessage = (event) => {
    recvFrames++;
    // Display in the Electron window — event.data is already ArrayBuffer
    createImageBitmap(new Blob([event.data], { type: 'image/jpeg' })).then((bitmap) => {
      displayCtx.drawImage(bitmap, 0, 0, remoteCanvas.width, remoteCanvas.height);
      bitmap.close();
    });

    // Push to OBS Browser Source — send raw ArrayBuffer, main process base64-encodes it.
    // Eliminates the async FileReader + dataURL string overhead on the render process.
    window.chimera.obsFrame(event.data);
  };

  ws.onerror = () => {
    setLog('Stream error — check GPU pod');
    showReconnectBanner('Stream error — tap to reconnect');
  };
  ws.onclose = () => {
    if (gpuIp) {
      setLog('Stream disconnected');
      showReconnectBanner('Stream disconnected — tap to reconnect');
    }
  };
}

function stopStreaming() {
  gpuIp = null;
  gpuPort = null;
  _lastGpuIp = null;
  _lastGpuPort = null;
  _captureLoopActive = false;
  stopStats();
  stopAudioMeter();
  stopVoiceChanger();
  hideConnScore();
  hideReconnectBanner();
  hidePrivacyShield();
  resetLightGate();

  // Auto-stop recording when stream ends
  if (_recMediaRecorder && _recMediaRecorder.state === 'recording') _recStop();

  if (ws) { ws.close(); ws = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }

  localVideo.srcObject = null;
  localVideo.classList.remove('active');
  offscreen = null;
  offCtx = null;

  if (remoteCanvas) {
    remoteCanvas.getContext('2d').clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  }

  showIdleState();
}

// --- Face Upload ---
btnUpload.addEventListener('click', () => faceInput.click());

faceInput.addEventListener('change', async () => {
  const file = faceInput.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  facePreview.src = url;
  facePreview.style.display = 'block';

  setLog('Uploading face...');
  try {
    const buffer = await file.arrayBuffer();
    await window.chimera.uploadFace(buffer, file.name);
    setLog('Face uploaded.');
  } catch (err) {
    setLog('Face upload failed: ' + err.message);
  }
});

// --- Start Session ---
btnStart.addEventListener('click', async () => {
  if (!isSessionUnlocked()) {
    setLog('Login with product key first.');
    return;
  }

  setStatus('Starting...', 'loading');
  setLog('Checking for a reusable warm pod...');
  setLoading(true);
  showLoadingState('Starting session...', 'Looking for a reusable warm pod...');
  playBeep(660, 0.15, 0.18); // single beep — session starting

  try {
    const configuredWarmPodId = String(cfgWarmPodId?.value || '').trim();
    if (configuredWarmPodId) {
      setLog(`Attaching configured warm pod ${configuredWarmPodId}...`);
      updateLoaderText('Attaching warm pod...', `Connecting to pod ${configuredWarmPodId}`);
      await window.chimera.attachWarmPod(configuredWarmPodId);
    }

    const existingStatus = await window.chimera.getStatus();
    if (existingStatus?.active) {
      setLog('Reusable warm pod found. Connecting to it...');
      updateLoaderText('Warm pod found', 'Reconnecting to existing session...');
    } else {
      setLog('No reusable warm pod found. Provisioning a new GPU pod...');
      updateLoaderText('Provisioning GPU...', 'Requesting a new GPU pod. This usually takes 30–90 seconds.');
    }

    // /start now reuses a live warm pod when one already exists.
    const data = await window.chimera.startSession();
    setCurrentPod(data.podId, data.endpoint);

    btnStart.style.display = 'none';
    btnStop.style.display  = 'block';
    btnStop.disabled       = false;

    if (data.reused) {
      setLog('Warm pod found. Checking server readiness...');
      updateLoaderText('Waking warm pod...', 'The inference server is booting up.');
    } else {
      const gpuLabel = (data.gpuType || '').replace('NVIDIA ', '').replace('GeForce ', '') || 'GPU';
      setLog(`Warm pod not available. Waiting for a new ${gpuLabel} pod to finish booting...`);
      updateLoaderText('Booting inference server...', `New ${gpuLabel} pod is starting. Models are loading.`);
    }

    // Poll /ready until the inference server is accepting connections.
    // Show elapsed time so the user knows it's working, not frozen.
    const startedAt = Date.now();
    let dots = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      dots = (dots + 1) % 4;
      const d = '.'.repeat(dots + 1);
      const prefix = data.reused ? 'Warm pod waking' : 'Provisioning and starting server';
      setLog(`${prefix}${d}  ${elapsed}s`);
      try {
        const r = await window.chimera.checkReady();
        if (r.ready) break;
      } catch (_) {}
    }

    updateLoaderText('Connecting stream...', 'GPU pod is ready. Opening camera and WebSocket...');

    setStatus('Active', 'active');
    setLog(`Streaming — ${data.endpoint.ip}:${data.endpoint.port}`);
    btnUpload.disabled = false;
    refreshUsage({ silent: true }).catch(() => {});

    await startStreaming(data.endpoint.ip, data.endpoint.port);
  } catch (err) {
    stopBeeping();
    setStatus('Error', 'error');
    maybeShowKeyContactPopup(err.message);
    setLog('Failed to start: ' + err.message);
    showIdleState();
    setLoading(false);
  }
});

// --- Stop Session ---
btnStop.addEventListener('click', async () => {
  setStatus('Stopping...', 'loading');
  setLog('Terminating GPU pod...');
  setLoading(true);
  stopBeeping();

  // Stop local streaming first (camera + WebSocket). Wrapped in try so any
  // DOM/state error here never prevents the backend pod from being terminated.
  try { stopStreaming(); } catch (e) { console.warn('stopStreaming error (non-fatal):', e); }

  try {
    await window.chimera.stopSession();
    setCurrentPod(null);
    setStatus('Idle', '');
    setLog('Session stopped.');
    playDoubleBeep();
    btnStop.style.display  = 'none';
    btnStart.style.display = 'block';
  } catch (err) {
    setStatus('Error', 'error');
    setLog('Failed to stop: ' + err.message);
  }

  refreshUsage({ silent: true }).catch(() => {});

  setLoading(false);
});

// --- Tutorial / Setup Guide ---
btnOpenTutorial.addEventListener('click', () => {
  tutorialOverlay.classList.add('visible');
  // Update the OBS URL references inside the tutorial
  const obsUrl = obsUrlLabel.textContent || 'http://localhost:7891';
  const tutUrl1 = document.getElementById('tut-obs-url');
  const tutUrl2 = document.getElementById('tut-obs-url-2');
  if (tutUrl1) tutUrl1.textContent = obsUrl;
  if (tutUrl2) tutUrl2.textContent = obsUrl;
});

btnCloseTutorial.addEventListener('click', () => {
  tutorialOverlay.classList.remove('visible');
});

btnOpenDrivers.addEventListener('click', async () => {
  try {
    await window.chimera.openDriversFolder();
  } catch (err) {
    setLog('Could not open drivers folder: ' + err.message);
  }
});

// Close tutorial on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tutorialOverlay.classList.contains('visible')) {
    tutorialOverlay.classList.remove('visible');
  }
});

// =============================================================================
// INSTRUCTIONS TOUR
// =============================================================================

const TOUR_STEPS = [
  {
    selector: null,
    title: 'Welcome to Chimera Lite',
    body: 'This quick tour walks you through the full workflow — from logging in to running a live face swap. Use the buttons below to navigate, or press ← → on your keyboard. Click anywhere outside the card to exit.',
    placement: 'center',
  },
  {
    selector: '#cfg-license-key',
    panel: true,
    title: 'Step 1 — Login with your Product Key',
    body: 'Enter your 12-character product key in the field above, then click <strong>Login with Product Key</strong>. This unlocks the session controls and auto-fills your API credentials. You only need to do this once per machine.',
    placement: 'right',
  },
  {
    selector: '#btn-upload',
    panel: true,
    title: 'Step 2 — Upload your Target Face',
    body: 'Click <strong>Choose Photo</strong> to upload a clear, front-facing photo of the face you want to swap onto yourself. Use good lighting in the photo — the sharper and more neutral the photo, the cleaner the swap result.',
    placement: 'right',
  },
  {
    selector: '#cfg-camera',
    title: 'Step 3 — Select your Camera',
    body: 'Choose your webcam from the dropdown. Real cameras are listed first — avoid selecting virtual cameras like OBS Virtual Camera or DroidCam here, as those are outputs, not inputs.',
    placement: 'right',
  },
  {
    selector: '#btn-start',
    title: 'Step 4 — Start a Session',
    body: 'Once you are logged in and have uploaded a face, click <strong>Start Session</strong>. Chimera Lite will provision a GPU pod on a remote server and connect your camera feed to it. This usually takes 30–90 seconds the first time.',
    placement: 'right',
  },
  {
    selector: '.segmented',
    title: 'Step 5 — Choose your Swap Mode',
    body: '<strong>Realtime</strong> — Lower latency, steadier motion. Best for live video calls.<br><br><strong>Quality</strong> — GFPGAN face enhancement enabled. Sharper and more refined output, with a small amount of extra delay.',
    placement: 'right',
  },
  {
    selector: '#ctrl-brightness',
    panel: true,
    title: 'Step 6 — Preview Adjustments',
    body: 'These sliders adjust what <em>you see</em> in the app preview — they do not affect the feed being processed by the GPU. Use them to fine-tune brightness, contrast, and colour saturation to your liking.',
    placement: 'right',
  },
  {
    selector: '.shield-wrap',
    title: 'Step 7 — Privacy Shield',
    body: 'The Privacy Shield automatically <strong>hides the video feed</strong> when your connection quality drops critically low — preventing frozen or glitched frames from exposing your real face to viewers. Click the icon to toggle it.',
    placement: 'bottom',
  },
  {
    selector: '#cfg-obs-port',
    panel: true,
    title: 'Step 8 — OBS Browser Source',
    body: 'To mirror your swapped feed into OBS or any screen-capture tool, add a <strong>Browser Source</strong> in OBS pointed at <code>http://localhost:7891</code> (or the port shown in your config). Set it to 640×360 with no audio.',
    placement: 'right',
  },
  {
    selector: '#btn-stop',
    title: 'Step 9 — Stop the Session',
    body: 'When you are done, click <strong>Stop Session</strong>. This terminates the GPU pod, releases your camera, and ends any associated billing. Always stop the session before closing the app.',
    placement: 'right',
  },
  {
    selector: null,
    title: "You're all set!",
    body: 'That covers everything you need to run a live face swap. If you get stuck, open the <strong>Setup Guide</strong> in the sidebar for detailed OBS and DroidCam instructions. Good luck!',
    placement: 'center',
  },
];

let _tourActive = false;
let _tourStep   = 0;

const _tourBackdrop  = document.getElementById('tour-backdrop');
const _tourSpotlight = document.getElementById('tour-spotlight');
const _tourCard      = document.getElementById('tour-card');
const _tourStepNum   = document.getElementById('tour-step-num');
const _tourStepTotal = document.getElementById('tour-step-total');
const _tourTitle     = document.getElementById('tour-title');
const _tourBody      = document.getElementById('tour-body');
const _tourBtnNext   = document.getElementById('tour-btn-next');
const _tourBtnPrev   = document.getElementById('tour-btn-prev');
const _tourBtnSkip   = document.getElementById('tour-btn-skip');

function _tourEnd() {
  _tourActive = false;
  if (_tourBackdrop)  _tourBackdrop.classList.remove('active');
  if (_tourSpotlight) { _tourSpotlight.style.opacity = '0'; }
  if (_tourCard)      _tourCard.classList.remove('active');
}

function _tourRender() {
  if (!_tourCard) return;
  const step    = TOUR_STEPS[_tourStep];
  const total   = TOUR_STEPS.filter(s => s.selector !== null || _tourStep === 0 || _tourStep === TOUR_STEPS.length - 1 || !s._skip).length;
  const isFirst = _tourStep === 0;
  const isLast  = _tourStep === TOUR_STEPS.length - 1;

  // Content
  if (_tourStepNum)   _tourStepNum.textContent   = _tourStep + 1;
  if (_tourStepTotal) _tourStepTotal.textContent  = TOUR_STEPS.length;
  if (_tourTitle)     _tourTitle.textContent      = step.title;
  if (_tourBody)      _tourBody.innerHTML         = step.body;

  // Navigation
  if (_tourBtnPrev) _tourBtnPrev.style.visibility = isFirst ? 'hidden' : 'visible';
  if (_tourBtnNext) {
    _tourBtnNext.textContent = isLast ? 'Done ✓' : 'Next →';
    _tourBtnNext.className   = isLast ? 'tour-btn-next done' : 'tour-btn-next';
  }
  if (_tourBtnSkip) _tourBtnSkip.style.display = isLast ? 'none' : 'inline';

  // Resolve target element
  let targetEl = step.selector ? document.querySelector(step.selector) : null;
  if (targetEl && step.panel) {
    targetEl = targetEl.closest('section') || targetEl;
  }

  if (!targetEl || step.placement === 'center') {
    // Center card, hide spotlight
    if (_tourSpotlight) _tourSpotlight.style.opacity = '0';
    _tourCard.style.top       = '50%';
    _tourCard.style.left      = '50%';
    _tourCard.style.transform = 'translate(-50%, -50%)';
    _tourCard.className       = 'tour-card active';
  } else {
    // Scroll target into view then position
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Use rAF so scroll has a chance to settle slightly before measuring
    requestAnimationFrame(() => {
      const rect   = targetEl.getBoundingClientRect();
      const pad    = 10;
      const cardW  = 330;
      const cardH  = 240;
      const margin = 16;
      const winW   = window.innerWidth;
      const winH   = window.innerHeight;

      // Spotlight
      if (_tourSpotlight) {
        _tourSpotlight.style.opacity = '1';
        _tourSpotlight.style.top     = (rect.top  - pad) + 'px';
        _tourSpotlight.style.left    = (rect.left - pad) + 'px';
        _tourSpotlight.style.width   = (rect.width  + pad * 2) + 'px';
        _tourSpotlight.style.height  = (rect.height + pad * 2) + 'px';
      }

      // Card placement — prefer right side, fall back left/below/above
      let cardTop, cardLeft, arrowClass;
      const spaceRight = winW - rect.right - pad;
      const spaceLeft  = rect.left - pad;

      if (spaceRight >= cardW + margin) {
        cardLeft   = rect.right + pad + margin;
        cardTop    = Math.max(20, Math.min(rect.top - pad, winH - cardH - 20));
        arrowClass = 'arrow-left';
      } else if (spaceLeft >= cardW + margin) {
        cardLeft   = rect.left - pad - margin - cardW;
        cardTop    = Math.max(20, Math.min(rect.top - pad, winH - cardH - 20));
        arrowClass = 'arrow-right';
      } else if (rect.top > winH / 2) {
        cardLeft   = Math.max(20, Math.min(rect.left - pad, winW - cardW - 20));
        cardTop    = Math.max(20, rect.top - pad - margin - cardH);
        arrowClass = 'arrow-bottom';
      } else {
        cardLeft   = Math.max(20, Math.min(rect.left - pad, winW - cardW - 20));
        cardTop    = rect.bottom + pad + margin;
        arrowClass = 'arrow-top';
      }

      _tourCard.style.transform = '';
      _tourCard.style.top       = cardTop  + 'px';
      _tourCard.style.left      = cardLeft + 'px';
      _tourCard.className       = `tour-card active ${arrowClass}`;
    });
  }
}

function _tourStart() {
  _tourActive = true;
  _tourStep   = 0;
  if (_tourBackdrop)  _tourBackdrop.classList.add('active');
  if (_tourSpotlight) _tourSpotlight.style.opacity = '0';
  if (_tourCard)      _tourCard.classList.add('active');
  _tourRender();
}

if (_tourBtnNext)  _tourBtnNext.addEventListener('click', () => {
  if (_tourStep >= TOUR_STEPS.length - 1) { _tourEnd(); return; }
  _tourStep++;
  _tourRender();
});
if (_tourBtnPrev)  _tourBtnPrev.addEventListener('click', () => {
  if (_tourStep > 0) { _tourStep--; _tourRender(); }
});
if (_tourBtnSkip)  _tourBtnSkip.addEventListener('click', _tourEnd);
if (_tourBackdrop) _tourBackdrop.addEventListener('click', _tourEnd);

if (btnInstructions) btnInstructions.addEventListener('click', _tourStart);

// Keyboard navigation for the tour
document.addEventListener('keydown', (e) => {
  if (!_tourActive) return;
  if (e.key === 'Escape')      { _tourEnd(); return; }
  if (e.key === 'ArrowRight' && _tourStep < TOUR_STEPS.length - 1) { _tourStep++; _tourRender(); }
  if (e.key === 'ArrowLeft'  && _tourStep > 0)                     { _tourStep--; _tourRender(); }
});

// --- Init: reconnect to existing session ---
(async () => {
  runLaunchSequence().catch(() => {});
  setPreviewDefaults();
  renderUsageState({ requiresLogin: true });
  startUsagePolling();
  await enumerateCameras().catch(() => {});
  try {
    const appConfig = await window.chimera.getAppConfig();
    applyConfigToUI(appConfig);

    const licenseSession = await window.chimera.getLicenseSession();
    licenseLoggedIn = !!licenseSession?.loggedIn;
    licenseUser = licenseSession?.user || null;
    updateLicenseUI();
    if (licenseLoggedIn) {
      hideKeyContactPopup();
      await refreshNotifications(true);
      await refreshUsage();
    } else {
      showKeyContactPopup();
    }

    const profileData = await window.chimera.getStreamProfile();
    if (profileData?.profile) {
      await setProfile(profileData.profile, false);
    } else {
      updateModeUI();
    }

    const data = await window.chimera.getStatus();
    if (data.active) {
      if (data.streamProfile) {
        await setProfile(data.streamProfile, false);
      }
      setCurrentPod(data.podId, data.endpoint);
      setStatus('Active', 'active');
      btnStart.style.display = 'none';
      btnStop.style.display  = 'block';
      setLog('Reconnecting...');
      await startStreaming(data.endpoint.ip, data.endpoint.port);
      refreshUsage({ silent: true }).catch(() => {});
    } else {
      setCurrentPod(null);
    }
  } catch (_) {}
})();

