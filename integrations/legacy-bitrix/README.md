# Legacy Bitrix CRM bridge

This package is the source of truth for delivery of `rosomaha-rus.ru` Bitrix
web-form results to the tenant CRM webhook.

The production file is installed as:

```text
/local/php_interface/rosomaha_crm_bridge.php
```

The existing `/local/php_interface/init.php` must include it once:

```php
$rosomahaCrmBridge = __DIR__ . '/rosomaha_crm_bridge.php';
if (is_file($rosomahaCrmBridge)) {
    require_once $rosomahaCrmBridge;
}
```

After deployment, run `RosomahaCrmBridge::install()` in the authenticated
Bitrix PHP console. Installation creates a protected queue containing only form
and result IDs, and registers the five-minute retry agent.

Useful read-only checks:

```php
var_export(RosomahaCrmBridge::status());
var_export(RosomahaCrmBridge::resultSummary(8, 430));
var_export(RosomahaCrmBridge::endpointProbe());
```

`endpointProbe()` intentionally sends a payload without contact data. The CRM
must return HTTP 422 before any database write, proving server-to-server POST
connectivity without creating a test lead.
