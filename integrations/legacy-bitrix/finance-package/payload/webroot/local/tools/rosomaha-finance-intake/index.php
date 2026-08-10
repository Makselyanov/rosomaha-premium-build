<?php

declare(strict_types=1);

define('ROSOMAHA_FINANCE_PROXY_INTERNAL', true);

$library = dirname(__DIR__, 3).'/local/php_interface/include/rosomaha_finance_proxy.php';
if (! is_file($library)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    echo '{"status":"error","message":"Сервис финансирования временно недоступен."}';
    exit;
}

require_once $library;

\Rosomaha\Finance\FinanceProxy::run();
