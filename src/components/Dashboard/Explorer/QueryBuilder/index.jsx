import React, { useCallback, useEffect, useMemo, useState } from "react";
import { func } from "prop-types";
import { NonIdealState, Switch } from "@blueprintjs/core";

import { ListWrapper, Pagination, Toolbar } from "../../../DataList";
import ItemElement from "./ItemElement";
import { defaultQueryTerm, runQuerySet } from "./queries";
import { addElemToArray, updateArrayElemAt, removeArrayElemAt } from "./utils";

import * as customPropTypes from "../../../../propTypes";
import "./index.css";
import QueryFilterList from "./QueryFilterList";

const itemsPerPage = 20;

function QueryBuilder({ items, onClose }){
	const [currentPage, setCurrentPage] = useState(1);
	const [useOR, setUseOR] = useState(true);
	const [queryTerms, setQueryTerms] = useState([]);

	const switchOperator = useCallback(() => setUseOR(prev => !prev), []);

	const addQueryTerm = useCallback(() => {
		setQueryTerms(prev => addElemToArray(prev, [[defaultQueryTerm]]));
	}, []);

	const removeQueryTerm = useCallback((index) => {
		setQueryTerms(prev => removeArrayElemAt(prev, index));
	}, []);

	const handleQueryTermChange = useCallback((index, value) => setQueryTerms(prev => updateArrayElemAt(prev, index, value)), []);

	const handlers = useMemo(() => ({
		addTerm: addQueryTerm,
		removeTerm: removeQueryTerm,
		updateTerm: handleQueryTermChange
	}), [addQueryTerm, removeQueryTerm, handleQueryTermChange]);

	const queriedItems = useMemo(() => items.filter(it => runQuerySet(queryTerms, useOR, it.raw)), [items, queryTerms, useOR]);

	const pageLimits = useMemo(() => [itemsPerPage*(currentPage - 1), itemsPerPage*currentPage], [currentPage]);

	useEffect(() => {
		setCurrentPage(1);
	}, [items, queriedItems]);

	return <div className="zr-query-builder">
		<Toolbar>
			<QueryFilterList handlers={handlers} terms={queryTerms} useOR={useOR} />
		</Toolbar>
		{queryTerms.length > 0 && <Switch checked={useOR} innerLabel="AND" innerLabelChecked="OR" onChange={switchOperator} />}
		<ListWrapper>
			{queriedItems.length > 0
				? queriedItems
					.slice(...pageLimits)
					.map(el => <ItemElement key={[el.location, el.key].join("-")} item={el} onClose={onClose} />)
				: <NonIdealState className="zr-auxiliary" description="No items to display" />}
		</ListWrapper>
		<Toolbar>
			<Pagination
				arrows="first" 
				currentPage={currentPage} 
				itemsPerPage={itemsPerPage} 
				nbItems={queriedItems.length} 
				setCurrentPage={setCurrentPage} 
			/>
		</Toolbar>
	</div>;
}
QueryBuilder.propTypes = {
	items: customPropTypes.cleanLibraryReturnArrayType,
	onClose: func
};

export default QueryBuilder;
