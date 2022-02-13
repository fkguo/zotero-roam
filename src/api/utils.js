
import { zoteroClient, semanticClient, citoidClient } from "./clients";
import { emitCustomEvent } from "../events";
import { makeDictionary, parseDOI, searchEngine } from "../utils";

/** Categorizes Zotero tags into tokens, based on similar spellings
 * @param {String[]} z_data - The tags to be categorized, as Strings
 * @param {Map<String,Object>} tagMap - The map of Zotero tags
 * @returns {{token: String, roam: [], zotero: Object[]}[]} The Array of tokenized tags, sorted alphabetically
 */
function categorizeZoteroTags(z_data, tagMap){
	let output = [];
	let zdata = Array.from(z_data).sort((a,b) => a > b ? -1 : 1);
	
	for(let elem of zdata){
		let in_table = output.findIndex(tk => searchEngine(elem, tk.token, { any_case: true, match: "exact", search_compounds: true}));
		let z_item = tagMap.get(elem);
		if(in_table == -1){
			output.push({
				token: elem.toLowerCase(), 
				roam: [],
				zotero: z_item.constructor === Array ? z_item : [z_item]
			});
		} else {
			if(z_item.constructor === Array){
				output[in_table].zotero.push(...z_item);
			} else {
				output[in_table].zotero.push(z_item);
			}
		}
	}
  
	return output.sort((a,b) => a.token < b.token ? -1 : 1);
}

/** Extracts pinned citekeys from a dataset
 * @param {ZoteroItem[]} arr - The dataset of Zotero items to scan
 * @returns {Object[]} The processed dataset : each item gains a `has_citekey` property, and its `key` property is assigned its citekey 
 */
function extractCitekeys(arr){
	return arr.map(item => {
		item.has_citekey = false;
		if(typeof(item.data.extra) !== "undefined"){
			if(item.data.extra.includes("Citation Key: ")){
				item.key = item.data.extra.match("Citation Key: (.+)")[1];
				item.has_citekey = true;
			}
		}
		return item;
	});
}

/** Retrieves additional data from the Zotero API, when the original results are greater than the limit of n = 100.
 *  A minimum of parameters are required so that the function can be used for all data types.
 * @param {{dataURI: String, apikey: String, since?: Integer, params?: String}} req - The parameters of the request 
 * @param {Integer} totalResults - The total number of results indicated by the original response 
 * @returns {Promise<Object[]>} The additional results to the original request
 */
async function fetchAdditionalData(req, totalResults) {
	let { dataURI, apikey, params = "", since = null } = req;
	let nbExtraCalls = Math.ceil((totalResults / 100) - 1);
	let apiCalls = [];

	for(let i=1; i <= nbExtraCalls; i++){
		let reqParams = new URLSearchParams(params);
		if(since){
			reqParams.set("since", since);
		}
		reqParams.set("start", 100*i);
		reqParams.set("limit", 100);
		apiCalls.push(zoteroClient.get(`${dataURI}?${reqParams.toString()}`, { headers: { "Zotero-API-Key": apikey } }));
	}

	try {
		let [...responses] = await Promise.all(apiCalls);
		return responses.map(res => res.data).flat(1);
	} catch(error){
		return Promise.reject(error);
	}
}

/** Retrieves an item's formatted bibliographic entry as returned by the Zotero API
 * @param {String} itemKey - The item's Zotero key
 * @param {ZoteroLibrary} library - The item's Zotero library
 * @param {{include: String, linkwrap: Boolean, locale: String, style: String}} config - Optional parameters to use in the API call
 * @returns
 */
async function fetchBibliography(itemKey, library, config = {}) {
	const { apikey, path } = library;
	// See https://www.zotero.org/support/dev/web_api/v3/basics#parameters_for_format_bib_includecontent_bib_includecontent_citation
	const { include = "bib", linkwrap = 0, locale = "en-US", style = "chicago-note-bibliography" } = config;
	
	try {
		let response = await zoteroClient.get(`${path}/items/${itemKey}`, {
			headers: {
				"Zotero-API-Key": apikey
			},
			params: {
				include,
				linkwrap,
				locale,
				style
			}
		});
		// For debugging
		console.log(response);
		const { data, ...rest } = response;
		console.log(data);
		console.log(rest);

		return response;
	} catch(error){
		return Promise.reject(error);
	}
}

/** Requests data from the `/data/citation/zotero` endpoint of the Wikipedia API
 * @param {String} query - The URL for which to request Zotero metadata
 * @returns {Promise<{item: Object, query: String}>} The metadata for the URL
 */
async function fetchCitoid(query) {
	try {
		let { data } = await citoidClient.get(encodeURIComponent(query));
		return {
			item: data[0],
			query
		};
	} catch(error){
		return Promise.reject(error);
	}
}

/** Requests data from the `/[library]/collections` endpoint of the Zotero API
 * @fires zotero-roam:update-collections
 * @param {ZoteroLibrary} library - The targeted Zotero library
 * @param {Integer} since - A library version
 * @param {{match: Object[]}} config - Additional parameters
 * @returns {Promise<{data: ZoteroCollection[], lastUpdated: Integer}>} Collections created or modified in Zotero since the specified version
 */
async function fetchCollections(library, since = 0, { match = [] } = {}) {
	const { apikey, path } = library;

	try {
		let { data: modified, headers } = await zoteroClient.get(`${path}/collections?since=${since}`, { headers: { "Zotero-API-Key": apikey } });
		let { "last-modified-version": lastUpdated, "total-results": totalResults } = headers;
		totalResults = Number(totalResults);
		if(totalResults > 100){
			let additional = await fetchAdditionalData({ dataURI: `${path}/collections`, apikey, since}, totalResults);
			modified.push(...additional);
		}

		let deleted = [];
		// DO NOT request deleted items since X if since = 0 (aka, initial data request)
		// It's a waste of a call
		if(since > 0 && modified.length > 0){
			deleted = await fetchDeleted(...library, since);

			emitCustomEvent("update-collections", {
				success: true,
				library,
				data: modified
			});
		}

		return {
			data: matchWithCurrentData({ modified, deleted: deleted.collections }, match),
			lastUpdated: Number(lastUpdated)
		};
	} catch(error){
		emitCustomEvent("update-collections", {
			success: false,
			library,
			error
		});
		return Promise.reject(error);
	}
}

/** Requests data from the `/[library]/deleted` endpoint of the Zotero API
 * @param {ZoteroLibrary} library - The targeted Zotero library
 * @param {Integer} since - A library version
 * @returns {Promise<Object>} Elements deleted from Zotero since the specified version
 */
async function fetchDeleted(library, since) {
	const { apikey, path } = library;

	try {
		let { data } = await zoteroClient.get(`${path}/deleted?since=${since}`, { headers: { "Zotero-API-Key": apikey } });
		return data;
	} catch(error){
		return Promise.reject(error);
	}
}

/** Requests data from the Zotero API, based on a specific data URI
 * @fires zotero-roam:update
 * @param {{apikey: String, dataURI: String, params: String, name: String, library: String}} req - The parameters of the request 
 * @param {{match: Object[]}} config - Additional parameters
 * @returns {Promise<{data: Object[], lastUpdated: Integer}>}
 */
async function fetchItems(req, { match = [] } = {}, queryClient) {
	let { apikey, dataURI, params, library, since = 0 } = req;
	let paramsQuery = new URLSearchParams(params);
	paramsQuery.set("since", since);
	paramsQuery.set("start", 0);
	paramsQuery.set("limit", 100);

	try {
		let { data: modified, headers } = await zoteroClient.get(`${dataURI}?${paramsQuery.toString()}`, 
			{ 
				headers: { "Zotero-API-Key": apikey } 
			});
		let { "last-modified-version": lastUpdated, "total-results": totalResults } = headers;
		totalResults = Number(totalResults);
		if(totalResults > 100){
			let additional = await fetchAdditionalData({ dataURI, apikey, params, since }, totalResults);
			modified.push(...additional);
		}

		let deleted = [];
		// DO NOT request deleted items since X if since = 0 (aka, initial data request)
		// It's a waste of a call
		if(since > 0){
			// Retrieve deleted items, if any
			deleted = await fetchDeleted({ apikey, path: library }, since);

			if(modified.length > 0){
				// Refetch tags data
				let tagsQueryKey = ["tags", { apikey, library }];
				let { lastUpdated: latest_tags_version } = queryClient.getQueryData(tagsQueryKey) || {}; // TODO: Check if getQueryData needs exact matching - if not, remove the apikey portion of line above
				if(Number(latest_tags_version) < Number(lastUpdated)){
					queryClient.refetchQueries(tagsQueryKey);
				}

				emitCustomEvent("update", {
					success: true,
					request: req,
					data: modified
				});
			}
		}

		return {
			data: matchWithCurrentData({ modified, deleted: deleted.items }, match, { with_citekey: true }),
			lastUpdated: Number(lastUpdated)
		};
	} catch(error){
		emitCustomEvent("update", {
			success: false,
			request: req,
			error
		});
		return Promise.reject(error);
	}
}

/** Requests data from the `/keys` endpoint of the Zotero API
 * @param {String} apikey - The targeted API key
 * @returns {Promise<ZoteroKey>} The API key's permissions
 */
async function fetchPermissions(apikey) {
	try {
		let { data } = await zoteroClient.get(`keys/${apikey}`, { headers: { "Zotero-API-Key": apikey } });
		return data;
	} catch(error){
		return Promise.reject(error);
	}
}

/** Requests data from the `/paper` endpoint of the Semantic Scholar API
 * @param {String} doi - The DOI of the targeted item, assumed to have already been checked and parsed.
 * @returns {Promise<{doi: String, citations: Object[], references: Object[]}>} Citation data for the item
**/
async function fetchSemantic(doi) {
	try {
		let { data: { citations, references } } = await semanticClient.get(`${doi}`);
		return { 
			doi, 
			citations: parseSemanticDOIs(citations), 
			references: parseSemanticDOIs(references) 
		};
	} catch(error){
		return Promise.reject(error);
	}
}

/** Requests data from the `/[library]/tags` endpoint of the Zotero API
 * @param {ZoteroLibrary} library - The targeted Zotero library
 * @returns {Promise<{data: Object[], lastUpdated: Integer}>} The library's tags
 */
async function fetchTags(library) {
	const { apikey, path } = library;

	try {
		let { data, headers } = await zoteroClient.get(`${path}/tags?limit=100`, { headers: { "Zotero-API-Key": apikey } });
		let { "last-modified-version": lastUpdated, "total-results": totalResults } = headers;
		totalResults = Number(totalResults);
		if(totalResults > 100){
			let additional = await fetchAdditionalData({ dataURI: `${path}/tags`, apikey}, totalResults);
			data.push(...additional);
		}
		return { 
			data: makeTagList(data), 
			lastUpdated: Number(lastUpdated)
		};
	} catch(error){
		return Promise.reject(error);
	}
}

function makeTagList(tags){
	let tagMap = makeTagMap(tags);
	let zdict = makeDictionary(Array.from(tagMap.keys()));
	let zkeys = Object.keys(zdict).sort((a,b) => a < b ? -1 : 1);

	let output = {};
	zkeys.forEach(key => {
		output[key] = categorizeZoteroTags(zdict[key], tagMap);
	});
	return output;
}

/** Converts Zotero tags data into a Map
 * @param {ZoteroTag[]} tags - The tags data from Zotero from which to create the Map
 * @returns {Map} A Map where each entry groups together Zotero tags with the exact same spelling, but a different type
 */
function makeTagMap(tags){
	return tags.reduce(
		function(map,t){
			let { tag, meta : { type } } = t;
			if(map.has(tag)){
				let entry = map.get(tag);
				if(entry.constructor === Array){
					if(entry.every(el => el.tag != tag || el.meta.type != type)){
						map.set(tag, [...entry, t]);
					}
				} else {
					map.set(tag, [entry, t]);
				}
			} else{
				map.set(tag,t);
			} 
			return map;
		}, 
		new Map());
}

/** Compares two datasets and merges the changes. As the match is done on the `data.key` property, both items and collections can be matched.
 *  For items, merging involves an additional step to extract citekeys.
 * @param {{modified: ZoteroItem[]|ZoteroCollection[], deleted: ZoteroItem[]|ZoteroCollection[]}} update - The newer dataset
 * @param {Object[]} arr - The older dataset
 * @param {{with_citekey?: Boolean}} config - Additional parameters 
 * @returns {Object[]} - The merged dataset
 */
function matchWithCurrentData(update, arr, { with_citekey = false } = {}) {
	let oldData = arr || [];
	let { modified = [], deleted = [] } = update;

	// Remove deleted items
	if(deleted.length > 0){
		oldData = oldData.filter(item => !deleted.includes(item.data.key));
	}
	// If the data has citekeys, transform before pushing
	if(with_citekey){
		modified = extractCitekeys(modified);
	}

	// Update datastore
	if(modified.length == 0){
		return oldData;
	} else if(oldData.length == 0){
		return modified;
	} else {
		let [...datastore] = arr;
		modified.forEach(item => {
			let duplicateIndex = datastore.findIndex(i => i.data.key == item.data.key);
			if(duplicateIndex == -1){
				datastore.push(item);
			} else {
				datastore[duplicateIndex] = item;
			}
		});
		return datastore;
	}
}

/** Selects and transforms Semantic items with valid DOIs
 * @param {Object[]} arr - The array of Semantic items to clean
 * @returns The clean Semantic array
 */
function parseSemanticDOIs(arr){
	return arr.map(elem => {
		let { doi, ...rest } = elem;
		return {
			doi: parseDOI(doi),
			...rest
		};
	}).filter(elem => elem.doi);
}

/** Adds new items to a Zotero library, with optional collections & tags.
 * @param {Object[]} citoids -  The items to be added to Zotero.
 * @param {{library: {apikey: String, path: String}, collections: String[], tags: String[]}} config - The options to be used for the import. 
 * @returns 
 */
async function writeItems(items, {library, collections = [], tags = []} = {}){
	const { apikey, path } = library;
	const clean_tags = tags.map(t => { return { tag: t }; });

	const data = items.map(citoid => {
		// Remove key and version from the data object
		const { key, version, ...item } = citoid;

		return {
			...item,
			collections,
			tags: clean_tags
		};
	});
	// TODO: Handle case where more than 50 items are selected for import
	// https://www.zotero.org/support/dev/web_api/v3/write_requests#creating_multiple_objects
	return zoteroClient.post(`${path}/items`, JSON.stringify(data), { headers: { "Zotero-API-Key": apikey } });
}

export {
	fetchBibliography,
	fetchCitoid,
	fetchCollections,
	fetchItems,
	fetchPermissions,
	fetchSemantic,
	fetchTags,
	writeItems
};
