"use strict";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { prisma } = require("./prisma");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const MIN_PACE_SECONDS = 180; // 3:00 min/km

function validateRunPayload(payload) {
  const errors = [];

  if (!payload.walletAddress) {
    errors.push("walletAddress is required");
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(payload.walletAddress)) {
    errors.push("walletAddress must be a valid 0x address");
  }

  if (!Number.isFinite(payload.distanceMeters) || payload.distanceMeters <= 0) {
    errors.push("distanceMeters must be a positive number");
  }

  if (!Number.isFinite(payload.durationSeconds) || payload.durationSeconds <= 0) {
    errors.push("durationSeconds must be a positive number");
  }

  if (!payload.startTime || Number.isNaN(payload.startTime.getTime())) {
    errors.push("startTime must be a valid ISO8601 date");
  }

  if (!payload.endTime || Number.isNaN(payload.endTime.getTime())) {
    errors.push("endTime must be a valid ISO8601 date");
  }

  if (payload.startTime && payload.endTime && payload.endTime <= payload.startTime) {
    errors.push("endTime must be after startTime");
  }

  return errors;
}

function validateRunRules({ distanceMeters, durationSeconds, startTime, endTime, deviceHash }) {
  if (!deviceHash) {
    return { status: "REJECTED", reasonCode: "ERR_NO_DEVICE_ATTESTATION" };
  }

  if (!startTime || !endTime || endTime <= startTime) {
    return { status: "REJECTED", reasonCode: "ERR_TIMESTAMP_INVALID" };
  }

  if (distanceMeters <= 0) {
    return { status: "REJECTED", reasonCode: "ERR_DISTANCE_SHORT" };
  }

  if (durationSeconds <= 0) {
    return { status: "REJECTED", reasonCode: "ERR_DURATION_SHORT" };
  }

  const distanceKm = distanceMeters / 1000;
  const paceSeconds = durationSeconds / distanceKm;

  if (paceSeconds < MIN_PACE_SECONDS) {
    return { status: "REJECTED", reasonCode: "ERR_PACE_IMPOSSIBLE" };
  }

  return { status: "VERIFIED", reasonCode: null };
}

app.post("/run/submit", async (req, res) => {
  const raw = req.body || {};
  const payload = {
    walletAddress: typeof raw.walletAddress === "string" ? raw.walletAddress.trim() : "",
    distanceMeters: Number(raw.distanceMeters),
    durationSeconds: Number(raw.durationSeconds),
    startTime: new Date(raw.startTime),
    endTime: new Date(raw.endTime),
    deviceHash: typeof raw.deviceHash === "string" ? raw.deviceHash.trim() : "",
  };

  const errors = validateRunPayload(payload);
  if (errors.length > 0) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "Invalid run payload",
        details: { errors },
      },
    });
  }

  const normalizedWallet = payload.walletAddress.toLowerCase();
  const now = new Date();
  const avgPaceSeconds = Math.round(
    payload.durationSeconds / (payload.distanceMeters / 1000),
  );
  const validation = validateRunRules(payload);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { walletAddress: normalizedWallet },
        update: {},
        create: { walletAddress: normalizedWallet },
      });

      const run = await tx.run.create({
        data: {
          userId: user.id,
          status: "SUBMITTED",
          distanceMeters: payload.distanceMeters,
          durationSeconds: payload.durationSeconds,
          startTime: payload.startTime,
          endTime: payload.endTime,
          deviceHash: payload.deviceHash || null,
          avgPaceSeconds,
          submittedAt: now,
        },
      });

      await tx.runStatusHistory.create({
        data: { runId: run.id, status: "SUBMITTED" },
      });
      await tx.runStatusHistory.create({
        data: { runId: run.id, status: "VALIDATING" },
      });
      await tx.run.update({
        where: { id: run.id },
        data: { status: "VALIDATING" },
      });

      if (validation.status === "VERIFIED") {
        await tx.run.update({
          where: { id: run.id },
          data: {
            status: "VERIFIED",
            validatedAt: now,
            verifiedAt: now,
            reasonCode: null,
            validatorVersion: "1.0.0",
          },
        });

        await tx.runStatusHistory.create({
          data: { runId: run.id, status: "VERIFIED" },
        });
      } else {
        await tx.run.update({
          where: { id: run.id },
          data: {
            status: "REJECTED",
            validatedAt: now,
            rejectedAt: now,
            reasonCode: validation.reasonCode,
            validatorVersion: "1.0.0",
          },
        });

        await tx.runStatusHistory.create({
          data: {
            runId: run.id,
            status: "REJECTED",
            reasonCode: validation.reasonCode,
          },
        });
      }

      return {
        runId: run.id,
        status: validation.status,
        reasonCode: validation.reasonCode,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to submit run:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to submit run",
      },
    });
  }
});

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, () => {
  console.log(`Runera backend listening on port ${PORT}`);
});
