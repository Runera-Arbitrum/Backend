"use strict";

function calculateLevel(exp) {
  return Math.floor(exp / 100) + 1;
}

function calculateTier(level) {
  if (level >= 9) return 5;
  if (level >= 7) return 4;
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  return 1;
}

function toDayNumber(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return Math.floor(Date.UTC(year, month, day) / 86400000);
}

function calculateLongestStreakDays(dates) {
  if (!dates || dates.length === 0) {
    return 0;
  }

  const uniqueDays = Array.from(
    new Set(dates.map((date) => toDayNumber(date))),
  ).sort((a, b) => a - b);

  let longest = 1;
  let current = 1;

  for (let i = 1; i < uniqueDays.length; i += 1) {
    if (uniqueDays[i] === uniqueDays[i - 1] + 1) {
      current += 1;
    } else {
      current = 1;
    }
    if (current > longest) {
      longest = current;
    }
  }

  return longest;
}

module.exports = {
  calculateLevel,
  calculateTier,
  calculateLongestStreakDays,
};
