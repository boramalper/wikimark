import Mustache from "./mustache.js";

/* =============================================================================
 * Type Definitions
 * =============================================================================
 */
/**
 * @enum {number}
 */
const Rank = Object.freeze({
  PREFERRED: 1,
  NORMAL: 2,
  DEPRECATED: 100,
});

/* =============================================================================
 * Global Constants
 * =============================================================================
 */
// Sample values:
//   - "localhost:8080"
//   - "wikimark.net"
const BASE_HOST = "localhost:8080";
const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/* =============================================================================
 * Entrypoint
 * =============================================================================
 */
addEventListener("load", async (event) => {
  const query = removeSuffix(window.location.host, `.${BASE_HOST}`);
  const requestURL = new URL(WIKIDATA_SPARQL_ENDPOINT);
  let delay = 1000;

  // Determine whether to do a point-lookup by item ID or a broad search by a
  // given term.
  if (query.match(/q[0-9]+/i)) {
    requestURL.search = new URLSearchParams({
      query: prepareSparqlLookupQuery(query),
    });
    // Redirect immediately (without any delay) for point-lookups.
    delay = 0;
  } else {
    requestURL.search = new URLSearchParams({
      query: prepareSparqlSearchQuery(query),
    });
  }

  updateStatus("Searching...");
  const response = await fetch(requestURL, {
    headers: {
      Accept: "application/sparql-results+json",
    },
    referrerPolicy: "origin"
  });
  if (!response.ok) {
    updateStatus("Search failed!");
    console.error("Search error", response);
    return;
  }

  const responseJSON = await response.json();
  const results = transformSparqlResponse(responseJSON);

  updateProgress(100);
  if (isEmpty(results)) {
    updateStatus("Not found.");
    return;
  }

  updateStatus("Found.");
  displayResults(results);

  // Do not automatically redirect the user to the destination if they
  // have clicked the back button of their browser.
  if (!didNavigateBack()) {
    updateStatus("Redirecting...");
    setTimeout(() => {
      const [uri, item] = Object.entries(results)[0];
      window.location.assign(item.websites[0].url);
    }, delay);
  }
});

/* =============================================================================
 * UI Helpers
 * =============================================================================
 */
/**
 * @param {number} progress
 */
function updateProgress(progress) {
  const progressElem = document.querySelector("progress");
  if (progress == null) {
    progressElem.removeAttribute("value");
  } else {
    progressElem.setAttribute("value", progress);
  }
}

/**
 * @param {string} status
 */
function updateStatus(status) {
  const statusElem = document.querySelector("#status");
  if (status == null) {
    statusElem.textContent = "";
  } else {
    statusElem.textContent = status;
  }
}

function displayResults(results) {
  const template = document.getElementById("resultTemplate").innerHTML;

  const [topURI, topItem] = Object.entries(results)[0];
  const otherResults = Object.entries(results).slice(1);

  const topResultElem = document.getElementById("topResult");
  topResultElem.innerHTML = Mustache.render(template, {
    uri: topURI,
    name: topItem.label,
    description: topItem.description,
    permalink: generatePermalink(topURI),
    urls: topItem.websites.map((x) => x.url),
  });

  const otherResultsElem = document.getElementById("otherResults");
  for (const [uri, item] of otherResults) {
    const resultHTML = Mustache.render(template, {
      uri: uri,
      name: item.label,
      description: item.description,
      permalink: generatePermalink(uri),
      urls: item.websites.map((x) => x.url),
    });
    otherResultsElem.innerHTML += resultHTML;
  }

  const detailsElem = document.querySelector("details");
  const detailsSummaryElem = document.querySelector("details summary");
  switch (otherResults.length) {
    case 0:
      break;
    case 1:
      detailsElem.style.display = "block";
      detailsSummaryElem.textContent = `1 more result`;
      break;
    default:
      detailsElem.style.display = "block";
      detailsSummaryElem.textContent = `${otherResults.length} more results`;
      break;
  }

  const resultsElem = document.querySelector("#results");
  resultsElem.style.display = "block";
}

/* =============================================================================
 * Helpers
 * =============================================================================
 */
/**
 * @param {URL} url
 * @returns {boolean}
 */
function isOnion(url) {
  return url.hostname.endsWith(".onion");
}

/**
 *
 * @param {string} uri
 * @returns {string}
 */
function generatePermalink(uri) {
  const qid = /^.*\/entity\/(Q[0-9]+)$/.exec(uri)[1].toLowerCase();
  return `//${qid}.${BASE_HOST}`;
}

/* =============================================================================
 * Wikidata Helpers
 * =============================================================================
 */
/**
 * @param {string} rank
 * @returns {Rank}
 */
function parseRank(rank) {
  const RANK_MAP = {
    "http://wikiba.se/ontology#PreferredRank": Rank.PREFERRED,
    "http://wikiba.se/ontology#NormalRank": Rank.NORMAL,
    "http://wikiba.se/ontology#DeprecatedRank": Rank.DEPRECATED,
  };
  return RANK_MAP[rank];
}

/* =============================================================================
 * SPARQL Helpers
 * =============================================================================
 */
/**
 * @param {string} term
 * @returns {string}
 */
function prepareSparqlSearchQuery(term) {
  return `
    SELECT DISTINCT ?item ?itemLabel ?itemDescription ?website ?endDate ?rank
    WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:api "Search" .
        bd:serviceParam wikibase:endpoint "www.wikidata.org" .
        bd:serviceParam mwapi:srsearch "${term}" .
        ?item wikibase:apiOutputItem mwapi:title .
        ?num wikibase:apiOrdinal true .
      }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en" .
        ?item rdfs:label ?itemLabel .
        ?item schema:description ?itemDescription .
      }
      
      ?item p:P856 ?statement .
      ?statement ps:P856 ?website .
      ?statement wikibase:rank ?rank .
      FILTER NOT EXISTS {
        ?statement pq:P582 ?endDate .
      }
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER(BOUND(?itemLabel))
      FILTER(BOUND(?itemDescription))
    }
    ORDER BY ASC(?num) DESC(?rank)
    LIMIT 20
  `;
}

/**
 * @param {string} id
 * @returns {string}
 */
function prepareSparqlLookupQuery(id) {
  return `
    SELECT DISTINCT ?item ?itemLabel ?itemDescription ?website ?endDate ?rank
    WHERE {
      BIND(wd:${id.toUpperCase()} AS ?item)
    
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en" .
        ?item rdfs:label ?itemLabel .
        ?item schema:description ?itemDescription .
      }
    
      ?item p:P856 ?statement .
      ?statement ps:P856 ?website .
      ?statement wikibase:rank ?rank .
      FILTER NOT EXISTS {
        ?statement pq:P582 ?endDate .
      }
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER(BOUND(?itemLabel))
      FILTER(BOUND(?itemDescription))
    }
    ORDER BY DESC(?rank)
    LIMIT 20
  `;
}

/**
 * @param {object} response
 * @returns {[object]}
 */
function transformSparqlResponse(response) {
  const entities = {};
  for (const binding of response.results.bindings) {
    const itemUri = binding.item.value;
    const websiteUrl = new URL(binding.website.value);

    // Browsers cannot open .onion links still, so we ignore them.
    if (isOnion(websiteUrl)) {
      continue;
    }

    if (!(itemUri in entities)) {
      entities[itemUri] = {
        label: binding.itemLabel.value,
        description: binding.itemDescription.value,
        websites: [],
      };
    }

    entities[itemUri].websites.push({
      url: websiteUrl,
      rank: parseRank(binding.rank.value),
    });
  }

  return entities;
}

/* =============================================================================
 * Generic Utilities
 * =============================================================================
 */

/**
 * @param {string} str
 * @param {string} suffix
 * @returns {string}
 */
function removeSuffix(str, suffix) {
  return str.substring(0, str.lastIndexOf(suffix)) || str;
}

/**
 * @param {object} obj
 * @returns {boolean}
 */
function isEmpty(obj) {
  for (const _ in obj) {
    return false;
  }
  return true;
}

/**
 * @returns {boolean}
 */
function didNavigateBack() {
  const entries = performance.getEntriesByType("navigation");
  return (
    entries.length > 0 && entries[entries.length - 1].type === "back_forward"
  );
}
