const $ = (id) => document.getElementById(id);

const statusDot = $('statusDot');
const statusText = $('statusText');
const toast = $('toast');
const lastSave = $('lastSave');
const errorBox = $('errorBox');
const syncStatus = $('syncStatus');
const authBox = $('authBox');
const authCode = $('authCode');
const authUrl = $('authUrl');
const authHint = $('authHint');

let currentAuthState = {
  authStatus: '',
  authMessage: '',
  authError: '',
  deviceAuth: null,
  githubLogin: '',
  lastErrorInfo: null,
  lastSyncMessage: '',
};

let loginPollTimer = null;

function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

function setStatus(state, text) {
  statusDot.className = `status-dot${state ? ` ${state}` : ''}`;
  statusText.textContent = text;
}

function setAuthBox(deviceAuth) {
  if (!deviceAuth) {
    authBox.classList.remove('visible');
    authCode.textContent = '----';
    authUrl.textContent = '';
    authHint.textContent = 'GitHub 승인 코드 입력 대기 중';
    return;
  }

  authBox.classList.add('visible');
  authCode.textContent = deviceAuth.userCode || '----';
  authUrl.textContent = deviceAuth.verificationUri || '';
  authHint.textContent = 'GitHub에서 코드를 입력하면 연결됩니다.';
}

function startLoginPolling() {
  if (loginPollTimer) {
    return;
  }

  loginPollTimer = setInterval(async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CHECK_GITHUB_LOGIN' });
      if (result?.status && result.status !== 'pending') {
        clearLoginPolling();
      }
      if (result?.ok === false) {
        clearLoginPolling();
      }
    } catch (_) {}
  }, 5000);
}

function clearLoginPolling() {
  if (!loginPollTimer) {
    return;
  }

  clearInterval(loginPollTimer);
  loginPollTimer = null;
}

function renderAuthState(state) {
  currentAuthState = {
    ...currentAuthState,
    ...state,
  };

  const merged = currentAuthState;

  renderLastError(merged.lastErrorInfo);
  renderSyncStatus(merged.lastSyncMessage);

  if (merged.authStatus === 'connected' && merged.githubLogin) {
    clearLoginPolling();
    setStatus('connected', `${merged.githubLogin} / aivle-codemasters 연결됨`);
    setAuthBox(null);
    return;
  }

  if (merged.authStatus === 'pending') {
    startLoginPolling();
    setStatus('pending', merged.authMessage || 'GitHub 인증 진행 중');
    setAuthBox(merged.deviceAuth);
    return;
  }

  if (merged.authStatus === 'error') {
    clearLoginPolling();
    setStatus('error', merged.authMessage || 'GitHub 인증 실패');
    setAuthBox(null);
    if (merged.authError) {
      showToast(merged.authError, 'error');
    }
    return;
  }

  clearLoginPolling();
  setStatus('', 'GitHub 로그인 필요');
  setAuthBox(null);
}

async function loadState() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['lastSaveInfo']),
    chrome.storage.local.get(['authStatus', 'authMessage', 'authError', 'deviceAuth', 'githubLogin', 'lastErrorInfo', 'lastSyncMessage']),
  ]);

  if (syncData.lastSaveInfo) {
    lastSave.style.display = 'block';
    lastSave.textContent = `마지막 저장: ${syncData.lastSaveInfo}`;
  }

  renderAuthState(localData);
}

function renderLastError(lastErrorInfo) {
  if (!lastErrorInfo?.message) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
    return;
  }

  const problemTitle = lastErrorInfo.problemTitle ? `[${lastErrorInfo.problemTitle}] ` : '';
  errorBox.style.display = 'block';
  errorBox.textContent = `${problemTitle}${lastErrorInfo.message}`;
}

function renderSyncStatus(message) {
  if (!message) {
    syncStatus.style.display = 'none';
    syncStatus.textContent = '';
    return;
  }

  syncStatus.style.display = 'block';
  syncStatus.textContent = message;
}

$('btnLogin').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'GITHUB_LOGIN',
  });

  if (result?.ok) {
    renderAuthState({
      authStatus: 'pending',
      authMessage: 'GitHub 인증을 진행하세요.',
      deviceAuth: {
        userCode: result.userCode,
        verificationUri: result.verificationUri,
      },
    });
    showToast('GitHub에서 승인 코드를 입력하세요.', 'success');
  } else {
    setStatus('error', result?.error || 'GitHub 로그인 실패');
    showToast(result?.error || 'GitHub 로그인 실패', 'error');
  }
});

$('btnLogout').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'GITHUB_LOGOUT' });

  if (result?.ok) {
    renderAuthState({ authStatus: '', githubLogin: '', deviceAuth: null });
    showToast('로그아웃되었습니다.', 'success');
  } else {
    showToast(result?.error || '로그아웃 실패', 'error');
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.lastSaveInfo) {
    lastSave.style.display = 'block';
    lastSave.textContent = `마지막 저장: ${changes.lastSaveInfo.newValue}`;
  }

  if (areaName === 'local') {
    const nextState = {};
    if (changes.authStatus) nextState.authStatus = changes.authStatus.newValue;
    if (changes.authMessage) nextState.authMessage = changes.authMessage.newValue;
    if (changes.authError) nextState.authError = changes.authError.newValue;
    if (changes.deviceAuth) nextState.deviceAuth = changes.deviceAuth.newValue;
    if (changes.githubLogin) nextState.githubLogin = changes.githubLogin.newValue;
    if (changes.lastErrorInfo) nextState.lastErrorInfo = changes.lastErrorInfo.newValue;
    if (changes.lastSyncMessage) nextState.lastSyncMessage = changes.lastSyncMessage.newValue;

    if (Object.keys(nextState).length > 0) {
      renderAuthState(nextState);
    }
  }
});

window.addEventListener('unload', clearLoginPolling);

loadState().catch((error) => {
  setStatus('error', '상태를 불러오지 못했습니다');
  showToast(error.message, 'error');
});
