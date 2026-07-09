export type RiskPromptSelectionState = Set<string>;

const isValidRiskPromptId = (riskPromptId: string) => riskPromptId.trim().length > 0;

const canSelectRiskPromptId = (riskPromptId: string, knownRiskPromptIds?: ReadonlySet<string>) =>
	isValidRiskPromptId(riskPromptId) && (!knownRiskPromptIds || knownRiskPromptIds.has(riskPromptId));

export const createRiskPromptSelectionState = (
	riskPromptIds: Iterable<string> = [],
	knownRiskPromptIds?: ReadonlySet<string>,
): RiskPromptSelectionState => {
	const selectedPromptIds = new Set<string>();
	for (const riskPromptId of riskPromptIds) {
		if (canSelectRiskPromptId(riskPromptId, knownRiskPromptIds)) selectedPromptIds.add(riskPromptId);
	}
	return selectedPromptIds;
};

export const selectRiskPrompt = (
	selectedPromptIds: ReadonlySet<string>,
	riskPromptId: string,
	knownRiskPromptIds?: ReadonlySet<string>,
): RiskPromptSelectionState => {
	const nextSelectedPromptIds = new Set(selectedPromptIds);
	if (canSelectRiskPromptId(riskPromptId, knownRiskPromptIds)) nextSelectedPromptIds.add(riskPromptId);
	return nextSelectedPromptIds;
};

export const deselectRiskPrompt = (
	selectedPromptIds: ReadonlySet<string>,
	riskPromptId: string,
): RiskPromptSelectionState => {
	const nextSelectedPromptIds = new Set(selectedPromptIds);
	nextSelectedPromptIds.delete(riskPromptId);
	return nextSelectedPromptIds;
};

export const toggleRiskPrompt = (
	selectedPromptIds: ReadonlySet<string>,
	riskPromptId: string,
	selected: boolean,
	knownRiskPromptIds?: ReadonlySet<string>,
): RiskPromptSelectionState => selected
	? selectRiskPrompt(selectedPromptIds, riskPromptId, knownRiskPromptIds)
	: deselectRiskPrompt(selectedPromptIds, riskPromptId);

export const isRiskPromptSelected = (selectedPromptIds: ReadonlySet<string>, riskPromptId: string) =>
	selectedPromptIds.has(riskPromptId);

export const getSelectedPromptCount = (selectedPromptIds: ReadonlySet<string>) => selectedPromptIds.size;

export const getSelectedPromptCountsByArea = (
	selectedPromptIds: ReadonlySet<string>,
	riskPromptAreaByPromptId: ReadonlyMap<string, string>,
) => {
	const countsByArea = new Map<string, number>();
	for (const riskPromptId of selectedPromptIds) {
		const areaId = riskPromptAreaByPromptId.get(riskPromptId);
		if (!areaId) continue;
		countsByArea.set(areaId, (countsByArea.get(areaId) || 0) + 1);
	}
	return countsByArea;
};

export const getSelectedPromptCountByArea = (
	selectedPromptIds: ReadonlySet<string>,
	riskPromptAreaByPromptId: ReadonlyMap<string, string>,
	areaId: string,
) => getSelectedPromptCountsByArea(selectedPromptIds, riskPromptAreaByPromptId).get(areaId) || 0;

export const clearRiskPromptSelections = (): RiskPromptSelectionState => new Set<string>();

export const removeUnknownRiskPromptSelections = (
	selectedPromptIds: ReadonlySet<string>,
	knownRiskPromptIds: ReadonlySet<string>,
) => createRiskPromptSelectionState(selectedPromptIds, knownRiskPromptIds);

export const getSelectedPromptTotalLabel = (count: number) =>
	count === 1 ? '1 prompt selected' : `${count} prompts selected`;
