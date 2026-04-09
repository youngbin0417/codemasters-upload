(() => {
  if (!isTargetPage()) {
    return;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._url = url;
    this._method = method;
    return originalOpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._url && this._url.includes('/codingSubmit')) {
      this._requestBody = body;

      this.addEventListener('load', function () {
        handleSubmitResponse(this._url, this.responseText, this._requestBody);
      });
    }

    return originalSend.apply(this, [body]);
  };

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const requestBody = init?.body;
    const response = await originalFetch.apply(this, [input, init]);

    if (url && url.includes('/codingSubmit')) {
      response.clone().text()
        .then((text) => handleSubmitResponse(url, text, requestBody))
        .catch((error) => {
          console.error('[GitHub Saver] fetch 응답 파싱 오류:', error);
          reportSubmitState('submit_error', '제출 응답을 읽지 못했습니다.');
        });
    }

    return response;
  };

  function extractRequestPayload(body) {
    try {
      if (!body) return {};
      if (typeof body !== 'string') {
        return {};
      }
      const outer = JSON.parse(body);
      if (outer.param) return JSON.parse(outer.param);
      return outer;
    } catch (e) {
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
        const aceEditors = window.ace?.edit ? null : null;
        const editorEl = document.querySelector('.ace_editor');
        if (editorEl) {
          const editor = window.ace.edit(editorEl);
          code = editor.getValue();
        }
      }

      if (!code) return null;

      const problemNumber = extractProblemNumber(payload);
      const problemTitle = extractProblemTitle(payload);

      return {
        language,
        code,
        problemTitle,
        problemNumber,
        timestamp: new Date().toISOString(),
        pageUrl: window.location.href
      };
    } catch (e) {
      console.error('[GitHub Saver] 코드 추출 오류:', e);
      return null;
    }
  }

  function handleSubmitResponse(url, responseText, requestBody) {
    try {
      reportSubmitState('submit_detected', '제출 응답 감지됨');
      const response = JSON.parse(responseText);

      if (response.result === true && response.code === 100) {
        const payload = extractRequestPayload(requestBody);
        const codeInfo = extractCodeFromEditor(payload);

        if (codeInfo) {
          reportSubmitState('submit_success', `${codeInfo.problemTitle} 저장 요청 전송`);
          chrome.runtime.sendMessage({
            type: 'SUBMIT_SUCCESS',
            data: codeInfo
          });
          return;
        }

        reportSubmitState('submit_error', '제출은 감지됐지만 코드 추출에 실패했습니다.');
        chrome.runtime.sendMessage({
          type: 'SUBMIT_CAPTURE_FAILED',
          data: {
            url,
            message: '코드 추출 실패',
          }
        });
        return;
      }

      reportSubmitState('submit_ignored', '제출 응답은 감지됐지만 성공 응답이 아닙니다.');
    } catch (e) {
      console.error('[GitHub Saver] 응답 파싱 오류:', e);
      reportSubmitState('submit_error', '제출 응답 파싱에 실패했습니다.');
    }
  }

  function reportSubmitState(status, message) {
    chrome.runtime.sendMessage({
      type: 'SUBMIT_STATUS',
      data: {
        status,
        message,
        pageUrl: window.location.href,
        timestamp: new Date().toISOString(),
      }
    }).catch(() => {});
  }

  function extractProblemTitle(payload) {
    if (payload?.problemTitle) {
      return payload.problemTitle;
    }

    if (payload?.prctcExmplQitemsNm) {
      return payload.prctcExmplQitemsNm;
    }

    if (payload?.title) {
      return payload.title;
    }

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

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    const pageHeading = extractPageHeading();
    if (pageHeading) {
      return pageHeading;
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

  function extractPageHeading() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    for (const heading of headings) {
      const text = heading.textContent?.trim();
      if (text && text !== getQueryParam('eduTitle')) {
        return text;
      }
    }
    return '';
  }

  function getQueryParam(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function isTargetPage() {
    return window.location.hostname === 'educodegenius.com' &&
      window.location.pathname.startsWith('/practice/genius');
  }
})();
