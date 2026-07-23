"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeFamilyDay = finalizeFamilyDay;
exports.finalizeGamificationDaysOnce = finalizeGamificationDaysOnce;
function currentTime(dependencies) {
    const value = dependencies.now();
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('now must return non-negative epoch milliseconds');
    return value;
}
function finalizeFamilyDay(dependencies, args) {
    return dependencies.repository.finalizeFamilyDay({ ...args, processingAt: currentTime(dependencies) });
}
async function finalizeGamificationDaysOnce(dependencies) {
    const processingAt = currentTime(dependencies);
    const familyIds = [...await dependencies.repository.listFamiliesForFinalization(processingAt)].sort();
    const results = [];
    for (const familyId of familyIds)
        results.push(await dependencies.repository.finalizeFamilyDay({ familyId, processingAt }));
    return results;
}
//# sourceMappingURL=gamificationScheduler.js.map