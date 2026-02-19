"use strict";

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: [
    { level: "error", emit: "stdout" },
    { level: "warn", emit: "stdout" },
  ],
});

// Attempt initial connection and log status
prisma
  .$connect()
  .then(() => {
    console.log("Prisma connected to database successfully");
  })
  .catch((error) => {
    console.error("Prisma failed to connect to database:", error.message);
  });

module.exports = { prisma };
