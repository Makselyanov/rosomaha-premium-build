<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    http_response_code(404);
    exit;
}

final class RosomahaCrmBridge
{
    private const ENDPOINT = 'https://rosomaha.centrlp.ru/api/webhooks/site-form';
    private const METRIKA_ENDPOINT = 'https://mc.yandex.ru/collect';
    private const METRIKA_CONFIG_PATH = '/home/b/berkutm4/.config/rosomaha/metrika.json';
    private const METRIKA_SOFT_ACTION = 'lead_submit';
    private const METRIKA_HARD_ACTION = 'crm_conversion';
    private const SOURCE = 'rosomaha-rus.ru';
    private const AGENT_NAME = 'RosomahaCrmBridge::retryAgent();';
    private const AGENT_INTERVAL = 300;
    private const MAX_COMMENT_LENGTH = 2400;
    private const MAX_FIELD_LENGTH = 900;

    private static bool $registered = false;
    private static bool $processing = false;

    public static function register(): void
    {
        if (self::$registered || !function_exists('AddEventHandler')) {
            return;
        }

        AddEventHandler('form', 'onAfterResultAdd', [self::class, 'onAfterResultAdd']);
        self::$registered = true;
        self::maybeRetryOnHit();
    }

    /**
     * The counter id is the only Metrika configuration value that may be
     * rendered into the public page. The Measurement Protocol token remains
     * private to this class and a mode-0600 file outside the document root.
     */
    public static function metrikaCounterId(): ?int
    {
        $config = self::metrikaConfig();

        return $config === null ? null : $config['counter_id'];
    }

    public static function install(): array
    {
        self::ensureStorage();

        $agentId = null;
        if (class_exists('CAgent')) {
            $agents = CAgent::GetList(['ID' => 'ASC'], ['NAME' => self::AGENT_NAME]);
            if ($agent = $agents->Fetch()) {
                $agentId = (int) $agent['ID'];
                CAgent::Update($agentId, [
                    'ACTIVE' => 'Y',
                    'AGENT_INTERVAL' => self::AGENT_INTERVAL,
                ]);
            } else {
                $agentId = (int) CAgent::AddAgent(
                    self::AGENT_NAME,
                    'main',
                    'N',
                    self::AGENT_INTERVAL,
                    '',
                    'Y',
                    date('d.m.Y H:i:s', time() + 60),
                    100
                );
            }
        }

        return [
            'installed' => is_dir(self::storageDirectory()),
            'agent_id' => $agentId,
            'status' => self::status(),
        ];
    }

    public static function onAfterResultAdd($webFormId, $resultId): void
    {
        $webFormId = (int) $webFormId;
        $resultId = (int) $resultId;
        if ($webFormId <= 0 || $resultId <= 0) {
            return;
        }

        try {
            $context = self::captureContext();
            if (!self::enqueueResult($webFormId, $resultId, $context)) {
                return;
            }

            self::flushPending(1, true, $webFormId, $resultId);
        } catch (Throwable $exception) {
            self::log('enqueue_exception', $webFormId, $resultId, [
                'exception' => get_class($exception),
            ]);
        }
    }

    public static function retryAgent(): string
    {
        try {
            self::flushPending(5);
        } catch (Throwable $exception) {
            self::log('agent_exception', 0, 0, [
                'exception' => get_class($exception),
            ]);
        }

        return self::AGENT_NAME;
    }

    public static function enqueueExistingResult(int $webFormId, int $resultId, array $context = []): bool
    {
        return self::enqueueResult($webFormId, $resultId, $context);
    }

    public static function flushPending(int $limit = 20, bool $force = false, ?int $onlyFormId = null, ?int $onlyResultId = null): array
    {
        self::validatePendingTarget($onlyFormId, $onlyResultId);
        if (self::$processing) {
            return ['processed' => 0, 'delivered' => 0, 'failed' => 0, 'locked' => true];
        }

        self::ensureStorage();
        $lock = fopen(self::storageDirectory() . '/process.lock', 'c+');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            if (is_resource($lock)) {
                fclose($lock);
            }

            return ['processed' => 0, 'delivered' => 0, 'failed' => 0, 'locked' => true];
        }

        self::$processing = true;
        $summary = ['processed' => 0, 'delivered' => 0, 'failed' => 0, 'locked' => false];

        try {
            $files = self::selectPendingFiles(glob(self::storageDirectory() . '/pending-*.json') ?: [], $onlyFormId, $onlyResultId);
            $now = time();

            foreach ($files as $path) {
                if ($summary['processed'] >= max(1, $limit)) {
                    break;
                }

                $record = self::readRecord($path);
                if ($record === null) {
                    self::quarantineRecord($path);
                    $summary['failed']++;
                    continue;
                }

                $completedPath = self::completedRecordPath(
                    (int) $record['form_id'],
                    (int) $record['result_id']
                );
                if (is_file($completedPath)) {
                    @unlink($path);
                    $summary['delivered']++;
                    continue;
                }

                if (!$force && (int) ($record['next_attempt_at'] ?? 0) > $now) {
                    continue;
                }

                $summary['processed']++;
                $formId = (int) $record['form_id'];
                $resultId = (int) $record['result_id'];
                if (self::requiresCrmDelivery($record)) {
                    $payload = self::buildPayload($formId, $resultId, (array) ($record['context'] ?? []));

                    if ($payload === null) {
                        self::markFailure($path, $record, 'payload_unavailable', 0);
                        self::log('payload_unavailable', $formId, $resultId);
                        $summary['failed']++;
                        continue;
                    }

                    $record['lead_submission_id'] = (string) $payload['lead_submission_id'];
                    $delivery = self::deliver($payload);
                    if (!$delivery['ok']) {
                        self::markFailure(
                            $path,
                            $record,
                            (string) $delivery['error'],
                            (int) $delivery['http_code']
                        );
                        self::log('delivery_failed', $formId, $resultId, [
                            'http_code' => $delivery['http_code'],
                            'error' => $delivery['error'],
                        ]);
                        $summary['failed']++;
                        continue;
                    }

                    // Persist the exact CRM acknowledgement before attempting
                    // Metrika. Every later retry must skip CRM deal creation.
                    $record['crm_ack'] = [
                        'status' => 'ok',
                        'lead_submission_id' => (string) $payload['lead_submission_id'],
                        'deal_id' => $delivery['deal_id'],
                        'acknowledged_at' => date(DATE_ATOM),
                    ];
                    $record['attempts'] = 0;
                    $record['next_attempt_at'] = 0;
                    $record['last_http_code'] = (int) $delivery['http_code'];
                    $record['last_error'] = null;
                    $record['updated_at'] = date(DATE_ATOM);
                    self::writeRecord($path, $record);
                    self::log('crm_acknowledged', $formId, $resultId, [
                        'http_code' => $delivery['http_code'],
                        'deal_id' => $delivery['deal_id'],
                    ]);
                }

                if (self::requiresCrmDelivery($record)) {
                    self::markFailure($path, $record, 'crm_ack_unavailable', 0);
                    self::log('crm_ack_unavailable', $formId, $resultId);
                    $summary['failed']++;
                    continue;
                }

                // CRM delivery always runs first. The soft analytics signal is
                // best effort and cannot delay or prevent deal creation.
                try {
                    $record = self::attemptSoftGoal($path, $record);
                } catch (Throwable $exception) {
                    self::log('metrika_soft_exception', $formId, $resultId, [
                        'exception' => get_class($exception),
                    ]);
                    $storedRecord = self::readRecord($path);
                    if ($storedRecord !== null) {
                        $record = $storedRecord;
                    }
                }

                $resumeAction = self::hardGoalResumeAction($record);
                if (in_array($resumeAction, ['finalize_sent', 'finalize_unattributed'], true)) {
                    $finalStatus = $resumeAction === 'finalize_sent' ? 'sent' : 'metrika_unattributed';
                    self::finalizeRecord($path, $record, $finalStatus);
                    $summary['delivered']++;
                    continue;
                }

                if ($resumeAction === 'manual_review') {
                    $record['metrika']['hard_goal'] = self::metrikaGoalState([
                        'status' => 'metrika_indeterminate',
                        'http_code' => (int) ($record['metrika']['hard_goal']['http_code'] ?? 0),
                        'error' => 'prior_dispatch_unknown',
                    ]);
                    $record['updated_at'] = date(DATE_ATOM);
                    self::finalizeRecord($path, $record, 'metrika_indeterminate');
                    self::log('metrika_hard_indeterminate', $formId, $resultId, [
                        'deal_id' => $record['crm_ack']['deal_id'] ?? null,
                        'metrika_status' => 'metrika_indeterminate',
                    ]);
                    $summary['failed']++;
                    continue;
                }

                $hardPreparation = self::prepareMetrikaGoal(
                    self::METRIKA_HARD_ACTION,
                    (array) ($record['context'] ?? []),
                    [
                        'crm' => [
                            'lead_submission_id' => (string) ($record['lead_submission_id'] ?? ''),
                            'deal_id' => (string) ($record['crm_ack']['deal_id'] ?? ''),
                        ],
                    ]
                );
                if (($hardPreparation['status'] ?? null) !== 'ready') {
                    $hardGoal = $hardPreparation;
                } else {
                    // From this durable marker onward a crash or ambiguous
                    // transport error must never trigger an automatic resend.
                    $record['metrika']['hard_goal'] = [
                        'status' => 'attempting',
                        'attempted_at' => date(DATE_ATOM),
                    ];
                    $record['updated_at'] = date(DATE_ATOM);
                    self::writeRecord($path, $record);
                    $hardGoal = self::dispatchMetrikaFields((array) $hardPreparation['fields']);
                }
                $record['metrika']['hard_goal'] = self::metrikaGoalState($hardGoal);
                $record['updated_at'] = date(DATE_ATOM);

                if (in_array($hardGoal['status'], ['sent', 'metrika_unattributed'], true)) {
                    self::finalizeRecord($path, $record, (string) $hardGoal['status']);
                    self::log('delivered', $formId, $resultId, [
                        'deal_id' => $record['crm_ack']['deal_id'] ?? null,
                        'metrika_status' => $hardGoal['status'],
                    ]);
                    $summary['delivered']++;
                    continue;
                }

                if ($hardGoal['status'] === 'metrika_indeterminate') {
                    self::finalizeRecord($path, $record, 'metrika_indeterminate');
                    self::log('metrika_hard_indeterminate', $formId, $resultId, [
                        'http_code' => $hardGoal['http_code'] ?? 0,
                        'deal_id' => $record['crm_ack']['deal_id'] ?? null,
                        'error' => $hardGoal['error'] ?? 'dispatch_unknown',
                        'metrika_status' => 'metrika_indeterminate',
                    ]);
                    $summary['failed']++;
                    continue;
                }

                self::markFailure(
                    $path,
                    $record,
                    'metrika_' . (string) ($hardGoal['error'] ?? 'failed'),
                    (int) ($hardGoal['http_code'] ?? 0)
                );
                self::log('metrika_hard_failed', $formId, $resultId, [
                    'http_code' => $hardGoal['http_code'] ?? 0,
                    'deal_id' => $record['crm_ack']['deal_id'] ?? null,
                    'error' => $hardGoal['error'] ?? 'failed',
                ]);
                $summary['failed']++;
            }
        } finally {
            if ((glob(self::storageDirectory() . '/pending-*.json') ?: []) === []) {
                @unlink(self::pendingFlagPath());
            }
            self::$processing = false;
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        return $summary;
    }

    public static function status(): array
    {
        self::ensureStorage();
        $files = glob(self::storageDirectory() . '/pending-*.json') ?: [];
        $oldest = null;
        foreach ($files as $path) {
            $mtime = filemtime($path) ?: null;
            if ($mtime !== null && ($oldest === null || $mtime < $oldest)) {
                $oldest = $mtime;
            }
        }

        return [
            'pending' => count($files),
            'oldest_pending_at' => $oldest ? date(DATE_ATOM, $oldest) : null,
            'storage_writable' => is_writable(self::storageDirectory()),
            'hit_retry_enabled' => true,
            'endpoint' => self::ENDPOINT,
        ];
    }

    public static function resultSummary(int $webFormId, int $resultId): array
    {
        $payload = self::buildPayload($webFormId, $resultId, []);
        if ($payload === null) {
            return ['eligible' => false];
        }

        return [
            'eligible' => true,
            'lead_submission_id' => $payload['lead_submission_id'],
            'source' => $payload['source'],
            'form_name' => $payload['form_name'],
            'has_name' => trim((string) ($payload['name'] ?? '')) !== '',
            'has_phone' => trim((string) ($payload['phone'] ?? '')) !== '',
            'has_email' => trim((string) ($payload['email'] ?? '')) !== '',
            'has_comment' => trim((string) ($payload['comment'] ?? '')) !== '',
        ];
    }

    public static function endpointProbe(): array
    {
        $probeId = 'rosomaha-' . time() . '-legacy-bridge-probe';
        $response = self::postJson([
            'lead_submission_id' => $probeId,
            'source' => self::SOURCE,
        ]);

        return [
            'ok' => $response['http_code'] === 422 && $response['curl_errno'] === 0,
            'http_code' => $response['http_code'],
            'curl_errno' => $response['curl_errno'],
        ];
    }

    private static function enqueueResult(int $webFormId, int $resultId, array $context): bool
    {
        $payload = self::buildPayload($webFormId, $resultId, $context);
        if ($payload === null) {
            return false;
        }

        self::ensureStorage();
        $path = self::recordPath($webFormId, $resultId);
        if (is_file($path) || is_file(self::completedRecordPath($webFormId, $resultId))) {
            return true;
        }

        $record = [
            'version' => 2,
            'form_id' => $webFormId,
            'result_id' => $resultId,
            'lead_submission_id' => (string) $payload['lead_submission_id'],
            'context' => self::sanitizeContext($context),
            'attempts' => 0,
            'next_attempt_at' => 0,
            'last_http_code' => 0,
            'last_error' => null,
            'created_at' => date(DATE_ATOM),
            'updated_at' => date(DATE_ATOM),
        ];

        self::writeRecord($path, $record);
        @touch(self::pendingFlagPath());
        @chmod(self::pendingFlagPath(), 0600);

        return true;
    }

    private static function maybeRetryOnHit(): void
    {
        if (PHP_SAPI === 'cli' || !is_file(self::pendingFlagPath())) {
            return;
        }

        $throttle = self::storageDirectory() . '/last-hit-retry';
        $lastAttempt = is_file($throttle) ? (int) filemtime($throttle) : 0;
        if ($lastAttempt > time() - 60) {
            return;
        }

        @touch($throttle);
        @chmod($throttle, 0600);
        self::flushPending(2);
    }

    private static function buildPayload(int $webFormId, int $resultId, array $context): ?array
    {
        if (!class_exists('Bitrix\\Main\\Loader') || !Bitrix\Main\Loader::includeModule('form')) {
            return null;
        }

        $resultFields = [];
        $answerMeta = [];
        $data = CFormResult::GetDataByID($resultId, [], $resultFields, $answerMeta);
        if (!is_array($data) || (int) ($resultFields['FORM_ID'] ?? 0) !== $webFormId) {
            return null;
        }

        $form = CForm::GetByID($webFormId)->Fetch();
        $formSid = trim((string) ($form['SID'] ?? ''));
        if ($formSid === '' || !self::isCommercialForm($formSid)) {
            return null;
        }

        $values = [];
        foreach ($data as $sid => $answers) {
            $value = self::answerValue((array) $answers, $webFormId === 3 && mb_strtoupper((string) $sid) === 'PARAMS' ? 20000 : self::MAX_FIELD_LENGTH);
            if ($value !== '') {
                $values[mb_strtoupper((string) $sid)] = $value;
            }
        }

        $phone = self::firstValue($values, ['PHONE', 'TEL', 'TELEPHONE']);
        $email = self::firstValue($values, ['EMAIL', 'E_MAIL']);
        if ($phone === '' && $email === '') {
            return null;
        }

        $submittedAt = self::resultTimestamp((string) ($resultFields['DATE_CREATE'] ?? ''));
        $pageUrl = self::sanitizePageUrl((string) ($context['page_url'] ?? ''));
        $tracking = self::trackingFromContext($context, $pageUrl);
        $source = self::sourceForPage($pageUrl);
        $formName = self::cleanText((string) ($form['NAME'] ?? $formSid), 250);

        $configuration = $webFormId === 3 ? self::orderConfiguration($values) : '';
        $commentValues = $values;
        if ($configuration !== '') {
            unset($commentValues['PARAMS']);
        }
        $payload = [
            'lead_submission_id' => self::submissionId($submittedAt, $webFormId, $resultId),
            'source' => $source,
            'form_name' => $formSid,
            'name' => self::firstValue($values, ['NAME', 'FIO']),
            'phone' => $phone,
            'email' => $email,
            'city' => self::firstValue($values, ['CITY']),
            'comment' => self::buildComment($formName, $commentValues),
            'configuration' => $configuration,
            'product' => self::firstValue($values, ['PRODUCT', 'PRODUCT_NAME', 'NEED_PRODUCT', 'ORDER_LIST']),
            'price' => self::firstValue($values, ['PRODUCT_PRICE', 'TOTAL_SUMM', 'TOTAL_SUM']),
            'delivery_address' => self::firstValue($values, ['ADDRESS']),
            'lead_capture' => 'legacy_bitrix_web_form',
            'attribution_scope' => 'submission_page_only',
            'page_url' => $pageUrl,
            'request_page' => $pageUrl,
            'privacy_accepted' => array_key_exists('privacy_accepted', $context)
                ? ($context['privacy_accepted'] ? '1' : '0')
                : null,
            'privacy_accepted_at' => $context['captured_at'] ?? date(DATE_ATOM, $submittedAt),
            'consent_source' => $source . '/' . $formSid,
        ];
        $orderParams = $webFormId === 3 ? self::parseOrderParams((string) ($values['PARAMS'] ?? '')) : null;
        if ($orderParams !== null) {
            $payload['deal_amount'] = $orderParams['totalSum'];
            // The CRM also supports legacy price. Both must carry the order
            // total so an earlier base-price field cannot override it.
            $payload['price'] = $orderParams['totalSum'];
        }
        if ($webFormId === 3 && $orderParams === null && trim((string) ($values['PARAMS'] ?? '')) !== '') {
            // Preserve unrecognized input for a human to inspect; do not silently
            // replace the customer's selection with only a parsing warning.
            $payload['comment'] .= "\nИсходные параметры комплектации:\n" . $values['PARAMS'];
        }

        foreach ($tracking as $key => $value) {
            $payload[$key] = $value;
        }

        $summary = array_filter([
            'lead_capture=legacy_bitrix_web_form',
            !empty($payload['source_platform']) ? 'source_platform=' . $payload['source_platform'] : null,
            !empty($payload['source_channel']) ? 'source_channel=' . $payload['source_channel'] : null,
            !empty($payload['utm_campaign']) ? 'utm_campaign=' . $payload['utm_campaign'] : null,
            $pageUrl !== '' ? 'request_page=' . $pageUrl : null,
        ]);
        $payload['attribution_summary'] = implode("\n", $summary);

        return array_filter($payload, static fn ($value) => $value !== null && $value !== '');
    }

    private static function answerValue(array $answers, int $limit = self::MAX_FIELD_LENGTH): string
    {
        $values = [];
        foreach ($answers as $answer) {
            if (!is_array($answer)) {
                continue;
            }

            foreach (['USER_TEXT', 'USER_DATE', 'ANSWER_TEXT', 'ANSWER_VALUE', 'VALUE'] as $key) {
                $candidate = self::cleanText((string) ($answer[$key] ?? ''), $limit);
                if ($candidate !== '') {
                    $values[] = $candidate;
                    break;
                }
            }
        }

        return implode("\n", array_values(array_unique($values)));
    }

    private static function parseOrderParams(string $raw): ?array
    {
        if (strlen($raw) > 20000) return null;
        $parsed = json_decode($raw, true);
        if (!is_array($parsed)) {
            // The existing calculator serializes only numeric IDs and a numeric total.
            // Accept that exact legacy shape, never evaluate JavaScript or arbitrary quotes.
            if (!preg_match("/^\\s*\\{\\s*'options'\\s*:\\s*\\[\\s*((?:'?[0-9]+'?\\s*(?:,\\s*'?[0-9]+'?\\s*)*)?)\\]\\s*,\\s*'totalSum'\\s*:\\s*([0-9]+(?:\\.[0-9]{1,2})?)\\s*\\}\\s*$/D", $raw, $match)) return null;
            $tokens = trim($match[1]) === '' ? [] : explode(',', $match[1]);
            foreach ($tokens as $token) {
                if (!preg_match("/^(?:[0-9]+|'[0-9]+')$/D", trim($token))) return null;
            }
            $ids = array_map(static fn ($id) => trim($id, " '\t\r\n"), $tokens);
            $parsed = ['options' => $ids, 'totalSum' => $match[2]];
        }
        if (array_diff(array_keys($parsed), ['options', 'totalSum']) || !isset($parsed['options'], $parsed['totalSum']) || !is_array($parsed['options']) || count($parsed['options']) > 96) return null;
        $ids = [];
        foreach ($parsed['options'] as $id) {
            if ((!is_string($id) && !is_int($id)) || !preg_match('/^[1-9][0-9]{0,8}$/D', (string) $id)) return null;
            $ids[] = (int) $id;
        }
        $total = $parsed['totalSum'];
        if ((!is_string($total) && !is_int($total) && !is_float($total)) || !preg_match('/^[0-9]+(?:\.[0-9]{1,2})?$/D', (string) $total) || (float) $total > 1000000000) return null;
        return ['options' => array_values(array_unique($ids)), 'totalSum' => (float) $total];
    }

    private static function orderConfiguration(array $values): string
    {
        $raw = trim((string) ($values['PARAMS'] ?? ''));
        if ($raw === '') return '';
        $params = self::parseOrderParams($raw);
        $product = self::firstValue($values, ['PRODUCT', 'PRODUCT_NAME', 'NEED_PRODUCT']);
        $lines = $product !== '' ? ['Модель и комплектация: ' . $product] : [];
        if ($params === null) {
            $lines[] = 'Состав дополнительного оснащения не удалось распознать. Требуется уточнение у клиента.';
            return implode("\n", $lines);
        }
        $resolved = [];
        if ($params['options'] && class_exists('Bitrix\\Main\\Loader') && Bitrix\Main\Loader::includeModule('iblock') && class_exists('CIBlockElement')) {
            // Fixed Rosomaha accessories scope, independently audited by bitrix-fan-button-option.php.
            $rows = CIBlockElement::GetList([], ['IBLOCK_ID' => 86, 'SECTION_ID' => 302, 'INCLUDE_SUBSECTIONS' => 'Y', 'ACTIVE' => 'Y', 'ID' => $params['options']], false, ['nTopCount' => 96], ['ID', 'NAME', 'PROPERTY_FILTER_PRICE', 'PROPERTY_PRICE']);
            while ($row = $rows->Fetch()) {
                $id = (int) $row['ID'];
                if (!in_array($id, $params['options'], true)) continue;
                $name = self::cleanText((string) ($row['NAME'] ?? ''), 120);
                if ($name === '') continue;
                $price = trim((string) ($row['PROPERTY_FILTER_PRICE_VALUE'] ?? ''));
                if ($price === '') $price = preg_replace('/[^0-9]/', '', (string) ($row['PROPERTY_PRICE_VALUE'] ?? ''));
                $resolved[$id] = $name . (preg_match('/^[0-9]+(?:\.[0-9]{1,2})?$/D', $price) ? ' — ' . number_format((float) $price, 0, '.', ' ') . ' ₽' : ' — цену уточнить');
            }
        }
        $lines[] = 'Дополнительное оснащение (текущие цены каталога):';
        foreach ($params['options'] as $id) $lines[] = '• ' . ($resolved[$id] ?? 'ID ' . $id . ': название не найдено в каталоге, требуется уточнение');
        if (!$params['options']) $lines[] = 'Не выбрано';
        $lines[] = 'Итого, указанное клиенту при отправке: ' . number_format($params['totalSum'], 0, '.', ' ') . ' ₽';
        return implode("\n", $lines);
    }

    private static function firstValue(array $values, array $keys): string
    {
        foreach ($keys as $key) {
            $value = trim((string) ($values[$key] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }

    private static function buildComment(string $formName, array $values): string
    {
        $lines = ['Форма: ' . $formName];
        $labels = [
            'MESSAGE' => 'Сообщение',
            'PRODUCT' => 'Товар',
            'PRODUCT_NAME' => 'Товар',
            'NEED_PRODUCT' => 'Интерес',
            'PROJECT' => 'Проект',
            'SERVICE' => 'Услуга',
            'COMPANY' => 'Компания',
            'ADDRESS' => 'Адрес доставки',
            'ORDER_LIST' => 'Состав заказа',
            'PARAMS' => 'Параметры',
            'PROMO' => 'Промокод',
        ];

        foreach ($labels as $key => $label) {
            $value = trim((string) ($values[$key] ?? ''));
            if ($value !== '') {
                $lines[] = $label . ': ' . $value;
            }
        }

        return self::cleanText(implode("\n", $lines), self::MAX_COMMENT_LENGTH, true);
    }

    private static function isCommercialForm(string $formSid): bool
    {
        $formSid = mb_strtolower($formSid);
        foreach ([
            '_order_page_',
            '_order_product_',
            '_order_project_',
            '_order_services_',
            '_question_',
            '_callback_',
            '_quick_buy_',
            '_callstaff_',
        ] as $needle) {
            if (str_contains($formSid, $needle)) {
                return true;
            }
        }

        return false;
    }

    private static function captureContext(): array
    {
        $pageUrl = self::sanitizePageUrl((string) ($_SERVER['HTTP_REFERER'] ?? ''));
        $consent = $_REQUEST['licenses_popup'] ?? null;
        $cookieTracking = [];
        foreach (self::trackingKeys() as $key) {
            $value = self::sanitizeTrackingValue($key, $_COOKIE[$key] ?? '');
            if ($value !== '') {
                $cookieTracking[$key] = $value;
            }
        }

        return [
            'page_url' => $pageUrl,
            'privacy_accepted' => in_array(mb_strtolower(trim((string) $consent)), ['1', 'y', 'yes', 'on'], true),
            'captured_at' => date(DATE_ATOM),
            'tracking' => $cookieTracking,
            'ym_client_id' => self::sanitizeClientId($_COOKIE['ym_client_id'] ?? ''),
        ];
    }

    private static function sanitizeContext(array $context): array
    {
        $pageUrl = self::sanitizePageUrl((string) ($context['page_url'] ?? ''));

        return array_filter([
            'page_url' => $pageUrl,
            'privacy_accepted' => array_key_exists('privacy_accepted', $context)
                ? (bool) $context['privacy_accepted']
                : null,
            'captured_at' => self::safeIsoTimestamp((string) ($context['captured_at'] ?? '')),
            'tracking' => self::trackingFromContext($context, $pageUrl),
            'ym_client_id' => self::sanitizeClientId(
                $context['ym_client_id']
                ?? (is_array($context['tracking'] ?? null) ? ($context['tracking']['ym_client_id'] ?? '') : '')
            ),
        ], static fn ($value) => $value !== null && $value !== '' && $value !== []);
    }

    private static function trackingFromContext(array $context, string $pageUrl): array
    {
        $provided = is_array($context['tracking'] ?? null) ? $context['tracking'] : $context;
        $tracking = [];
        foreach (self::trackingKeys() as $key) {
            $value = self::sanitizeTrackingValue($key, $provided[$key] ?? '');
            if ($value !== '') {
                $tracking[$key] = $value;
            }
        }

        // A fresh URL parameter represents the current submission and must
        // override an older first-party attribution cookie.
        foreach (self::trackingFromUrl($pageUrl) as $key => $value) {
            $tracking[$key] = $value;
        }

        $clientId = self::sanitizeClientId(
            $context['ym_client_id']
            ?? ($provided['ym_client_id'] ?? '')
        );
        if ($clientId !== '') {
            $tracking['ym_client_id'] = $clientId;
        }

        $utmSource = mb_strtolower((string) ($tracking['utm_source'] ?? ''));
        if (!empty($tracking['yclid']) || str_contains($utmSource, 'yandex')) {
            $tracking['source_platform'] = 'yandex';
        } elseif (!empty($tracking['gclid']) || str_contains($utmSource, 'google')) {
            $tracking['source_platform'] = 'google';
        } elseif (!empty($tracking['vkclid']) || str_contains($utmSource, 'vk')) {
            $tracking['source_platform'] = 'vk';
        } elseif ($utmSource !== '') {
            $tracking['source_platform'] = $utmSource;
        } else {
            $tracking['source_platform'] = 'direct';
        }

        $tracking['source_channel'] = $tracking['utm_medium']
            ?? ((!empty($tracking['yclid']) || !empty($tracking['gclid']) || !empty($tracking['vkclid'])) ? 'cpc' : 'direct');

        $allParams = [];
        foreach (self::trackingKeys() as $key) {
            if (!empty($tracking[$key])) {
                $allParams[$key] = $tracking[$key];
            }
        }
        if ($allParams !== []) {
            $tracking['all_params'] = http_build_query($allParams, '', '&', PHP_QUERY_RFC3986);
        }

        return $tracking;
    }

    private static function trackingFromUrl(string $pageUrl): array
    {
        if ($pageUrl === '') {
            return [];
        }

        $query = parse_url($pageUrl, PHP_URL_QUERY);
        if (!is_string($query) || $query === '') {
            return [];
        }

        parse_str($query, $params);
        $tracking = [];
        foreach (self::trackingKeys() as $key) {
            $value = self::sanitizeTrackingValue($key, $params[$key] ?? '');
            if ($value !== '') {
                $tracking[$key] = $value;
            }
        }

        return $tracking;
    }

    private static function trackingKeys(): array
    {
        return [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'utm_id',
            'yclid',
            'gclid',
            'vkclid',
            'vk_click_id',
        ];
    }

    private static function sanitizeClientId($value): string
    {
        if (!is_scalar($value)) {
            return '';
        }

        $value = trim((string) $value);

        return preg_match('/^[0-9]{6,32}$/D', $value) === 1 ? $value : '';
    }

    private static function sanitizeTrackingValue(string $key, $value): string
    {
        if (!is_scalar($value)) {
            return '';
        }

        $value = self::cleanText((string) $value, 250);
        if ($value === '') {
            return '';
        }

        if (in_array($key, ['yclid', 'gclid', 'vkclid', 'vk_click_id'], true)
            && preg_match('/^[a-z0-9._~+\/-]{1,250}$/iD', $value) !== 1
        ) {
            return '';
        }

        return $value;
    }

    private static function sanitizePageUrl(string $url): string
    {
        $url = trim(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($url === '') {
            return '';
        }
        if (str_starts_with($url, '//')) {
            $url = 'https:' . $url;
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            return '';
        }

        $host = mb_strtolower((string) ($parts['host'] ?? ''));
        $host = preg_replace('/^www\./u', '', $host) ?? $host;
        if ($host !== self::SOURCE) {
            return '';
        }

        $path = '/' . ltrim((string) ($parts['path'] ?? '/'), '/');
        $tracking = [];
        if (!empty($parts['query'])) {
            parse_str((string) $parts['query'], $params);
            foreach (self::trackingKeys() as $key) {
                $value = self::sanitizeTrackingValue($key, $params[$key] ?? '');
                if ($value !== '') {
                    $tracking[$key] = $value;
                }
            }
        }

        return 'https://' . self::SOURCE . $path
            . ($tracking !== [] ? '?' . http_build_query($tracking, '', '&', PHP_QUERY_RFC3986) : '');
    }

    private static function sourceForPage(string $pageUrl): string
    {
        $path = mb_strtolower((string) (parse_url($pageUrl, PHP_URL_PATH) ?: ''));
        if (str_starts_with($path, '/sotrudnichestvo')) {
            return self::SOURCE . '/sotrudnichestvo';
        }
        if (str_starts_with($path, '/komplektuyshie')) {
            return self::SOURCE . '/komplektuyshie';
        }

        return self::SOURCE;
    }

    private static function submissionId(int $timestamp, int $webFormId, int $resultId): string
    {
        return 'rosomaha-' . $timestamp . '-legacy-form-' . $webFormId . '-result-' . $resultId;
    }

    private static function resultTimestamp(string $value): int
    {
        $timestamp = strtotime($value);

        return $timestamp && $timestamp >= 1000000000 ? $timestamp : time();
    }

    private static function deliver(array $payload): array
    {
        $response = self::postJson($payload);
        $ack = self::parseCrmAck($payload, $response);
        if ($ack === null) {
            return [
                'ok' => false,
                'http_code' => $response['http_code'],
                'deal_id' => null,
                'error' => $response['curl_errno'] !== 0
                    ? 'curl_' . $response['curl_errno']
                    : 'invalid_ack',
            ];
        }

        return [
            'ok' => true,
            'http_code' => $response['http_code'],
            'deal_id' => $ack['deal_id'],
            'error' => null,
        ];
    }

    private static function parseCrmAck(array $payload, array $response): ?array
    {
        if ((int) ($response['curl_errno'] ?? -1) !== 0) {
            return null;
        }

        $httpCode = (int) ($response['http_code'] ?? 0);
        if ($httpCode < 200 || $httpCode >= 300) {
            return null;
        }

        $body = json_decode((string) ($response['body'] ?? ''), true);
        $expectedSubmissionId = (string) ($payload['lead_submission_id'] ?? '');
        $rawSubmissionId = is_array($body) ? ($body['lead_submission_id'] ?? null) : null;
        $actualSubmissionId = is_scalar($rawSubmissionId) ? (string) $rawSubmissionId : '';
        $dealId = is_array($body) ? self::normalizeDealId($body['deal_id'] ?? null) : null;
        if (!is_array($body)
            || ($body['status'] ?? null) !== 'ok'
            || $expectedSubmissionId === ''
            || !hash_equals($expectedSubmissionId, $actualSubmissionId)
            || $dealId === null
        ) {
            return null;
        }

        return [
            'status' => 'ok',
            'lead_submission_id' => $actualSubmissionId,
            'deal_id' => $dealId,
        ];
    }

    private static function postJson(array $payload): array
    {
        if (!extension_loaded('curl')) {
            return ['http_code' => 0, 'curl_errno' => -1, 'body' => ''];
        }

        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($encoded)) {
            return ['http_code' => 0, 'curl_errno' => -2, 'body' => ''];
        }

        $curl = curl_init(self::ENDPOINT);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $encoded,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Content-Type: application/json',
                'User-Agent: RosomahaLegacyBitrixBridge/1.0',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
        ]);
        $body = curl_exec($curl);
        $httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $curlError = (int) curl_errno($curl);
        curl_close($curl);

        return [
            'http_code' => $httpCode,
            'curl_errno' => $curlError,
            'body' => is_string($body) ? mb_substr($body, 0, 10000) : '',
        ];
    }

    private static function metrikaConfig(): ?array
    {
        $path = self::METRIKA_CONFIG_PATH;
        $permissions = @fileperms($path);
        if (!is_file($path)
            || is_link($path)
            || $permissions === false
            || ($permissions & 0777) !== 0600
            || (int) @filesize($path) > 8192
        ) {
            return null;
        }

        $content = @file_get_contents($path);

        return is_string($content) ? self::parseMetrikaConfigJson($content) : null;
    }

    private static function parseMetrikaConfigJson(string $content): ?array
    {
        $decoded = json_decode($content, true);
        if (!is_array($decoded)) {
            return null;
        }

        $counterId = self::normalizeCounterId($decoded['counter_id'] ?? null);
        $rawMeasurementToken = $decoded['measurement_token'] ?? null;
        $measurementToken = is_scalar($rawMeasurementToken) ? trim((string) $rawMeasurementToken) : '';
        if ($counterId === null
            || preg_match('/^[\x21-\x7E]{16,1024}$/D', $measurementToken) !== 1
        ) {
            return null;
        }

        return [
            'counter_id' => $counterId,
            'measurement_token' => $measurementToken,
        ];
    }

    private static function normalizeCounterId($value): ?int
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);
        if (preg_match('/^[1-9][0-9]{4,14}$/D', $value) !== 1) {
            return null;
        }

        $counterId = (int) $value;

        return $counterId > 0 ? $counterId : null;
    }

    private static function attemptSoftGoal(string $path, array $record): array
    {
        if (isset($record['metrika']['soft_goal']['status'])) {
            return $record;
        }

        // Persist the attempt marker first. A process crash can lose this
        // optional signal, but cannot send it twice on an automatic retry.
        $record['metrika']['soft_goal'] = [
            'status' => 'attempted',
            'attempted_at' => date(DATE_ATOM),
        ];
        $record['updated_at'] = date(DATE_ATOM);
        self::writeRecord($path, $record);

        $result = self::sendMetrikaGoal(
            self::METRIKA_SOFT_ACTION,
            (array) ($record['context'] ?? []),
            [
                'form' => [
                    'lead_submission_id' => (string) ($record['lead_submission_id'] ?? ''),
                ],
            ]
        );
        $record['metrika']['soft_goal'] = self::metrikaGoalState($result);
        $record['updated_at'] = date(DATE_ATOM);
        self::writeRecord($path, $record);

        return $record;
    }

    private static function sendMetrikaGoal(string $action, array $context, array $eventParams = []): array
    {
        $preparation = self::prepareMetrikaGoal($action, $context, $eventParams);
        if (($preparation['status'] ?? null) !== 'ready') {
            return $preparation;
        }

        return self::dispatchMetrikaFields((array) $preparation['fields']);
    }

    private static function prepareMetrikaGoal(string $action, array $context, array $eventParams = []): array
    {
        if (!in_array($action, [self::METRIKA_SOFT_ACTION, self::METRIKA_HARD_ACTION], true)) {
            return [
                'status' => 'failed',
                'http_code' => 0,
                'error' => 'invalid_action',
            ];
        }

        $context = self::sanitizeContext($context);
        $clientId = self::sanitizeClientId(
            $context['ym_client_id']
            ?? ($context['tracking']['ym_client_id'] ?? '')
        );
        if ($clientId === '') {
            return [
                'status' => 'metrika_unattributed',
                'http_code' => 0,
                'error' => 'client_id_missing',
            ];
        }

        $config = self::metrikaConfig();
        if ($config === null) {
            return [
                'status' => 'failed',
                'http_code' => 0,
                'error' => 'config_unavailable',
            ];
        }

        $pageUrl = self::sanitizePageUrl((string) ($context['page_url'] ?? ''));
        if ($pageUrl === '') {
            $pageUrl = 'https://' . self::SOURCE . '/';
        }

        return [
            'status' => 'ready',
            'fields' => self::buildMetrikaFields(
                $config,
                $clientId,
                $action,
                $pageUrl,
                $eventParams
            ),
        ];
    }

    private static function dispatchMetrikaFields(array $fields): array
    {
        return self::classifyMetrikaResponse(self::postMetrikaForm($fields));
    }

    private static function classifyMetrikaResponse(array $response): array
    {
        $httpCode = (int) ($response['http_code'] ?? 0);
        $curlError = (int) ($response['curl_errno'] ?? -1);
        $dispatched = ($response['dispatched'] ?? false) === true;
        if ($curlError === 0 && $httpCode >= 200 && $httpCode < 300) {
            return [
                'status' => 'sent',
                'http_code' => $httpCode,
                'error' => null,
            ];
        }

        if (($curlError !== 0 || $httpCode >= 500) && $dispatched) {
            return [
                'status' => 'metrika_indeterminate',
                'http_code' => $httpCode,
                'error' => 'dispatch_unknown',
            ];
        }

        if ($curlError === 0 && $httpCode === 0 && $dispatched) {
            return [
                'status' => 'metrika_indeterminate',
                'http_code' => 0,
                'error' => 'dispatch_unknown',
            ];
        }

        return [
            'status' => 'failed',
            'http_code' => $httpCode,
            'error' => $curlError !== 0 ? 'curl_' . $curlError : 'http_' . $httpCode,
        ];
    }

    private static function buildMetrikaFields(
        array $config,
        string $clientId,
        string $action,
        string $pageUrl,
        array $eventParams = []
    ): array {
        $fields = [
            'tid' => (string) $config['counter_id'],
            'cid' => $clientId,
            't' => 'event',
            'ea' => $action,
            'dl' => $pageUrl,
        ];

        $sanitizedParams = self::sanitizeMetrikaEventParams($eventParams);
        if ($sanitizedParams !== []) {
            $encodedParams = json_encode(
                $sanitizedParams,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
            );
            $fields['params'] = $encodedParams;
        }

        // Keep the server-only token last so callers can explicitly redact it
        // without touching the public analytics fields.
        $fields['ms'] = $config['measurement_token'];

        return $fields;
    }

    private static function sanitizeMetrikaEventParams(array $params): array
    {
        $sanitized = [];
        foreach (['form', 'crm'] as $scope) {
            if (!is_array($params[$scope] ?? null)) {
                continue;
            }

            $leadSubmissionId = self::normalizeMetrikaReference(
                $params[$scope]['lead_submission_id'] ?? null,
                180
            );
            if ($leadSubmissionId !== null) {
                $sanitized[$scope]['lead_submission_id'] = $leadSubmissionId;
            }

            if ($scope === 'crm') {
                $dealId = self::normalizeDealId($params[$scope]['deal_id'] ?? null);
                if ($dealId !== null) {
                    $sanitized[$scope]['deal_id'] = $dealId;
                }
            }
        }

        return $sanitized;
    }

    private static function normalizeMetrikaReference($value, int $maxLength): ?string
    {
        if ((!is_int($value) && !is_string($value)) || is_bool($value)) {
            return null;
        }

        $value = trim((string) $value);
        if ($value === ''
            || mb_strlen($value) > $maxLength
            || preg_match('/^[a-z0-9._:-]+$/iD', $value) !== 1
        ) {
            return null;
        }

        return $value;
    }

    private static function postMetrikaForm(array $fields): array
    {
        if (!extension_loaded('curl')) {
            return ['http_code' => 0, 'curl_errno' => -1, 'dispatched' => false];
        }

        $encoded = http_build_query($fields, '', '&', PHP_QUERY_RFC3986);
        $curl = curl_init(self::METRIKA_ENDPOINT);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $encoded,
            CURLOPT_HTTPHEADER => [
                'Accept: */*',
                'Content-Type: application/x-www-form-urlencoded',
                'User-Agent: RosomahaLegacyBitrixBridge/2.0',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 1,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
        ]);
        curl_exec($curl);
        $httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $requestSize = (int) curl_getinfo($curl, CURLINFO_REQUEST_SIZE);
        $curlError = (int) curl_errno($curl);
        curl_close($curl);

        return [
            'http_code' => $httpCode,
            'curl_errno' => $curlError,
            'dispatched' => $requestSize > 0,
        ];
    }

    private static function metrikaGoalState(array $result): array
    {
        return array_filter([
            'status' => in_array((string) ($result['status'] ?? ''), ['sent', 'failed', 'metrika_unattributed', 'metrika_indeterminate'], true)
                ? (string) $result['status']
                : 'failed',
            'http_code' => (int) ($result['http_code'] ?? 0),
            'error' => isset($result['error'])
                ? preg_replace('/[^a-z0-9_-]/i', '_', mb_substr((string) $result['error'], 0, 80))
                : null,
            'completed_at' => date(DATE_ATOM),
        ], static fn ($value) => $value !== null && $value !== '');
    }

    private static function hardGoalResumeAction(array $record): string
    {
        $status = (string) ($record['metrika']['hard_goal']['status'] ?? '');

        return match ($status) {
            '', 'failed' => 'send',
            'sent' => 'finalize_sent',
            'metrika_unattributed' => 'finalize_unattributed',
            default => 'manual_review',
        };
    }

    private static function requiresCrmDelivery(array $record): bool
    {
        $submissionId = trim((string) ($record['lead_submission_id'] ?? ''));
        $ack = is_array($record['crm_ack'] ?? null) ? $record['crm_ack'] : [];
        $ackSubmissionId = trim((string) ($ack['lead_submission_id'] ?? ''));

        return $submissionId === ''
            || ($ack['status'] ?? null) !== 'ok'
            || $ackSubmissionId === ''
            || !hash_equals($submissionId, $ackSubmissionId)
            || self::normalizeDealId($ack['deal_id'] ?? null) === null;
    }

    private static function normalizeDealId($value): ?string
    {
        if ((!is_int($value) && !is_string($value)) || is_bool($value)) {
            return null;
        }

        $value = trim((string) $value);
        if ($value === ''
            || $value === '0'
            || mb_strlen($value) > 128
            || preg_match('/^[a-z0-9._:-]+$/iD', $value) !== 1
        ) {
            return null;
        }

        return $value;
    }

    private static function finalizeRecord(string $path, array $record, string $metrikaStatus): void
    {
        $receipt = self::buildCompletionReceipt($record, $metrikaStatus);
        $completedPath = self::completedRecordPath(
            (int) $record['form_id'],
            (int) $record['result_id']
        );
        if (!is_file($completedPath)) {
            self::writeRecord($completedPath, $receipt);
        }

        if (!@unlink($path) && is_file($path)) {
            throw new RuntimeException('Could not finalize queue record.');
        }
    }

    private static function buildCompletionReceipt(array $record, string $metrikaStatus): array
    {
        $ack = is_array($record['crm_ack'] ?? null) ? $record['crm_ack'] : [];
        $metrika = is_array($record['metrika'] ?? null) ? $record['metrika'] : [];

        return array_filter([
            'version' => 2,
            'form_id' => (int) ($record['form_id'] ?? 0),
            'result_id' => (int) ($record['result_id'] ?? 0),
            'lead_submission_id' => trim((string) ($record['lead_submission_id'] ?? '')),
            'final_status' => match ($metrikaStatus) {
                'metrika_unattributed' => 'metrika_unattributed',
                'metrika_indeterminate' => 'metrika_indeterminate',
                default => 'delivered',
            },
            'manual_review_required' => $metrikaStatus === 'metrika_indeterminate',
            'crm_ack' => [
                'status' => ($ack['status'] ?? null) === 'ok' ? 'ok' : 'invalid',
                'lead_submission_id' => trim((string) ($ack['lead_submission_id'] ?? '')),
                'deal_id' => self::normalizeDealId($ack['deal_id'] ?? null),
                'acknowledged_at' => self::safeIsoTimestamp((string) ($ack['acknowledged_at'] ?? '')),
            ],
            'metrika' => [
                'soft_goal' => self::receiptGoalState((array) ($metrika['soft_goal'] ?? [])),
                'hard_goal' => self::receiptGoalState((array) ($metrika['hard_goal'] ?? [])),
            ],
            'created_at' => self::safeIsoTimestamp((string) ($record['created_at'] ?? '')),
            'finalized_at' => date(DATE_ATOM),
        ], static fn ($value) => $value !== null && $value !== '' && $value !== []);
    }

    private static function receiptGoalState(array $state): array
    {
        return array_filter([
            'status' => in_array((string) ($state['status'] ?? ''), ['sent', 'failed', 'metrika_unattributed', 'metrika_indeterminate'], true)
                ? (string) $state['status']
                : 'unknown',
            'http_code' => (int) ($state['http_code'] ?? 0),
            'error' => isset($state['error'])
                ? preg_replace('/[^a-z0-9_-]/i', '_', mb_substr((string) $state['error'], 0, 80))
                : null,
            'completed_at' => self::safeIsoTimestamp((string) ($state['completed_at'] ?? '')),
        ], static fn ($value) => $value !== null && $value !== '');
    }

    private static function markFailure(string $path, array $record, string $error, int $httpCode): void
    {
        $attempts = (int) ($record['attempts'] ?? 0) + 1;
        $delays = [60, 300, 900, 3600, 21600, 86400];
        $delay = $delays[min($attempts - 1, count($delays) - 1)];
        $record['attempts'] = $attempts;
        $record['next_attempt_at'] = time() + $delay;
        $record['last_http_code'] = $httpCode;
        $record['last_error'] = preg_replace('/[^a-z0-9_-]/i', '_', mb_substr($error, 0, 80));
        $record['updated_at'] = date(DATE_ATOM);
        self::writeRecord($path, $record);
    }

    private static function readRecord(string $path): ?array
    {
        $content = @file_get_contents($path);
        if (!is_string($content) || $content === '') {
            return null;
        }

        $record = json_decode($content, true);
        if (!is_array($record) || (int) ($record['form_id'] ?? 0) <= 0 || (int) ($record['result_id'] ?? 0) <= 0) {
            return null;
        }

        return $record;
    }

    private static function writeRecord(string $path, array $record): void
    {
        $encoded = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($encoded)) {
            throw new RuntimeException('Could not encode queue record.');
        }

        $temporary = $path . '.tmp-' . bin2hex(random_bytes(4));
        if (file_put_contents($temporary, $encoded, LOCK_EX) === false) {
            throw new RuntimeException('Could not write queue record.');
        }
        @chmod($temporary, 0600);
        if (!@rename($temporary, $path)) {
            @unlink($temporary);
            throw new RuntimeException('Could not finalize queue record.');
        }
        @chmod($path, 0600);
    }

    private static function quarantineRecord(string $path): void
    {
        @rename($path, $path . '.invalid-' . time());
    }

    private static function ensureStorage(): void
    {
        $directory = self::storageDirectory();
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Could not create bridge storage.');
        }
        @chmod($directory, 0700);

        $protections = [
            $directory . '/.htaccess' => "Require all denied\nDeny from all\n",
            $directory . '/index.php' => "<?php http_response_code(404); exit;\n",
        ];
        foreach ($protections as $path => $content) {
            if (!is_file($path)) {
                @file_put_contents($path, $content, LOCK_EX);
                @chmod($path, 0600);
            }
        }
    }

    private static function storageDirectory(): string
    {
        return __DIR__ . '/.rosomaha_crm_bridge';
    }

    private static function validatePendingTarget(?int $formId, ?int $resultId): void
    {
        if (($formId !== null || $resultId !== null) && ($formId === null || $resultId === null || $formId <= 0 || $resultId <= 0)) {
            throw new InvalidArgumentException('Both positive form and result IDs are required.');
        }
    }

    private static function selectPendingFiles(array $files, ?int $formId = null, ?int $resultId = null): array
    {
        self::validatePendingTarget($formId, $resultId);
        if ($formId !== null) {
            // Immediate delivery addresses only the newly saved form result.
            // Older acknowledged results may still be waiting for analytics.
            $target = self::recordPath($formId, $resultId);
            return in_array($target, $files, true) ? [$target] : [];
        }
        sort($files, SORT_NATURAL);
        return $files;
    }

    private static function recordPath(int $webFormId, int $resultId): string
    {
        return self::storageDirectory() . '/pending-' . $webFormId . '-' . $resultId . '.json';
    }

    private static function completedRecordPath(int $webFormId, int $resultId): string
    {
        return self::storageDirectory() . '/completed-' . $webFormId . '-' . $resultId . '.json';
    }

    private static function pendingFlagPath(): string
    {
        return self::storageDirectory() . '/pending.flag';
    }

    private static function safeIsoTimestamp(string $value): ?string
    {
        $timestamp = strtotime(trim($value));

        return $timestamp ? date(DATE_ATOM, $timestamp) : null;
    }

    private static function cleanText(string $value, int $limit, bool $preserveLines = false): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        if ($preserveLines) {
            $value = preg_replace('/[\t ]+/u', ' ', $value) ?? $value;
            $value = preg_replace('/\n{3,}/u', "\n\n", $value) ?? $value;
        } else {
            $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        }

        return mb_substr(trim($value), 0, $limit);
    }

    private static function log(string $event, int $webFormId, int $resultId, array $context = []): void
    {
        if (!function_exists('AddMessage2Log')) {
            return;
        }

        $safe = [
            'event' => $event,
            'form_id' => $webFormId,
            'result_id' => $resultId,
            'http_code' => isset($context['http_code']) ? (int) $context['http_code'] : null,
            'deal_id' => isset($context['deal_id']) ? self::normalizeDealId($context['deal_id']) : null,
            'error' => isset($context['error']) ? preg_replace('/[^a-z0-9_-]/i', '_', (string) $context['error']) : null,
            'exception' => isset($context['exception']) ? basename(str_replace('\\', '/', (string) $context['exception'])) : null,
            'metrika_status' => isset($context['metrika_status'])
                ? preg_replace('/[^a-z0-9_-]/i', '_', (string) $context['metrika_status'])
                : null,
        ];

        AddMessage2Log('[RosomahaCrmBridge] ' . json_encode(array_filter($safe), JSON_UNESCAPED_SLASHES), 'rosomaha_crm_bridge');
    }
}

RosomahaCrmBridge::register();
