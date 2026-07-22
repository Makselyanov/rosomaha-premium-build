<?php

define('B_PROLOG_INCLUDED', true);

$registeredEvents = [];

function AddEventHandler($module, $event, $handler): void
{
    global $registeredEvents;
    $registeredEvents[] = [$module, $event, $handler];
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

$submissionId = callPrivate('submissionId', [1721212121, 7, 430]);
if (!preg_match('/^rosomaha-[0-9]{10,}-[a-z0-9-]{6,100}$/i', $submissionId)) {
    fwrite(STDERR, 'Submission ID violates the CRM contract.' . PHP_EOL);
    exit(1);
}

$source = file_get_contents(dirname(__DIR__) . '/local/php_interface/rosomaha_crm_bridge.php');
foreach (['CFormResult::GetDataByID', 'pending-', 'retryAgent', 'maybeRetryOnHit', 'pending.flag', 'lead_submission_id', 'invalid_ack'] as $marker) {
    if (!str_contains($source, $marker)) {
        fwrite(STDERR, "Missing bridge marker: {$marker}" . PHP_EOL);
        exit(1);
    }
}

fwrite(STDOUT, "bridge_contract_test=ok\n");
