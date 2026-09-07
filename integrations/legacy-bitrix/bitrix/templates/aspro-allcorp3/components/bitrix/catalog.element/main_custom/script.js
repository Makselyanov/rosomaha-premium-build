$(document).ready(function(){
	setBasketItemsClasses();

	setTimeout(function () {
		function checkStickyPanelContent(){
			if(window.matchMedia('(min-width:992px)').matches){
				$title = $('.catalog-detail__sticky-panel .catalog-detail__title');
				if ($title.length) {
					$right = $('.catalog-detail__right-info');
					if($right.length){
						var bVisible = $title.hasClass('show');
						var headerFixedHeight = $('#headerfixed.fixed').length ? 112 : 32;
						
						if($right[0].getBoundingClientRect().top <= headerFixedHeight){
							if (!bVisible) {						
								$title.addClass('show');
								
								if ($title.data('timer')) { 
									clearTimeout($title.data('timer'));
									$title.data('timer', false);
								}
								
								$title.css('height', '');
								var h = $title.actual('height');
								$title.height(0);
								$title.addClass('active');
								$title.height(h);
	
								$title.data('timer', setTimeout(function () {
									$title.css('height', '');
								}, 2000));
							}
						}
						else{
							if (bVisible) {
								$title.removeClass('show');
	
								if ($title.data('timer')) { 
									clearTimeout($title.data('timer'));
									$title.data('timer', false);
								}
	
								var h = $title.actual('height');
								$title.height(h);
								$title.height(0);
								$title.data('timer', setTimeout(function () {
									$title.removeClass('active');
									$title.css('height', '');
								}, 700));
							}
						}
					}
				}
	
				setTimeout(function () { 
					var $sale = $('.catalog-detail__sticky-panel .catalog-detail__sale:not(.show)');
					if ($sale.length) {
						var h = $sale.actual('height');
						$sale.height(0);
						$sale.addClass('show');
						$sale.height(h);
						setTimeout(function () {
							$sale.css('height', '');
						}, 2000);
					}
				}, 2000);
			}
		}
		checkStickyPanelContent();
	
		$(document).resize(function(){
			checkStickyPanelContent();
		});
		
		$(document).scroll(function(){
			checkStickyPanelContent();
		});
	}, 1000);
});

class PriceCalculator {
    constructor() {
        this.urlParams = new URLSearchParams(window.location.search);
        this.priceElement = document.querySelector('.price__new-val');
        this.optPriceElement = document.getElementById("opt-price");
        this.priceElementToObserve = document.querySelector("#price");
        this.optionsList = document.getElementById('opt-list');
        this.deliveryCalculator = document.querySelector('.delivery-calculator');
        this.selectedOptionsIds = this.urlParams.getAll('option_id');
        this.skuProps = document.querySelectorAll('.catalog-detail__main .sku-props__value');

        this.initialPrice = this.parsePrice(this.priceElement.textContent);
        this.currentPrice = this.initialPrice;
        this.totalSum = this.initialPrice;

        this.init();
    }

    init() {
        this.updateDisplayPrice();
        this.setupPriceObserver();
        this.setupDeliveryCalculator();
        this.addFormAdditionalInfo();
        this.initEventListeners();
    }

    initEventListeners() {
        this.skuProps.forEach(prop => {
            prop.addEventListener('click', () => setTimeout(() =>
                this.addFormAdditionalInfo(),
                500)
            );
        })
    }

    parsePrice(priceText) {
        return parseInt(priceText.replace(/\D/g, '')) || 0;
    }

    updateDisplayPrice() {
        this.optPriceElement.textContent = `${this.totalSum.toLocaleString()} ₽`;
        this.addFormAdditionalInfo();
    }

    setupPriceObserver() {
        const observer = new MutationObserver(() => {
            const newPrice = this.parsePrice(this.priceElementToObserve.innerText);
            const priceDifference = newPrice - this.currentPrice;

            this.totalSum += priceDifference;
            this.currentPrice = newPrice;

            this.updateDisplayPrice();
        });

        observer.observe(this.priceElementToObserve, { childList: true });
    }

    toggleOption(element) {
        const optionSum = parseInt(element.dataset.sum);
        const isActive = element.classList.contains('active-option');
        const rowElement = document.getElementById(element.dataset.rowId);

        if (isActive) {
            this.removeOption(element, optionSum, rowElement);
        } else {
            this.addOption(element, optionSum, rowElement);
        }
    }

    addOption(element, optionSum, rowElement) {
        element.classList.add('active-option');
        element.textContent = 'Убрать';

        this.totalSum += optionSum;
        this.updateDisplayPrice();

        this.createOptionListItem(element);
        rowElement.classList.add('active-row');
        this.updateSelectedOptionsList(element.dataset.productId, true);
    }

    removeOption(element, optionSum, rowElement) {
        element.classList.remove('active-option');
        element.textContent = 'Добавить';

        this.totalSum -= optionSum;
        this.updateDisplayPrice();

        this.removeOptionListItem(element.dataset.name);
        rowElement.classList.remove('active-row');
        this.updateSelectedOptionsList(element.dataset.productId, false);
    }

    createOptionListItem(element) {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            ${element.dataset.name}
            <span class="delete" onclick="priceCalculator.removeOptionFromList(this.parentNode)">
                убрать
            </span>
        `;
        listItem.dataset.sum = element.dataset.sum;
        listItem.dataset.parentId = element.dataset.productId;

        this.optionsList.appendChild(listItem);
    }

    removeOptionListItem(optionName) {
        const items = Array.from(this.optionsList.querySelectorAll('li'));
        const itemToRemove = items.find(item => item.textContent.includes(optionName));

        if (itemToRemove) {
            itemToRemove.remove();
        }
    }

    removeOptionFromList(listItem) {
        const optionSum = parseInt(listItem.dataset.sum);
        const parentElement = document.querySelector(`[data-product-id="${listItem.dataset.parentId}"]`);
        const rowElement = document.getElementById(parentElement.dataset.rowId);

        listItem.remove();
        this.totalSum -= optionSum;
        this.updateDisplayPrice();

        parentElement.classList.remove('active-option');
        parentElement.textContent = 'Добавить';
        rowElement.classList.remove('active-row');

        this.updateSelectedOptionsList(listItem.dataset.parentId, false);
    }

    updateSelectedOptionsList(optionId, shouldAdd) {
        if (shouldAdd) {
            if (!this.selectedOptionsIds.includes(optionId)) {
                this.selectedOptionsIds.push(optionId);
            }
        } else {
            let optionIdIndex = this.selectedOptionsIds.indexOf(optionId);

            if (optionIdIndex !== -1) {
                this.selectedOptionsIds.splice(optionIdIndex, 1);
            }
        }

        this.updateUrlParam();
        this.addFormAdditionalInfo();
    }

    updateUrlParam() {
        this.urlParams.delete("option_id");

        this.selectedOptionsIds.forEach(id => {
            this.urlParams.append("option_id", id);
        });

        const newUrl = this.urlParams.toString() ? `?${this.urlParams.toString()}` : '';
        history.pushState(null, null, newUrl);
    }

    setupDeliveryCalculator() {
        this.deliveryCalculator.addEventListener("change", () => {
            if (this.deliveryCalculator.value === '') {
                this.removeDelivery();
            } else {
                this.addDelivery();
            }
        });
    }

    addDelivery() {
        this.removeDelivery(); // Сначала удаляем существующую доставку

        const deliveryCost = parseInt(this.deliveryCalculator.value);
        this.totalSum += deliveryCost;
        this.updateDisplayPrice();

        this.createDeliveryListItem(deliveryCost);
    }

    removeDelivery() {
        const deliveryItem = this.optionsList.querySelector('.delivery-option');

        if (deliveryItem) {
            const deliveryCost = parseInt(deliveryItem.dataset.sum);
            this.totalSum -= deliveryCost;
            this.updateDisplayPrice();
            deliveryItem.remove();
        }
    }

    createDeliveryListItem(deliveryCost) {
        const listItem = document.createElement('li');
        listItem.className = 'delivery-option';
        listItem.dataset.sum = deliveryCost;
        listItem.innerHTML = `
            Доставка ${deliveryCost.toLocaleString()} ₽*
            <span class="delete">убрать</span>
        `;

        listItem.querySelector('.delete').addEventListener('click', () => {
            this.deliveryCalculator.value = '';
            this.removeDelivery();
        });

        this.optionsList.appendChild(listItem);
    }

    addFormAdditionalInfo() {
        let orderButton = document.querySelector('.catalog-detail__buy-block [data-autoload-product]');

        if (orderButton) {
            const additionalInfo = {
                options: this.selectedOptionsIds,
                totalSum: this.totalSum
            };

            orderButton.dataset.autoloadParams = JSON.stringify(additionalInfo).replace(/"/g, "'");
        }
    }
}
