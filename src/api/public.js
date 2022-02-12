import { fetchBibliography } from "./utils";

/** Returns an item's formatted bibliography as returned by the Zotero API
 * @param {ZoteroItem} item - The targeted Zotero item
 * @param {ZoteroLibrary} library - The library where the Zotero item is located
 * @param {{include: String, linkwrap: Boolean, locale: String, style: String}} config - Optional parameters to use in the API call
 * @returns 
 */
async function _getBibliography(item, library, config){
	let itemKey = item.data.key;

	return await fetchBibliography(itemKey, library, config);
}

function _getCollections(library, queryClient){
	const { apikey, path } = library;
	return queryClient.getQueryData(["collections", { apikey, library: path }]);
}

/** Returns all children of a given item available in the query cache
 * @param {ZoteroItem} item - The targeted Zotero item
 * @param {*} queryClient - The React Query client to use
 * @returns The item's children
 */
function _getChildren(item, queryClient) {
	let location = item.library.type + "s/" + item.library.id;
	return _getItems("children", { predicate: (queryKey) => queryKey[1].dataURI.startsWith(location) }, queryClient)
		.filter(el => el.data.parentItem == item.data.key);
}

/** Returns the current items in the query cache, with optional configuration
 * @param {("all"|"attachments"|"children"|"items"|"notes"|"pdfs")} select - The type of items to retrieve
 * @param {Object} filters - Optional filters for the item queries
 * @param {*} queryClient - The React Query client to use
 * @returns {ZoteroItem[]} - The requested items
 */
function _getItems(select = "all", filters = {}, queryClient) {
	let items = queryClient.getQueriesData(["items"], filters).map(query => (query[1] || {}).data || []).flat(1);
	switch(select){
	case "items":
		return items.filter(it => !["attachment", "note", "annotation"].includes(it.data.itemType));
	case "attachments":
		return items.filter(it => it.data.itemType == "attachment");
	case "children":
		return items.filter(it => it.data.itemType == "note" || it.data.itemType == "attachment" && it.data.contentType == "application/pdf");
	case "notes":
		return items.filter(it => it.data.itemType == "note");
	case "pdfs":
		return items.filter(it => it.data.itemType == "attachment" && it.data.contentType == "application/pdf");
	case "all":
	default:
		return items;
	}
}

/** Returns the current tags map in the query cache, for a given library
 * @param {ZoteroLibrary} library - The targeted Zotero library
 * @param {*} queryClient - The React Query client to access
 * @returns 
 */
function _getTags(library, queryClient) {
	const { apikey, path } = library;
	let datastore = queryClient.getQueryData(["tags", { apikey, library: path }]);
	return datastore.data;
}

export {
	_getBibliography,
	_getCollections,
	_getChildren,
	_getItems,
	_getTags
};