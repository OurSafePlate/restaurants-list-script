document.addEventListener('DOMContentLoaded', () => {
  // --- CONFIGURATIE ---
  const API_GROUP_URL = "https://x8ki-letl-twmt.n7.xano.io/api:tNUMBEXY"; // Gebruik overal deze ID

	const API_AUTH_LOGIN = `${API_GROUP_URL}/auth/anonymous_login`;
	const API_RESTAURANTS_LIST = `${API_GROUP_URL}/restaurants_list`; 
	const API_RESTAURANTS_SLIDER = `${API_GROUP_URL}/restaurants_for_slider`; 

	const DEBUG_LOGGING = true;
  const ITEMS_PER_PAGE = 30; // Pas dit aan naar je Webflow paginatie limiet
  const SLIDER_INJECT_AFTER_N_ITEMS = 5; 
  const API_CALL_RETRIES = 2;
  const API_CALL_RETRY_DELAY = 2000;
  const SEARCH_DEBOUNCE_DELAY = 500; 

  // --- SELECTOREN ---
  const restaurantListWrapperSelector = '#restaurant-list-wrapper'; 
  const templateItemSelector = '.is-template-item'; 
  const mainSliderTemplateSelector = '#slider-main_component';     
  const sliderItemTemplateSelector = '.swiper-slide'; 
  const sliderMaskSelector = '.swiper-wrapper';       

  const filterFormSelector = '#filter-form'; 
  const searchInputSelector = '#filter-search-input'; 
  const keukenCheckboxGroupSelector = '.filter-group-keuken'; 
  const mealOptionsCheckboxGroupSelector = '.filter-group-meal-options'; 
  const priceCheckboxGroupSelector = '.filter-group-price'; 
  const clearAllButtonSelector = '#clear-all-filters-button';
  const applyFiltersButtonSelector = '#apply-filters-button';
  const openFiltersButtonSelector = '#open-filters-button';
	const closeFiltersButtonSelector = '#close-filters-button';
  const filtersPanelSelector = '#filters-panel';

  const resultsCountTextSelector = '.restaurants_results_count'; 
  const paginationPrevButtonSelector = '#pagination-prev';
  const paginationNextButtonSelector = '#pagination-next';
  const paginationInfoTextSelector = '#pagination-info';
  const paginationNumbersContainerSelector = '#pagination-numbers'; 
  const finsweetEmptyStateSelector = '[fs-cmsload-element="empty"]';
  const finsweetLoaderSelector = '[fs-cmsload-element="loader"]';
  
  // --- GLOBALE STATE ---
  let currentPage = 1;
  let currentSearchTerm = '';
  let currentFilters = { filter_keuken: [], filter_meal_options: [], filter_price: [] };
  let currentSortBy = 'name_asc'; 
  let totalPages = 0; // Start met 0
  let isLoading = false;
  let allSliderData = null;
  let xanoAuthToken = null;
  let sliderInjectionCounter = 0;
  let initialLoadComplete = false; // Vlag voor eerste succesvolle load

  // --- DOM ELEMENTEN ---
  let restaurantListWrapperEl, templateItemEl, mainSliderTemplateNodeGlobal, filterFormEl, searchInputEl,
    resultsCountTextEl, paginationPrevEl, paginationNextEl, paginationInfoEl, paginationNumbersContainerEl,
    finsweetEmptyStateEl, finsweetLoaderEl, clearAllButtonEl, applyFiltersButtonEl, openFiltersButtonEl,
    closeFiltersButtonEl, filtersPanelEl;

  // --- LOG FUNCTIE ---
  function log(...args) {
    if (DEBUG_LOGGING) console.log("[OurSafePlate Final]", ...args); 
  }
  log("Script gestart. Versie: SWIPER_INTEGRATED_V1.2");

  // --- HULPFUNCTIES ---
  async function fetchDataWithRetry(url, options, retries = API_CALL_RETRIES, attempt = 1) {
    log(`fetchData: Poging ${attempt} voor ${url}`, options ? `met opties` : '');
    const requestHeaders = new Headers(options.headers || {});
  
  // Controleer of we een token hebben en voeg het toe aan de headers
  if (xanoAuthToken) {
    requestHeaders.set('Authorization', `Bearer ${xanoAuthToken}`);
  }

  // Creëer de definitieve opties met de (mogelijk aangepaste) headers
  const finalOptions = {
      ...options,
      headers: requestHeaders
  };
    try {
      const response = await fetch(url, finalOptions);
      if (!response.ok) {
        if ((response.status >= 500 || response.status === 404 || response.status === 408 || response.status === 429) && retries > 0) {
          log(`fetchData: Status ${response.status}. Nog ${retries} pogingen...`);
          await new Promise(resolve => setTimeout(resolve, API_CALL_RETRY_DELAY * attempt));
          return fetchDataWithRetry(url, options, retries - 1, attempt + 1);
        }
        throw new Error(`API Fout: ${response.status} - ${response.statusText || 'Server gaf geen tekstuele foutmelding'}`);
      }
      return response.json();
    } catch (error) {
      log(`fetchData: Catch error: ${error.message}. Nog ${retries} pogingen.`);
      if (retries > 0 && (error.message.toLowerCase().includes('failed to fetch') || error.message.toLowerCase().includes('networkerror'))) {
        await new Promise(resolve => setTimeout(resolve, API_CALL_RETRY_DELAY * attempt));
        return fetchDataWithRetry(url, options, retries - 1, attempt + 1);
      }
      log(`Definitieve fout na alle pogingen voor ${url}:`, error);
      throw error; 
    }
  }
  
  // -- FUNCTIE VOOR RATING BOLLETJES -- 
  
  function renderRatingVisuals(parentItem, containerSelector, ratingValue) {
  const container = parentItem.querySelector(containerSelector);
  if (!container) {
    // log(`Waarschuwing: Rating container '${containerSelector}' niet gevonden.`);
    return;
  }

  // Zoek alle individuele ster/bolletje elementen binnen deze container.
  // We passen de selector aan om specifiek naar de 'rating-star' of 'rating-overlay-star' te zoeken.
  const visuals = container.querySelectorAll('.restaurants_rating-star, .restaurants_allergy_rating-overlay-star');
  const roundedRating = Math.round(parseFloat(ratingValue) || 0);

  // Zorg ervoor dat alle visuals standaard zichtbaar zijn voordat we beginnen
  visuals.forEach(visual => {
    visual.style.display = 'block'; // Of 'inline-block', afhankelijk van uw Webflow-instelling
  });

  // Verberg nu de visuals die niet "actief" zijn
  visuals.forEach((visual, index) => {
    // index is 0-based, dus we vergelijken met index + 1
    if (index >= roundedRating) {
      // Als de index groter of gelijk is aan de score, verberg het element.
      // Voorbeeld: bij een score van 3, worden de 4e (index 3) en 5e (index 4) ster verborgen.
      visual.style.display = 'none';
    }
  });
}

  const capitalizeFirstLetter = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

  // Zoek de doel-container BINNEN het specifieke parentElement (bv. het gekloonde restaurant-item)
  const targetElement = parentElement.querySelector('#allergy-icon-container');
  if (!targetElement) return; // Stop als de container niet bestaat in dit item

  // Verwerk de tekst
  const allergiesArray = (allergyText || "").toLowerCase().split(',').map(s => s.trim()).filter(s => s);
  
  targetElement.innerHTML = ""; // Maak de container leeg

  if (allergiesArray.length > 0) {
    const iconsHTML = allergiesArray.map(key =>
      allergyIconMap[key]
        ? `<img src="${allergyIconMap[key]}" alt="${capitalizeFirstLetter(key)}" title="${capitalizeFirstLetter(key)}" class="allergy-icon-class">`
        : ""
    ).join('');
    
    targetElement.innerHTML = iconsHTML;
  }
}
  
  // --- FUNCTIE OM TEKST IN TE KORTEN ---
		function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
		  }
 			 return text.substring(0, maxLength) + '...';
	}

 function renderRestaurantItem(restaurantData, isForSlider = false) {
    const templateSourceNode = isForSlider 
        ? mainSliderTemplateNodeGlobal?.querySelector(sliderItemTemplateSelector) 
        : templateItemEl;

    if (!templateSourceNode) {
        log(`Template node niet gevonden. isForSlider: ${isForSlider}.`);
        return null;
    }
    const newItem = templateSourceNode.cloneNode(true);
    newItem.classList.remove(isForSlider ? 'is-slider-item-template' : 'is-template-item');
    newItem.style.display = ''; 

    // --- ALGEMENE VELDBINDING (voor zowel slider als lijst) ---
    const titleSelector = isForSlider ? '.food_title-link' : '.restaurants_title';
    const imgSelector = isForSlider ? '.food_img' : '.restaurants_img';
    const addressSelector = isForSlider ? '.food-preview_address-link' : '.restaurant_adress';
    const postalCodeSelector = isForSlider ? '.food-preview_postal' : '.restaurant_postal_code';
    const citySelector = isForSlider ? '.food-preview_city' : '.restaurant_city';

    const titleEl = newItem.querySelector(titleSelector);
    if (titleEl) titleEl.textContent = restaurantData.Name || 'Naam onbekend';

    const imgEl = newItem.querySelector(imgSelector);
    if (imgEl && restaurantData.restaurant_img_url) {
        imgEl.src = restaurantData.restaurant_img_url;
        imgEl.alt = restaurantData.Name || 'Restaurant afbeelding';
    } else if (imgEl) {
        imgEl.src = ''; imgEl.alt = 'Geen afbeelding';
    }

    const addressEl = newItem.querySelector(addressSelector);
    if (addressEl) addressEl.textContent = restaurantData.restaurant_address || '';
    
    const postalCodeEl = newItem.querySelector(postalCodeSelector);
    if (postalCodeEl) postalCodeEl.textContent = restaurantData.restaurant_postal_code || '';
    
    const cityEl = newItem.querySelector(citySelector);
    if (cityEl) cityEl.textContent = restaurantData.restaurant_city || '';

    // --- NU KOMT DE GESCHEIDEN LOGICA ---

    if (isForSlider) {
    // --- LOGICA SPECIFIEK VOOR DE SLIDER ---

    // 1. Kwaliteitsrating (total_rating)
    const totalRatingValue = restaurantData.avg_total_rating ?? restaurantData.total_rating;
    const totalRatingTextEl = newItem.querySelector('.restaurant-total-rating');
    if (totalRatingTextEl) {
        totalRatingTextEl.textContent = totalRatingValue ? parseFloat(totalRatingValue).toFixed(1) : '-';
    }
    renderRatingVisuals(newItem, '.restaurants_rating-star-wrap.is-quality-rating', totalRatingValue);

    // 2. Our Safe Score (allergy_rating)
    const safeScoreValue = restaurantData.allergy_rating; 
    const safeScoreTextEl = newItem.querySelector('.restaurants_allergy_rating-overlay.is-slider-overlay .restaurants_allergy_rating-overlay-rating');
    if (safeScoreTextEl) {
        safeScoreTextEl.textContent = safeScoreValue ? parseFloat(safeScoreValue).toFixed(1) : '-';
    }
    const safeScoreVisualsContainerSelector = '.restaurants_allergy_rating-overlay.is-slider-overlay .restaurants_rating_star-wrap.restaurants_rating_allergy-wrap';
    renderRatingVisuals(newItem, safeScoreVisualsContainerSelector, safeScoreValue);

    // --- NIEUW TOEGEVOEGD: Keuken, Prijs en Maaltijdopties ---
    
    // Keuken
    const keukenEl = newItem.querySelector('.restaurant_cuisine');
    if (keukenEl) keukenEl.textContent = restaurantData.restaurant_keuken || '-';

    // Prijs
    const priceEl = newItem.querySelector('.restaurant_price');
    if (priceEl) priceEl.textContent = restaurantData.restaurant_price || '-';

    // Maaltijdopties
    const mealOptEl = newItem.querySelector('.meal-options-output'); 
    if (mealOptEl && restaurantData.restaurant_meal_options && Array.isArray(restaurantData.restaurant_meal_options)) {
        mealOptEl.innerHTML = '';
        restaurantData.restaurant_meal_options.forEach(opt => {
            if(opt){
                const b = document.createElement('span');
                b.className = 'meal-option-badge';
                b.textContent = opt;
                mealOptEl.appendChild(b);
            }
        });
    } else if (mealOptEl) {
        mealOptEl.innerHTML = '';
    }
    // --- EINDE NIEUWE TOEVOEGING ---

    } else {
        // --- LOGICA ALLEEN VOOR DE HOOFDLIJST ---
        const keukenEl = newItem.querySelector('.restaurant_cuisine');
        if (keukenEl) keukenEl.textContent = restaurantData.restaurant_keuken || '-';

        const priceEl = newItem.querySelector('.restaurant_price');
        if (priceEl) priceEl.textContent = restaurantData.restaurant_price || '-';
        
        const reviewCountEl = newItem.querySelector('.restaurants_rating_count-text');
        if (reviewCountEl) reviewCountEl.textContent = `${restaurantData.review_count || 0} beoordelingen`;

        const mealOptEl = newItem.querySelector('.meal-options-output'); 
        if (mealOptEl && restaurantData.restaurant_meal_options && Array.isArray(restaurantData.restaurant_meal_options)) {
            mealOptEl.innerHTML = '';
            restaurantData.restaurant_meal_options.forEach(opt => {
                if(opt){
                    const b = document.createElement('span');
                    b.className = 'meal-option-badge';
                    b.textContent = opt;
                    mealOptEl.appendChild(b);
                }
            });
        } else if (mealOptEl) {
            mealOptEl.innerHTML = '';
        }

        const totalRatingValue = restaurantData.avg_total_rating ?? restaurantData.total_rating;
        const totalRatingTextEl = newItem.querySelector('.restaurant-total-rating');
        if (totalRatingTextEl) {
            totalRatingTextEl.textContent = totalRatingValue ? parseFloat(totalRatingValue).toFixed(1) : '-';
        }
        renderRatingVisuals(newItem, '.restaurants_rating-star-wrap.is-quality-rating', totalRatingValue);

        const allergyRatingValue = restaurantData.allergy_rating;
        const allergyRatingTextEl = newItem.querySelector('.restaurants_allergy_rating-overlay-rating');
        if (allergyRatingTextEl) {
            allergyRatingTextEl.textContent = allergyRatingValue ? parseFloat(allergyRatingValue).toFixed(1) : '-';
        }
        renderRatingVisuals(newItem, '.restaurants_rating-star-wrap.restaurants_rating_allergy-wrap', allergyRatingValue);
        
        const reviewsContainerEl = newItem.querySelector('.recent-reviews-container');
        const review1El = newItem.querySelector('.first-example-review');
        const review2El = newItem.querySelector('.second-example-review');

        if (reviewsContainerEl && review1El && review2El) {
            const review1Text = restaurantData.latest_review_1_body;
            const review2Text = restaurantData.latest_review_2_body;
            let hasVisibleReviews = false; 

            if (review1Text && review1Text.trim() !== '') {
                review1El.textContent = `"${truncateText(review1Text, 80)}"`;
                review1El.style.display = '';
                hasVisibleReviews = true;
            } else {
                review1El.style.display = 'none';
            }

            if (review2Text && review2Text.trim() !== '') {
                review2El.textContent = `"${truncateText(review2Text, 80)}"`;
                review2El.style.display = '';
                hasVisibleReviews = true;
            } else {
                review2El.style.display = 'none';
            }

            if (hasVisibleReviews) {
                reviewsContainerEl.style.display = '';
            } else {
                reviewsContainerEl.style.display = 'none';
            }
        }
    }
    
    // --- LAATSTE ALGEMENE ACTIES ---
    const slugEl = newItem.querySelector('.cms-item-slug'); 
    if (slugEl) slugEl.textContent = restaurantData.slug || '';
    
    const allLinksInItem = newItem.querySelectorAll('a');
    allLinksInItem.forEach(linkElement => {
      if (restaurantData.slug) {
        linkElement.href = `/restaurants/${restaurantData.slug}`;
      } else {
        linkElement.removeAttribute('href');
        linkElement.style.pointerEvents = 'none';
      }
    });
    
    return newItem;
}

// --- FUNCTIE OM PAGINANUMMERS TE RENDEREN ---
function renderPageNumbers() {
    if (!paginationNumbersContainerEl) { 
        if (DEBUG_LOGGING) log("Paginanummers container (paginationNumbersContainerEl) niet gevonden in DOM.");
        return;
    }
    
    paginationNumbersContainerEl.innerHTML = ''; // Leegmaken voor nieuwe nummers

    if (totalPages <= 1) { // Geen nummers nodig als er 0 of 1 pagina is
        return;
    }

    // Logica voor welke nummers te tonen (bv. max 5-7 nummers, met "...")
    const maxPagesToShow = 5; // Totaal aantal knoppen (excl. eerste/laatste/dots)
    const halfPages = Math.floor(maxPagesToShow / 2);
    let startPage, endPage;

    if (totalPages <= maxPagesToShow) {
        // Minder of gelijk aan maxPagesToShow: toon alle pagina's
        startPage = 1;
        endPage = totalPages;
    } else {
        // Meer dan maxPagesToShow: bereken range met dots
        if (currentPage <= halfPages + 1) { // Als we dicht bij het begin zijn
            startPage = 1;
            endPage = maxPagesToShow - 1; // Ruimte voor "..." en laatste pagina
        } else if (currentPage >= totalPages - halfPages) { // Als we dicht bij het einde zijn
            startPage = totalPages - (maxPagesToShow - 2); // Ruimte voor eerste pagina en "..."
            endPage = totalPages;
        } else { // Ergens in het midden
            startPage = currentPage - Math.floor(halfPages / 2) - (maxPagesToShow % 2 === 0 ? 0 : 1) ; // Balans voor even/oneven maxPagesToShow
            if (maxPagesToShow === 5) startPage = currentPage - 2; // Simpel voor 5
            else startPage = currentPage - Math.floor((maxPagesToShow -3)/2)

            endPage = startPage + (maxPagesToShow - 3); // startPage + 2 nummers + dots + laatste, of startPage + eerste + dots + 2 nummers
             if (maxPagesToShow === 5) endPage = currentPage + 2;
             else endPage = currentPage + Math.ceil((maxPagesToShow -3)/2)


            // Zorg dat startPage en endPage logisch zijn met dots
            // Als we 5 knoppen tonen (1 ... 2 3 4 ... 5), dan is het:
            // 1 (als niet startPage), ... (als gat), [curr-1, curr, curr+1] (als mogelijk), ... (als gat), totalPages (als niet endPage)
            // Voor 5 knoppen is een simpele range vaak:
            // [curr-2, curr-1, curr, curr+1, curr+2] gebonden door 1 en totalPages.
            // Laten we de vorige logica verfijnen:
            if (currentPage - halfPages > 1) { // Is er ruimte voor "1 ..."?
                 startPage = currentPage - halfPages + (maxPagesToShow % 2 === 0 ? 1: 0); // Bij 6 knoppen, curr-2. Bij 5, curr-2
            } else {
                startPage = 1;
            }
            if (currentPage + halfPages < totalPages) { // Is er ruimte voor "... N"?
                endPage = currentPage + halfPages;
            } else {
                endPage = totalPages;
            }
            // Verfijning om altijd maxPagesToShow te proberen te tonen indien mogelijk
             if (endPage - startPage + 1 < maxPagesToShow && totalPages > maxPagesToShow) {
                if(startPage === 1) endPage = Math.min(totalPages, maxPagesToShow);
                else if (endPage === totalPages) startPage = Math.max(1, totalPages - maxPagesToShow + 1);
            }
             // Nog een correctie specifiek voor 5 knoppen, zodat de huidige pagina meer in het midden staat
            if (maxPagesToShow === 5) {
                if (currentPage <=3) {startPage = 1; endPage = Math.min(totalPages, 5);}
                else if (currentPage >= totalPages -2) {startPage = Math.max(1, totalPages - 4); endPage = totalPages;}
                else {startPage = currentPage - 2; endPage = currentPage + 2;}
            }

        }
    }
    
    // Functie om een paginaknop te maken
    const createPageButton = (pageNumber, text, isActive = false, isDisabled = false) => {
        const button = document.createElement('a');
        button.href = '#'; 
        button.textContent = text || pageNumber.toString();
        if (pageNumber > 0) button.dataset.page = pageNumber.toString(); // Alleen data-page als het een echt paginanummer is
        button.classList.add('pagination-number'); 
        if (isActive) button.classList.add('is-active'); 
        if (isDisabled) { 
            button.classList.add('is-disabled'); 
            button.style.pointerEvents = 'none';
        }
        return button;
    };

    // "Eerste" knop als niet in de directe range
    if (startPage > 1) {
        paginationNumbersContainerEl.appendChild(createPageButton(1, '1'));
        if (startPage > 2) { // Dots als er een gat is na de '1'
            paginationNumbersContainerEl.appendChild(createPageButton(0, '...', false, true)); 
        }
    }

    // Genereer de paginanummer knoppen voor de berekende range
    for (let i = startPage; i <= endPage; i++) {
        if (i > 0 && i <= totalPages) { // Zorg dat we binnen de grenzen blijven
            paginationNumbersContainerEl.appendChild(createPageButton(i, i.toString(), i === currentPage));
        }
    }

    // "Laatste" knop als niet in de directe range
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) { // Dots als er een gat is voor de laatste pagina
            paginationNumbersContainerEl.appendChild(createPageButton(0, '...', false, true)); 
        }
        paginationNumbersContainerEl.appendChild(createPageButton(totalPages, totalPages.toString()));
    }
  } // Einde renderPageNumbers functie

  // --- FUNCTIE OM PAGINATIE UI TE UPDATEN (inclusief paginanummers) ---
  function updatePaginationUI() {
    if (paginationInfoEl) {
      paginationInfoEl.textContent = (totalPages > 0 && currentPage > 0) ? `Pagina ${currentPage} van ${totalPages}` : (totalPages === 0 ? 'Geen resultaten' : '');
    }
    if (paginationPrevEl) {
      paginationPrevEl.style.pointerEvents = (currentPage > 1 && totalPages > 0) ? 'auto' : 'none';
      paginationPrevEl.style.opacity = (currentPage > 1 && totalPages > 0) ? '1' : '0.5';
    }
    if (paginationNextEl) {
      paginationNextEl.style.pointerEvents = (currentPage < totalPages && totalPages > 0) ? 'auto' : 'none';
      paginationNextEl.style.opacity = (currentPage < totalPages && totalPages > 0) ? '1' : '0.5';
    }
    
    renderPageNumbers(); // Roep de functie aan om de paginanummers te tekenen
  }
  
  function getSelectedCheckboxDataValues(groupSelector, dataAttributeKebabCase) {
    const group = document.querySelector(groupSelector);
    if (!group) {
        log(`Checkbox groep niet gevonden voor selector: ${groupSelector}`);
        return []; // Altijd een array teruggeven
    }
    const selectedValues = [];
    const dataAttributeCamelCase = dataAttributeKebabCase.replace(/-([a-z])/g, g => g[1].toUpperCase());

    group.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        if (cb.dataset && typeof cb.dataset[dataAttributeCamelCase] !== 'undefined') { // Check of dataset[key] bestaat
            selectedValues.push(cb.dataset[dataAttributeCamelCase]);
        } else {
            log(`Waarschuwing: checkbox in groep ${groupSelector} mist data-attribuut '${dataAttributeKebabCase}' (als '${dataAttributeCamelCase}') of waarde is undefined.`, cb);
        }
    });
    return selectedValues; // Altijd een array teruggeven
}
  
  function handleFilterChange(isClearAll = false) {
    log("handleFilterChange aangeroepen. Is ClearAll:", isClearAll);
    
    if (!isClearAll) {
        currentSearchTerm = searchInputEl ? searchInputEl.value : '';
        // Zorg ervoor dat we altijd een array toewijzen, zelfs als getSelected... undefined zou geven
        currentFilters.filter_keuken = getSelectedCheckboxDataValues(keukenCheckboxGroupSelector, 'cuisine') || []; 
        currentFilters.filter_meal_options = getSelectedCheckboxDataValues(mealOptionsCheckboxGroupSelector, 'meal-options') || []; 
        currentFilters.filter_price = getSelectedCheckboxDataValues(priceCheckboxGroupSelector, 'price') || []; 
    } else {
        // Als het een clear all is, resetten we de filters hier expliciet naar lege arrays
        currentSearchTerm = '';
        currentFilters.filter_keuken = [];
        currentFilters.filter_meal_options = [];
        currentFilters.filter_price = [];
        // De UI (checkboxes, input veld) wordt al gereset in de clearAllButton click handler
    }
    
    log("Huidige filters na handleFilterChange:", currentFilters, "Zoekterm:", currentSearchTerm);

    currentPage = 1; 
    fetchAndDisplayRestaurants();
}
  
  let searchDebounceTimer;
  function onSearchInput() { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(handleFilterChange, SEARCH_DEBOUNCE_DELAY); }
  
  async function safeCallCMSFilter(action) { // forceRebind verwijderd voor eenvoud, 'refresh' doet het altijd
    if (!window.fsAttributes?.cmsfilter) { log("CMSFilter niet gevonden."); return; }
    try {
        if (window.fsAttributes.cmsfilter.loading) await window.fsAttributes.cmsfilter.loading;
        if (action === 'refresh' && window.fsAttributes.cmsfilter.destroy && window.fsAttributes.cmsfilter.init) {
            log("CMSFilter: destroy/init.");
            window.fsAttributes.cmsfilter.destroy(); window.fsAttributes.cmsfilter.init();
        } else if (action === 'init' && !window.fsAttributes.cmsfilter.instance?.form && window.fsAttributes.cmsfilter.init) {
            log("CMSFilter: init() (eerste keer)."); window.fsAttributes.cmsfilter.init();
        } else if (action === 'init') log("CMSFilter: init() overgeslagen.");
    } catch (error) { console.error("Fout in safeCallCMSFilter:", error); }
  }
  
// --- NIEUWE FUNCTIE: SWIPER INITIALISATIE ---
  function initializeSwiperForElement(sliderElement) {
    if (!sliderElement || typeof Swiper === 'undefined') {
      log("Swiper initialisatie overgeslagen: sliderElement niet gevonden of Swiper library niet geladen.", sliderElement);
      return null;
    }

    log("Swiper initialiseren voor element:", sliderElement);
    
    // Converteer jQuery-achtige attributen naar Swiper opties
    // In jouw voorbeeld gebruikte je jQuery $(this).attr(...), we doen dit nu met vanilla JS
    // op het specifieke 'sliderElement' dat wordt doorgegeven.
    let loopMode = sliderElement.getAttribute("loop-mode") === "true";
    let sliderDuration = 300;
    if (sliderElement.hasAttribute("slider-duration")) {
      sliderDuration = parseInt(sliderElement.getAttribute("slider-duration"), 10) || 300;
    }

    // Belangrijk: Swiper verwacht het .swiper container element, niet de .slider-main_component
    // Je moet de selector aanpassen aan jouw HTML structuur binnen het sliderElement.
    // Aanname: sliderElement is de .slider-main_component, en daarin zit .swiper
    const swiperContainer = sliderElement.querySelector(".swiper"); // OF .blog67_mask als dat je swiper container is
    if (!swiperContainer) {
        log("Swiper container (.swiper of .blog67_mask) niet gevonden binnen:", sliderElement);
        return null;
    }

    // Selectoren voor navigatie en paginatie BINNEN het specifieke sliderElement
    const nextButton = sliderElement.querySelector(".swiper-next"); // Of .slider-arrow.is-next
    const prevButton = sliderElement.querySelector(".swiper-prev"); // Of .slider-arrow.is-prev
    const paginationWrapper = sliderElement.querySelector(".swiper-bullet-wrapper"); // Of .blog67_slide-nav
    const scrollbarWrapper = sliderElement.querySelector(".swiper-drag-wrapper");

    try {
      const swiperInstance = new Swiper(swiperContainer, {
        speed: sliderDuration,
        loop: loopMode,
        autoHeight: false,
        centeredSlides: loopMode, // Alleen zinvol als loopMode true is en slidesPerView < aantal slides
        followFinger: true,
        freeMode: false,
        slideToClickedSlide: false,
        slidesPerView: 1,    // Default voor kleinste scherm
        spaceBetween: "2%",  // Moet een getal zijn in pixels voor Swiper V8, bv. 16 of '2%' als string als V8 dat ondersteunt
                              // Voor Swiper.js is een percentage string voor spaceBetween niet standaard.
                              // Gebruik een getal (pixels) of bereken het percentage. Laten we 16px als voorbeeld nemen.
                              // spaceBetween: 16, // 16px
        
        // Gebruik de class namen uit jouw Webflow slider structuur
        // Voorbeeld: .section_blog67 > .blog67_component > .blog67_group > .blog67_mask (dit is de .swiper-wrapper)
        // .blog67_slide (dit is .swiper-slide)
        // .slider-arrow (voor prev/next, met een extra class voor .is-next / .is-prev)
        // .blog67_slide-nav (voor .swiper-pagination)

        rewind: false, // Als loop false is, kan rewind handig zijn
        mousewheel: {
          forceToAxis: true
        },
        keyboard: {
          enabled: true,
          onlyInViewport: true
        },
        breakpoints: {
          480: { slidesPerView: 1.5, spaceBetween: 10 }, // Pas spaceBetween aan
          768: { slidesPerView: 2, spaceBetween: 15 },
          992: { slidesPerView: 3, spaceBetween: 20 }  // Pas spaceBetween aan
        },
        pagination: paginationWrapper ? {
          el: paginationWrapper,
          bulletActiveClass: "is-active", // Of je Webflow class
          bulletClass: "swiper-bullet",   // Of je Webflow class
          bulletElement: "button",        // Of 'div' als je dat gebruikt
          clickable: true
        } : false, // Zet op false als paginationWrapper niet bestaat
        navigation: (nextButton && prevButton) ? {
          nextEl: nextButton,
          prevEl: prevButton,
          disabledClass: "is-disabled" // Of je Webflow class
        } : false,
        scrollbar: scrollbarWrapper ? {
          el: scrollbarWrapper,
          draggable: true,
          dragClass: "swiper-drag", // Of je Webflow class
          snapOnRelease: true
        } : false,
        slideActiveClass: "is-active", // Of je Webflow class voor actieve slide
        slideDuplicateActiveClass: "is-active" // Voor loop mode
      });
      log("Swiper succesvol geïnitialiseerd voor:", sliderElement, swiperInstance);
      return swiperInstance;
    } catch (e) {
      console.error("Fout bij initialiseren Swiper voor:", sliderElement, e);
      return null;
    }
  }

// --- SLIDER LOGICA ---
async function fetchAllSliderDataOnce() { 
    log("--- fetchAllSliderDataOnce: FUNCTIE GESTART ---");
    
    if (allSliderData !== null) { 
        log("fetchAllSliderDataOnce: Slider data al aanwezig, wordt niet opnieuw gehaald.");
        return allSliderData; 
    }

    const requestUrl = API_RESTAURANTS_SLIDER; // De URL blijft hetzelfde, zonder parameters

    // STAP 1: Definieer de body van het POST-verzoek
    const requestBody = {
      count: 10,
      exclude_slugs_str: [] // We sturen nu een echte, lege array zoals uw endpoint verwacht
    };
    
    log("fetchAllSliderDataOnce: API call (POST) naar:", requestUrl, "met body:", requestBody);
    
    try {
        // STAP 2: Bouw de fetch opties voor een POST request
        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // De 'Authorization' header wordt automatisch toegevoegd door fetchDataWithRetry
            },
            body: JSON.stringify(requestBody) // Converteer het object naar een JSON string
        };

        // De aanroep met de nieuwe opties
        allSliderData = await fetchDataWithRetry(requestUrl, fetchOptions);
        
        log("fetchAllSliderDataOnce: Data succesvol ontvangen:", allSliderData ? Object.keys(allSliderData) : 'null/leeg');
        return allSliderData;
    } catch (error) {
        console.error("fetchAllSliderDataOnce: Fout bij ophalen slider data:", error);
        allSliderData = {}; 
        return null; 
    }
}


function injectAndRenderSlider(targetPlaceholderDiv, sliderKeyFromApi, sliderDisplayTitle) {
    // mainSliderTemplateNodeGlobal wordt gezet in initializeSite
    if (!mainSliderTemplateNodeGlobal) { 
        log("Hoofd slider template (mainSliderTemplateNodeGlobal) niet gevonden. Slider kan niet gemaakt worden."); 
        if(targetPlaceholderDiv && targetPlaceholderDiv.parentNode) targetPlaceholderDiv.remove();
        return; 
    }
    
    if (!allSliderData || !allSliderData[sliderKeyFromApi] || !Array.isArray(allSliderData[sliderKeyFromApi]) || allSliderData[sliderKeyFromApi].length === 0) {
        log(`Geen data of lege array voor slider key: ${sliderKeyFromApi} in allSliderData. Data:`, allSliderData);
        if(targetPlaceholderDiv && targetPlaceholderDiv.parentNode) targetPlaceholderDiv.remove();
        return;
    }

    const itemsForThisSlider = allSliderData[sliderKeyFromApi];
    const newSliderInstance = mainSliderTemplateNodeGlobal.cloneNode(true); // Kloon je #slider-template (bv. section_blog67)
    newSliderInstance.removeAttribute('id'); 
    newSliderInstance.style.display = '';    

    // Jouw Webflow structuur: #slider-template (section_blog67) > ... > slider-main_component > ... > .swiper-wrapper (jouw .restaurant_slider-mask)
    const sliderMask = newSliderInstance.querySelector(sliderMaskSelector); // Dit is .swiper-wrapper of .restaurant_slider-mask
    const singleSlideTemplateNodeForCloning = mainSliderTemplateNodeGlobal.querySelector(sliderItemTemplateSelector); // Dit is .swiper-slide of .restaurant_slider-item

    if (!sliderMask) { 
        log(`Slider mask (${sliderMaskSelector}) niet gevonden binnen gekloonde slider instantie.`); 
        if(targetPlaceholderDiv && targetPlaceholderDiv.parentNode) targetPlaceholderDiv.remove(); 
        return; 
    }
    if (!singleSlideTemplateNodeForCloning) { 
        log(`Enkele slide template (${sliderItemTemplateSelector}) niet gevonden binnen de originele #slider-template.`); 
        if(targetPlaceholderDiv && targetPlaceholderDiv.parentNode) targetPlaceholderDiv.remove(); 
        return; 
    }
    
    sliderMask.innerHTML = ''; 

    // Titel voor de slider sectie - pas selector aan naar je Webflow structuur
    // Voorbeeld: .slider-main_component > .slider-main_heading-wrapper > .slider-main_heading > H2.heading-style-h2
    const titleEl = newSliderInstance.querySelector('.slider-main_heading .heading-style-h3'); 
    if (titleEl) {
        titleEl.textContent = sliderDisplayTitle;
    } else {
        log("Geen titel element (.slider-main_heading .heading-style-h3) gevonden in slider template voor titel:", sliderDisplayTitle);
    }

    itemsForThisSlider.forEach(restaurant => {
        const newSlideElement = renderRestaurantItem(restaurant, true); // isForSlider = true
        if (newSlideElement) { // newSlideElement is nu een gevulde .swiper-slide (of .restaurant_slider-item)
            sliderMask.appendChild(newSlideElement);
        }
    });
    
    if (targetPlaceholderDiv.parentNode) {
        targetPlaceholderDiv.parentNode.replaceChild(newSliderInstance, targetPlaceholderDiv);
        log(`Slider "${sliderDisplayTitle}" succesvol geïnjecteerd en placeholder vervangen.`);

        // --- SWIPER.JS INITIALISATIE ---
			// De 'newSliderInstance' is het root-element van ons component. We geven dit direct door.
			if (newSliderInstance && typeof initializeSwiperForElement === 'function') {
    // We controleren of onze instantie de class heeft die we verwachten, voor de zekerheid.
   		 if (newSliderInstance.matches('.slider-main_component')) {
        log("initializeSwiperForElement aanroepen voor de nieuwe slider instantie:", newSliderInstance);
        initializeSwiperForElement(newSliderInstance); // Roep je Swiper init functie aan
   			 } else {
        log("WARN: De nieuwe slider instantie heeft niet de class .slider-main_component. Swiper niet geïnitialiseerd.", newSliderInstance);
   	 }
		} else {
    log("WARN: initializeSwiperForElement functie niet gevonden of de slider instantie is leeg.");
}
// --- EINDE SWIPER.JS INITIALISATIE ---

    } else {
        log("Kan slider niet injecteren, targetPlaceholderDiv (meer) niet in DOM. Dit is onverwacht.");
    }
}
  async function fetchAndDisplayRestaurants() {
    if (isLoading) { log("Al aan het laden..."); return; }
    isLoading = true;
    sliderInjectionCounter = 0; 
    const currentMainListSlugs = []; 
    if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'block';
    if (restaurantListWrapperEl) restaurantListWrapperEl.style.opacity = '0.5'; // Waas aan

    // Zorg dat slider data beschikbaar is (wordt nu in initializeSite al gedaan)
    if (allSliderData === null) { 
        log("fetchAndDisplayRestaurants: allSliderData is nog null, wacht kort...");
        await new Promise(resolve => setTimeout(resolve, 300)); // Kleine wacht als het nog niet klaar zou zijn
    }
    
    const params = new URLSearchParams({page: currentPage, per_page: ITEMS_PER_PAGE, sort_by: currentSortBy});
    if (currentSearchTerm) params.append('search_term', currentSearchTerm);
    if (currentFilters.filter_keuken.length > 0) params.append('filter_keuken', currentFilters.filter_keuken.join(','));
    if (currentFilters.filter_meal_options.length > 0) params.append('filter_meal_options', currentFilters.filter_meal_options.join(','));
    if (currentFilters.filter_price.length > 0) params.append('filter_price', currentFilters.filter_price.join(','));
    const requestUrl = `${API_RESTAURANTS_LIST}?${params.toString()}`;
    log("API call hoofdlijst:", requestUrl);

    try {
      const data = await fetchDataWithRetry(requestUrl, {});
      log("Hoofdlijst data ontvangen:", data ? JSON.parse(JSON.stringify(data)) : "Geen data object"); 

      if (!data) { throw new Error("Geen data object teruggekomen van fetchDataWithRetry voor hoofdlijst."); }
      
      if (restaurantListWrapperEl) restaurantListWrapperEl.innerHTML = ''; 

      if (data?.items?.length > 0) {
        data.items.forEach((restaurant, index) => {
          const itemEl = renderRestaurantItem(restaurant, false); 
          if (itemEl) { 
            restaurantListWrapperEl.appendChild(itemEl);
            if (restaurant.slug) currentMainListSlugs.push(restaurant.slug);
          }

          if ((index + 1) % SLIDER_INJECT_AFTER_N_ITEMS === 0 && (index + 1) < data.items.length) {
            const sliderDataKeys = allSliderData ? Object.keys(allSliderData) : []; 
            if (sliderDataKeys.length > 0 && allSliderData[sliderDataKeys[0]] !== undefined ) {
                const sliderKeyToInject = sliderDataKeys[sliderInjectionCounter % sliderDataKeys.length];
                if (allSliderData[sliderKeyToInject] && allSliderData[sliderKeyToInject].length > 0) {
                    let sliderTitle = "Aanbevolen"; 
                    if (sliderKeyToInject === 'result_random') sliderTitle = 'Willekeurig Uitgelicht';
                    else if (sliderKeyToInject === 'result_newest') sliderTitle = 'Nieuwkomers';
                    else if (sliderKeyToInject === 'result_allergy_rating') sliderTitle = 'Top voor Allergieën';
                    else if (sliderKeyToInject === 'result_email') sliderTitle = 'Onze Selectie'; 

                    const placeholderDiv = document.createElement('div');
                    placeholderDiv.className = 'slider-injection-placeholder'; 
                    restaurantListWrapperEl.appendChild(placeholderDiv);
                    
                    log(`Injecteer slider: ${sliderTitle} (key: ${sliderKeyToInject}) na item ${index + 1}`);
                    injectAndRenderSlider(placeholderDiv, sliderKeyToInject, sliderTitle);
                    sliderInjectionCounter++;
                } else { log(`Slider injectie overgeslagen: Geen items voor key ${sliderKeyToInject}`); }
            } else { log(`Slider injectie overgeslagen: allSliderData is leeg, null of heeft geen keys.`); }
          }
        });
        if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'none';
      } else { 
        if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'block';
        log("Geen items in hoofdlijst.");
      }
      
      let newTotalPages = data?.pageTotal ?? data?.total_page_count ?? 0; 
      let newTotalItems = data?.itemsTotal ?? data?.total_items_count ?? 0;
      totalPages = newTotalPages; // Update globale totalPages
      if (resultsCountTextEl) resultsCountTextEl.textContent = newTotalItems.toString();
      updatePaginationUI();

      await safeCallCMSFilter('refresh'); // Doe refresh na renderen
      initialLoadComplete = true; // Zet vlag na eerste succesvolle load

    } catch (error) { 
        console.error("Fout in fetchAndDisplayRestaurants:", error);
        totalPages = 0;
        if (resultsCountTextEl) resultsCountTextEl.textContent = '0'; // Zet count op 0 bij error
        if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'block';
        updatePaginationUI();
    } 
    finally { 
        isLoading = false;
        if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'none';
        if (restaurantListWrapperEl) restaurantListWrapperEl.style.opacity = '1'; // Waas weg
    }
  }

  // --- INITIALISATIE ---
async function initializeSite() {
  log("Site initialisatie gestart.");

  // STAP 1: Haal het token op en WACHT.
  try {
    const response = await fetch(API_AUTH_LOGIN, { method: 'POST' }); 
    if (!response.ok) {
      throw new Error(`Authenticatie-server reageerde met status: ${response.status}`);
    }
  	xanoAuthToken = await response.json(); 
    console.log("ONTVANGEN TOKEN IN VARIABELE:", xanoAuthToken); // Extra logging

  } catch (error) {
    console.error("KRITISCHE FOUT: Authenticatie mislukt. Stoppen met initialisatie.", error);
    if(finsweetLoaderEl) finsweetLoaderEl.style.display = 'none'; // Verberg de lader
    if(finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'block'; // Toon de 'leeg' staat
    return; // Stop de hele functie hier
  }

  // Als we hier komen, weten we 100% zeker dat we een token hebben.

  // Koppel nu pas de DOM elementen, voor het geval we eerder moesten stoppen.
  restaurantListWrapperEl = document.querySelector(restaurantListWrapperSelector);
  templateItemEl = document.querySelector(templateItemSelector);
  mainSliderTemplateNodeGlobal = document.querySelector(mainSliderTemplateSelector);
  filterFormEl = document.querySelector(filterFormSelector);
  searchInputEl = document.querySelector(searchInputSelector);
  resultsCountTextEl = document.querySelector(resultsCountTextSelector);
  paginationPrevEl = document.querySelector(paginationPrevButtonSelector);
  paginationNextEl = document.querySelector(paginationNextButtonSelector);
  paginationInfoEl = document.querySelector(paginationInfoTextSelector);
  paginationNumbersContainerEl = document.querySelector(paginationNumbersContainerSelector);
  finsweetEmptyStateEl = document.querySelector(finsweetEmptyStateSelector);
  finsweetLoaderEl = document.querySelector(finsweetLoaderSelector);
  clearAllButtonEl = document.querySelector(clearAllButtonSelector);
  applyFiltersButtonEl = document.querySelector(applyFiltersButtonSelector);
  openFiltersButtonEl = document.querySelector(openFiltersButtonSelector);
	closeFiltersButtonEl = document.querySelector(closeFiltersButtonSelector);
	filtersPanelEl = document.querySelector(filtersPanelSelector);
  
  if (!restaurantListWrapperEl || !templateItemEl) { 
      console.error("Kritische elementen niet gevonden! Stoppen."); 
      return; 
  }
  
  if(templateItemEl) templateItemEl.style.display = 'none';
  if(mainSliderTemplateNodeGlobal) mainSliderTemplateNodeGlobal.style.display = 'none';

  // STAP 2: Haal de slider data op en WACHT.
  await fetchAllSliderDataOnce();

  // STAP 3: Haal de restaurant data op.
  await fetchAndDisplayRestaurants();

  // STAP 4: Voeg nu pas de event listeners toe.

// Hulpfunctie om het paneel te sluiten
function closeFiltersPanel() {
  if (filtersPanelEl) {
    log("Filter paneel sluiten.");
    filtersPanelEl.classList.remove('is-open');
  }
}

// Listener voor de zoekbalk (Desktop-only)
if (searchInputEl) {
  searchInputEl.addEventListener('input', () => {
    if (window.innerWidth >= 992) { // Gebruik 992px als standaard tablet breakpoint
      log("Desktop: Zoek-input gewijzigd, direct filteren.");
      onSearchInput();
    }
  });
}

// Listener voor de checkboxes (Desktop-only)
const filterElementsForChange = filterFormEl || document.body;
filterElementsForChange.addEventListener('change', (e) => {
  if (e.target.type === 'checkbox' && (e.target.closest(keukenCheckboxGroupSelector) || e.target.closest(mealOptionsCheckboxGroupSelector) || e.target.closest(priceCheckboxGroupSelector))) {
    if (window.innerWidth >= 992) {
      log("Desktop: Checkbox gewijzigd, direct filteren.");
      handleFilterChange();
    }
  }
});

// Listener voor de 'Open Filters' knop (Mobiel)
if (openFiltersButtonEl && filtersPanelEl) {
  openFiltersButtonEl.addEventListener('click', () => {
    log("Open filters knop geklikt.");
    filtersPanelEl.classList.add('is-open');
  });
}

// Listener voor de 'Close Filters' knop (Mobiel)
if (closeFiltersButtonEl) {
  closeFiltersButtonEl.addEventListener('click', closeFiltersPanel);
}

// ÉÉN GECOMBINEERDE Listener voor de 'Apply Filters' knop
if (applyFiltersButtonEl) {
  applyFiltersButtonEl.addEventListener('click', (e) => {
    e.preventDefault();
    log("Apply filters knop geklikt.");
    handleFilterChange(); // Pas altijd de filters toe
    if (window.innerWidth < 992) {
      closeFiltersPanel(); // Sluit het paneel alleen op mobiel
    }
  });
}

  if (paginationPrevEl) paginationPrevEl.addEventListener('click', (e) => { e.preventDefault(); if (currentPage > 1 && !isLoading) { currentPage--; fetchAndDisplayRestaurants(); } });
  if (paginationNextEl) paginationNextEl.addEventListener('click', (e) => { e.preventDefault(); if (currentPage < totalPages && !isLoading && totalPages > 0) { currentPage++; fetchAndDisplayRestaurants(); } });
    if (paginationNumbersContainerEl) {
        paginationNumbersContainerEl.addEventListener('click', (e) => {
            e.preventDefault(); 
            const clickedElement = e.target; // Het daadwerkelijk geklikte element
            log("Paginanummer-container klik. Geklikt op:", clickedElement);

            // Ga alleen verder als het geklikte element (of zijn ouder met .pagination-number) een data-page heeft
            const pageButton = clickedElement.closest('.pagination-number');
            if (!pageButton || !pageButton.dataset.page) {
                log("Klik was niet op een geldige paginaknop met data-page.");
                return; 
            }

            const pageNumStr = pageButton.dataset.page;
            const pageClicked = parseInt(pageNumStr, 10);
            log(`Paginaknop data-page: "${pageNumStr}", Geparst als: ${pageClicked}`);

            // Check 1: Is het een geldig paginanummer (niet 0 voor dots, en niet NaN)?
            if (!pageClicked || isNaN(pageClicked)) {
                log("Ongeldig paginanummer (0 of NaN) geklikt. Actie genegeerd.");
                return;
            }

            // Check 2: Is de pagina al aan het laden?
            if (isLoading) {
                log("Al aan het laden, paginaklik genegeerd.");
                return;
            }

            // Check 3: Is het de huidige pagina?
            if (pageClicked === currentPage) {
                log("Geklikt op de huidige actieve pagina. Actie genegeerd.");
                return;
            }

            // Als alle checks OK zijn:
            currentPage = pageClicked;
            log(`SUCCESS: Nieuwe pagina is ${currentPage}. fetchAndDisplayRestaurants() wordt aangeroepen.`);
            fetchAndDisplayRestaurants();
        });
    } else {
        log("Paginanummers container (paginationNumbersContainerEl) niet gevonden voor click listener setup.");
    }
    // --- VERVANG UW HELE clearAllButtonEl BLOK MET DIT ---

		if (clearAllButtonEl) {
    clearAllButtonEl.addEventListener('click', (e) => {
        e.preventDefault(); 
        log("Clear all filters geklikt.");

        // 1. Reset het zoekveld (dit deed u al)
        if (searchInputEl) {
            searchInputEl.value = '';
        }

        // 2. Loop door alle filtergroepen om de checkboxes te resetten
        const allFilterGroupSelectors = [keukenCheckboxGroupSelector, mealOptionsCheckboxGroupSelector, priceCheckboxGroupSelector];
        
        allFilterGroupSelectors.forEach(groupSelector => {
            const groupEl = document.querySelector(groupSelector);
            if (groupEl) {
                // Vind alle checkboxes binnen deze groep
                const checkboxes = groupEl.querySelectorAll('input[type="checkbox"]');
                
                checkboxes.forEach(cb => {
                    // Reset de daadwerkelijke 'checked' staat
                    cb.checked = false;

                    // Reset de visuele weergave van Webflow
                    // Webflow voegt 'w--redirected-checked' toe voor de visuele stijl.
                    const visualCheckbox = cb.previousElementSibling;
                    if (visualCheckbox && visualCheckbox.classList.contains('w-checkbox-input')) {
                        visualCheckbox.classList.remove('w--redirected-checked');
                    }
                });
            }
        });

        // 3. Roep de filterfunctie aan om de resultaten te vernieuwen (dit deed u al)
        handleFilterChange(true);
    });
}
    
    if (window.fsAttributes) { /* ... Wacht op Finsweet ... */ } 
    
    await fetchAllSliderDataOnce(); 
    await fetchAndDisplayRestaurants(); // Wacht op de eerste load
    // safeCallCMSFilter('init') is nu verplaatst naar einde van fetchAndDisplayRestaurants (als 'refresh')
  }

  setTimeout(initializeSite, 700); 
});
