(function () {
  'use strict';

  var core = window.RosomahaFinanceCore;
  var root = document.querySelector('[data-rosomaha-finance]');
  if (!core || !root) {
    return;
  }

  var PROXY_URL = '/local/tools/rosomaha-finance-intake/index.php';
  var MAX_RESPONSE_CHARACTERS = 131072;
  var configNode = document.getElementById('rosomaha-finance-products');
  var form = document.getElementById('rosomaha-finance-form');
  var fieldset = document.getElementById('rosomaha-finance-fields');
  var productSelect = document.getElementById('rf-product');
  var downPaymentInput = document.getElementById('rf-down-payment');
  var termInput = document.getElementById('rf-term');
  var priceOutput = document.getElementById('rf-price-output');
  var principalOutput = document.getElementById('rf-principal-output');
  var termOutput = document.getElementById('rf-term-output');
  var submitButton = document.getElementById('rf-submit');
  var resetButton = document.getElementById('rf-reset-submission');
  var legalRetryButton = document.getElementById('rf-retry-legal');
  var statusNode = document.getElementById('rf-status');
  var privacyLink = document.getElementById('rf-privacy-link');
  var privacyTitle = document.getElementById('rf-privacy-title');
  var privacyMeta = document.getElementById('rf-privacy-meta');
  var privacyText = document.getElementById('rf-privacy-text');
  var privacyAccepted = document.getElementById('rf-privacy-accepted');
  var productConfig = null;
  var products = [];
  var legalDocument = null;
  var submissionSnapshot = null;
  var legalRequestGeneration = 0;
  var sending = false;

  function setStatus(message, type) {
    statusNode.textContent = message || '';
    statusNode.dataset.state = type || 'idle';
  }

  function setFormReady(ready) {
    fieldset.disabled = !ready;
    submitButton.disabled = !ready || sending;
  }

  function parseProductConfig() {
    var parsed = JSON.parse(configNode ? configNode.textContent : '');
    if (!parsed || parsed.contract !== 'rosomaha-finance-products/v1'
      || parsed.currency !== 'RUB'
      || parsed.price_semantics !== 'catalog_base_price'
      || !Array.isArray(parsed.products)
      || parsed.products.length === 0) {
      throw new Error('Каталог для расчёта недоступен.');
    }

    var seen = {};
    parsed.products.forEach(function (product) {
      if (!product || typeof product.id !== 'string' || !/^[a-z0-9-]+$/.test(product.id)
        || typeof product.name !== 'string' || product.name.trim() === ''
        || !Number.isInteger(product.price_rub) || product.price_rub <= 0
        || seen[product.id]) {
        throw new Error('Каталог для расчёта повреждён.');
      }
      seen[product.id] = true;
    });

    return Object.freeze(parsed);
  }

  function populateProducts() {
    productSelect.textContent = '';
    products.forEach(function (product) {
      var option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.name + ' — ' + core.formatRub(product.price_rub);
      productSelect.appendChild(option);
    });

    var prefill = core.productPrefill(window.location.search, products);
    if (prefill) {
      productSelect.value = prefill;
    }
  }

  function currentProduct() {
    return products.find(function (product) {
      return product.id === productSelect.value;
    }) || null;
  }

  function renderCalculation() {
    var product = currentProduct();
    if (!product) {
      priceOutput.textContent = '—';
      principalOutput.textContent = '—';
      return;
    }

    var down = Number(downPaymentInput.value || 0);
    if (!Number.isInteger(down) || down < 0) {
      down = 0;
    }
    if (down > product.price_rub) {
      down = product.price_rub;
      downPaymentInput.value = String(down);
    }

    downPaymentInput.max = String(product.price_rub);
    priceOutput.textContent = core.formatRub(product.price_rub);
    principalOutput.textContent = core.formatRub(core.calculatePrincipal(product.price_rub, down));
    termOutput.textContent = String(termInput.value) + ' мес.';
  }

  function sha256Hex(value) {
    if (!window.crypto || !window.crypto.subtle || typeof window.TextEncoder !== 'function') {
      return Promise.reject(new Error('Проверка документа не поддерживается браузером.'));
    }

    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function fetchJson(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;
    var requestOptions = Object.assign({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'strict-origin',
      headers: { Accept: 'application/json' }
    }, options || {});
    if (controller) {
      requestOptions.signal = controller.signal;
    }

    return window.fetch(url, requestOptions).then(function (response) {
      var contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        throw new Error('Сервис вернул неподдерживаемый формат ответа.');
      }

      return response.text().then(function (text) {
        if (text.length > MAX_RESPONSE_CHARACTERS) {
          throw new Error('Ответ сервиса слишком большой.');
        }

        var body;
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new Error('Сервис вернул повреждённый ответ.');
        }

        return { response: response, body: body };
      });
    }).finally(function () {
      if (timer) {
        window.clearTimeout(timer);
      }
    });
  }

  function renderLegal(document) {
    privacyTitle.textContent = document.title;
    privacyMeta.textContent = 'Версия: ' + document.version;
    privacyText.textContent = document.text;
    privacyLink.removeAttribute('aria-disabled');
  }

  function clearLegal() {
    legalDocument = null;
    privacyAccepted.checked = false;
    privacyTitle.textContent = 'Документ загружается';
    privacyMeta.textContent = '';
    privacyText.textContent = '';
    privacyLink.setAttribute('aria-disabled', 'true');
  }

  function loadLegalDocument() {
    var generation = ++legalRequestGeneration;
    clearLegal();
    legalRetryButton.hidden = true;
    setFormReady(false);
    setStatus('Проверяем действующую версию согласия…', 'working');

    return fetchJson(PROXY_URL, { method: 'GET' })
      .then(function (result) {
        if (!result.response.ok) {
          throw new Error('Действующий документ о согласии недоступен.');
        }
        var document = core.validateLegalMetadata(result.body);
        return sha256Hex(document.text).then(function (actualHash) {
          if (actualHash !== document.sha256) {
            throw new Error('Не удалось подтвердить целостность документа о согласии.');
          }
          return document;
        });
      })
      .then(function (document) {
        if (generation !== legalRequestGeneration || submissionSnapshot) {
          return;
        }
        legalDocument = document;
        renderLegal(document);
        setFormReady(true);
        setStatus('', 'idle');
      })
      .catch(function () {
        if (generation !== legalRequestGeneration) {
          return;
        }
        clearLegal();
        legalRetryButton.hidden = false;
        setFormReady(false);
        setStatus('Форма закрыта: не удалось получить и проверить действующий документ о согласии.', 'error');
      });
  }

  function randomSubmissionPart() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }

    throw new Error('Безопасный генератор идентификатора недоступен.');
  }

  function buildSnapshot() {
    return core.buildSubmissionSnapshot({
      now: Date.now(),
      randomValue: randomSubmissionPart(),
      legal: legalDocument,
      product: currentProduct(),
      name: document.getElementById('rf-name').value,
      phone: document.getElementById('rf-phone').value,
      email: document.getElementById('rf-email').value,
      city: document.getElementById('rf-city').value,
      applicantType: document.getElementById('rf-applicant').value,
      financingType: document.getElementById('rf-financing-type').value,
      downPayment: downPaymentInput.value || '0',
      termMonths: termInput.value,
      comment: document.getElementById('rf-comment').value,
      privacyAccepted: privacyAccepted.checked,
      attribution: core.collectAttribution(window.location.search),
      honeypot: document.getElementById('rf-company-website').value
    });
  }

  function lockSnapshot() {
    fieldset.disabled = true;
    resetButton.hidden = false;
    submitButton.textContent = 'Повторить ту же отправку';
  }

  function emitHardConversion(response) {
    var detail = Object.freeze({
      leadSubmissionId: response.lead_submission_id,
      receiptId: response.receipt_id,
      created: response.created,
      deduplicated: response.deduplicated
    });

    try {
      window.dispatchEvent(new CustomEvent('rosomaha:finance-hard-conversion', { detail: detail }));
    } catch (error) {
      // Analytics integration must never turn a confirmed CRM receipt into a failed form state.
    }
  }

  function submitSnapshot() {
    if (!submissionSnapshot || sending) {
      return;
    }

    if (new TextEncoder().encode(submissionSnapshot.bodyJson).byteLength > 16384) {
      setStatus('Запрос слишком большой. Измените данные и повторите отправку.', 'error');
      return;
    }

    sending = true;
    submitButton.disabled = true;
    setStatus('Отправляем заявку…', 'working');

    fetchJson(PROXY_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Lead-Submission-ID': submissionSnapshot.id
      },
      body: submissionSnapshot.bodyJson
    }).then(function (result) {
      if ((result.response.status !== 200 && result.response.status !== 201)
        || !core.isHardConversionResponse(result.body, submissionSnapshot.id)) {
        var publicMessage = result.body && typeof result.body.message === 'string'
          ? result.body.message
          : 'Не удалось подтвердить приём заявки.';
        throw new Error(publicMessage);
      }

      emitHardConversion(result.body);
      submitButton.hidden = true;
      resetButton.hidden = true;
      setStatus('Заявка принята. Мы свяжемся с вами, чтобы уточнить задачу и передать её на отдельное рассмотрение.', 'success');
    }).catch(function (error) {
      setStatus(error && error.message
        ? error.message + ' Повторная кнопка отправит неизменённую заявку.'
        : 'Не удалось отправить заявку. Повторная кнопка отправит неизменённую заявку.', 'error');
    }).finally(function () {
      sending = false;
      if (!submitButton.hidden) {
        submitButton.disabled = false;
      }
    });
  }

  function resetSubmission() {
    if (sending) {
      return;
    }

    submissionSnapshot = null;
    resetButton.hidden = true;
    submitButton.hidden = false;
    submitButton.textContent = 'Отправить заявку';
    setStatus('', 'idle');
    loadLegalDocument();
  }

  productSelect.addEventListener('change', renderCalculation);
  downPaymentInput.addEventListener('input', renderCalculation);
  termInput.addEventListener('change', renderCalculation);
  legalRetryButton.addEventListener('click', loadLegalDocument);
  resetButton.addEventListener('click', resetSubmission);
  privacyLink.addEventListener('click', function (event) {
    if (!legalDocument) {
      event.preventDefault();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) {
      return;
    }

    if (!submissionSnapshot) {
      if (!legalDocument) {
        setStatus('Действующий документ о согласии не подтверждён.', 'error');
        return;
      }
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      try {
        submissionSnapshot = buildSnapshot();
      } catch (error) {
        setStatus(error && error.message ? error.message : 'Проверьте заполненные поля.', 'error');
        return;
      }
      lockSnapshot();
    }

    submitSnapshot();
  });

  try {
    productConfig = parseProductConfig();
    products = productConfig.products.slice();
    populateProducts();
    renderCalculation();
    loadLegalDocument();
  } catch (error) {
    setFormReady(false);
    legalRetryButton.hidden = true;
    setStatus(error && error.message ? error.message : 'Каталог для расчёта недоступен.', 'error');
  }
}());
