(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.RosomahaFinanceCore = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APPLICANT_TYPES = ['individual', 'sole_proprietor', 'company'];
  var FINANCING_TYPES = ['credit', 'leasing', 'installment', 'unsure'];
  var ATTRIBUTION_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'yclid',
    'ymclid',
    'gclid',
    'fbclid',
    'vk_click_id'
  ];

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }

    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });

    return Object.freeze(value);
  }

  function cleanText(value, maximum, required) {
    var text = String(value == null ? '' : value).trim();
    assert(!required || text.length > 0, 'Заполните обязательные поля.');
    assert(text.length <= maximum, 'Одно из полей заполнено слишком длинным текстом.');
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), 'Поле содержит недопустимые символы.');

    return text;
  }

  function integer(value, name) {
    var number = Number(value);
    assert(Number.isInteger(number), name + ' должно быть целым числом.');

    return number;
  }

  function calculatePrincipal(price, downPayment) {
    var normalizedPrice = integer(price, 'Цена');
    var normalizedDown = integer(downPayment, 'Первоначальный взнос');
    assert(normalizedPrice > 0, 'Цена должна быть больше нуля.');
    assert(normalizedDown >= 0 && normalizedDown <= normalizedPrice, 'Первоначальный взнос не может превышать цену.');

    return normalizedPrice - normalizedDown;
  }

  function formatRub(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';
  }

  function normalizeRussianPhone(value) {
    var raw = cleanText(value, 40, true);
    assert(/^\+?[0-9()\-\s]+$/.test(raw), 'Введите российский номер телефона.');
    var digits = raw.replace(/\D/g, '');

    if (digits.length === 10) {
      digits = '7' + digits;
    } else if (digits.length === 11 && digits.charAt(0) === '8') {
      digits = '7' + digits.slice(1);
    }

    assert(/^7[0-9]{10}$/.test(digits), 'Введите российский номер телефона.');

    return digits;
  }

  function createSubmissionId(now, randomValue) {
    var timestamp = integer(now, 'Время отправки');
    var suffix = String(randomValue == null ? '' : randomValue)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
    assert(timestamp >= 1000000000, 'Не удалось создать идентификатор отправки.');
    assert(suffix.length >= 6 && /[a-z0-9]$/.test(suffix), 'Не удалось создать идентификатор отправки.');

    return 'rosomaha-' + timestamp + '-' + suffix;
  }

  function validateLegalMetadata(payload) {
    var document = payload && payload.status === 'ok' ? payload.privacy_document : null;
    assert(document && typeof document === 'object' && !Array.isArray(document), 'Документ о согласии недоступен.');
    assert(document.kind === 'personal_data_processing', 'Получен неподходящий документ о согласии.');
    assert(typeof document.version === 'string' && document.version.length > 0 && document.version.length <= 100, 'Версия документа недоступна.');
    assert(typeof document.title === 'string' && document.title.trim().length > 0 && document.title.length <= 500, 'Название документа недоступно.');
    assert(typeof document.text === 'string' && document.text.trim().length > 0 && document.text.length <= 100000, 'Текст документа недоступен.');
    assert(typeof document.sha256 === 'string' && /^[a-f0-9]{64}$/.test(document.sha256), 'Контрольная сумма документа недоступна.');

    return deepFreeze({
      kind: document.kind,
      version: document.version,
      title: document.title,
      text: document.text,
      sha256: document.sha256
    });
  }

  function collectAttribution(search) {
    var result = {};
    var params = new URLSearchParams(search || '');

    ATTRIBUTION_KEYS.forEach(function (key) {
      var value = params.get(key);
      if (value != null) {
        value = value.trim();
      }
      if (value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) {
        result[key] = value;
      }
    });

    return deepFreeze(result);
  }

  function findProduct(products, productId) {
    return products.find(function (product) {
      return product.id === productId;
    });
  }

  function productPrefill(search, products) {
    var requested = new URLSearchParams(search || '').get('product');
    if (!requested) {
      return null;
    }

    var product = findProduct(products, requested);

    return product ? product.id : null;
  }

  function buildSubmissionSnapshot(values) {
    assert(values && typeof values === 'object', 'Данные формы недоступны.');
    assert(values.legal && typeof values.legal === 'object', 'Документ о согласии недоступен.');
    assert(values.product && typeof values.product === 'object', 'Выберите модель.');
    assert(typeof values.product.name === 'string' && values.product.name.trim() !== '', 'Выберите модель.');

    var submissionId = createSubmissionId(values.now, values.randomValue);
    var saleAmount = integer(values.product.price_rub, 'Цена');
    var downPayment = integer(values.downPayment, 'Первоначальный взнос');
    calculatePrincipal(saleAmount, downPayment);
    var term = integer(values.termMonths, 'Срок');
    assert(term >= 1 && term <= 120, 'Срок должен быть от 1 до 120 месяцев.');
    assert(APPLICANT_TYPES.indexOf(values.applicantType) !== -1, 'Выберите тип заявителя.');
    assert(FINANCING_TYPES.indexOf(values.financingType) !== -1, 'Выберите способ финансирования.');
    assert(values.privacyAccepted === true, 'Подтвердите согласие на обработку данных.');

    var body = {
      lead_submission_id: submissionId,
      source_site: 'rosomaha-rus.ru',
      source_form: 'credit_calculator',
      source_path: '/finansirovanie/',
      name: cleanText(values.name, 255, true),
      phone: normalizeRussianPhone(values.phone),
      product_name: cleanText(values.product.name, 255, true),
      applicant_type: values.applicantType,
      financing_type: values.financingType,
      sale_amount: saleAmount,
      down_payment_amount: downPayment,
      desired_term_months: term,
      privacy_accepted: true,
      privacy_version: cleanText(values.legal.version, 100, true),
      consent_source: 'rosomaha_rus_credit',
      honeypot: cleanText(values.honeypot, 0, false)
    };

    var optional = [
      ['email', values.email, 255],
      ['city', values.city, 255],
      ['comment', values.comment, 2000]
    ];
    optional.forEach(function (entry) {
      var text = cleanText(entry[1], entry[2], false);
      if (text !== '') {
        body[entry[0]] = text;
      }
    });

    if (values.attribution && Object.keys(values.attribution).length > 0) {
      var attribution = {};
      ATTRIBUTION_KEYS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(values.attribution, key)) {
          attribution[key] = cleanText(values.attribution[key], 255, true);
        }
      });
      if (Object.keys(attribution).length > 0) {
        body.attribution = attribution;
      }
    }

    deepFreeze(body);
    var snapshot = {
      id: submissionId,
      body: body,
      bodyJson: JSON.stringify(body)
    };

    return deepFreeze(snapshot);
  }

  function isHardConversionResponse(response, expectedSubmissionId) {
    return Boolean(
      response
      && response.status === 'ok'
      && typeof response.lead_submission_id === 'string'
      && response.lead_submission_id === expectedSubmissionId
      && typeof response.receipt_id === 'string'
      && /^fin_[a-f0-9]{32}$/.test(response.receipt_id)
      && typeof response.created === 'boolean'
      && typeof response.deduplicated === 'boolean'
      && response.created !== response.deduplicated
    );
  }

  return Object.freeze({
    APPLICANT_TYPES: Object.freeze(APPLICANT_TYPES.slice()),
    FINANCING_TYPES: Object.freeze(FINANCING_TYPES.slice()),
    ATTRIBUTION_KEYS: Object.freeze(ATTRIBUTION_KEYS.slice()),
    calculatePrincipal: calculatePrincipal,
    formatRub: formatRub,
    normalizeRussianPhone: normalizeRussianPhone,
    createSubmissionId: createSubmissionId,
    validateLegalMetadata: validateLegalMetadata,
    collectAttribution: collectAttribution,
    productPrefill: productPrefill,
    buildSubmissionSnapshot: buildSubmissionSnapshot,
    isHardConversionResponse: isHardConversionResponse
  });
}));
