"use strict";

const { prisma } = require("./prisma");

async function main() {
  const eventId = process.env.EVENT_ID;

  if (!eventId || !/^0x[a-fA-F0-9]{64}$/.test(eventId)) {
    throw new Error("EVENT_ID must be a 0x-prefixed 32-byte hex string");
  }

  const name = process.env.EVENT_NAME || "RUNERA Genesis 10K";
  const minTier = Number(process.env.EVENT_MIN_TIER || 1);
  const minTotalDistanceMeters = Number(
    process.env.EVENT_MIN_TOTAL_DISTANCE_METERS || 20000,
  );
  const targetDistanceMeters = Number(
    process.env.EVENT_TARGET_DISTANCE_METERS || 10000,
  );
  const expReward = Number(process.env.EVENT_EXP_REWARD || 500);
  const startTime = process.env.EVENT_START_TIME
    ? new Date(process.env.EVENT_START_TIME)
    : new Date("2025-01-15T00:00:00Z");
  const endTime = process.env.EVENT_END_TIME
    ? new Date(process.env.EVENT_END_TIME)
    : new Date("2025-01-30T23:59:59Z");
  const active =
    typeof process.env.EVENT_ACTIVE === "string"
      ? process.env.EVENT_ACTIVE.toLowerCase() === "true"
      : true;

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error("EVENT_START_TIME / EVENT_END_TIME must be valid ISO dates");
  }

  await prisma.event.upsert({
    where: { eventId },
    update: {
      name,
      minTier,
      minTotalDistanceMeters,
      targetDistanceMeters,
      expReward,
      startTime,
      endTime,
      active,
    },
    create: {
      eventId,
      name,
      minTier,
      minTotalDistanceMeters,
      targetDistanceMeters,
      expReward,
      startTime,
      endTime,
      active,
    },
  });

  console.log("Event saved:", eventId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
