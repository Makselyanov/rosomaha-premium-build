<?
if(!defined("B_PROLOG_INCLUDED") || B_PROLOG_INCLUDED !== true) die();
IncludeTemplateLangFile(__FILE__);
global $APPLICATION, $arRegion, $arSite, $arTheme;

$arSite = CSite::GetByID(SITE_ID)->Fetch();
$bIncludedModule = \Bitrix\Main\Loader::includeModule('aspro.allcorp3');
?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="<?=LANGUAGE_ID?>" lang="<?=LANGUAGE_ID?>" class="<?=($_SESSION['SESS_INCLUDE_AREAS'] ? 'bx_editmode ' : '')?><?=strpos( $_SERVER['HTTP_USER_AGENT'], 'MSIE 7.0' ) ? 'ie ie7' : ''?> <?=strpos( $_SERVER['HTTP_USER_AGENT'], 'MSIE 8.0' ) ? 'ie ie8' : ''?> <?=strpos( $_SERVER['HTTP_USER_AGENT'], 'MSIE 7.0' ) ? 'ie ie9' : ''?>">
	<head>
		<title><?$APPLICATION->ShowTitle()?></title>
		<?$APPLICATION->ShowMeta("viewport");?>
		<?$APPLICATION->ShowMeta("HandheldFriendly");?>
		<?$APPLICATION->ShowMeta("apple-mobile-web-app-capable", "yes");?>
		<?$APPLICATION->ShowMeta("apple-mobile-web-app-status-bar-style");?>
		<?$APPLICATION->ShowMeta("SKYPE_TOOLBAR");?>
		<?$APPLICATION->ShowHead();?>
		<?$APPLICATION->AddHeadString('<script>BX.message('.CUtil::PhpToJSObject($MESS, false).')</script>', true);?>
		<?if($bIncludedModule)
			CAllcorp3::Start(SITE_ID);?>
		<?
		$rosomahaCanonicalTrackingParams = array('yclid', 'gclid', 'fbclid', 'msclkid', '_openstat', 'gbraid', 'wbraid');
		$rosomahaCanonicalKillParams = array();
		foreach (array_keys($_GET) as $rosomahaCanonicalParamName) {
			$rosomahaCanonicalParamName = (string)$rosomahaCanonicalParamName;
			$rosomahaCanonicalParamNameLower = strtolower($rosomahaCanonicalParamName);
			if (strpos($rosomahaCanonicalParamNameLower, 'utm_') === 0 || in_array($rosomahaCanonicalParamNameLower, $rosomahaCanonicalTrackingParams, true)) {
				$rosomahaCanonicalKillParams[] = $rosomahaCanonicalParamName;
			}
		}
		$rosomahaCanonicalHref = $APPLICATION->GetCurPageParam('', $rosomahaCanonicalKillParams);
		?>
		<link rel="canonical" href="<?=htmlspecialcharsbx($rosomahaCanonicalHref)?>" />
	</head>
	<body class="<?=($bIndexBot ? "wbot" : "")?> site_<?=SITE_ID?> <?=($bIncludedModule ? CAllcorp3::getConditionClass() : '')?>" id="main" data-site="<?=SITE_DIR?>">
		<div class="bx_areas"><?if($bIncludedModule){CAllcorp3::ShowPageType('header_counter');}?></div>

		<?if(!$bIncludedModule):?>
			<?$APPLICATION->SetTitle(GetMessage("ERROR_INCLUDE_MODULE_ALLCORP3_TITLE"));?>
			<?$APPLICATION->IncludeFile(SITE_DIR."include/error_include_module.php");?></body></html>
			<?die();?>
		<?endif;?>

		<?include_once(str_replace('//', '/', $_SERVER['DOCUMENT_ROOT'].'/'.SITE_DIR.'include/header/body_top.php'));?>

		<?$arTheme = $APPLICATION->IncludeComponent("aspro:theme.allcorp3", "", array(), false, ['HIDE_ICONS' => 'Y']);?>
		<?include_once('defines.php');?>
		<?CAllcorp3::SetJSOptions();?>

		<div class="body <?=($isIndex ? 'index' : '')?> hover_<?=$arTheme["HOVER_TYPE_IMG"]["VALUE"];?>">
			<div class="body_media"></div>

			<?CAllcorp3::get_banners_position('TOP_HEADER');?>
			<?CAllcorp3::ShowPageType('eyed_component');?>
			<div class="visible-lg visible-md title-v<?=$arTheme["PAGE_TITLE"]["VALUE"];?><?=($isIndex ? ' index' : '')?>" data-ajax-block="HEADER" data-ajax-callback="headerInit">
				<?CAllcorp3::ShowPageType('mega_menu');?>
				<?CAllcorp3::ShowPageType('header');?>
			</div>

			<?CAllcorp3::get_banners_position('TOP_UNDERHEADER');?>

			<?if($arTheme["TOP_MENU_FIXED"]["VALUE"] == 'Y'):?>
				<div id="headerfixed">
					<?CAllcorp3::ShowPageType('header_fixed');?>
				</div>
			<?endif;?>

			<div id="mobileheader" class="visible-xs visible-sm">
				<?CAllcorp3::ShowPageType('header_mobile');?>
				<div id="mobilemenu" class="mobile-scroll scrollbar">
					<?CAllcorp3::ShowPageType('header_mobile_menu');?>
				</div>
			</div>
			<div id="mobilefilter" class="scrollbar-filter"></div>

			<div role="main" class="main banner-auto">
				<?if(!$isIndex && !$is404 && !$isForm):?>
					<?$APPLICATION->ShowViewContent('section_bnr_content');?>
					<?if($APPLICATION->GetProperty("HIDETITLE")!=='Y'):?>
						<!--title_content-->
						<? CAllcorp3::ShowPageType('page_title');?>
						<!--end-title_content-->
					<?endif;?>
					<?$APPLICATION->ShowViewContent('top_section_filter_content');?>
					<?$APPLICATION->ShowViewContent('top_detail_content');?>
				<?endif; // if !$isIndex && !$is404 && !$isForm?>

				<div class="container <?=($isCabinet ? 'cabinte-page' : '');?><?=($isBlog ? ' blog-page' : '');?> <?=CAllcorp3::ShowPageProps("ERROR_404");?>">
					<?if(!$isIndex):?>
						<div class="row">
							<div class="maxwidth-theme wide-<?CAllcorp3::ShowPageProps("FULLWIDTH");?>">
							<?if($is404):?>
								<div class="col-md-12 col-sm-12 col-xs-12 content-md">
							<?else:?>
								<div class="col-md-12 col-sm-12 col-xs-12 content-md">
									<div class="right_block narrow_<?=CAllcorp3::ShowPageProps("MENU");?> <?=$APPLICATION->ShowViewContent('right_block_class')?>">
									<?CAllcorp3::get_banners_position('CONTENT_TOP');?>

									<?ob_start();?>
										<?$APPLICATION->IncludeComponent("bitrix:main.include", ".default",
											array(
												"COMPONENT_TEMPLATE" => ".default",
												"PATH" => SITE_DIR."include/left_block/menu.left_menu.php",
												"AREA_FILE_SHOW" => "file",
												"AREA_FILE_SUFFIX" => "",
												"AREA_FILE_RECURSIVE" => "Y",
												"EDIT_TEMPLATE" => "include_area.php"
											),
											false
										);?>
									<?$sMenuContent = ob_get_contents();
									ob_end_clean();?>
							<?endif;?>
					<?endif;?>
					<?CAllcorp3::checkRestartBuffer();?>