<?php
namespace Bitrix\Main { class Loader { public static function includeModule($name) { return true; } } }
namespace {
define('B_PROLOG_INCLUDED', true);
class CFormResult {
    public static $params = '';
    public static function GetDataByID($id, $filter, &$fields, &$meta) {
        $fields = ['FORM_ID'=>3,'DATE_CREATE'=>'2026-09-07 12:00:00'];
        return ['PHONE'=>[['USER_TEXT'=>'+7 900 000-00-00']], 'PRODUCT'=>[['USER_TEXT'=>'Пикап RAL 9010']], 'MESSAGE'=>[['USER_TEXT'=>'Проверка']], 'PARAMS'=>[['USER_TEXT'=>self::$params]]];
    }
}
class CForm { public static function GetByID($id) { return new class { public function Fetch() { return ['SID'=>'aspro_allcorp3_order_product_s1','NAME'=>'Заказ']; } }; } }
class CIBlockElement {
    public static function GetList($sort, $filter, $group, $limit, $select) {
        if ($filter['IBLOCK_ID'] !== 86 || $filter['SECTION_ID'] !== 302 || $filter['ACTIVE'] !== 'Y') throw new \RuntimeException('Wrong catalog scope');
        return new class {
            private $rows = [ ['ID'=>895,'NAME'=>'Шины AVTOROS','PROPERTY_FILTER_PRICE_VALUE'=>150000], ['ID'=>998,'NAME'=>'Шины Багира','PROPERTY_FILTER_PRICE_VALUE'=>150000], ['ID'=>855,'NAME'=>'Кофры улучшенные','PROPERTY_FILTER_PRICE_VALUE'=>18000], ['ID'=>854,'NAME'=>'Кофры стандартные','PROPERTY_FILTER_PRICE_VALUE'=>10000], ['ID'=>853,'NAME'=>'Передний кофр','PROPERTY_FILTER_PRICE_VALUE'=>25000] ];
            public function Fetch() { return array_shift($this->rows); }
        };
    }
}
require dirname(__DIR__).'/local/php_interface/rosomaha_crm_bridge.php';
function invoke($method, $arguments) { return (new \ReflectionMethod(RosomahaCrmBridge::class,$method))->invokeArgs(null,$arguments); }
function check($value, $message) { if (!$value) throw new \RuntimeException($message); }
$legacy="{'options':['895','998','855','854','853'],'totalSum':2153000}";
$params=invoke('parseOrderParams',[$legacy]);
check($params['options']===[895,998,855,854,853], 'Legacy IDs lost');
check(invoke('parseOrderParams',[json_encode(['options'=>[895],'totalSum'=>2153000])])['options']===[895], 'JSON unsupported');
foreach (["{'options':['1'];alert(1),'totalSum':1}", '{"options":[{}],"totalSum":1}', '{"options":[1],"totalSum":-1}', '{"options":[1],"totalSum":1000000001}', '{"options":[1],"totalSum":1,"extra":1}'] as $bad) check(invoke('parseOrderParams',[$bad])===null,'Unsafe input accepted');
$result=invoke('orderConfiguration',[['PRODUCT'=>'Пикап 1NZ-FE 1,5 УАЗ Тимкен RAL 9010','PARAMS'=>$legacy]]);
foreach (['RAL 9010','AVTOROS','Багира','улучшенные','стандартные','Передний кофр','2 153 000 ₽'] as $needle) check(str_contains($result,$needle),'Missing '.$needle);
check(str_contains(invoke('orderConfiguration',[['PARAMS'=>'{"options":[999999],"totalSum":123}']]),'999999: название не найдено'),'Unknown ID concealed');
check(invoke('orderConfiguration',[['MESSAGE'=>'Обычная заявка']])==='','Other forms changed');
$long='{"options":['.implode(',',array_fill(0,96,'123456789')).'],"totalSum":1}';
check(strlen($long)>900,'Long fixture too short');
$answer=invoke('answerValue',[[['USER_TEXT'=>$long]],20000]);
check($answer===$long && invoke('parseOrderParams',[$answer])!==null,'PARAMS truncated');
CFormResult::$params = '{broken:'.str_repeat('x',3500).':LAST_OPTION}';
$payload = invoke('buildPayload',[3,777,[]]);
check(str_contains($payload['configuration'],'не удалось распознать'),'Missing malformed configuration warning');
check(str_contains($payload['comment'],CFormResult::$params),'Malformed source parameters lost or truncated');
check(!isset($payload['deal_amount']), 'Malformed amount must not be guessed');
CFormResult::$params = $legacy;
$validPayload = invoke('buildPayload',[3,778,[]]);
check($validPayload['deal_amount']===2153000.0 && $validPayload['price']===2153000.0,'Actual payload total lost');
check(str_contains($validPayload['configuration'],'AVTOROS') && !str_contains($validPayload['comment'],$legacy),'Actual payload configuration extraction failed');
echo "PASS: strict parser, 5 video options, exact historical total, catalog scope, unknown IDs, other forms, >900 chars\n";
}
