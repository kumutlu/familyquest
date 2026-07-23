"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GAMIFICATION_CONFIG_V1 = void 0;
exports.isValidXpReward = isValidXpReward;
exports.resolveGamificationConfig = resolveGamificationConfig;
exports.GAMIFICATION_CONFIG_V1 = Object.freeze({
    schemaVersion: 1,
    xpPerLevel: 1000,
    defaultDailyGoalPercentage: 80,
    dailyGoalBonusXp: 25,
    perfectDayBonusXp: 50,
});
function isValidXpReward(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function resolveGamificationConfig(input) {
    const dailyGoalPercentage = input?.dailyGoalPercentage ?? exports.GAMIFICATION_CONFIG_V1.defaultDailyGoalPercentage;
    if (input !== undefined && input.schemaVersion !== 1) {
        throw new Error(`Unsupported gamification config schema version: ${input.schemaVersion}`);
    }
    if (!Number.isInteger(dailyGoalPercentage) || dailyGoalPercentage < 50 || dailyGoalPercentage > 100) {
        throw new Error('dailyGoalPercentage must be an integer from 50 through 100');
    }
    return Object.freeze({
        schemaVersion: exports.GAMIFICATION_CONFIG_V1.schemaVersion,
        xpPerLevel: exports.GAMIFICATION_CONFIG_V1.xpPerLevel,
        dailyGoalPercentage,
        dailyGoalBonusXp: exports.GAMIFICATION_CONFIG_V1.dailyGoalBonusXp,
        perfectDayBonusXp: exports.GAMIFICATION_CONFIG_V1.perfectDayBonusXp,
    });
}
//# sourceMappingURL=config.js.map