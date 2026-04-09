const REPO_NAME = 'aivle-codemasters';
const DEFAULT_BRANCH = 'main';
const API_VERSION = '2022-11-28';
const DEVICE_SCOPES = 'repo read:user';
const GITHUB_CLIENT_ID = "test_client_id";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUBMIT_SUCCESS') {
    handleSubmitSuccess(message.data)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('[GitHub Saver] 자동 저장 실패:', error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'GITHUB_LOGIN') {
    startGitHubLogin()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'GITHUB_LOGOUT') {
    logoutGitHub()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHECK_GITHUB_LOGIN') {
    processPendingGitHubLogin()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'github-login-poll') {
    processPendingGitHubLogin().catch((error) => {
      console.error('[GitHub Saver] 로그인 폴링 실패:', error);
    });
  }
});

async function startGitHubLogin() {
  const resolvedClientId = GITHUB_CLIENT_ID;
  if (!resolvedClientId) {
    throw new Error('GitHub Client ID가 설정되지 않았습니다.');
  }

  await setLocalStorage({
    authStatus: 'pending',
    authMessage: 'GitHub 인증을 진행하세요.',
    authError: null,
  });

  let device;
  try {
    device = await requestDeviceCode(resolvedClientId);
  } catch (error) {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: 'GitHub 인증 시작 실패',
      authError: error.message,
      deviceAuth: null,
    });
    throw error;
  }

  await setLocalStorage({
    authStatus: 'pending',
    authMessage: 'GitHub에서 승인 코드를 입력해주세요.',
    authError: null,
    deviceAuth: {
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      deviceCode: device.device_code,
      clientId: resolvedClientId,
      intervalMs: device.interval * 1000,
      expiresAt: Date.now() + device.expires_in * 1000,
    },
  });

  await chrome.alarms.create('github-login-poll', { periodInMinutes: 1 });

  return {
    ok: true,
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresIn: device.expires_in,
    interval: device.interval,
  };
}

async function logoutGitHub() {
  await chrome.alarms.clear('github-login-poll');
  await chrome.storage.local.remove([
    'accessToken',
    'githubLogin',
    'repoFullName',
    'defaultBranch',
    'authStatus',
    'authMessage',
    'authError',
    'deviceAuth',
  ]);
  await setLocalStorage({
    authStatus: 'idle',
    authMessage: 'GitHub 로그아웃 완료',
    authError: null,
    deviceAuth: null,
  });
  showNotification('GitHub 연결 해제', '저장된 인증 정보를 삭제했습니다.');
}

async function handleSubmitSuccess(data) {
  const token = await getAccessToken();

  if (!token) {
    showNotification('⚙️ GitHub 로그인 필요', '먼저 GitHub에 로그인한 뒤 다시 제출해주세요.');
    throw new Error('GitHub access token이 없습니다.');
  }

  const repo = await resolveRepoContext(token);

  try {
    await saveToGitHub(token, repo, data);
    const saveInfo = `${data.problemTitle} / ${data.language} / ${formatSavedAt(data.timestamp)}`;
    await chrome.storage.sync.set({ lastSaveInfo: saveInfo });
    showNotification('✅ GitHub 저장 완료', `${data.problemTitle} (${data.language}) 이(가) 저장되었습니다.`);
  } catch (error) {
    if (error.status === 401) {
      await clearAuthState('GitHub 인증이 만료되었습니다. 다시 로그인해주세요.');
    }
    throw error;
  }
}

async function saveToGitHub(token, repo, data) {
  const { language, code, problemTitle, problemNumber } = data;
  const ext = language === 'PYTHON' ? 'py' : language === 'JAVA' ? 'java' : 'txt';
  const folder = language === 'PYTHON' ? 'python' : language === 'JAVA' ? 'java' : 'other';
  const filePath = `${folder}/${buildProblemFilename(problemNumber, problemTitle)}.${ext}`;
  const branch = repo.defaultBranch || DEFAULT_BRANCH;

  const header = buildFileHeader(language, problemTitle, problemNumber, data.timestamp);
  const fullContent = `${header}\n${code}`;
  const encoded = encodeBase64Utf8(fullContent);
  const apiUrl = `https://api.github.com/repos/${repo.fullName}/contents/${filePath}`;

  const existingSha = await getFileSha(apiUrl, token);
  const body = {
    message: `Solve: ${problemTitle} (${language})`,
    content: encoded,
    branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const res = await githubFetch(apiUrl, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await githubError(res);
  }

  return res.json();
}

async function getFileSha(apiUrl, token) {
  const res = await githubFetch(apiUrl, token);
  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    throw await githubError(res);
  }

  const data = await res.json();
  return data.sha || null;
}

async function resolveAuthenticatedProfile(token) {
  const user = await githubJson('https://api.github.com/user', token);
  if (!user.login) {
    throw new Error('GitHub 사용자 정보를 가져오지 못했습니다.');
  }

  const fullName = `${user.login}/${REPO_NAME}`;
  return {
    login: user.login,
    repoFullName: fullName,
    defaultBranch: user.default_branch || DEFAULT_BRANCH,
  };
}

async function resolveRepoContext(token) {
  const profile = await resolveAuthenticatedProfile(token);
  const repoUrl = `https://api.github.com/repos/${profile.repoFullName}`;

  try {
    const repo = await githubJson(repoUrl, token);
    return {
      fullName: profile.repoFullName,
      defaultBranch: repo.default_branch || DEFAULT_BRANCH,
    };
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const created = await githubJson('https://api.github.com/user/repos', token, {
    method: 'POST',
    body: JSON.stringify({
      name: REPO_NAME,
      private: true,
      auto_init: true,
      description: 'Auto-saved coding solutions from the Chrome extension',
    }),
  });

  return {
    fullName: `${profile.login}/${REPO_NAME}`,
    defaultBranch: created.default_branch || DEFAULT_BRANCH,
  };
}

async function requestDeviceCode(clientId) {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: DEVICE_SCOPES,
    }),
  });

  if (!res.ok) {
    throw await githubError(res);
  }

  const data = await res.json();
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('GitHub device flow 응답이 올바르지 않습니다.');
  }

  return data;
}

async function clearAuthState(message) {
  await chrome.alarms.clear('github-login-poll');
  await chrome.storage.local.remove([
    'accessToken',
    'githubLogin',
    'repoFullName',
    'defaultBranch',
    'authStatus',
    'authMessage',
    'authError',
    'deviceAuth',
  ]);

  if (message) {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: message,
      authError: message,
    });
  }
}

async function processPendingGitHubLogin() {
  const { deviceAuth, accessToken } = await chrome.storage.local.get(['deviceAuth', 'accessToken']);

  if (!deviceAuth || !deviceAuth.clientId || !deviceAuth.deviceCode) {
    await chrome.alarms.clear('github-login-poll');
    return { ok: true, status: 'idle' };
  }

  if (accessToken) {
    await chrome.alarms.clear('github-login-poll');
    return { ok: true, status: 'connected' };
  }

  if (deviceAuth.expiresAt && Date.now() >= deviceAuth.expiresAt) {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: 'GitHub 인증 시간이 만료되었습니다.',
      authError: 'GitHub 인증 시간이 만료되었습니다. 다시 시도해주세요.',
      deviceAuth: null,
    });
    await chrome.alarms.clear('github-login-poll');
    showNotification('❌ GitHub 로그인 실패', '인증 시간이 만료되었습니다. 다시 시도해주세요.');
    return { ok: false, status: 'expired', error: 'GitHub 인증 시간이 만료되었습니다. 다시 시도해주세요.' };
  }

  const result = await pollDeviceOnce(deviceAuth.clientId, deviceAuth.deviceCode);

  if (result.status === 'authorized') {
    await completeGitHubLogin(result.accessToken);
    await chrome.alarms.clear('github-login-poll');
    return { ok: true, status: 'authorized' };
  }

  if (result.status === 'denied') {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: 'GitHub 인증이 취소되었습니다.',
      authError: 'GitHub 인증이 취소되었습니다.',
      deviceAuth: null,
    });
    await chrome.alarms.clear('github-login-poll');
    showNotification('❌ GitHub 로그인 실패', 'GitHub 인증이 취소되었습니다.');
    return { ok: false, status: 'denied', error: 'GitHub 인증이 취소되었습니다.' };
  }

  if (result.status === 'expired') {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: 'GitHub 인증 시간이 만료되었습니다.',
      authError: 'GitHub 인증 시간이 만료되었습니다. 다시 시도해주세요.',
      deviceAuth: null,
    });
    await chrome.alarms.clear('github-login-poll');
    showNotification('❌ GitHub 로그인 실패', '인증 시간이 만료되었습니다. 다시 시도해주세요.');
    return { ok: false, status: 'expired', error: 'GitHub 인증 시간이 만료되었습니다. 다시 시도해주세요.' };
  }

  if (result.status === 'error') {
    await setLocalStorage({
      authStatus: 'error',
      authMessage: 'GitHub 로그인 실패',
      authError: result.error,
      deviceAuth: null,
    });
    await chrome.alarms.clear('github-login-poll');
    showNotification('❌ GitHub 로그인 실패', result.error);
    return { ok: false, status: 'error', error: result.error };
  }

  return { ok: true, status: 'pending' };
}

async function githubJson(url, token, options = {}) {
  const res = await githubFetch(url, token, options);
  if (!res.ok) {
    throw await githubError(res);
  }
  return res.status === 204 ? null : res.json();
}

async function githubFetch(url, token, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    ...(options.headers || {}),
  };

  const init = {
    ...options,
    headers,
  };

  return fetch(url, init);
}

async function githubError(res) {
  const data = await res.json().catch(() => ({}));
  const error = new Error(data.message || `HTTP ${res.status}`);
  error.status = res.status;
  error.details = data;
  return error;
}

async function completeGitHubLogin(token) {
  const profile = await resolveAuthenticatedProfile(token);
  await setLocalStorage({
    accessToken: token,
    githubLogin: profile.login,
    repoFullName: profile.repoFullName,
    defaultBranch: profile.defaultBranch,
    authStatus: 'connected',
    authMessage: `${profile.login} 로그인 완료`,
    authError: null,
    deviceAuth: null,
  });
  showNotification('✅ GitHub 로그인 완료', `${profile.login} 계정으로 연결되었습니다.`);
}

async function getAccessToken() {
  const { accessToken } = await chrome.storage.local.get(['accessToken']);
  return accessToken || null;
}

async function pollDeviceOnce(clientId, deviceCode) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok && data.access_token) {
    return { status: 'authorized', accessToken: data.access_token };
  }

  if (data.error === 'authorization_pending') {
    return { status: 'pending' };
  }

  if (data.error === 'slow_down') {
    return { status: 'pending' };
  }

  if (data.error === 'access_denied') {
    return { status: 'denied' };
  }

  if (data.error === 'expired_token') {
    return { status: 'expired' };
  }

  return {
    status: 'error',
    error: data.error_description || data.error || 'GitHub 로그인에 실패했습니다.',
  };
}

async function setLocalStorage(values) {
  await chrome.storage.local.set(values);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildFileHeader(language, title, number, timestamp) {
  const date = new Date(timestamp).toLocaleDateString('ko-KR');
  if (language === 'PYTHON') {
    return `# Problem: ${title}\n# Number: ${number}\n# Solved: ${date}\n# Language: Python\n`;
  }

  if (language === 'JAVA') {
    return `// Problem: ${title}\n// Number: ${number}\n// Solved: ${date}\n// Language: Java\n`;
  }

  return `// Problem: ${title} | Number: ${number} | Date: ${date}\n`;
}

function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function buildProblemFilename(problemNumber, problemTitle) {
  const safeNumber = sanitizeFilename(String(problemNumber || '').trim());
  const safeTitle = sanitizeFilename(problemTitle || '문제');

  if (safeNumber) {
    return `${safeNumber}_${safeTitle}`;
  }

  return safeTitle;
}

function formatSavedAt(timestamp) {
  return new Date(timestamp).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
  });
}
