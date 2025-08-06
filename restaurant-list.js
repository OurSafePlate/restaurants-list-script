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

  // --- KAART CONFIGURATIE ---
  const NOMINATIM_GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search?format=json&q=';
  const INITIAL_COORDS = [52.3676, 4.9041]; // Amsterdam
  const INITIAL_ZOOM = 12;

  const parentComponentSelector = '.layout192_component';
  const showMapButtonSelector = '#show-map-button';
  const mapElementSelector = '#map';
  const locateMeButtonSelector = '#locate-me-button';
  const searchAreaButtonSelector = '#map-search-area-button';

  const mapOverlaySelector = '#map-overlay';
  const closeMapButtonSelector = '#map-close-button';
  const mapListContainerSelector = '#map-restaurant-list';
  const mapListTemplateSelector = '.is-map-list-template';
  const filtersToggleButtonSelector = '#map-filters-toggle-button';
  const filterPanelSelector = '#map-filter-form-content';


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
  const allergieCheckboxGroupSelector = '.filter-group-allergie';
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
  let currentFilters = { filter_keuken: [], filter_meal_options: [], filter_price: [], filter_allergie: [] };
  let currentSortBy = 'name_asc'; 
  let totalPages = 0; // Start met 0
  let isLoading = false;
  let allSliderData = null;
  let xanoAuthToken = null;
  let sliderInjectionCounter = 0;
  let initialLoadComplete = false; 

  // --- KAART STATE ---
  let map;
  let markers = {}; // { restaurantId: markerObject }
  let isMapInitialized = false; // Vlag om te zien of de kaart al geladen is
  let currentMapRestaurants = []; // Slaat de resultaten op die op de kaart getoond worden	

  // --- DOM ELEMENTEN ---
   let restaurantListWrapperEl, templateItemEl, mainSliderTemplateNodeGlobal, searchInputEl,
        resultsCountTextEl, paginationPrevEl, paginationNextEl, paginationNumbersContainerEl,
        applyFiltersButtonEl, clearAllButtonEl, showMapButton, mapOverlay, closeMapButton,
        mapContainer, mapListContainer, searchAreaButton, filtersToggleButton, filterPanel, finsweetLoaderEl, finsweetEmptyStateEl;

  // --- LOG FUNCTIE ---
  function log(...args) {
    if (DEBUG_LOGGING) console.log("[OurSafePlate Final]", ...args); 
  }
  log("Script gestart. Versie: SWIPER_INTEGRATED_V1.2");

  // --- HULPFUNCTIES ---
  async function fetchDataWithRetry(url, options, retries = API_CALL_RETRIES, attempt = 1) {
    log(`fetchData: Poging ${attempt} voor ${url}`, options ? `met opties` : '');
    
    // Wacht ALTIJD tot de getAuthToken functie is voltooid.
    const token = await getAuthToken(); 
    
    const requestHeaders = new Headers(options.headers || {});
    
    // Voeg het token toe aan de headers.
    if (token) {
        requestHeaders.set('Authorization', `Bearer ${token}`);
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

async function getAuthToken() {
    if (xanoAuthToken) return xanoAuthToken;
    log("Authenticatie token ophalen...");
    try {
        const response = await fetch(API_AUTH_LOGIN, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(`Authenticatie serverfout: ${response.status}`);
        }
        
        // De response is een JSON-geformatteerde string.
        // We gebruiken .json() om het correct uit te pakken.
        const token = await response.json(); 
        
        // Controleer of het resultaat een string is en op een token lijkt.
        if (token && typeof token === 'string' && token.startsWith('ey')) {
            xanoAuthToken = token;
            log("Authenticatie succesvol, token ontvangen.");
            return xanoAuthToken;
        } else {
            throw new Error("Ongeldig of onbekend formaat token ontvangen. Verwachtte een pure string.");
        }

    } catch (error) {
        console.error("KRITISCHE FOUT: Authenticatie mislukt.", error);
        throw error;
    }
}
	
// --- NIEUWE FUNCTIE: FILTERS UIT URL LEZEN EN TOEPASSEN ---
function applyFiltersFromURL() {
    log("applyFiltersFromURL: Functie gestart. Controleren op URL-parameters...");
    const urlParams = new URLSearchParams(window.location.search);
    let filtersWereApplied = false;

    // Een 'woordenboek' om URL-parameters te koppelen aan uw filter-configuratie
    const paramConfig = {
        'keuken': {
            groupSelector: keukenCheckboxGroupSelector,
            dataAttribute: 'cuisine', // data-cuisine -> cuisine
            filterKey: 'filter_keuken'
        },
        'meal_options': {
            groupSelector: mealOptionsCheckboxGroupSelector,
            dataAttribute: 'mealOptions', // data-meal-options -> mealOptions
            filterKey: 'filter_meal_options'
        },
        'price': {
            groupSelector: priceCheckboxGroupSelector,
            dataAttribute: 'price', // data-price -> price
            filterKey: 'filter_price'
        },
	'allergie': { // <-- NIEUWE SECTIE
           groupSelector: allergieCheckboxGroupSelector, 
           dataAttribute: 'allergy',                    
           filterKey: 'filter_allergie'           
	}
    };

    // Loop door elke configuratie
    for (const paramName in paramConfig) {
        if (urlParams.has(paramName)) {
            const config = paramConfig[paramName];
            // Haal waarden op en split ze op de komma (voor meerdere waarden, bv. ?keuken=Italiaans,Frans)
            const valuesFromURL = urlParams.get(paramName).split(',').map(v => v.trim()).filter(Boolean);

            if (valuesFromURL.length > 0) {
                log(`Parameter gevonden: '${paramName}' met waarden:`, valuesFromURL);
                filtersWereApplied = true;

                const filterGroupEl = document.querySelector(config.groupSelector);
                if (!filterGroupEl) {
                    log(`Waarschuwing: Filtergroep '${config.groupSelector}' niet gevonden.`);
                    continue; // Ga door naar de volgende parameter
                }

                // Loop door alle checkboxes in de groep
                filterGroupEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    const checkboxValue = cb.dataset[config.dataAttribute];
                    if (checkboxValue && valuesFromURL.includes(checkboxValue)) {
                        log(`Match gevonden! Checkbox met waarde '${checkboxValue}' wordt aangevinkt.`);
                        // 1. Vink de checkbox daadwerkelijk aan
                        cb.checked = true;

                        // 2. Update de visuele stijl van Webflow
                        const visualCheckbox = cb.previousElementSibling;
                        if (visualCheckbox && visualCheckbox.classList.contains('w-checkbox-input')) {
                            visualCheckbox.classList.add('w--redirected-checked');
                        }
                    }
                });
            }
        }
    }

    // Als er filters zijn toegepast via de URL, roepen we handleFilterChange aan.
    // Dit zorgt ervoor dat de 'currentFilters' state wordt bijgewerkt en de eerste fetch correct wordt uitgevoerd.
    if (filtersWereApplied) {
        log("Filters uit URL zijn toegepast. handleFilterChange() wordt aangeroepen om de state en lijst te updaten.");
        // We roepen de bestaande functie aan die de state bijwerkt op basis van de (nu aangevinkte) checkboxes.
        handleFilterChange();
        return true; // Geef aan dat de fetch al is gestart
    }
    
    log("Geen geldige filter-parameters in URL gevonden.");
    return false; // Geef aan dat een normale fetch moet plaatsvinden
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

// --- NIEUWE HERBRUIKBARE FUNCTIE VOOR ALLERGIE-ICOONTJES ---
function renderAllergyIcons(parentElement, allergyText) {
  // Definieer de "woordenboek" map BINNEN de functie
  const allergyIconMap = {
    "ei allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0af5f0966589c0bc75a_ei.png",
    "ei-intolerantie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0af5f0966589c0bc75a_ei.png",
    "glutenbevattende granen allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0afed7adf1139c811c8_gluten.png",
    "glutenovergevoeligheid (zonder coeliakie)": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0afed7adf1139c811c8_gluten.png",
    "melkallergie (koemelk)": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0ae9cbc248d9691a00b_melk.png",
    "lactose-intolerantie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0ae9cbc248d9691a00b_melk.png",
    "lupine allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0afd5025c5d7a13b0dd_lupine.png",
    "mosterd allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0ae9d789b79b07dda42_mosterd.png",
    "noten allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b1e14f0cb8d003fca1_noten.png",
    "pinda allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0aff30648cc671ee3d2_pindas.png",
    "schaaldieren allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0ae7c1173f8e0a6116a_schaald.png",
    "selderij allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b1074f4e4f53a33db0_selderij.png",
    "sesamzaad allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b05f0966589c0bc81d_sesamzaad.png",
    "soja allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b0ecf980276bd93d3b_soja.png",
    "soja-intolerantie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b0ecf980276bd93d3b_soja.png",
    "vis allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b0337d460e04f1644a_vis.png",
    "weekdieren allergie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6808e0b111bf1e6f46eed61b_weekdieren.png",
    "fructose-intolerantie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/68613ac408fa5f77d9c5e9b9_Ontwerp%20zonder%20titel%20(25).png",
    "histamine-intolerantie": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/68613bba4ef175a5beb49955_Ontwerp%20zonder%20titel%20(26).png",
    "salicylaatovergevoeligheid": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/68613d2c9921aea0c284ea36_Ontwerp%20zonder%20titel%20(27).png",
    "sulfietovergevoeligheid": "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/68613e0d4979f309dcab57ec_Ontwerp%20zonder%20titel%20(29).png",
  };

  const capitalizeFirstLetter = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

  // Zoek de doel-container BINNEN het specifieke parentElement
  const targetElement = parentElement.querySelector('#allergy-icon-container');
  if (!targetElement) return;

  const allergiesArray = (allergyText || "").toLowerCase().split(',').map(s => s.trim()).filter(s => s);
  
  targetElement.innerHTML = "";

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

 // ---  renderRestaurantItem FUNCTIE  ---

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
        const totalRatingValue = restaurantData.avg_total_rating ?? restaurantData.total_rating;
        const totalRatingTextEl = newItem.querySelector('.restaurant-total-rating');
        if (totalRatingTextEl) {
            totalRatingTextEl.textContent = totalRatingValue ? parseFloat(totalRatingValue).toFixed(1) : '-';
        }
        renderRatingVisuals(newItem, '.restaurants_rating-star-wrap.is-quality-rating', totalRatingValue);

        const safeScoreValue = restaurantData.allergy_rating; 
        const safeScoreTextEl = newItem.querySelector('.restaurants_allergy_rating-overlay.is-slider-overlay .restaurants_allergy_rating-overlay-rating');
        if (safeScoreTextEl) {
            safeScoreTextEl.textContent = safeScoreValue ? parseFloat(safeScoreValue).toFixed(1) : '-';
        }
        const safeScoreVisualsContainerSelector = '.restaurants_allergy_rating-overlay.is-slider-overlay .restaurants_rating_star-wrap.restaurants_rating_allergy-wrap';
        renderRatingVisuals(newItem, safeScoreVisualsContainerSelector, safeScoreValue);

        const keukenEl = newItem.querySelector('.restaurant_cuisine');
        if (keukenEl) keukenEl.textContent = restaurantData.restaurant_keuken || '-';

        const priceEl = newItem.querySelector('.restaurant_price');
        if (priceEl) priceEl.textContent = restaurantData.restaurant_price || '-';

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

	// --- START NIEUWE LOGICA: ALLERGIE-TITEL TONEN/VERBERGEN ---

    // 1. Zoek het titel-element BINNEN het huidige restaurant-item.
    const allergyTitleEl = newItem.querySelector('#allergy-title-icons');
    
    // 2. Haal de allergie-tekst op uit de Xano data.
    const allergyTextFromXano = restaurantData.review_allergies || "";

    // 3. Controleer of de titel-div bestaat en of er daadwerkelijk allergie-tekst is.
    if (allergyTitleEl) {
        if (allergyTextFromXano && allergyTextFromXano.trim() !== "") {
            // Zo ja: maak de titel zichtbaar.
            // Gebruik 'block', 'flex', of '' afhankelijk van de standaard display-stijl in Webflow.
            allergyTitleEl.style.display = 'block'; 
        } else {
            // Zo nee: verberg de titel.
            allergyTitleEl.style.display = 'none';
        }
    }

    // --- EINDE NIEUWE LOGICA ---

	// --- START NIEUWE LOGICA: ALLERGIE-ICOONTJES ---
    
    // 1. Zoek het 'allergy-source' tekstveld BINNEN dit specifieke item.
    const allergySourceField = newItem.querySelector('#allergy-source');
    
    // 2. Vul dit veld met de data uit Xano.
    if (allergySourceField) {
        // Gebruik het juiste veld uit uw Xano response, in dit geval 'review_allergies'
        const allergyTextFromXano = restaurantData.review_allergies || ""; 
        allergySourceField.textContent = allergyTextFromXano;
        
        // 3. Roep de nieuwe hulpfunctie aan om de icoontjes te renderen.
        // We geven het hele 'newItem' door als context, en de tekst die we net hebben ingesteld.
        renderAllergyIcons(newItem, allergyTextFromXano);
    }
    
    // --- EINDE NIEUWE LOGICA ---
        
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

function initMap() {
    if (isMapInitialized) return;
    
    const mapElement = document.querySelector(mapElementSelector);
    if (!mapElement) {
        console.error("FATALE FOUT: Kon de kaart-container '#map' niet vinden op het moment van initialisatie.");
        return;
    }
    
    log("Kaart initialiseren in:", mapElement);
    isMapInitialized = true; // Zet de vlag direct om dubbele initialisatie te voorkomen.

    map = L.map(mapElement).setView(INITIAL_COORDS, INITIAL_ZOOM);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO', maxZoom: 20
    }).addTo(map);

    map.on('moveend', () => {
        if (searchAreaButton) searchAreaButton.parentElement.style.display = 'block';
    });

    // Wacht een ruime marge (nadat de kaarttegels beginnen te laden)
    // om zeker te zijn dat de kaart volledig gerenderd is.
    setTimeout(() => {
        log("Forceer redraw en haal data op.");
        map.invalidateSize();
        handleSearchArea();
    }, 400); // 400ms is een veilige, ruime marge.
}

function createMarker(restaurant) {
    const lat = restaurant.geo_location?.data?.lat;
    const lon = restaurant.geo_location?.data?.lng;

    if (!lat || !lon || !map) return;

    // Haal de allergy_rating op. Toon een '-' als deze niet bestaat.
    const ratingText = restaurant.allergy_rating ? parseFloat(restaurant.allergy_rating).toFixed(1) : '-';

    // BELANGRIJK: URL naar je vleugel-icoon. Zorg dat deze correct is.
    const wingIconUrl = "https://cdn.prod.website-files.com/67ec1f5e9ca7126309c2348f/6893bdc678b1b5d1cc10666a_Ontwerp%20zonder%20titel%20(30).png";

    // --- DE WIJZIGING: Bouw de nieuwe HTML-structuur ---
    const customIconHtml = `
        <div class="marker-wrapper">
            <div class="marker-icon-body">
                <img src="${wingIconUrl}" class="marker-icon-img">
            </div>
            <div class="marker-rating-flag">
                ${ratingText}
            </div>
        </div>
    `;

    const customIcon = L.divIcon({
        html: customIconHtml,
        className: '', // Laat leeg om CSS-conflicten te voorkomen
        iconSize: [38, 48],   // De afmetingen van de .marker-wrapper
        iconAnchor: [19, 48]    // De "punt" van de marker (onderaan in het midden van de cirkel)
    });

    const marker = L.marker([lat, lon], { icon: customIcon }).addTo(map);

    marker.bindTooltip(restaurant.Name);
    marker.on('click', () => handleMarkerClick(restaurant.id));
    markers[restaurant.id] = marker;
}
	
async function handleSearchArea() {
    if (!map) return;
    log("handleSearchArea: Zoekopdracht wordt uitgevoerd.");
    if (searchAreaButton) searchAreaButton.parentElement.style.display = 'none';

    const bounds = map.getBounds();
    // Validatie: Zorg ervoor dat we geen '0x0' gebied opvragen
    if (bounds.getSouthWest().equals(bounds.getNorthEast())) {
        log("Waarschuwing: Kaartgrenzen zijn identiek. Zoekopdracht wordt uitgesteld.");
        return;
    }

    const params = new URLSearchParams({
        sw_lat: bounds.getSouthWest().lat,
        sw_lng: bounds.getSouthWest().lng,
        ne_lat: bounds.getNorthEast().lat,
        ne_lng: bounds.getNorthEast().lng,
    });

    try {
        const result = await fetchDataWithRetry(`${API_RESTAURANTS_LIST}?${params.toString()}`, {});
        currentMapRestaurants = result.items || [];
        displayDataOnMap(currentMapRestaurants);
    } catch (error) {
        console.error("Fout bij zoeken in gebied:", error);
    }
}
	
function handleMarkerClick(id) {
    if (!mapListContainer) return;
    const listItem = mapListContainer.querySelector(`[data-restaurant-id='${id}']`);
    if (listItem) {
        listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightSelection(id, true);
    }
}

function handleListItemClick(id) {
    const restaurant = currentMapRestaurants.find(r => r.id === id);
    if (restaurant && restaurant.geo_location?.data && map) {
        map.flyTo([restaurant.geo_location.data.lat, restaurant.geo_location.data.lng], 16);
        highlightSelection(id, false);
    }
}

function highlightSelection(id, openTooltip = false) {
    if (!mapListContainer) return;
    mapListContainer.querySelectorAll('.restaurants_item-component').forEach(card => card.classList.remove('is-map-highlighted'));
    
    const listItem = mapListContainer.querySelector(`[data-restaurant-id='${id}']`);
    if (listItem) listItem.classList.add('is-map-highlighted');

    Object.values(markers).forEach(m => m.setZIndexOffset(0));
    const marker = markers[id];
    if (marker) {
        marker.setZIndexOffset(1000);
        if (openTooltip) marker.openTooltip();
    }
}

    
function openMapOverlay() {
    log("Kaart overlay wordt geopend...");
    if (!mapOverlay) {
        console.error("Fout: Kan het kaart-overlay element (#map-overlay) niet vinden.");
        return;
    }

    // Maak de overlay zichtbaar. Dit triggert de CSS-transitie.
    mapOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Wacht een fractie van een seconde zodat de display-wijziging is verwerkt.
    setTimeout(() => {
        mapOverlay.style.opacity = '1';

        // Initialiseer de kaart NU PAS.
        if (!isMapInitialized) {
            initMap();
        } else {
            // Als de kaart al bestaat, forceer een redraw.
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 100);
        }
    }, 10); // Een minimale vertraging van 10ms is al genoeg.
}

function closeMapOverlay() {
    log("Kaart overlay sluiten...");
    if (!mapOverlay) return;

    mapOverlay.style.opacity = '0';
    document.body.style.overflow = '';
    
    // Wacht tot de animatie klaar is voordat we het element verbergen
    setTimeout(() => {
        mapOverlay.style.display = 'none';
    }, 500);
}


async function fetchRestaurantsForMap(params = {}) {
        if (!xanoAuthToken) xanoAuthToken = await getAuthToken();

        const url = new URL(API_RESTAURANTS_LIST);
        // Voeg alle parameters toe
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        
        log("API call naar:", url.toString());
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${xanoAuthToken}` } });
        if (!response.ok) throw new Error("Kon restaurants niet ophalen");
        return response.json();
    }


function displayDataOnMap(restaurants) {
    log(`displayDataOnMap: Functie gestart met ${restaurants.length} restaurants.`);
    if (!mapListContainer) {
        console.error("Fout: mapListContainer niet gevonden.");
        return;
    }

    // Stap 1: Vind de template voor ÉÉN ENKEL item.
    // We duiken dieper: .is-map-list-template -> .w-dyn-item
    const templateItem = document.querySelector(`${mapListTemplateSelector} .w-dyn-item`);
    
    if (!templateItem) {
        console.error("KRITISCHE FOUT: Kon het template item (.w-dyn-item) niet vinden binnen de .is-map-list-template wrapper. Zorg ervoor dat de Collection List niet leeg is in de Designer.");
        mapListContainer.innerHTML = '<div>Template voor restaurantlijst is niet correct ingesteld.</div>';
        return;
    }

    // Stap 2: Leeg de lijst en de kaartmarkers.
    mapListContainer.innerHTML = '';
    Object.values(markers).forEach(marker => map.removeLayer(marker));
    markers = {};
    
    // Stap 3: Render de nieuwe items.
    if (restaurants.length === 0) {
        mapListContainer.innerHTML = '<div class="empty-state-map">Geen restaurants gevonden in dit gebied.</div>';
        return;
    }

    restaurants.forEach(restaurant => {
        createMarker(restaurant);

        // Stap 4: Kloon het INDIVIDUELE item, niet de hele lijst.
        const newItem = templateItem.cloneNode(true);
        // De class 'is-map-list-template' zit op de parent, dus die hoeven we hier niet te verwijderen.
        // De display-stijl van het gekloonde item staat standaard goed.
        
        // Vul de data in
        const titleEl = newItem.querySelector('.restaurants_title');
        if (titleEl) titleEl.textContent = restaurant.Name || 'Naam onbekend';
        
        const imgEl = newItem.querySelector('.restaurants_img');
        if (imgEl && restaurant.restaurant_img_url) {
            imgEl.src = restaurant.restaurant_img_url;
        } else if (imgEl) {
            imgEl.src = ''; // Lege src voor restaurants zonder afbeelding
        }

        const cuisineEl = newItem.querySelector('.restaurant_cuisine');
        if (cuisineEl) cuisineEl.textContent = restaurant.restaurant_keuken || '-';

        // Voeg hier de rest van je velden toe (prijs, ratings etc.)
        // Voorbeeld voor rating:
        const totalRatingValue = restaurant.avg_total_rating ?? restaurant.total_rating;
        const totalRatingTextEl = newItem.querySelector('.restaurant-total-rating');
        if (totalRatingTextEl) totalRatingTextEl.textContent = totalRatingValue ? parseFloat(totalRatingValue).toFixed(1) : '-';
        renderRatingVisuals(newItem, '.restaurants_rating-star-wrap.is-quality-rating', totalRatingValue);


        // Stel links en listeners in
        const allLinksInItem = newItem.querySelectorAll('a');
        allLinksInItem.forEach(link => {
            if (restaurant.slug) link.href = `/restaurants/${restaurant.slug}`;
        });
        
        newItem.dataset.restaurantId = restaurant.id;
        newItem.addEventListener('click', () => handleListItemClick(restaurant.id));
        
        mapListContainer.appendChild(newItem);
    });
    log(`displayDataOnMap: ${restaurants.length} items succesvol toegevoegd.`);
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
    const paginationInfoEl = document.querySelector(paginationInfoTextSelector);
    const paginationPrevEl = document.querySelector(paginationPrevButtonSelector);
    const paginationNextEl = document.querySelector(paginationNextButtonSelector);

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
    
    renderPageNumbers(); // Deze functie blijft ongewijzigd
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
	currentFilters.filter_allergie = getSelectedCheckboxDataValues(allergieCheckboxGroupSelector, 'allergy') || [];
    } else {
        // Als het een clear all is, resetten we de filters hier expliciet naar lege arrays
        currentSearchTerm = '';
        currentFilters.filter_keuken = [];
        currentFilters.filter_meal_options = [];
        currentFilters.filter_price = [];
	currentFilters.filter_allergie = [];
        // De UI (checkboxes, input veld) wordt al gereset in de clearAllButton click handler
    }
    
    log("Huidige filters na handleFilterChange:", currentFilters, "Zoekterm:", currentSearchTerm);

    currentPage = 1; 
    fetchAndDisplayMainList();
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
        log("Slider data al in cache.");
        return;
    }

    const requestUrl = API_RESTAURANTS_SLIDER;
    const requestBody = { count: 10, exclude_slugs_str: [] };

    try {
        log("fetchAllSliderDataOnce: API call (POST) naar:", requestUrl);
        // We gebruiken een directe fetch hier, en voegen handmatig het token toe
        const token = await getAuthToken(); // Zorg ervoor dat het token beschikbaar is
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) throw new Error(`Slider API Fout: ${response.status}`);
        allSliderData = await response.json();
        log("Slider data succesvol ontvangen.");
    } catch (error) {
        console.error("fetchAllSliderDataOnce: Fout bij ophalen slider data:", error);
        allSliderData = {};
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
  
async function fetchAndDisplayMainList() {
    if (isLoading) { log("Al aan het laden..."); return; }
    isLoading = true;
    sliderInjectionCounter = 0;
    if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'block';
    if (restaurantListWrapperEl) restaurantListWrapperEl.style.opacity = '0.5';

    // Bestaande code voor het bouwen van de request URL - DIT IS CORRECT
    const params = new URLSearchParams({ page: currentPage, per_page: ITEMS_PER_PAGE, sort_by: currentSortBy });
    if (currentSearchTerm) params.append('search_term', currentSearchTerm);
    if (currentFilters.filter_keuken.length > 0) params.append('filter_keuken', currentFilters.filter_keuken.join(','));
    if (currentFilters.filter_meal_options.length > 0) params.append('filter_meal_options', currentFilters.filter_meal_options.join(','));
    if (currentFilters.filter_price.length > 0) params.append('filter_price', currentFilters.filter_price.join(','));
    if (currentFilters.filter_allergie.length > 0) params.append('filter_allergie', currentFilters.filter_allergie.join(','));
    const requestUrl = `${API_RESTAURANTS_LIST}?${params.toString()}`;

    try {
        const data = await fetchDataWithRetry(requestUrl, {});
        if (!data || !data.items) { throw new Error("API data is ongeldig."); }

        // Sla de data direct op in de state. De 'coords' worden later op de achtergrond toegevoegd.
        allRestaurantsWithCoords = data.items;
        
        // 1. Render de lijst onmiddellijk
        if (restaurantListWrapperEl) restaurantListWrapperEl.innerHTML = '';
        if (data.items.length > 0) {
            data.items.forEach((restaurant, index) => {
                const itemEl = renderRestaurantItem(restaurant, false);
                if (itemEl) {
                    itemEl.dataset.restaurantId = restaurant.id;
                    itemEl.addEventListener('click', () => handleListItemClick(restaurant.id));
                    restaurantListWrapperEl.appendChild(itemEl);
                }
                // Slider injectie blijft hier
                if ((index + 1) % SLIDER_INJECT_AFTER_N_ITEMS === 0 && (index + 1) < data.items.length) {
                    const sliderDataKeys = allSliderData ? Object.keys(allSliderData) : [];
                    if (sliderDataKeys.length > 0) {
                       const sliderKeyToInject = sliderDataKeys[sliderInjectionCounter % sliderDataKeys.length];
                       if(allSliderData[sliderKeyToInject] && allSliderData[sliderKeyToInject].length > 0){
                           let sliderTitle = "Aanbevolen";
                           if (sliderKeyToInject === 'result_random') sliderTitle = 'Willekeurig Uitgelicht';
                           else if (sliderKeyToInject === 'result_newest') sliderTitle = 'Nieuwkomers';
                           else if (sliderKeyToInject === 'result_allergy_rating') sliderTitle = 'Top voor Allergieën';
                           else if (sliderKeyToInject === 'result_email') sliderTitle = 'Onze Selectie';
                           const placeholderDiv = document.createElement('div');
                           restaurantListWrapperEl.appendChild(placeholderDiv);
                           injectAndRenderSlider(placeholderDiv, sliderKeyToInject, sliderTitle);
                           sliderInjectionCounter++;
                       }
                    }
                }
            });
            if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'none';
        } else {
            if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'block';
        }

      

        // 3. Update de rest van de UI direct.
        totalPages = data?.pageTotal ?? 0;
        if (resultsCountTextEl) resultsCountTextEl.textContent = data?.itemsTotal ?? 0;
        updatePaginationUI();
        initialLoadComplete = true;

    } catch (error) {
        console.error("Fout in fetchAndDisplayMainList:", error);
        totalPages = 0;
        if (resultsCountTextEl) resultsCountTextEl.textContent = '0';
        if (finsweetEmptyStateEl) finsweetEmptyStateEl.style.display = 'block';
        updatePaginationUI();
    } finally {
        isLoading = false;
        if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'none';
        if (restaurantListWrapperEl) restaurantListWrapperEl.style.opacity = '1';
    }
}

  // --- INITIALISATIE ---
async function initializeSite() {
    log("Site initialisatie gestart.");

    // STAP 1: KOPPEL ALLE DOM ELEMENTEN
    log("DOM elementen koppelen...");
    restaurantListWrapperEl = document.querySelector(restaurantListWrapperSelector);
    templateItemEl = document.querySelector(templateItemSelector);
    mainSliderTemplateNodeGlobal = document.querySelector(mainSliderTemplateSelector);
    searchInputEl = document.querySelector(searchInputSelector);
    resultsCountTextEl = document.querySelector(resultsCountTextSelector);
    paginationPrevEl = document.querySelector(paginationPrevButtonSelector);
    paginationNextEl = document.querySelector(paginationNextButtonSelector);
    paginationNumbersContainerEl = document.querySelector(paginationNumbersContainerSelector);
    clearAllButtonEl = document.querySelector(clearAllButtonSelector);
    applyFiltersButtonEl = document.querySelector(applyFiltersButtonSelector);
    openFiltersButtonEl = document.querySelector(openFiltersButtonSelector);
    closeFiltersButtonEl = document.querySelector(closeFiltersButtonSelector);
    filtersPanelEl = document.querySelector('#filters-panel');
    mapOverlay = document.querySelector(mapOverlaySelector);
    mapContainer = document.querySelector(mapElementSelector);
    mapListContainer = document.querySelector(mapListContainerSelector);
    finsweetLoaderEl = document.querySelector(finsweetLoaderSelector);
    finsweetEmptyStateEl = document.querySelector(finsweetEmptyStateSelector);
    searchAreaButton = document.querySelector(searchAreaButtonSelector);
    
    if (!restaurantListWrapperEl) return console.error("Hoofdlijst wrapper niet gevonden!");
    if (templateItemEl) templateItemEl.style.display = 'none';

    // STAP 2: KOPPEL ALLE EVENT LISTENERS
    log("Event listeners koppelen via event delegation...");

    document.body.addEventListener('click', (e) => {
        const target = e.target;

        // Kaart Overlay
        if (target.closest(showMapButtonSelector)) { e.preventDefault(); openMapOverlay(); }
        if (target.closest(closeMapButtonSelector)) { e.preventDefault(); closeMapOverlay(); }
        if (target.closest(searchAreaButtonSelector)) { e.preventDefault(); handleSearchArea(); }
        if (target.closest(filtersToggleButtonSelector)) {
            e.preventDefault();
            const mapFilterPanel = document.querySelector('#map-view-filter-panel');
            if (mapFilterPanel) mapFilterPanel.style.display = (mapFilterPanel.style.display === 'block') ? 'none' : 'block';
        }

        // Hoofdlijst Filters & Paginatie
        if (target.closest(applyFiltersButtonSelector)) { e.preventDefault(); handleFilterChange(); }
        if (target.closest(clearAllButtonSelector)) { e.preventDefault(); handleFilterChange(true); }
        if (target.closest(openFiltersButtonSelector)) { e.preventDefault(); if (filtersPanelEl) filtersPanelEl.classList.add('is-open'); }
        if (target.closest(closeFiltersButtonSelector)) { e.preventDefault(); if (filtersPanelEl) filtersPanelEl.classList.remove('is-open'); }

        const pageButton = target.closest('[data-page]');
        if (pageButton) {
            e.preventDefault();
            const pageClicked = parseInt(pageButton.dataset.page, 10);
            if (pageClicked && pageClicked !== currentPage && !isLoading) { currentPage = pageClicked; fetchAndDisplayMainList(); }
        }
        if (target.closest(paginationPrevButtonSelector)) { e.preventDefault(); if (currentPage > 1 && !isLoading) { currentPage--; fetchAndDisplayMainList(); } }
        if (target.closest(paginationNextButtonSelector)) { e.preventDefault(); if (currentPage < totalPages && !isLoading) { currentPage++; fetchAndDisplayMainList(); } }
    });

    // Aparte listeners voor 'input' en 'change'
    if (searchInputEl) searchInputEl.addEventListener('input', () => setTimeout(() => handleFilterChange(), SEARCH_DEBOUNCE_DELAY));
    const mainFilterForm = document.querySelector('#filter-form');
    if (mainFilterForm) {
        mainFilterForm.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') handleFilterChange();
        });
    }

 // STAP 2: AUTHENTICATIE & DATA LADEN
    try {
        if(document.querySelector('[fs-cmsload-element="loader"]')) {
            document.querySelector('[fs-cmsload-element="loader"]').style.display = 'block';
        }
        await getAuthToken(); // Wacht tot het token er is
        await fetchAllSliderDataOnce(); // Wacht tot slider data er is
        await fetchAndDisplayMainList(); // Wacht tot de hoofdlijst is geladen
    } catch (error) {
        console.error("Fout tijdens initialisatie:", error);
    } finally {
        if(document.querySelector('[fs-cmsload-element="loader"]')) {
            document.querySelector('[fs-cmsload-element="loader"]').style.display = 'none';
        }
    }

    // --- STAP 4: DATA LADEN ---
    log("Initiële data laden...");
    try {
        if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'block';
        
        // De fetch-functies handelen nu zelf de authenticatie af.
        await fetchAllSliderDataOnce();
        
        const fetchWasTriggeredByUrl = applyFiltersFromURL();
        if (!fetchWasTriggeredByUrl) {
            await fetchAndDisplayMainList();
        }
    } catch (error) {
        console.error("Fout tijdens de initiële data-load:", error);
    } finally {
        if (finsweetLoaderEl) finsweetLoaderEl.style.display = 'none';
    }
}
	
  setTimeout(initializeSite, 700); 
});
