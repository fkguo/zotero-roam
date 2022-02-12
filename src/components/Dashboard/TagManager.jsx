import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { arrayOf, func, number, shape, string } from "prop-types";
import { Button, ButtonGroup, Callout, Classes, FormGroup, HTMLSelect, InputGroup, NonIdealState, Spinner, Switch, Tag } from "@blueprintjs/core";

import { ListItem, ListWrapper, Pagination, Toolbar } from "../DataList";
import SortButtons from "../SortButtons";
import { ExtensionContext } from "../App";

import { useQuery_Tags, useWriteableLibraries } from "../../api/queries";
import { getTagStats, getTagUsage, matchTagData, pluralize, sortTags } from "../../utils";
import * as customPropTypes from "../../propTypes";

const itemsPerPage = 30;

// TODO: Convert to globally accessible constant
const NoWriteableLibraries = <Callout>No writeable libraries were found. Please check that your API key(s) have the permission to write to at least one of the Zotero libraries you use. <a href="https://app.gitbook.com/@alix-lahuec/s/zotero-roam/getting-started/prereqs#zotero-api-credentials" target="_blank" rel="noreferrer">Refer to the extension docs</a> for more details.</Callout>;

const isSingleton = (entry) => entry.zotero.length == 1 && (entry.roam.length == 0 || (entry.roam.length == 1 && entry.zotero[0].tag == entry.roam[0].title));

function RoamTag({ text, uid = null }){
	return (
		<Tag 
			active={true} 
			className="zr-tag--roam" 
			minimal={true} 
			multiline={true}
			data-tag-source="roam" data-tag={text} data-uid={uid} >
			{text}
		</Tag>
	);
}
RoamTag.propTypes = {
	text: string,
	uid: string
};

function ZoteroTag({ tagElement }){
	const { tag, meta: { numItems, type = 0 } } = tagElement;
	const [isSelected, setIsSelected] = useState(true);

	const handleSelect = useCallback(() => setIsSelected(prev => !prev), []);

	return (
		<Tag 
			active={isSelected} 
			className="zr-tag--zotero"
			interactive={true} 
			minimal={true} 
			multiline={true} 
			onClick={handleSelect}
			data-tag-source="zotero" data-tag={tag} data-tag-type={type} >
			{tag + "(" + numItems + ")"}
		</Tag>
	);
}
ZoteroTag.propTypes = {
	tagElement: customPropTypes.zoteroTagType
};

const Item = React.memo(function Item({ entry }){
	const is_singleton = isSingleton(entry);
	const usage = getTagUsage(entry);

	return (
		<ListItem data-token={entry.token} in-graph={(entry.roam.length > 0).toString()}>
			<div>
				<span className="zr-auxiliary" zr-role="title">{entry.token}</span>
				<span className={["zr-secondary", "zr-text-small"].join(" ")}>{pluralize(usage, "item")}</span>
				{is_singleton
					? null
					: <div className="zr-text-small">
						{entry.roam.map(elem => <RoamTag key={elem.title} text={elem.title} uid={elem.uid} /> )}
						{entry.zotero.map((elem) => <ZoteroTag key={[elem.tag, elem.meta.type].join("_")} tagElement={elem} /> )}
					</div>}
			</div>
			<span zr-role="item-actions" >
				{is_singleton
					? <ButtonGroup>
						<Button intent="primary" text="Edit" />
						<Button icon="trash" intent="danger" text="Delete" />
					</ButtonGroup>
					: <>
						<InputGroup 
							defaultValue={entry.roam[0]?.title || null}
							rightElement={<Button className="zr-text-small" intent="primary" minimal={true} text="Merge tags" />}
							small={true} />
						<ButtonGroup minimal={true} >
							<Button className="zr-text-small" icon="trash" intent="danger" text="Delete" />
						</ButtonGroup>
					</>}
			</span>
		</ListItem>
	);
});
Item.propTypes = {
	entry: customPropTypes.taglistEntry
};

const LibrarySelect = React.memo(function LibrarySelect({ libProps }){
	const { currentPath, onSelect, options } = libProps;
	const handleSelect = useCallback((event) => {
		let value = event.currentTarget?.value;
		if(value){ onSelect(value); }
	}, [onSelect]);

	return (
		<FormGroup
			className="zr-text-small"
			inline={true}
			label="Library :"
			labelFor="zr-select--library">
			<HTMLSelect id="zr-select--library" minimal={true} onChange={handleSelect} options={options} value={currentPath} />
		</FormGroup>
	);
});
LibrarySelect.propTypes = {
	libProps: shape({
		currentPath: string,
		onSelect: func,
		options: arrayOf(string)
	})
};

const Stats = React.memo(function Stats({ stats }){
	if(!stats){
		return null;
	} else {
		const { nTags, nRoam, nAuto, nTotal} = stats;
		return (
			<div className={["zr-auxiliary", "zr-text-small"].join(" ")} zr-role="list-stats" >
				<span>
					Zotero has {nTags} tags ({nAuto} / {Math.round(nAuto / nTags*100)}% automatic), matched in {nTotal} groups
				</span>
				<span>
					{nRoam} are in Roam ({Math.round(nRoam / nTotal *100)}%)
				</span>
			</div>
		);
	}
});
Stats.propTypes = {
	stats: shape({
		nAuto: number,
		nRoam: number,
		nTags: number,
		nTotal: number
	})
};

const TagsDatalist = React.memo(function ItemRenderer(props){
	const { items, libProps } = props;
	const [currentPage, setCurrentPage] = useState(1);
	const [filter, setFilter] = useState("select");
	const [sortBy, setSortBy] = useState("usage");
	const [matchedTags, setMatchedTags] = useState(null);
	const [stats, setStats] = useState(null);

	const pageLimits = useMemo(() => [itemsPerPage*(currentPage - 1), itemsPerPage*currentPage], [currentPage]);

	useEffect(() => {
		if(items) {
			matchTagData(items)
				.then(data => {
					setMatchedTags(data);
					setStats(() => getTagStats(data));
				});
			setCurrentPage(1);
		}
	}, [items]);

	const handleFilter = useCallback((_event) => {
		setFilter((prevFilter) => prevFilter == "select" ? "all" : "select");
	}, []);

	const filteredItems = useMemo(() => {
		if(!matchedTags){
			return [];
		} else {
			if(filter == "select"){
				return matchedTags.filter(el => !isSingleton(el));
			} else if(filter == "all"){
				return matchedTags;
			}
		}
	}, [filter, matchedTags]);

	const handleSort = useCallback((value) => {
		setSortBy(() => value);
		setCurrentPage(1);
	}, []);
    
	const sortOptions = useMemo(() => [
		{ icon: "sort-desc", label: "Most Used", value: "usage" },
		{ icon: "sort-alphabetical", label: "Name", value: "alphabetical"},
		{ icon: "star", label: "In Roam", value: "roam" }
	], []);

	const sortedItems = useMemo(() => sortTags(filteredItems, sortBy), [filteredItems, sortBy]);

	return (
		matchedTags == null
			? <Spinner size={15} />
			: <>
				<Toolbar>
					<SortButtons name="zr-tagmanager-sort" onSelect={handleSort} options={sortOptions} selectedOption={sortBy} />
					<LibrarySelect libProps={libProps} />
				</Toolbar>
				<ListWrapper>
					{sortedItems.length > 0
						? sortedItems
							.slice(...pageLimits)
							.map(el => 
								<Item key={el.token} entry={el} />)
						: <NonIdealState className="zr-auxiliary" description="No items in the current view" />}
				</ListWrapper>
				<Toolbar>
					<Switch checked={filter == "all"} className="zr-text-small" label="Show all tags" onChange={handleFilter} />
					<Pagination 
						currentPage={currentPage} 
						itemsPerPage={itemsPerPage} 
						nbItems={filteredItems.length} 
						setCurrentPage={setCurrentPage} />
				</Toolbar>
				{filter == "all" && <Stats stats={stats} />}
			</>
	);
});
TagsDatalist.propTypes = {
	items: arrayOf(customPropTypes.taglistEntry),
	libProps: shape({
		currentPath: string,
		onSelect: func,
		options: arrayOf(string)
	})
};

const TabContents = React.memo(function TabContents(props){
	const { libraries } = props;
	const [selectedLibrary, setSelectedLibrary] = useState(libraries[0]);

	const { isLoading, data } = useQuery_Tags([selectedLibrary], { 
		notifyOnChangeProps: ["data"], 
		select: (datastore) => datastore.data
	})[0];
	
	const libOptions = useMemo(() => libraries.map(lib => lib.path), [libraries]);
	const handleLibrarySelect = useCallback((path) => setSelectedLibrary(libraries.find(lib => lib.path == path)), [libraries]);
	const libProps = useMemo(() => {
		return {
			currentPath: selectedLibrary.path,
			onSelect: handleLibrarySelect,
			options: libOptions
		};
	}, [handleLibrarySelect, libOptions, selectedLibrary.path]);

	return (
		<>
			<div className={["zr-tagmanager--header", "zr-auxiliary"].join(" ")}>
                Rename, merge, and delete tags between <RoamTag text="Roam" /> and <Tag active={true} className={["zr-tag--zotero", Classes.ACTIVE, Classes.MINIMAL].join(" ")}>Zotero</Tag>
			</div>
			<div className="zr-tagmanager--datalist">
				{isLoading
					? <Spinner />
					: <TagsDatalist items={data} libProps={libProps} /> }
			</div>
		</>
	);
});
TabContents.propTypes = {
	libraries: arrayOf(customPropTypes.zoteroLibraryType)
};

const TagManager = React.memo(function TagManager(){
	const { libraries } = useContext(ExtensionContext);
	const { data: writeableLibraries, isLoading } = useWriteableLibraries(libraries);

	return (
		isLoading
			? <Spinner />
			: writeableLibraries.length == 0
				? <NoWriteableLibraries />
				: <TabContents libraries={writeableLibraries} />
	);
});
TagManager.propTypes = {
	
};

export default TagManager;
