(() => {
  if (!isTargetPage()) {
    return;
  }

  const LOG_PREFIX = '[GitHub Saver][content]';
  const BRIDGE_SOURCE = 'github-auto-saver-bridge';

  console.log(LOG_PREFIX, 'initialized', window.location.href);

  installBridgeListener();
  injectPageHook();

  function installBridgeListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) {
        return;
      }

      const message = event.data;
      if (!message || message.source !== BRIDGE_SOURCE) {
        return;
      }

      if (message.type === 'SUBMIT_STATUS') {
        console.log(LOG_PREFIX, 'submit state', message.data?.status, message.data?.message);
        chrome.runtime.sendMessage({
          type: 'SUBMIT_STATUS',
          data: message.data,
        }).catch(() => {});
        return;
      }

      if (message.type === 'SUBMIT_SUCCESS') {
        console.log(LOG_PREFIX, 'submit success payload received', {
          language: message.data?.language,
          problemNumber: message.data?.problemNumber,
          problemTitle: message.data?.problemTitle,
          codeLength: message.data?.code?.length || 0,
        });
        chrome.runtime.sendMessage({
          type: 'SUBMIT_SUCCESS',
          data: message.data,
        }).catch((error) => {
          console.error(LOG_PREFIX, 'failed to forward submit success', error);
        });
        return;
      }

      if (message.type === 'SUBMIT_CAPTURE_FAILED') {
        console.warn(LOG_PREFIX, 'submit capture failed', message.data);
        chrome.runtime.sendMessage({
          type: 'SUBMIT_CAPTURE_FAILED',
          data: message.data,
        }).catch(() => {});
      }
    });
  }

  function injectPageHook() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected-page.js');
    script.dataset.bridgeSource = BRIDGE_SOURCE;
    script.onload = () => {
      console.log(LOG_PREFIX, 'page hook injected');
      script.remove();
    };
    script.onerror = (error) => {
      console.error(LOG_PREFIX, 'page hook injection failed', error);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function isTargetPage() {
    return window.location.hostname === 'educodegenius.com' &&
      window.location.pathname.startsWith('/practice/genius');
  }
})();
