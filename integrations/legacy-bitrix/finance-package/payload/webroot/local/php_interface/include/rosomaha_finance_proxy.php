<?php

declare(strict_types=1);

namespace Rosomaha\Finance;

use RuntimeException;
use Throwable;

if (! defined('ROSOMAHA_FINANCE_PROXY_INTERNAL')) {
    http_response_code(404);
    exit;
}

final class FinanceProxy
{
    public const MAX_REQUEST_BYTES = 16384;
    public const MAX_RESPONSE_BYTES = 131072;
    public const PUBLIC_ORIGIN = 'https://rosomaha-rus.ru';
    public const PUBLIC_HOST = 'rosomaha-rus.ru';
    public const UPSTREAM_URL = 'https://rosomaha.centrlp.ru/api/finance/public-intake';
    public const DEFAULT_TOKEN_FILE = '/etc/rosomaha/finance-intake.token';

    private const ALLOWED_PAYLOAD_KEYS = [
        'lead_submission_id',
        'source_site',
        'source_form',
        'source_path',
        'name',
        'phone',
        'email',
        'city',
        'product_name',
        'applicant_type',
        'financing_type',
        'comment',
        'sale_amount',
        'down_payment_amount',
        'desired_term_months',
        'privacy_accepted',
        'privacy_version',
        'consent_source',
        'attribution',
        'honeypot',
    ];

    private const ATTRIBUTION_KEYS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'yclid',
        'ymclid',
        'gclid',
        'fbclid',
        'vk_click_id',
    ];

    /**
     * HTTP entry point. It intentionally does not bootstrap Bitrix, accept cookies,
     * or read any inbound Authorization header.
     */
    public static function run(): void
    {
        self::sendSecurityHeaders();

        $rawBody = file_get_contents('php://input');
        if (! is_string($rawBody)) {
            self::sendJson(400, self::errorBody('Не удалось прочитать запрос.'));

            return;
        }

        $prepared = self::prepareClientRequest([
            'method' => (string) ($_SERVER['REQUEST_METHOD'] ?? ''),
            'query_string' => (string) ($_SERVER['QUERY_STRING'] ?? ''),
            'files' => is_array($_FILES ?? null) ? $_FILES : [],
            'content_type' => (string) ($_SERVER['CONTENT_TYPE'] ?? ''),
            'content_length' => (string) ($_SERVER['CONTENT_LENGTH'] ?? ''),
            'raw_body' => $rawBody,
            'submission_id' => (string) ($_SERVER['HTTP_X_LEAD_SUBMISSION_ID'] ?? ''),
            'origin' => array_key_exists('HTTP_ORIGIN', $_SERVER)
                ? (string) $_SERVER['HTTP_ORIGIN']
                : null,
            'referer' => array_key_exists('HTTP_REFERER', $_SERVER)
                ? (string) $_SERVER['HTTP_REFERER']
                : null,
            'host' => (string) ($_SERVER['HTTP_HOST'] ?? ''),
        ]);

        if (! $prepared['ok']) {
            self::sendJson($prepared['status'], $prepared['body']);

            return;
        }

        if ($prepared['method'] === 'POST') {
            try {
                $catalog = self::readProductCatalog((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
            } catch (Throwable $exception) {
                self::sendJson(503, self::errorBody('Каталог для заявки временно недоступен.'));

                return;
            }

            if (! self::catalogAllowsPayload($prepared['payload'], $catalog)) {
                self::sendJson(422, self::errorBody('Модель или цена больше не соответствуют каталогу.'));

                return;
            }
        }

        try {
            // Requiring a valid server-side token for GET as well makes a broken
            // installation fail closed before the form can be enabled.
            $token = self::readSiteToken((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
            $upstream = self::callUpstream(
                $prepared['method'],
                $prepared['body_json'],
                $prepared['submission_id'],
                $token
            );
        } catch (Throwable $exception) {
            // Never log the exception, request body, contact data, or token here.
            self::sendJson(503, self::errorBody('Сервис финансирования временно недоступен.'));

            return;
        }

        if (! $upstream['ok']) {
            self::sendJson(502, self::errorBody('Сервис финансирования временно недоступен.'));

            return;
        }

        $safe = self::sanitizeUpstreamResponse(
            $prepared['method'],
            $prepared['submission_id'],
            $upstream['status'],
            $upstream['content_type'],
            $upstream['body']
        );

        self::sendJson($safe['status'], $safe['body']);
    }

    /**
     * Pure request boundary used by the CLI contract test.
     *
     * @param array<string,mixed> $request
     * @return array<string,mixed>
     */
    public static function prepareClientRequest(array $request): array
    {
        $method = strtoupper(trim((string) ($request['method'] ?? '')));
        if (! in_array($method, ['GET', 'POST'], true)) {
            return self::rejection(405, 'Метод не поддерживается.');
        }

        if ((string) ($request['query_string'] ?? '') !== '') {
            return self::rejection(400, 'Параметры в адресе прокси не принимаются.');
        }

        if (! self::isPublicHost((string) ($request['host'] ?? ''))
            || ! self::isSameOrigin(
                array_key_exists('origin', $request) ? $request['origin'] : null,
                array_key_exists('referer', $request) ? $request['referer'] : null
            )) {
            return self::rejection(403, 'Источник запроса не разрешён.');
        }

        if ((array) ($request['files'] ?? []) !== []) {
            return self::rejection(415, 'Загрузка файлов не поддерживается.');
        }

        $rawBody = (string) ($request['raw_body'] ?? '');
        $declaredLength = trim((string) ($request['content_length'] ?? ''));
        if ($declaredLength !== '' && (! ctype_digit($declaredLength)
            || (int) $declaredLength > self::MAX_REQUEST_BYTES)) {
            return self::rejection(413, 'Запрос слишком большой.');
        }

        if (strlen($rawBody) > self::MAX_REQUEST_BYTES) {
            return self::rejection(413, 'Запрос слишком большой.');
        }

        if ($method === 'GET') {
            if ($rawBody !== '' || ($declaredLength !== '' && (int) $declaredLength > 0)) {
                return self::rejection(400, 'GET-запрос не должен содержать тело.');
            }

            return [
                'ok' => true,
                'method' => 'GET',
                'submission_id' => '',
                'body_json' => '',
            ];
        }

        if (self::mediaType((string) ($request['content_type'] ?? '')) !== 'application/json') {
            return self::rejection(415, 'Поддерживается только application/json.');
        }

        $decodedObject = json_decode($rawBody, false, 16);
        if (! is_object($decodedObject) || json_last_error() !== JSON_ERROR_NONE) {
            return self::rejection(400, 'Тело запроса должно быть JSON-объектом.');
        }

        $payload = json_decode($rawBody, true, 16);
        if (! is_array($payload) || json_last_error() !== JSON_ERROR_NONE) {
            return self::rejection(400, 'Тело запроса должно быть JSON-объектом.');
        }

        $unknown = array_diff(array_keys($payload), self::ALLOWED_PAYLOAD_KEYS);
        if ($unknown !== []) {
            return self::rejection(422, 'В запросе есть неподдерживаемые поля.');
        }

        $submissionId = trim((string) ($request['submission_id'] ?? ''));
        $bodySubmissionId = is_string($payload['lead_submission_id'] ?? null)
            ? $payload['lead_submission_id']
            : '';
        if (! self::isSubmissionId($submissionId)
            || ! hash_equals($submissionId, $bodySubmissionId)) {
            return self::rejection(422, 'Идентификатор отправки не совпадает.');
        }

        if (($payload['source_site'] ?? null) !== self::PUBLIC_HOST
            || ($payload['source_form'] ?? null) !== 'credit_calculator'
            || ($payload['source_path'] ?? null) !== '/finansirovanie/'
            || ($payload['consent_source'] ?? null) !== 'rosomaha_rus_credit') {
            return self::rejection(422, 'Источник формы не совпадает.');
        }

        if (($payload['privacy_accepted'] ?? null) !== true
            || ! self::isSafeText($payload['privacy_version'] ?? null, 100, false)) {
            return self::rejection(422, 'Согласие не подтверждено.');
        }

        if (! self::isSafeText($payload['name'] ?? null, 255, false)
            || ! self::isSafeText($payload['phone'] ?? null, 40, false)
            || ! is_numeric($payload['sale_amount'] ?? null)) {
            return self::rejection(422, 'Обязательные поля заполнены неверно.');
        }

        if (($payload['honeypot'] ?? '') !== '') {
            return self::rejection(422, 'Запрос отклонён.');
        }

        if (! self::validAttribution($payload['attribution'] ?? null)) {
            return self::rejection(422, 'Данные источника перехода заполнены неверно.');
        }

        // Reassert all provenance fields after validation. Browser input can never
        // select another origin, path, form, or consent source.
        $payload['source_site'] = self::PUBLIC_HOST;
        $payload['source_form'] = 'credit_calculator';
        $payload['source_path'] = '/finansirovanie/';
        $payload['consent_source'] = 'rosomaha_rus_credit';

        $bodyJson = json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        if (! is_string($bodyJson) || strlen($bodyJson) > self::MAX_REQUEST_BYTES) {
            return self::rejection(413, 'Запрос слишком большой.');
        }

        return [
            'ok' => true,
            'method' => 'POST',
            'submission_id' => $submissionId,
            'body_json' => $bodyJson,
            'payload' => $payload,
        ];
    }

    /**
     * @param array<string,mixed> $payload
     * @param array<int,array<string,mixed>> $catalog
     */
    public static function catalogAllowsPayload(array $payload, array $catalog): bool
    {
        $productName = $payload['product_name'] ?? null;
        $saleAmount = $payload['sale_amount'] ?? null;
        $downPayment = $payload['down_payment_amount'] ?? null;
        $term = $payload['desired_term_months'] ?? null;

        if (! is_string($productName) || ! is_int($saleAmount) || $saleAmount <= 0
            || ! is_int($downPayment) || $downPayment < 0 || $downPayment > $saleAmount
            || ! is_int($term) || ! in_array($term, [12, 24, 36, 48, 60], true)
            || ! in_array($payload['applicant_type'] ?? null, ['individual', 'sole_proprietor', 'company'], true)
            || ! in_array($payload['financing_type'] ?? null, ['credit', 'leasing', 'installment', 'unsure'], true)) {
            return false;
        }

        foreach ($catalog as $product) {
            if (($product['name'] ?? null) === $productName
                && ($product['price_rub'] ?? null) === $saleAmount) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<int,array<string,mixed>>
     * @throws RuntimeException
     */
    public static function readProductCatalog(string $documentRoot): array
    {
        $webRoot = realpath($documentRoot);
        if ($webRoot === false) {
            throw new RuntimeException('Document root is unavailable.');
        }

        $configuredPath = $webRoot.'/finansirovanie/config/products.v1.json';
        if (is_link($configuredPath)) {
            throw new RuntimeException('Catalog path is unsafe.');
        }

        $catalogPath = realpath($configuredPath);
        if ($catalogPath === false || ! is_file($catalogPath)
            || ! self::pathIsWithin($catalogPath, $webRoot)) {
            throw new RuntimeException('Catalog is unavailable.');
        }

        $mode = @fileperms($catalogPath);
        $size = @filesize($catalogPath);
        if ($mode === false || (DIRECTORY_SEPARATOR === '/' && (($mode & 0022) !== 0))
            || $size === false || $size < 1 || $size > self::MAX_RESPONSE_BYTES) {
            throw new RuntimeException('Catalog permissions or size are unsafe.');
        }

        $raw = @file_get_contents($catalogPath);
        $decodedObject = is_string($raw) ? json_decode($raw, false, 16) : null;
        $decoded = is_string($raw) ? json_decode($raw, true, 16) : null;
        if (! is_object($decodedObject) || ! is_array($decoded)
            || json_last_error() !== JSON_ERROR_NONE
            || ($decoded['contract'] ?? null) !== 'rosomaha-finance-products/v1'
            || ($decoded['currency'] ?? null) !== 'RUB'
            || ($decoded['price_semantics'] ?? null) !== 'catalog_base_price'
            || ! self::isSafeText($decoded['catalog_version'] ?? null, 100, false)
            || ! is_array($decoded['products'] ?? null)
            || count($decoded['products']) < 1
            || count($decoded['products']) > 100) {
            throw new RuntimeException('Catalog contract is invalid.');
        }

        $products = [];
        $seenIds = [];
        $seenNames = [];
        foreach ($decoded['products'] as $product) {
            if (! is_array($product)
                || ! is_string($product['id'] ?? null)
                || preg_match('/\A[a-z0-9-]{1,100}\z/', $product['id']) !== 1
                || ! self::isSafeText($product['name'] ?? null, 255, false)
                || ! self::isSafeText($product['slug'] ?? null, 255, false)
                || ! is_int($product['price_rub'] ?? null)
                || $product['price_rub'] <= 0
                || isset($seenIds[$product['id']])
                || isset($seenNames[$product['name']])) {
                throw new RuntimeException('Catalog product is invalid.');
            }

            $seenIds[$product['id']] = true;
            $seenNames[$product['name']] = true;
            $products[] = [
                'id' => $product['id'],
                'name' => $product['name'],
                'slug' => $product['slug'],
                'price_rub' => $product['price_rub'],
            ];
        }

        return $products;
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public static function sanitizeUpstreamResponse(
        string $method,
        string $expectedSubmissionId,
        int $status,
        string $contentType,
        string $rawBody
    ): array {
        if (self::mediaType($contentType) !== 'application/json'
            || strlen($rawBody) > self::MAX_RESPONSE_BYTES) {
            return ['status' => 502, 'body' => self::errorBody('Некорректный ответ сервиса финансирования.')];
        }

        $decodedObject = json_decode($rawBody);
        $decoded = json_decode($rawBody, true, 16);
        if (! is_object($decodedObject) || ! is_array($decoded)
            || json_last_error() !== JSON_ERROR_NONE) {
            return ['status' => 502, 'body' => self::errorBody('Некорректный ответ сервиса финансирования.')];
        }

        if ($method === 'GET' && $status === 200) {
            $document = $decoded['privacy_document'] ?? null;
            if (($decoded['status'] ?? null) !== 'ok'
                || ! is_array($document)
                || ($document['kind'] ?? null) !== 'personal_data_processing'
                || ! self::isSafeText($document['version'] ?? null, 100, false)
                || ! self::isSafeText($document['title'] ?? null, 500, false)
                || ! self::isSafeText($document['text'] ?? null, 100000, false)
                || ! is_string($document['sha256'] ?? null)
                || preg_match('/\A[a-f0-9]{64}\z/', $document['sha256']) !== 1) {
                return ['status' => 502, 'body' => self::errorBody('Некорректный ответ сервиса финансирования.')];
            }

            return [
                'status' => 200,
                'body' => [
                    'status' => 'ok',
                    'privacy_document' => [
                        'kind' => $document['kind'],
                        'version' => $document['version'],
                        'title' => $document['title'],
                        'text' => $document['text'],
                        'sha256' => $document['sha256'],
                    ],
                ],
            ];
        }

        if ($method === 'POST' && in_array($status, [200, 201], true)) {
            $echoedId = $decoded['lead_submission_id'] ?? null;
            $receiptId = $decoded['receipt_id'] ?? null;
            if (($decoded['status'] ?? null) !== 'ok'
                || ! is_string($echoedId)
                || ! hash_equals($expectedSubmissionId, $echoedId)
                || ! is_string($receiptId)
                || preg_match('/\Afin_[a-f0-9]{32}\z/', $receiptId) !== 1
                || ! is_bool($decoded['created'] ?? null)
                || ! is_bool($decoded['deduplicated'] ?? null)
                || $decoded['created'] === $decoded['deduplicated']) {
                return ['status' => 502, 'body' => self::errorBody('Некорректный ответ сервиса финансирования.')];
            }

            return [
                'status' => $status,
                'body' => [
                    'status' => 'ok',
                    'receipt_id' => $receiptId,
                    'lead_submission_id' => $echoedId,
                    'created' => $decoded['created'],
                    'deduplicated' => $decoded['deduplicated'],
                ],
            ];
        }

        $allowedStatuses = [400, 403, 404, 409, 413, 415, 422, 429, 500, 503];
        if (! in_array($status, $allowedStatuses, true)) {
            return ['status' => 502, 'body' => self::errorBody('Некорректный ответ сервиса финансирования.')];
        }

        $messages = [
            400 => 'Запрос заполнен неверно.',
            403 => 'Запрос отклонён.',
            404 => 'Сервис финансирования недоступен.',
            409 => 'Не удалось подтвердить повторную отправку.',
            413 => 'Запрос слишком большой.',
            415 => 'Формат запроса не поддерживается.',
            422 => 'Проверьте заполненные поля.',
            429 => 'Слишком много попыток. Повторите позже.',
            500 => 'Сервис финансирования временно недоступен.',
            503 => 'Сервис финансирования временно недоступен.',
        ];
        $body = self::errorBody($messages[$status]);

        if ($status === 422 && is_array($decoded['errors'] ?? null)) {
            $fields = [];
            foreach (array_keys($decoded['errors']) as $field) {
                if (is_string($field)
                    && preg_match('/\A[a-z][a-z0-9_.-]{0,79}\z/i', $field) === 1) {
                    $fields[] = $field;
                }
            }
            if ($fields !== []) {
                $body['fields'] = array_values(array_unique($fields));
            }
        }

        return ['status' => $status, 'body' => $body];
    }

    public static function isSafeTokenMode(int $mode): bool
    {
        $permissions = $mode & 0777;

        return ($permissions & 0400) !== 0
            && ($permissions & 0037) === 0;
    }

    /**
     * @throws RuntimeException
     */
    public static function readSiteToken(string $documentRoot): string
    {
        $configured = defined('ROSOMAHA_FINANCE_TOKEN_FILE')
            ? (string) constant('ROSOMAHA_FINANCE_TOKEN_FILE')
            : (string) (getenv('ROSOMAHA_FINANCE_TOKEN_FILE') ?: self::DEFAULT_TOKEN_FILE);
        $configured = trim($configured);

        if ($configured === '' || strpos($configured, "\0") !== false
            || $configured[0] !== '/' || is_link($configured)) {
            throw new RuntimeException('Unsafe token file path.');
        }

        $tokenPath = realpath($configured);
        $webRoot = $documentRoot !== '' ? realpath($documentRoot) : false;
        if ($tokenPath === false || ! is_file($tokenPath)
            || ($webRoot !== false && self::pathIsWithin($tokenPath, $webRoot))) {
            throw new RuntimeException('Token file is unavailable.');
        }

        $owner = @fileowner($tokenPath);
        $mode = @fileperms($tokenPath);
        $size = @filesize($tokenPath);
        if ($owner === false || (int) $owner !== 0 || $mode === false
            || ! self::isSafeTokenMode($mode)
            || $size === false || $size < 1 || $size > 4096) {
            throw new RuntimeException('Token file ownership or permissions are unsafe.');
        }

        $token = @file_get_contents($tokenPath);
        $token = is_string($token) ? trim($token) : '';
        if (preg_match('/\A[\x21-\x7E]{32,512}\z/', $token) !== 1) {
            throw new RuntimeException('Token file content is invalid.');
        }

        return $token;
    }

    /**
     * @return array{ok:bool,status?:int,content_type?:string,body?:string}
     */
    private static function callUpstream(
        string $method,
        string $bodyJson,
        string $submissionId,
        string $token
    ): array {
        if (! function_exists('curl_init')) {
            throw new RuntimeException('cURL is required.');
        }

        $responseBody = '';
        $responseTooLarge = false;
        $curl = curl_init(self::UPSTREAM_URL);
        if ($curl === false) {
            throw new RuntimeException('Unable to initialize cURL.');
        }

        $headers = [
            'Accept: application/json',
            'Accept-Encoding: identity',
            'Origin: '.self::PUBLIC_ORIGIN,
            'User-Agent: RosomahaLegacyFinanceProxy/1.0',
        ];
        $options = [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROXY => '',
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$responseBody, &$responseTooLarge): int {
                if (strlen($responseBody) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    $responseTooLarge = true;

                    return 0;
                }

                $responseBody .= $chunk;

                return strlen($chunk);
            },
        ];

        if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
            $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
        }
        if (defined('CURLOPT_REDIR_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
            $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS;
        }

        if ($method === 'POST') {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = $bodyJson;
            $headers[] = 'Content-Type: application/json';
            $headers[] = 'X-Lead-Submission-ID: '.$submissionId;
            $headers[] = 'X-Rosomaha-Site-Token: '.$token;
            $options[CURLOPT_HTTPHEADER] = $headers;
        } else {
            $options[CURLOPT_HTTPGET] = true;
        }

        curl_setopt_array($curl, $options);
        $executed = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
        $curlError = curl_errno($curl);
        curl_close($curl);

        if ($executed === false || $curlError !== 0 || $responseTooLarge
            || $status < 100 || $status > 599) {
            return ['ok' => false];
        }

        return [
            'ok' => true,
            'status' => $status,
            'content_type' => $contentType,
            'body' => $responseBody,
        ];
    }

    /** @return array{ok:bool,status:int,body:array<string,string>} */
    private static function rejection(int $status, string $message): array
    {
        return ['ok' => false, 'status' => $status, 'body' => self::errorBody($message)];
    }

    /** @return array{status:string,message:string} */
    private static function errorBody(string $message): array
    {
        return ['status' => 'error', 'message' => $message];
    }

    private static function sendSecurityHeaders(): void
    {
        header_remove('X-Powered-By');
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
    }

    /** @param array<string,mixed> $body */
    private static function sendJson(int $status, array $body): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=UTF-8');
        $encoded = json_encode(
            $body,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        echo is_string($encoded)
            ? $encoded
            : '{"status":"error","message":"Response encoding failed."}';
    }

    private static function mediaType(string $contentType): string
    {
        $parts = explode(';', strtolower(trim($contentType)), 2);

        return trim($parts[0]);
    }

    private static function isSubmissionId(string $value): bool
    {
        return preg_match('/\Arosomaha-[0-9]{10,}-[a-z0-9](?:[a-z0-9-]{4,98}[a-z0-9])\z/i', $value) === 1;
    }

    /** @param mixed $value */
    private static function isSafeText($value, int $maxBytes, bool $allowEmpty): bool
    {
        if (! is_string($value) || strlen($value) > $maxBytes
            || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value) === 1) {
            return false;
        }

        return $allowEmpty || trim($value) !== '';
    }

    /** @param mixed $attribution */
    private static function validAttribution($attribution): bool
    {
        if ($attribution === null) {
            return true;
        }

        if (! is_array($attribution) || self::isList($attribution)) {
            return false;
        }

        foreach ($attribution as $key => $value) {
            if (! is_string($key) || ! in_array($key, self::ATTRIBUTION_KEYS, true)
                || ! self::isSafeText($value, 255, false)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<mixed> $value */
    private static function isList(array $value): bool
    {
        if ($value === []) {
            return false;
        }

        return array_keys($value) === range(0, count($value) - 1);
    }

    private static function isPublicHost(string $host): bool
    {
        $host = strtolower(trim($host));

        return $host === self::PUBLIC_HOST;
    }

    /** @param mixed $origin @param mixed $referer */
    private static function isSameOrigin($origin, $referer): bool
    {
        if ($origin !== null) {
            return is_string($origin) && trim($origin) === self::PUBLIC_ORIGIN;
        }

        if (! is_string($referer) || trim($referer) === '') {
            return false;
        }

        $parts = parse_url(trim($referer));

        return is_array($parts)
            && ($parts['scheme'] ?? null) === 'https'
            && strtolower((string) ($parts['host'] ?? '')) === self::PUBLIC_HOST
            && ! isset($parts['port'])
            && ! isset($parts['user'])
            && ! isset($parts['pass']);
    }

    private static function pathIsWithin(string $path, string $parent): bool
    {
        $path = rtrim(str_replace('\\', '/', $path), '/');
        $parent = rtrim(str_replace('\\', '/', $parent), '/');

        return $path === $parent || strpos($path.'/', $parent.'/') === 0;
    }
}
