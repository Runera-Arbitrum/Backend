"use strict";

const { ethers } = require("ethers");

const PROFILE_DOMAIN_NAME = "RuneraProfileDynamicNFT";
const PROFILE_DOMAIN_VERSION = "1";

const STATS_UPDATE_TYPES = {
  StatsUpdate: [
    { name: "user", type: "address" },
    { name: "xp", type: "uint96" },
    { name: "level", type: "uint16" },
    { name: "runCount", type: "uint32" },
    { name: "achievementCount", type: "uint32" },
    { name: "totalDistanceMeters", type: "uint64" },
    { name: "longestStreakDays", type: "uint32" },
    { name: "lastUpdated", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

function getDomain() {
  const chainId = Number(process.env.CHAIN_ID || 0);
  const verifyingContract = process.env.PROFILE_NFT_ADDRESS || "";

  return {
    name: PROFILE_DOMAIN_NAME,
    version: PROFILE_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

async function signProfileStatsUpdate(userAddress, stats, nonce, deadline) {
  const privateKey = process.env.BACKEND_SIGNER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("BACKEND_SIGNER_PRIVATE_KEY is not configured");
  }

  const wallet = new ethers.Wallet(privateKey);

  const value = {
    user: userAddress,
    xp: BigInt(stats.xp),
    level: stats.level,
    runCount: stats.runCount,
    achievementCount: stats.achievementCount,
    totalDistanceMeters: BigInt(Math.round(stats.totalDistanceMeters)),
    longestStreakDays: stats.longestStreakDays,
    lastUpdated: BigInt(stats.lastUpdated),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };

  return wallet.signTypedData(getDomain(), STATS_UPDATE_TYPES, value);
}

module.exports = {
  STATS_UPDATE_TYPES,
  getDomain,
  signProfileStatsUpdate,
};
