(() => {
  if (!isTargetPage()) {
    return;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._url = url;
    this._method = method;
    return originalOpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._url && this._url.includes('/codingSubmit')) {
      this._requestBody = body;

      this.addEventListener('load', function () {
        try {
          const response = JSON.parse(this.responseText);

          if (response.result === true && response.code === 100) {
            const payload = extractRequestPayload(this._requestBody);
            const codeInfo = extractCodeFromEditor(payload);

            if (codeInfo) {
              chrome.runtime.sendMessage({
                type: 'SUBMIT_SUCCESS',
                data: codeInfo
              });
            }
          }
        } catch (e) {
          console.error('[GitHub Saver] 응답 파싱 오류:', e);
        }
      });
    }

    return originalSend.apply(this, [body]);
  };

  function extractRequestPayload(body) {
    try {
      if (!body) return {};
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
