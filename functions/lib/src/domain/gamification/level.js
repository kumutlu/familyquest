"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.levelForXp = levelForXp;
exports.levelProgressForXp = levelProgressForXp;
function assertXp(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}
function assertXpPerLevel(xpPerLevel) {
    if (!Number.isSafeInteger(xpPerLevel) || xpPerLevel <= 0) {
        throw new Error('xpPerLevel must be a positive safe integer');
    }
}
function levelForXp(xp, xpPerLevel) {
    assertXp(xp, 'XP');
    assertXpPerLevel(xpPerLevel);
    return Math.floor(xp / xpPerLevel) + 1;
}
function levelProgressForXp(xp, xpPerLevel) {
    const level = levelForXp(xp, xpPerLevel);
    const xpIntoLevel = xp % xpPerLevel;
    return {
        level,
        xpIntoLevel,
        xpToNextLevel: xpPerLevel - xpIntoLevel,
        percentage: Number((BigInt(xpIntoLevel) * 100n) / BigInt(xpPerLevel)),
    };
}
//# sourceMappingURL=level.js.map