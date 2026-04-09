(() => {
  const LOG_PREFIX = '[GitHub Saver][page]';
  const currentScript = document.currentScript;
  const bridgeSource = currentScript?.dataset.bridgeSource || 'github-auto-saver-bridge';

  console.log(LOG_PREFIX, 'hook initialized', window.location.href);

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._githubSaverUrl = url;
    return originalOpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._githubSaverUrl && String(this._githubSaverUrl).includes('/codingSubmit')) {
      console.log(LOG_PREFIX, 'XHR submit detected', this._githubSaverUrl);
      this._githubSaverRequestBody = body;
      this.addEventListener('load', function() {
        console.log(LOG_PREFIX, 'XHR submit load', this._githubSaverUrl, this.status);
        handleSubmitResponse(this._githubSaverUrl, this.responseText, this._githubSaverRequestBody);
      });
    }

    return originalSend.apply(this, [body]);
  };

  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const requestBody = init?.body;
    const response = await originalFetch.apply(this, [input, init]);

    if (url && String(url).includes('/codingSubmit')) {
      console.log(LOG_PREFIX, 'fetch submit detected', url, response.status);
      response.clone().text()
        .then((text) => handleSubmitResponse(url, text, requestBody))
        .catch((error) => {
          console.error(LOG_PREFIX, 'fetch response parse failed', error);
          reportSubmitState('submit_error', '제출 응답을 읽지 못했습니다.');
        });
    }

    return response;
  };

  function handleSubmitResponse(url, responseText, requestBody) {
    try {
      console.log(LOG_PREFIX, 'submit response received', url);
      reportSubmitState('submit_detected', '제출 응답 감지됨');
      const response = JSON.parse(responseText);
      console.log(LOG_PREFIX, 'submit response parsed', response);

      if (response.result === true && String(response.code) === '100') {
        const payload = extractRequestPayload(requestBody);
        console.log(LOG_PREFIX, 'submit payload parsed', payload);
        const codeInfo = extractCodeFromEditor(payload);

        if (codeInfo) {
          console.log(LOG_PREFIX, 'code extracted', {
            language: codeInfo.language,
            problemNumber: codeInfo.problemNumber,
            problemTitle: codeInfo.problemTitle,
            codeLength: codeInfo.code.length,
          });
          reportSubmitState('submit_success', `${codeInfo.problemTitle} 저장 요청 전송`);
          bridgeMessage('SUBMIT_SUCCESS', codeInfo);
          return;
        }

        console.warn(LOG_PREFIX, 'submit detected but code extraction failed');
        reportSubmitState('submit_error', '제출은 감지됐지만 코드 추출에 실패했습니다.');
        bridgeMessage('SUBMIT_CAPTURE_FAILED', {
          url,
          message: '코드 추출 실패',
        });
        return;
      }

      console.warn(LOG_PREFIX, 'submit response was not success', response);
      reportSubmitState('submit_ignored', '제출 응답은 감지됐지만 성공 응답이 아닙니다.');
    } catch (error) {
      console.error(LOG_PREFIX, 'submit response parse failed', error, responseText);
      reportSubmitState('submit_error', '제출 응답 파싱에 실패했습니다.');
    }
  }

  function extractRequestPayload(body) {
    try {
      if (!body) return {};
      if (typeof body !== 'string') {
        console.log(LOG_PREFIX, 'request body is not string', typeof body);
        return {};
      }
      const outer = JSON.parse(body);
      if (outer.param) return JSON.parse(outer.param);
      return outer;
    } catch (_) {
      return {};
    }
  }

  function extractCodeFromEditor(payload) {
    try {
      const language = payload.language || 'UNKNOWN';

      let code = '';
      if (language === 'PYTHON' && window.document.editortypes?.PYTHON) {
        code = window.document.editortypes.PYTHON.getValue();
      } else if (language === 'JAVA' && window.document.editortypes?.JAVA) {
        code = window.document.editortypes.JAVA.getValue();
      } else {
        const editorEl = document.querySelector('.ace_editor');
        if (editorEl && window.ace?.edit) {
          const editor = window.ace.edit(editorEl);
          code = editor.getValue();
        }
      }

      if (!code) return null;

        return {
          language,
          code,
          problemTitle: extractProblemTitle(payload),
          problemNumber: extractProblemNumber(payload),
          problemText: extractProblemText(payload),
          timestamp: new Date().toISOString(),
          pageUrl: window.location.href,
        };
    } catch (error) {
      console.error(LOG_PREFIX, 'code extraction failed', error);
      return null;
    }
  }

  function extractProblemTitle(payload) {
    if (payload?.problemTitle) return payload.problemTitle;
    if (payload?.prctcExmplQitemsNm) return payload.prctcExmplQitemsNm;
    if (payload?.title) return payload.title;

    const selectors = [
      '[data-problem-title]',
      '.problem-title',
      '.qitem-title',
      '.question-title',
      '.qitem_tit',
      '.question_tit',
      'h1.title',
      'h2.title',
      '.prctc-title',
      '.problem_title',
      '[class*="question"] h1',
      '[class*="problem"] h1',
      '.content-title',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const eduTitle = getQueryParam('eduTitle');
    for (const heading of headings) {
      const text = heading.textContent?.trim();
      if (text && text !== eduTitle) {
        return text;
      }
    }

    return document.title.trim() || '문제';
  }

  function extractProblemNumber(payload) {
    return payload?.prctcExmplQitemsSn ||
      payload?.problemNumber ||
      getQueryParam('prctcExmplQitemsSn') ||
      getQueryParam('num') ||
      '';
  }

  function extractProblemText(payload) {
    const problemBody = extractTextWithoutMedia(document.querySelector('.qitem_cn'));
    const inputDescription = extractTextWithoutMedia(document.querySelector('article .txt_box .inpt_cn'));
    const outputDescription = extractTextWithoutMedia(document.querySelector('article .txt_box .otpt_cn'));

    return {
      body: problemBody,
      input: inputDescription,
      output: outputDescription,
    };
  }

  function getQueryParam(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function normalizeText(text) {
    return text
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractTextWithoutMedia(root) {
    if (!root) {
      return '';
    }

    const clone = root.cloneNode(true);
    clone.querySelectorAll('img, picture, source, figure, svg, canvas, video, audio, iframe, script, style, noscript').forEach((node) => {
      node.remove();
    });

    return normalizeText(clone.innerText || '');
  }

  function reportSubmitState(status, message) {
    bridgeMessage('SUBMIT_STATUS', {
      status,
      message,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString(),
    });
  }

  function bridgeMessage(type, data) {
    window.postMessage({
      source: bridgeSource,
      type,
      data,
    }, window.location.origin);
  }
})();
