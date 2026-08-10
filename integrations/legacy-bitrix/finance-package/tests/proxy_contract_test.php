<?php

declare(strict_types=1);

define('ROSOMAHA_FINANCE_PROXY_INTERNAL', true);

require_once dirname(__DIR__).'/payload/webroot/local/php_interface/include/rosomaha_finance_proxy.php';

use Rosomaha\Finance\FinanceProxy;

$assertions = 0;

/** @param mixed $actual @param mixed $expected */
function same($actual, $expected, string $message): void
{
    global $assertions;
    $assertions++;
    if ($actual !== $expected) {
        throw new RuntimeException($message.' Expected '.var_export($expected, true).', got '.var_export($actual, true));
    }
}

function truth(bool $condition, string $message): void
{
    global $assertions;
    $assertions++;
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

/** @return array<string,mixed> */
function payload(string $submissionId = 'rosomaha-1721212121000-contracttest'): array
{
    return [
        'lead_submission_id' => $submissionId,
        'source_site' => 'rosomaha-rus.ru',
        'source_form' => 'credit_calculator',
        'source_path' => '/finansirovanie/',
        'name' => 'Иван Петров',
        'phone' => '79991234567',
        'email' => 'ivan@example.test',
        'city' => 'Екатеринбург',
        'product_name' => 'Егерь-1 (Волга)',
        'applicant_type' => 'individual',
        'financing_type' => 'credit',
        'comment' => 'Нужна консультация по сроку.',
        'sale_amount' => 850000,
        'down_payment_amount' => 300000,
        'desired_term_months' => 36,
        'privacy_accepted' => true,
        'privacy_version' => 'public-finance-pd-v1',
        'consent_source' => 'rosomaha_rus_credit',
        'attribution' => ['utm_source' => 'yandex', 'yclid' => '123456'],
        'honeypot' => '',
    ];
}

/** @param array<string,mixed> $overrides @param array<string,mixed>|null $body */
function request(array $overrides = [], ?array $body = null): array
{
    $body = $body ?? payload();
    $raw = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return array_replace([
        'method' => 'POST',
        'query_string' => '',
        'files' => [],
        'content_type' => 'application/json; charset=UTF-8',
        'content_length' => (string) strlen((string) $raw),
        'raw_body' => (string) $raw,
        'submission_id' => (string) ($body['lead_submission_id'] ?? ''),
        'origin' => 'https://rosomaha-rus.ru',
        'referer' => null,
        'host' => 'rosomaha-rus.ru',
    ], $overrides);
}

$get = FinanceProxy::prepareClientRequest(request([
    'method' => 'GET',
    'content_type' => '',
    'content_length' => '',
    'raw_body' => '',
    'submission_id' => '',
]));
same($get['ok'], true, 'A same-origin GET must be accepted.');
same($get['method'], 'GET', 'GET must remain GET.');

$refererGet = FinanceProxy::prepareClientRequest(request([
    'method' => 'GET',
    'content_type' => '',
    'content_length' => '',
    'raw_body' => '',
    'submission_id' => '',
    'origin' => null,
    'referer' => 'https://rosomaha-rus.ru/finansirovanie/',
]));
same($refererGet['ok'], true, 'A same-origin Referer fallback must be accepted.');

$post = FinanceProxy::prepareClientRequest(request());
same($post['ok'], true, 'A valid POST must be accepted.');
same($post['submission_id'], payload()['lead_submission_id'], 'The submission header must be preserved.');
$forwarded = json_decode($post['body_json'], true);
same($forwarded['source_site'], 'rosomaha-rus.ru', 'The source host must be pinned.');
same($forwarded['source_form'], 'credit_calculator', 'The source form must be pinned.');
same($forwarded['source_path'], '/finansirovanie/', 'The source path must be pinned.');
same($forwarded['consent_source'], 'rosomaha_rus_credit', 'The consent source must be pinned.');
$catalogRoot = dirname(__DIR__).'/payload/webroot';
$catalog = FinanceProxy::readProductCatalog($catalogRoot);
truth(count($catalog) > 0, 'The installed catalog contract must be readable by the proxy.');
truth(FinanceProxy::catalogAllowsPayload($post['payload'], $catalog), 'The canonical product and price must pass the server catalog gate.');
$tamperedPrice = $post['payload'];
$tamperedPrice['sale_amount'] = 1;
truth(! FinanceProxy::catalogAllowsPayload($tamperedPrice, $catalog), 'A browser-tampered product price must fail.');
$tamperedProduct = $post['payload'];
$tamperedProduct['product_name'] = 'Несуществующая модель';
truth(! FinanceProxy::catalogAllowsPayload($tamperedProduct, $catalog), 'An unknown browser product must fail.');

$negativeCases = [
    'method' => request(['method' => 'PUT']),
    'query' => request(['query_string' => 'debug=1']),
    'file' => request(['files' => ['document' => ['name' => 'passport.pdf']]]),
    'media' => request(['content_type' => 'multipart/form-data']),
    'origin' => request(['origin' => 'https://evil.example']),
    'missing_origin' => request(['origin' => null, 'referer' => null]),
    'host' => request(['host' => 'evil.example']),
    'id_header' => request(['submission_id' => 'rosomaha-1721212121000-anotherid']),
];
$expectedStatuses = [
    'method' => 405,
    'query' => 400,
    'file' => 415,
    'media' => 415,
    'origin' => 403,
    'missing_origin' => 403,
    'host' => 403,
    'id_header' => 422,
];
foreach ($negativeCases as $name => $case) {
    $result = FinanceProxy::prepareClientRequest($case);
    same($result['ok'], false, $name.' must fail closed.');
    same($result['status'], $expectedStatuses[$name], $name.' must have the expected status.');
}

$unknownBody = payload();
$unknownBody['authorization'] = 'must-not-forward';
$unknown = FinanceProxy::prepareClientRequest(request([], $unknownBody));
same($unknown['status'], 422, 'Unknown fields must be rejected.');

$wrongSourceBody = payload();
$wrongSourceBody['source_site'] = 'xn--80aa8ahaki9a.site';
$wrongSource = FinanceProxy::prepareClientRequest(request([], $wrongSourceBody));
same($wrongSource['status'], 422, 'A different allowed CRM source must still be rejected by this proxy.');

$oversize = FinanceProxy::prepareClientRequest(request([
    'raw_body' => str_repeat('x', FinanceProxy::MAX_REQUEST_BYTES + 1),
    'content_length' => (string) (FinanceProxy::MAX_REQUEST_BYTES + 1),
]));
same($oversize['status'], 413, 'Oversize bodies must be rejected before JSON parsing.');

truth(FinanceProxy::isSafeTokenMode(0640), '0640 must be accepted for a root-owned token file.');
truth(FinanceProxy::isSafeTokenMode(0600), '0600 must be accepted for a root-owned token file.');
truth(! FinanceProxy::isSafeTokenMode(0644), 'World-readable tokens must be rejected.');
truth(! FinanceProxy::isSafeTokenMode(0660), 'Group-writable tokens must be rejected.');

$legalText = 'Действующий текст согласия.';
$legalJson = json_encode([
    'status' => 'ok',
    'privacy_document' => [
        'kind' => 'personal_data_processing',
        'version' => 'public-finance-pd-v7',
        'title' => 'Согласие на обработку персональных данных',
        'text' => $legalText,
        'sha256' => hash('sha256', $legalText),
        'tenant_id' => 999,
    ],
], JSON_UNESCAPED_UNICODE);
$safeLegal = FinanceProxy::sanitizeUpstreamResponse('GET', '', 200, 'application/json; charset=UTF-8', (string) $legalJson);
same($safeLegal['status'], 200, 'Valid legal metadata must pass.');
truth(! array_key_exists('tenant_id', $safeLegal['body']['privacy_document']), 'Internal legal fields must be stripped.');

$submissionId = payload()['lead_submission_id'];
$receipt = 'fin_'.str_repeat('a', 32);
$successJson = json_encode([
    'status' => 'ok',
    'receipt_id' => $receipt,
    'lead_submission_id' => $submissionId,
    'created' => true,
    'deduplicated' => false,
    'deal_id' => 123,
    'finance_application_id' => 456,
], JSON_UNESCAPED_UNICODE);
$safeSuccess = FinanceProxy::sanitizeUpstreamResponse('POST', $submissionId, 201, 'application/json', (string) $successJson);
same($safeSuccess['status'], 201, 'A valid opaque receipt must pass.');
same($safeSuccess['body']['receipt_id'], $receipt, 'The opaque receipt must be returned.');
truth(! array_key_exists('deal_id', $safeSuccess['body']), 'Internal deal IDs must be stripped.');
truth(! array_key_exists('finance_application_id', $safeSuccess['body']), 'Internal finance IDs must be stripped.');

$wrongEcho = json_encode(array_replace(json_decode((string) $successJson, true), [
    'lead_submission_id' => 'rosomaha-1721212121000-wrongecho',
]));
$unsafeSuccess = FinanceProxy::sanitizeUpstreamResponse('POST', $submissionId, 201, 'application/json', (string) $wrongEcho);
same($unsafeSuccess['status'], 502, 'A mismatched echo must never become success.');

$unsafeReceipt = json_encode(array_replace(json_decode((string) $successJson, true), [
    'receipt_id' => 'deal-123',
]));
$unsafeReceiptResult = FinanceProxy::sanitizeUpstreamResponse('POST', $submissionId, 201, 'application/json', (string) $unsafeReceipt);
same($unsafeReceiptResult['status'], 502, 'A non-opaque receipt must never become success.');

$impossibleFlags = json_encode(array_replace(json_decode((string) $successJson, true), [
    'created' => true,
    'deduplicated' => true,
]));
$impossibleFlagsResult = FinanceProxy::sanitizeUpstreamResponse('POST', $submissionId, 201, 'application/json', (string) $impossibleFlags);
same($impossibleFlagsResult['status'], 502, 'Created and deduplicated cannot have the same value.');

$validationJson = json_encode([
    'status' => 'error',
    'message' => 'Sensitive upstream message: Ivan',
    'errors' => [
        'phone' => ['Sensitive phone value'],
        'bad field!' => ['Unsafe field name'],
    ],
]);
$safeValidation = FinanceProxy::sanitizeUpstreamResponse('POST', $submissionId, 422, 'application/json', (string) $validationJson);
same($safeValidation['status'], 422, 'A safe validation status must pass.');
same($safeValidation['body']['fields'], ['phone'], 'Only safe error field names may pass.');
truth(strpos($safeValidation['body']['message'], 'Ivan') === false, 'Upstream error text must not pass through.');

$librarySource = file_get_contents(dirname(__DIR__).'/payload/webroot/local/php_interface/include/rosomaha_finance_proxy.php');
truth(is_string($librarySource), 'Proxy source must be readable.');
truth(strpos($librarySource, "CURLOPT_SSL_VERIFYPEER => true") !== false, 'TLS peer verification must be enabled.');
truth(strpos($librarySource, "CURLOPT_SSL_VERIFYHOST => 2") !== false, 'TLS host verification must be enabled.');
truth(strpos($librarySource, "CURLOPT_FOLLOWLOCATION => false") !== false, 'Redirect following must be disabled.');
truth(strpos($librarySource, "CURLOPT_PROXY => ''") !== false, 'Ambient outbound proxies must be disabled.');
truth(strpos($librarySource, 'X-Rosomaha-Site-Token: \'.$token') !== false, 'The server token must be attached upstream.');
truth(strpos($librarySource, 'Cookie:') === false, 'Cookies must never be forwarded.');
truth(strpos($librarySource, 'Authorization:') === false, 'Authorization must never be forwarded.');
truth(strpos($librarySource, 'error_log(') === false, 'The proxy must not log request bodies or PII.');

echo "proxy_contract_test: {$assertions} assertions passed\n";
