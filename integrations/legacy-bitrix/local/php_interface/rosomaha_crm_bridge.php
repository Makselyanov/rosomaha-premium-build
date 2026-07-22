<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    http_response_code(404);
    exit;
}

final class RosomahaCrmBridge
{
    private const ENDPOINT = 'https://rosomaha.centrlp.ru/api/webhooks/site-form';
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

            self::flushPending(1, true);
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

    public static function flushPending(int $limit = 20, bool $force = false): array
    {
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
            $files = glob(self::storageDirectory() . '/pending-*.json') ?: [];
            sort($files, SORT_NATURAL);
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

                if (!$force && (int) ($record['next_attempt_at'] ?? 0) > $now) {
                    continue;
                }

                $summary['processed']++;
                $formId = (int) $record['form_id'];
                $resultId = (int) $record['result_id'];
                $payload = self::buildPayload($formId, $resultId, (array) ($record['context'] ?? []));

                if ($payload === null) {
                    self::markFailure($path, $record, 'payload_unavailable', 0);
                    self::log('payload_unavailable', $formId, $resultId);
                    $summary['failed']++;
                    continue;
                }

                $delivery = self::deliver($payload);
                if ($delivery['ok']) {
                    @unlink($path);
                    self::log('delivered', $formId, $resultId, [
                        'http_code' => $delivery['http_code'],
                        'deal_id' => $delivery['deal_id'],
                    ]);
                    $summary['delivered']++;
                    continue;
                }

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
        if (self::buildPayload($webFormId, $resultId, $context) === null) {
            return false;
        }

        self::ensureStorage();
        $path = self::recordPath($webFormId, $resultId);
        if (is_file($path)) {
            return true;
        }

        $record = [
            'version' => 1,
            'form_id' => $webFormId,
            'result_id' => $resultId,
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
            $value = self::answerValue((array) $answers);
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

        $payload = [
            'lead_submission_id' => self::submissionId($submittedAt, $webFormId, $resultId),
            'source' => $source,
            'form_name' => $formSid,
            'name' => self::firstValue($values, ['NAME', 'FIO']),
            'phone' => $phone,
            'email' => $email,
            'city' => self::firstValue($values, ['CITY']),
            'comment' => self::buildComment($formName, $values),
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

    private static function answerValue(array $answers): string
    {
        $values = [];
        foreach ($answers as $answer) {
            if (!is_array($answer)) {
                continue;
            }

            foreach (['USER_TEXT', 'USER_DATE', 'ANSWER_TEXT', 'ANSWER_VALUE', 'VALUE'] as $key) {
                $candidate = self::cleanText((string) ($answer[$key] ?? ''), self::MAX_FIELD_LENGTH);
                if ($candidate !== '') {
                    $values[] = $candidate;
                    break;
                }
            }
        }

        return implode("\n", array_values(array_unique($values)));
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

        return [
            'page_url' => $pageUrl,
            'privacy_accepted' => in_array(mb_strtolower(trim((string) $consent)), ['1', 'y', 'yes', 'on'], true),
            'captured_at' => date(DATE_ATOM),
            'tracking' => self::trackingFromUrl($pageUrl),
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
        ], static fn ($value) => $value !== null && $value !== '' && $value !== []);
    }

    private static function trackingFromContext(array $context, string $pageUrl): array
    {
        $tracking = self::trackingFromUrl($pageUrl);
        $provided = is_array($context['tracking'] ?? null) ? $context['tracking'] : $context;
        foreach (self::trackingKeys() as $key) {
            $value = self::cleanText((string) ($provided[$key] ?? ''), 250);
            if ($value !== '') {
                $tracking[$key] = $value;
            }
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
            $value = self::cleanText((string) ($params[$key] ?? ''), 250);
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
                $value = self::cleanText((string) ($params[$key] ?? ''), 250);
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
        if ($response['curl_errno'] !== 0) {
            return [
                'ok' => false,
                'http_code' => $response['http_code'],
                'deal_id' => null,
                'error' => 'curl_' . $response['curl_errno'],
            ];
        }

        $body = json_decode((string) $response['body'], true);
        $acknowledged = $response['http_code'] >= 200
            && $response['http_code'] < 300
            && is_array($body)
            && ($body['status'] ?? null) === 'ok'
            && (string) ($body['lead_submission_id'] ?? '') === (string) $payload['lead_submission_id']
            && !empty($body['deal_id']);

        return [
            'ok' => $acknowledged,
            'http_code' => $response['http_code'],
            'deal_id' => $acknowledged ? (int) $body['deal_id'] : null,
            'error' => $acknowledged ? null : 'invalid_ack',
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

    private static function recordPath(int $webFormId, int $resultId): string
    {
        return self::storageDirectory() . '/pending-' . $webFormId . '-' . $resultId . '.json';
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
            'deal_id' => isset($context['deal_id']) ? (int) $context['deal_id'] : null,
            'error' => isset($context['error']) ? preg_replace('/[^a-z0-9_-]/i', '_', (string) $context['error']) : null,
            'exception' => isset($context['exception']) ? basename(str_replace('\\', '/', (string) $context['exception'])) : null,
        ];

        AddMessage2Log('[RosomahaCrmBridge] ' . json_encode(array_filter($safe), JSON_UNESCAPED_SLASHES), 'rosomaha_crm_bridge');
    }
}

RosomahaCrmBridge::register();
