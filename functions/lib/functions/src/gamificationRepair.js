"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareRebuildRecord = compareRebuildRecord;
exports.mergeRebuildStreams = mergeRebuildStreams;
exports.takeCompleteCausalGroups = takeCompleteCausalGroups;
exports.repairGamificationPage = repairGamificationPage;
exports.repairPostCutoverPage = repairPostCutoverPage;
const types_1 = require("../../src/domain/gamification/types");
function compareStrings(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareRebuildRecord(left, right) {
    return left.effectiveAt - right.effectiveAt
        || compareStrings(left.causalGroupId, right.causalGroupId)
        || left.transitionRank - right.transitionRank
        || compareStrings(left.id, right.id);
}
function mergeRebuildStreams(eligibility, events) {
    const left = [...eligibility].sort(compareRebuildRecord);
    const right = [...events].sort(compareRebuildRecord);
    const result = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length || rightIndex < right.length) {
        if (rightIndex >= right.length || (leftIndex < left.length && compareRebuildRecord(left[leftIndex], right[rightIndex]) <= 0)) {
            result.push(left[leftIndex++]);
        }
        else {
            result.push(right[rightIndex++]);
        }
    }
    return result;
}
function takeCompleteCausalGroups(records, streamExhausted) {
    for (let start = 0; start < records.length;) {
        let end = start + 1;
        while (end < records.length && records[end].causalGroupId === records[start].causalGroupId)
            end += 1;
        (0, types_1.assertCausalGroupRecordCount)(end - start);
        start = end;
    }
    if (records.length === 0 || streamExhausted)
        return { complete: records, pending: [] };
    const finalGroup = records.at(-1).causalGroupId;
    const split = records.findIndex(record => record.causalGroupId === finalGroup);
    return { complete: records.slice(0, split), pending: records.slice(split) };
}
function now(dependencies) {
    const value = dependencies.now();
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('now must return non-negative epoch milliseconds');
    return value;
}
function repairGamificationPage(dependencies, args) {
    return dependencies.repository.repairGamificationPage({ ...args, processingAt: now(dependencies), maxRecords: 250 });
}
function repairPostCutoverPage(dependencies, args) {
    return dependencies.repository.repairPostCutoverPage({ ...args, processingAt: now(dependencies), maxRecords: 250 });
}
//# sourceMappingURL=gamificationRepair.js.map