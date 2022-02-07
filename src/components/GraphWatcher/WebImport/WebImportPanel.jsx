import React, { useCallback, useContext, useState } from "react";
import { arrayOf, bool, func, object, string } from "prop-types";
import { Checkbox, Classes } from "@blueprintjs/core";

import AuxiliaryDialog from "../../AuxiliaryDialog";
import ZoteroImport from "../../ZoteroImport";

import { UserSettings } from "../../App";
import { useQuery_Citoid } from "../../../api/queries";
import { pluralize } from "../../../utils";

function useGetCitoids(urls, opts = {}) {
	return useQuery_Citoid(urls, {
		...opts,
		select: (data) => {
			const { item, query } = data;
			
			return {
				abstract: item.abstractNote || "",
				creators: item.creators.map(cre => cre.name || [cre.firstName, cre.lastName].filter(Boolean).join(" ")).join(", "),
				itemType: item.itemType, 
				publication: item.publicationTitle || item.bookTitle || item.websiteTitle || "",
				title: item.title,
				url: query
			};
		},
		notifyOnChangeProps: ["data", "errorUpdatedAt"]
	});
}

const WebImportItem = React.memo(function WebImportItem(props){
	const { isSelected, item, onSelect } = props;
	const { typemap } = useContext(UserSettings);

	const handleCheckUncheck = useCallback(() => {
		onSelect(item.url);
	}, [item.url, onSelect]);
    
	return (
		<li className="zr-webimport-item" data-item-type={item.itemType}>
			<div className={ Classes.MENU_ITEM } label={item.url}>
				<Checkbox
					checked={isSelected}
					className="zr-webimport-item--title"
					defaultChecked={false}
					inline={false}
					labelElement={<a target="_blank" rel="noreferrer" href={item.url}>{item.title}</a>}
					onChange={handleCheckUncheck}
				/>
				<div className={[ Classes.FILL, "zr-webimport-item--contents" ].join(" ")}>
					<span className="zr-auxiliary">
						{[typemap[item.itemType] || item.itemType, item.creators].join(" | ")}
					</span>
					{item.publication 
						? <span className={["zr-webimport-item--publication", "zr-text-small", "zr-secondary"].join(" ")}>{item.publication}</span> 
						: null}
					<span className={["zr-webimport-item--abstract", "zr-text-small", "zr-auxiliary"].join(" ")}>
						{item.abstract}
					</span>
				</div>
			</div>
		</li>
	);
});
WebImportItem.propTypes = {
	isSelected: bool,
	item: object,
	onSelect: func
};

const WebImportPanel = React.memo(function WebImportPanel(props){
	const { isOpen, onClose, urls } = props;
	const [selected, setSelected] = useState([]);
	const has_selected_items = selected.length > 0;

	const citoidQueries = useGetCitoids(urls, { enabled: isOpen });
	const areQueriesSettled = citoidQueries.every(q => q.isSuccess || q.isError);
	const citoids = citoidQueries.filter(q => q.isSuccess).map(q => q.data);

	const handleClose = useCallback(() => {
		resetImport();
		onClose();
	}, [onClose, resetImport]);

	const handleItemSelection = useCallback((url) => {
		setSelected(currentSelection => {
			if(currentSelection.includes(url)){
				return currentSelection.filter(u => u != url);
			} else {
				return [...currentSelection, url];
			}
		});
	}, []);

	const resetImport = useCallback(() => {
		setSelected([]);
	}, []);

	return (
		<AuxiliaryDialog
			ariaLabelledBy="zr-webimport-dialog--title"
			className="webimport"
			extraClasses={has_selected_items ? ["has-selected-items"] : []}
			isOpen={isOpen}
			onClose={handleClose} >
			<div className={ Classes.DIALOG_BODY }>
				<div className="zr-webimport-panel--main">
					<div className="header-content">
						<div className="header-left">
							<h5 id="zr-webimport-dialog--title" className="panel-tt">
								{areQueriesSettled
									? pluralize(citoids.length, "link", " found")
									: "Parsing links..."}
							</h5>
						</div>
					</div>
					<div className="rendered-div">
						<ul className={ Classes.LIST_UNSTYLED }>
							{citoids.map(cit => <WebImportItem key={cit.url} item={cit} isSelected={selected.includes(cit.url)} onSelect={handleItemSelection} />)}
						</ul>
					</div>
				</div>
				<div className="zr-webimport-panel--side">
					<ZoteroImport identifiers={selected} isActive={has_selected_items} resetImport={resetImport} />
				</div>
			</div>
		</AuxiliaryDialog>
	);
});
WebImportPanel.propTypes = {
	isOpen: bool,
	onClose: func,
	urls: arrayOf(string)
};

export default WebImportPanel;
