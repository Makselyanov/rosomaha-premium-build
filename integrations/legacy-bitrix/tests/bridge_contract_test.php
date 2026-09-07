<?php

define('B_PROLOG_INCLUDED', true);

$registeredEvents = [];
$bridgeLogMessages = [];

function AddEventHandler($module, $event, $handler): void
{
    global $registeredEvents;
    $registeredEvents[] = [$module, $event, $handler];
}

function AddMessage2Log($message, $module): void
{
    global $bridgeLogMessages;
    $bridgeLogMessages[] = [$message, $module];
}

require dirname(__DIR__) . '/local/php_interface/rosomaha_crm_bridge.php';

function callPrivate(string $method, array $arguments = [])
{
    $reflection = new ReflectionMethod(RosomahaCrmBridge::class, $method);

    return $reflection->invokeArgs(null, $arguments);
}

function assertSameValue($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual: ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

function assertTrueValue(bool $actual, string $message): void
{
    if (!$actual) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function assertNullValue($actual, string $message): void
{
    assertSameValue(null, $actual, $message);
}

assertSameValue('form', $registeredEvents[0][0] ?? null, 'Form module event was not registered.');
assertSameValue('onAfterResultAdd', $registeredEvents[0][1] ?? null, 'Result event was not registered.');

$safePage = callPrivate('sanitizePageUrl', [
    'https://www.rosomaha-rus.ru/sotrudnichestvo/?utm_source=yandex&utm_medium=cpc&phone=secret#fragment',
]);
assertSameValue(
    'https://rosomaha-rus.ru/sotrudnichestvo/?utm_source=yandex&utm_medium=cpc',
    $safePage,
    'Page URL must retain only attribution parameters.'
);
assertSameValue(
    'rosomaha-rus.ru/sotrudnichestvo',
    callPrivate('sourceForPage', [$safePage]),
    'Cooperation source mapping failed.'
);
assertSameValue(
    'rosomaha-rus.ru/komplektuyshie',
    callPrivate('sourceForPage', ['https://rosomaha-rus.ru/komplektuyshie/']),
    'Parts source mapping failed.'
);
assertSameValue(
    'rosomaha-rus.ru',
    callPrivate('sourceForPage', ['https://rosomaha-rus.ru/catalog/']),
    'Root source mapping failed.'
);

$tracking = callPrivate('trackingFromContext', [[
    'tracking' => [
        'utm_source' => 'cookie-source',
        'utm_medium' => 'cookie-medium',
        'yclid' => 'cookie-yclid',
        'gclid' => 'invalid click id',
    ],
    'ym_client_id' => '1234567890123456789',
], 'https://rosomaha-rus.ru/catalog/?utm_source=url-source&utm_campaign=url-campaign&yclid=url-yclid']);
assertSameValue('url-source', $tracking['utm_source'] ?? null, 'URL UTM must override its cookie value.');
assertSameValue('url-campaign', $tracking['utm_campaign'] ?? null, 'Current URL campaign was not retained.');
assertSameValue('url-yclid', $tracking['yclid'] ?? null, 'URL click id must override its cookie value.');
assertSameValue('cookie-medium', $tracking['utm_medium'] ?? null, 'Cookie fallback must fill a missing URL UTM.');
assertSameValue('1234567890123456789', $tracking['ym_client_id'] ?? null, 'Valid Metrika ClientID was lost.');
assertTrueValue(!isset($tracking['gclid']), 'Invalid click id must be rejected.');
assertSameValue('1234567890123456789', callPrivate('sanitizeClientId', ['1234567890123456789']), 'Valid ClientID was rejected.');
assertSameValue('', callPrivate('sanitizeClientId', ['1234-not-a-client']), 'Invalid ClientID was accepted.');
assertSameValue('', callPrivate('sanitizeClientId', [['1234567890123456789']]), 'Array ClientID was accepted.');
assertSameValue('', callPrivate('sanitizeTrackingValue', ['utm_source', ['nested']]), 'Array attribution value was accepted.');

$submissionId = callPrivate('submissionId', [1721212121, 7, 430]);
if (!preg_match('/^rosomaha-[0-9]{10,}-[a-z0-9-]{6,100}$/i', $submissionId)) {
    fwrite(STDERR, 'Submission ID violates the CRM contract.' . PHP_EOL);
    exit(1);
}

$crmPayload = ['lead_submission_id' => $submissionId];
$validAck = callPrivate('parseCrmAck', [$crmPayload, [
    'http_code' => 201,
    'curl_errno' => 0,
    'body' => json_encode([
        'status' => 'ok',
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-812',
    ]),
]]);
assertSameValue('D-812', $validAck['deal_id'] ?? null, 'A valid exact CRM acknowledgement was rejected.');
callPrivate('log', ['crm_acknowledged', 7, 430, ['deal_id' => 'D-812']]);
assertTrueValue(
    str_contains((string) ($bridgeLogMessages[0][0] ?? ''), '"deal_id":"D-812"'),
    'Operational log lost a valid string CRM deal_id.'
);

foreach ([
    [
        'http_code' => 201,
        'curl_errno' => 0,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId . '-other', 'deal_id' => 812]),
    ],
    [
        'http_code' => 201,
        'curl_errno' => 0,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId, 'deal_id' => '']),
    ],
    [
        'http_code' => 201,
        'curl_errno' => 0,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId, 'deal_id' => 0]),
    ],
    [
        'http_code' => 201,
        'curl_errno' => 0,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId, 'deal_id' => true]),
    ],
    [
        'http_code' => 500,
        'curl_errno' => 0,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId, 'deal_id' => 812]),
    ],
    [
        'http_code' => 201,
        'curl_errno' => 28,
        'body' => json_encode(['status' => 'ok', 'lead_submission_id' => $submissionId, 'deal_id' => 812]),
    ],
] as $invalidAck) {
    assertNullValue(
        callPrivate('parseCrmAck', [$crmPayload, $invalidAck]),
        'CRM hard-goal gate accepted an invalid acknowledgement.'
    );
}

$recordWithAck = [
    'lead_submission_id' => $submissionId,
    'crm_ack' => [
        'status' => 'ok',
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-812',
    ],
];
assertSameValue(false, callPrivate('requiresCrmDelivery', [$recordWithAck]), 'Metrika retry would recreate an acknowledged CRM deal.');
$legacyPendingV1 = [
    'version' => 1,
    'form_id' => 7,
    'result_id' => 429,
    'context' => [],
];
assertSameValue(true, callPrivate('requiresCrmDelivery', [$legacyPendingV1]), 'Legacy pending v1 record must enter the CRM ACK migration path.');
$attemptingRecord = $recordWithAck;
$attemptingRecord['metrika']['hard_goal'] = [
    'status' => 'attempting',
    'attempted_at' => '2026-08-24T12:00:06+05:00',
];
assertSameValue(false, callPrivate('requiresCrmDelivery', [$attemptingRecord]), 'Saved CRM ACK must still suppress another CRM delivery.');
assertSameValue(
    'manual_review',
    callPrivate('hardGoalResumeAction', [$attemptingRecord]),
    'Saved attempting hard goal would be dispatched a second time.'
);
$failedHardRecord = $recordWithAck;
$failedHardRecord['metrika']['hard_goal'] = ['status' => 'failed'];
assertSameValue('send', callPrivate('hardGoalResumeAction', [$failedHardRecord]), 'Definitive hard-goal failure must remain retryable.');
$sentHardRecord = $recordWithAck;
$sentHardRecord['metrika']['hard_goal'] = ['status' => 'sent'];
assertSameValue('finalize_sent', callPrivate('hardGoalResumeAction', [$sentHardRecord]), 'Saved sent goal must finalize without resend.');
$recordWithAck['crm_ack']['lead_submission_id'] .= '-wrong';
assertSameValue(true, callPrivate('requiresCrmDelivery', [$recordWithAck]), 'Mismatched stored acknowledgement must not bypass CRM verification.');

$config = callPrivate('parseMetrikaConfigJson', [json_encode([
    'counter_id' => 110600001,
    'measurement_token' => 'measurement-token_1234567890',
])]);
assertSameValue(110600001, $config['counter_id'] ?? null, 'Valid server-only Metrika config was rejected.');
assertSameValue('measurement-token_1234567890', $config['measurement_token'] ?? null, 'Private config parser lost the token.');
assertNullValue(
    callPrivate('parseMetrikaConfigJson', [json_encode(['counter_id' => 'bad', 'measurement_token' => 'measurement-token_1234567890'])]),
    'Invalid counter id was accepted.'
);
assertNullValue(
    callPrivate('parseMetrikaConfigJson', [json_encode(['counter_id' => 110600001, 'measurement_token' => 'short'])]),
    'Invalid Measurement Protocol token was accepted.'
);

$metrikaFields = callPrivate('buildMetrikaFields', [[
    'counter_id' => 110600001,
    'measurement_token' => 'measurement-token_1234567890',
], '1234567890123456789', 'crm_conversion', 'https://rosomaha-rus.ru/catalog/', [
    'crm' => [
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-812',
    ],
]]);
assertSameValue(
    ['tid', 'cid', 't', 'ea', 'dl', 'params', 'ms'],
    array_keys($metrikaFields),
    'Measurement Protocol field contract changed.'
);
assertSameValue('110600001', $metrikaFields['tid'] ?? null, 'Measurement Protocol counter id is missing.');
assertSameValue('1234567890123456789', $metrikaFields['cid'] ?? null, 'Measurement Protocol ClientID is missing.');
assertSameValue('event', $metrikaFields['t'] ?? null, 'Measurement Protocol hit type must be event.');
assertSameValue('crm_conversion', $metrikaFields['ea'] ?? null, 'Hard action name changed.');
assertTrueValue(!array_key_exists('et', $metrikaFields), 'Measurement Protocol et must not contain a title; Yandex reserves it for a Unix timestamp.');
assertSameValue('https://rosomaha-rus.ru/catalog/', $metrikaFields['dl'] ?? null, 'Document URL is missing.');
assertSameValue('measurement-token_1234567890', $metrikaFields['ms'] ?? null, 'Measurement Protocol secret is missing from POST fields.');
$metrikaParams = json_decode((string) ($metrikaFields['params'] ?? ''), true);
assertSameValue($submissionId, $metrikaParams['crm']['lead_submission_id'] ?? null, 'Hard event lost the exact lead_submission_id.');
assertSameValue('D-812', $metrikaParams['crm']['deal_id'] ?? null, 'Hard event lost the confirmed deal_id.');

$unsafeMetrikaFields = callPrivate('buildMetrikaFields', [[
    'counter_id' => 110600001,
    'measurement_token' => 'measurement-token_1234567890',
], '1234567890123456789', 'crm_conversion', 'https://rosomaha-rus.ru/catalog/', [
    'crm' => [
        'lead_submission_id' => 'bad value with spaces',
        'deal_id' => '<script>',
    ],
    'private' => ['phone' => '+79990000000'],
]]);
assertTrueValue(!array_key_exists('params', $unsafeMetrikaFields), 'Unsafe or unapproved event parameters reached Metrika.');

assertSameValue('sent', callPrivate('classifyMetrikaResponse', [[
    'http_code' => 200,
    'curl_errno' => 0,
    'dispatched' => true,
]])['status'] ?? null, 'Successful Measurement Protocol response was not accepted.');
assertSameValue('failed', callPrivate('classifyMetrikaResponse', [[
    'http_code' => 0,
    'curl_errno' => 6,
    'dispatched' => false,
]])['status'] ?? null, 'Pre-dispatch transport failure must remain retryable.');
assertSameValue('failed', callPrivate('classifyMetrikaResponse', [[
    'http_code' => 400,
    'curl_errno' => 0,
    'dispatched' => true,
]])['status'] ?? null, 'Definitive HTTP rejection must remain retryable.');
assertSameValue('metrika_indeterminate', callPrivate('classifyMetrikaResponse', [[
    'http_code' => 503,
    'curl_errno' => 0,
    'dispatched' => true,
]])['status'] ?? null, 'Post-dispatch server failure must fail closed without resend.');
assertSameValue('metrika_indeterminate', callPrivate('classifyMetrikaResponse', [[
    'http_code' => 0,
    'curl_errno' => 28,
    'dispatched' => true,
]])['status'] ?? null, 'Post-dispatch timeout must fail closed without resend.');

$publicCounterMethod = new ReflectionMethod(RosomahaCrmBridge::class, 'metrikaCounterId');
assertTrueValue($publicCounterMethod->isPublic(), 'Counter id accessor must be public for the tracked tag template.');
$bridgeLines = file(dirname(__DIR__) . '/local/php_interface/rosomaha_crm_bridge.php');
$publicMethodSource = implode('', array_slice(
    $bridgeLines,
    $publicCounterMethod->getStartLine() - 1,
    $publicCounterMethod->getEndLine() - $publicCounterMethod->getStartLine() + 1
));
assertTrueValue(!str_contains($publicMethodSource, 'measurement_token'), 'Public accessor exposes the Measurement Protocol token.');

$receipt = callPrivate('buildCompletionReceipt', [[
    'form_id' => 7,
    'result_id' => 430,
    'lead_submission_id' => $submissionId,
    'created_at' => '2026-08-24T12:00:00+05:00',
    'context' => [
        'phone' => '+79990000000',
        'name' => 'Private Person',
        'ym_client_id' => '1234567890123456789',
        'measurement_token' => 'must-never-enter-receipt',
    ],
    'crm_ack' => [
        'status' => 'ok',
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-812',
        'acknowledged_at' => '2026-08-24T12:00:05+05:00',
    ],
    'metrika' => [
        'soft_goal' => ['status' => 'sent', 'http_code' => 200, 'measurement_token' => 'private-soft'],
        'hard_goal' => ['status' => 'sent', 'http_code' => 200, 'measurement_token' => 'private-hard'],
    ],
], 'sent']);
$receiptJson = json_encode($receipt, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
foreach (['+79990000000', 'Private Person', '1234567890123456789', 'measurement_token', 'must-never-enter-receipt', 'private-soft', 'private-hard'] as $forbiddenReceiptValue) {
    assertTrueValue(!str_contains($receiptJson, $forbiddenReceiptValue), 'Completion receipt contains private data.');
}
assertSameValue('delivered', $receipt['final_status'] ?? null, 'Sent hard goal must finalize the queue record.');
$receiptUnattributed = callPrivate('buildCompletionReceipt', [[
    'form_id' => 7,
    'result_id' => 431,
    'lead_submission_id' => $submissionId,
    'crm_ack' => [
        'status' => 'ok',
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-813',
    ],
    'metrika' => [
        'hard_goal' => ['status' => 'metrika_unattributed', 'error' => 'client_id_missing'],
    ],
], 'metrika_unattributed']);
assertSameValue('metrika_unattributed', $receiptUnattributed['final_status'] ?? null, 'Missing ClientID must terminate with an explicit status.');
$receiptIndeterminate = callPrivate('buildCompletionReceipt', [[
    'form_id' => 7,
    'result_id' => 432,
    'lead_submission_id' => $submissionId,
    'crm_ack' => [
        'status' => 'ok',
        'lead_submission_id' => $submissionId,
        'deal_id' => 'D-814',
    ],
    'metrika' => [
        'hard_goal' => ['status' => 'metrika_indeterminate', 'error' => 'dispatch_unknown'],
    ],
], 'metrika_indeterminate']);
assertSameValue('metrika_indeterminate', $receiptIndeterminate['final_status'] ?? null, 'Ambiguous dispatched hit must have an explicit terminal status.');
assertSameValue(true, $receiptIndeterminate['manual_review_required'] ?? null, 'Ambiguous dispatched hit must require manual review.');

$source = file_get_contents(dirname(__DIR__) . '/local/php_interface/rosomaha_crm_bridge.php');
$crmDeliveryPosition = strpos($source, '$delivery = self::deliver($payload);');
$softGoalPosition = strpos($source, '$record = self::attemptSoftGoal($path, $record);');
assertTrueValue(
    is_int($crmDeliveryPosition) && is_int($softGoalPosition) && $crmDeliveryPosition < $softGoalPosition,
    'Soft analytics must not run before CRM delivery.'
);
$hardResumePosition = strpos($source, '$resumeAction = self::hardGoalResumeAction($record);');
$hardDispatchPosition = strpos($source, '$hardGoal = self::dispatchMetrikaFields((array) $hardPreparation[\'fields\']);');
assertTrueValue(
    is_int($hardResumePosition) && is_int($hardDispatchPosition) && $hardResumePosition < $hardDispatchPosition,
    'Hard-goal resume guard must run before any Measurement Protocol dispatch.'
);
foreach ([
    'CFormResult::GetDataByID',
    'pending-',
    'completed-',
    'retryAgent',
    'maybeRetryOnHit',
    'pending.flag',
    'lead_submission_id',
    'invalid_ack',
    "METRIKA_SOFT_ACTION = 'lead_submit'",
    "METRIKA_HARD_ACTION = 'crm_conversion'",
    "METRIKA_CONFIG_PATH = '/home/b/berkutm4/.config/rosomaha/metrika.json'",
    'is_link($path)',
    '($permissions & 0777) !== 0600',
    "METRIKA_ENDPOINT = 'https://mc.yandex.ru/collect'",
    "'Content-Type: application/x-www-form-urlencoded'",
    'CURLOPT_POSTFIELDS => $encoded',
    "'crm_ack'",
    "'metrika_unattributed'",
    "'metrika_indeterminate'",
    'CURLINFO_REQUEST_SIZE',
    'hardGoalResumeAction',
    'requiresCrmDelivery',
] as $marker) {
    if (!str_contains($source, $marker)) {
        fwrite(STDERR, "Missing bridge marker: {$marker}" . PHP_EOL);
        exit(1);
    }
}

$oldAnalyticsPending = callPrivate('recordPath', [3, 100]);
$newCrmPending = callPrivate('recordPath', [3, 101]);
$anotherFormPending = callPrivate('recordPath', [8, 101]);
$queueFiles = [$newCrmPending, $anotherFormPending, $oldAnalyticsPending];
assertSameValue([$newCrmPending], callPrivate('selectPendingFiles', [$queueFiles, 3, 101]), 'An older analytics retry must not occupy the new CRM result delivery slot.');
assertSameValue([], callPrivate('selectPendingFiles', [$queueFiles, 3, 102]), 'Missing new result must not fall back to another pending result.');
assertSameValue([$oldAnalyticsPending, $newCrmPending, $anotherFormPending], callPrivate('selectPendingFiles', [$queueFiles]), 'General retry must retain the complete natural-order queue.');
foreach ([[0, 101], [3, 0], [-3, 101], [null, 101], [3, null]] as $invalidTarget) {
    $rejected = false;
    try { callPrivate('selectPendingFiles', [$queueFiles, ...$invalidTarget]); }
    catch (InvalidArgumentException $exception) { $rejected = true; }
    assertTrueValue($rejected, 'Invalid targeted delivery ID accepted.');
}
assertTrueValue(str_contains($source, 'self::flushPending(1, true, $webFormId, $resultId);'), 'New-result callback must use targeted delivery.');
fwrite(STDOUT, "bridge_contract_test=ok\n");
