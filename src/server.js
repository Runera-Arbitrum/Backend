"use strict";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("crypto");
const { verifyMessage, JsonRpcProvider, Contract, Wallet, parseEther } = require("ethers");
const { prisma } = require("./prisma");
const {
  calculateLevel,
  calculateTier,
  calculateLongestStreakDays,
} = require("./utils/levelTier");
const { signProfileStatsUpdate } = require("./utils/eip712");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["*"];
const JWT_SECRET = process.env.JWT_SECRET || "";
const NONCE_TTL_MINUTES = 5;
const XP_PER_VERIFIED_RUN = Number(process.env.XP_PER_VERIFIED_RUN || 100);
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

const CAN_SIGN_PROFILE =
  !!process.env.BACKEND_SIGNER_PRIVATE_KEY &&
  !!process.env.PROFILE_NFT_ADDRESS &&
  !!process.env.CHAIN_ID;

const FAUCET_PRIVATE_KEY =
  process.env.FAUCET_PRIVATE_KEY || process.env.BACKEND_SIGNER_PRIVATE_KEY || "";
const FAUCET_RPC_URL =
  process.env.FAUCET_RPC_URL ||
  process.env.RPC_URL ||
  "https://base-sepolia.g.alchemy.com/v2/zLbuFi4TN6im35POeM45p";
const FAUCET_AMOUNT_ETH = process.env.FAUCET_AMOUNT_ETH || "0.0005";
const FAUCET_MIN_INTERVAL_MS = Number(
  process.env.FAUCET_MIN_INTERVAL_MS || 24 * 60 * 60 * 1000,
);
const CAN_FUND_FAUCET = !!FAUCET_PRIVATE_KEY;
const faucetRequestsByWallet = new Map();

app.use(
  cors({
    origin: CORS_ORIGIN.length === 1 && CORS_ORIGIN[0] === "*" ? "*" : CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function isValidWalletAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidEventId(eventId) {
  return /^0x[a-fA-F0-9]{64}$/.test(eventId);
}

function normalizeWalletAddress(address) {
  return address.trim().toLowerCase();
}

async function getUserFromAuthHeader(req) {
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  if (!JWT_SECRET) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.sub) {
      return prisma.user.findUnique({ where: { id: String(payload.sub) } });
    }

    if (payload.walletAddress && isValidWalletAddress(String(payload.walletAddress))) {
      return prisma.user.findUnique({
        where: { walletAddress: normalizeWalletAddress(String(payload.walletAddress)) },
      });
    }

    return null;
  } catch (_error) {
    return null;
  }
}

function isEventOpen(event, now = new Date()) {
  if (!event.active) {
    return false;
  }
  if (event.startTime && now < event.startTime) {
    return false;
  }
  if (event.endTime && now > event.endTime) {
    return false;
  }
  return true;
}

function isEligibleForEvent(user, event, now = new Date()) {
  if (!user) {
    return false;
  }
  if (user.tier < event.minTier) {
    return false;
  }
  if (user.totalDistanceMeters < event.minTotalDistanceMeters) {
    return false;
  }
  return isEventOpen(event, now);
}

function getTierName(tier) {
  switch (tier) {
    case 5:
      return "Diamond";
    case 4:
      return "Platinum";
    case 3:
      return "Gold";
    case 2:
      return "Silver";
    default:
      return "Bronze";
  }
}

function buildLoginMessage(nonce) {
  return `RUNERA login\nNonce: ${nonce}`;
}

async function issueJwt(user) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      sub: user.id,
      walletAddress: user.walletAddress,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

app.post("/auth/nonce", async (req, res) => {
  const walletAddress = typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";

  if (!isValidWalletAddress(walletAddress)) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "walletAddress must be a valid 0x address",
      },
    });
  }

  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60 * 1000);

  try {
    await prisma.authNonce.create({
      data: {
        walletAddress: walletAddress.toLowerCase(),
        nonce,
        expiresAt,
      },
    });
  } catch (error) {
    console.error("Failed to create nonce:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to create nonce",
      },
    });
  }

  return res.json({
    nonce,
    expiresAt: expiresAt.toISOString(),
    message: buildLoginMessage(nonce),
  });
});

app.post("/auth/connect", async (req, res) => {
  const walletAddress = typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const nonce = typeof req.body?.nonce === "string" ? req.body.nonce.trim() : "";

  if (!isValidWalletAddress(walletAddress)) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "walletAddress must be a valid 0x address",
      },
    });
  }

  if (!signature || !message || !nonce) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "signature, message, and nonce are required",
      },
    });
  }

  if (!message.includes(nonce)) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "message must include nonce",
      },
    });
  }

  const normalizedWallet = walletAddress.toLowerCase();

  try {
    const nonceRecord = await prisma.authNonce.findFirst({
      where: {
        walletAddress: normalizedWallet,
        nonce,
        usedAt: null,
      },
      orderBy: { issuedAt: "desc" },
    });

    if (!nonceRecord) {
      return res.status(400).json({
        error: {
          code: "ERR_INVALID_NONCE",
          message: "Nonce not found or already used",
        },
      });
    }

    if (nonceRecord.expiresAt < new Date()) {
      return res.status(400).json({
        error: {
          code: "ERR_NONCE_EXPIRED",
          message: "Nonce expired",
        },
      });
    }

    let recovered;
    try {
      recovered = verifyMessage(message, signature);
    } catch (error) {
      return res.status(400).json({
        error: {
          code: "ERR_SIGNATURE_INVALID",
          message: "Signature verification failed",
        },
      });
    }

    if (recovered.toLowerCase() !== normalizedWallet) {
      return res.status(401).json({
        error: {
          code: "ERR_SIGNATURE_MISMATCH",
          message: "Signature does not match wallet address",
        },
      });
    }

    const user = await prisma.user.upsert({
      where: { walletAddress: normalizedWallet },
      update: {},
      create: { walletAddress: normalizedWallet },
    });

    await prisma.authNonce.update({
      where: { id: nonceRecord.id },
      data: { usedAt: new Date(), userId: user.id },
    });

    const token = await issueJwt(user);

    return res.json({
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        tier: user.tier,
        exp: user.exp,
        totalDistanceMeters: user.totalDistanceMeters,
        runCount: user.runCount,
        verifiedRunCount: user.verifiedRunCount,
        profileTokenId: user.profileTokenId,
      },
    });
  } catch (error) {
    console.error("Auth connect failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Authentication failed",
      },
    });
  }
});

app.post("/faucet/request", async (req, res) => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";

  if (!isValidWalletAddress(walletAddress)) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "walletAddress must be a valid 0x address",
      },
    });
  }

  if (!CAN_FUND_FAUCET) {
    return res.status(503).json({
      error: {
        code: "ERR_FAUCET_DISABLED",
        message: "Faucet is not configured",
      },
    });
  }

  const normalizedWallet = walletAddress.toLowerCase();
  const now = Date.now();
  const existing = faucetRequestsByWallet.get(normalizedWallet);

  if (existing) {
    const elapsed = now - existing.lastRequestAt;
    if (elapsed < FAUCET_MIN_INTERVAL_MS) {
      return res.status(429).json({
        error: {
          code: "ERR_FAUCET_RATE_LIMIT",
          message: "Faucet already used recently",
          details: {
            retryAfterMs: FAUCET_MIN_INTERVAL_MS - elapsed,
          },
        },
      });
    }
  }

  try {
    const provider = new JsonRpcProvider(FAUCET_RPC_URL);
    const signer = new Wallet(FAUCET_PRIVATE_KEY, provider);
    const amount = parseEther(FAUCET_AMOUNT_ETH);

    const tx = await signer.sendTransaction({
      to: normalizedWallet,
      value: amount,
    });

    faucetRequestsByWallet.set(normalizedWallet, {
      lastRequestAt: now,
      lastTxHash: tx.hash,
    });

    return res.json({
      success: true,
      txHash: tx.hash,
      amountWei: amount.toString(),
      walletAddress: normalizedWallet,
    });
  } catch (error) {
    console.error("Faucet transfer failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_FAUCET_FAILED",
        message: "Failed to send funds from faucet",
      },
    });
  }
});

app.post("/profile/gasless-register", async (req, res) => {
  const raw = req.body || {};
  const authUser = await getUserFromAuthHeader(req);
  const rawWallet =
    typeof raw.walletAddress === "string" ? raw.walletAddress.trim() : "";

  if (authUser && rawWallet && normalizeWalletAddress(rawWallet) !== authUser.walletAddress) {
    return res.status(403).json({
      error: {
        code: "ERR_WALLET_MISMATCH",
        message: "walletAddress does not match authenticated user",
      },
    });
  }

  const walletAddress = authUser ? authUser.walletAddress : rawWallet;

  if (!isValidWalletAddress(walletAddress)) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "walletAddress must be a valid 0x address",
      },
    });
  }

  if (!FAUCET_PRIVATE_KEY || !process.env.PROFILE_NFT_ADDRESS) {
    return res.status(503).json({
      error: {
        code: "ERR_GASLESS_DISABLED",
        message: "Gasless registration is not configured",
      },
    });
  }

  let deadlineValue = null;
  if (typeof raw.deadline === "number" && Number.isFinite(raw.deadline)) {
    try {
      deadlineValue = BigInt(raw.deadline);
    } catch {
      deadlineValue = null;
    }
  } else if (typeof raw.deadline === "string") {
    const trimmed = raw.deadline.trim();
    if (trimmed) {
      try {
        deadlineValue = BigInt(trimmed);
      } catch {
        deadlineValue = null;
      }
    }
  }

  const signature = typeof raw.signature === "string" ? raw.signature.trim() : "";

  if (!deadlineValue || !signature) {
    return res.status(400).json({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "deadline and signature are required",
      },
    });
  }

  try {
    const rpcUrl = process.env.RPC_URL || FAUCET_RPC_URL;
    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(FAUCET_PRIVATE_KEY, provider);
    const profileAddress = process.env.PROFILE_NFT_ADDRESS;

    const profileContract = new Contract(
      profileAddress,
      ["function registerFor(address user,uint256 deadline,bytes signature) external"],
      signer,
    );

    const tx = await profileContract.registerFor(
      normalizeWalletAddress(walletAddress),
      deadlineValue,
      signature,
    );

    return res.json({
      success: true,
      txHash: tx.hash,
      walletAddress: normalizeWalletAddress(walletAddress),
      deadline: deadlineValue.toString(),
    });
  } catch (error) {
    console.error("Gasless profile registration failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_GASLESS_REGISTER_FAILED",
        message: "Failed to submit gasless profile registration",
        details: {
          reason: typeof error === "object" && error !== null && "reason" in error ? error.reason : null,
          code: typeof error === "object" && error !== null && "code" in error ? error.code : null,
        },
      },
    });
  }
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
  const authUser = await getUserFromAuthHeader(req);
  const rawWallet =
    typeof raw.walletAddress === "string" ? raw.walletAddress.trim() : "";

  if (authUser && rawWallet && normalizeWalletAddress(rawWallet) !== authUser.walletAddress) {
    return res.status(403).json({
      error: {
        code: "ERR_WALLET_MISMATCH",
        message: "walletAddress does not match authenticated user",
      },
    });
  }

  const payload = {
    walletAddress: authUser ? authUser.walletAddress : rawWallet,
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
  const nowUnix = Math.floor(now.getTime() / 1000);
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

      let onchainSync = null;

      if (validation.status === "VERIFIED") {
        const updatedExp = user.exp + XP_PER_VERIFIED_RUN;
        const updatedLevel = calculateLevel(updatedExp);
        const updatedTier = calculateTier(updatedLevel);
        const updatedRunCount = user.runCount + 1;
        const updatedVerifiedRunCount = user.verifiedRunCount + 1;
        const updatedTotalDistance =
          user.totalDistanceMeters + payload.distanceMeters;

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

        const verifiedRuns = await tx.run.findMany({
          where: {
            userId: user.id,
            status: "VERIFIED",
          },
          select: { endTime: true },
        });

        const longestStreakDays = calculateLongestStreakDays(
          verifiedRuns.map((item) => item.endTime),
        );

        const achievementCount = await tx.achievement.count({
          where: { userId: user.id },
        });

        const statsPayload = {
          xp: updatedExp,
          level: updatedLevel,
          runCount: updatedVerifiedRunCount,
          achievementCount,
          totalDistanceMeters: updatedTotalDistance,
          longestStreakDays,
          lastUpdated: nowUnix,
        };

        let nextNonce = user.onchainNonce;
        
        // Fetch actual on-chain nonce to ensure sync
        if (CAN_SIGN_PROFILE) {
          try {
             // Use RPC_URL from env or fallback to Alchemy (more reliable than public)
             const rpcUrl = process.env.RPC_URL || "https://base-sepolia.g.alchemy.com/v2/zLbuFi4TN6im35POeM45p";
             const provider = new JsonRpcProvider(rpcUrl);
             const contract = new Contract(process.env.PROFILE_NFT_ADDRESS, ["function nonces(address) view returns (uint256)"], provider);
             const onChainNonce = await contract.nonces(user.walletAddress);
             const chainNonceNum = Number(onChainNonce);
             
             if (chainNonceNum !== nextNonce) {
                console.log(`⚠️ Nonce mismatch for ${user.walletAddress}: DB=${nextNonce}, Chain=${chainNonceNum}. Syncing to Chain.`);
                nextNonce = chainNonceNum;
             }
          } catch (e) {
             console.warn("⚠️ Failed to fetch on-chain nonce, falling back to DB:", e.message);
          }

          const deadline = nowUnix + 600;
          const signature = await signProfileStatsUpdate(
            user.walletAddress,
            statsPayload,
            nextNonce,
            deadline,
          );

          onchainSync = {
            stats: statsPayload,
            nonce: nextNonce,
            deadline,
            signature,
          };

          nextNonce += 1;
        }

        await tx.user.update({
          where: { id: user.id },
          data: {
            exp: updatedExp,
            level: updatedLevel,
            tier: updatedTier,
            runCount: updatedRunCount,
            verifiedRunCount: updatedVerifiedRunCount,
            totalDistanceMeters: updatedTotalDistance,
            longestStreakDays,
            onchainNonce: nextNonce,
            lastOnchainSyncAt: CAN_SIGN_PROFILE ? now : user.lastOnchainSyncAt,
          },
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
        onchainSync,
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

app.get("/runs", async (req, res) => {
  try {
    const walletAddress =
      typeof req.query.walletAddress === "string" ? req.query.walletAddress.trim() : "";
    const limitParam =
      typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 20;

    let user = await getUserFromAuthHeader(req);

    if (!user) {
      if (!walletAddress) {
        return res.status(400).json({
          error: {
            code: "ERR_BAD_REQUEST",
            message: "walletAddress is required",
          },
        });
      }

      if (!isValidWalletAddress(walletAddress)) {
        return res.status(400).json({
          error: {
            code: "ERR_BAD_REQUEST",
            message: "walletAddress must be a valid 0x address",
          },
        });
      }

      user = await prisma.user.findUnique({
        where: { walletAddress: normalizeWalletAddress(walletAddress) },
      });
    }

    if (!user) {
      return res.json([]);
    }

    const runs = await prisma.run.findMany({
      where: { userId: user.id },
      orderBy: { startTime: "desc" },
      take: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20,
    });

    const response = runs.map((run) => {
      const distanceKm = run.distanceMeters / 1000;
      const avgPaceSeconds =
        run.avgPaceSeconds ??
        (distanceKm > 0 ? Math.round(run.durationSeconds / distanceKm) : null);

      return {
        runId: run.id,
        status: run.status,
        reasonCode: run.reasonCode,
        distanceMeters: run.distanceMeters,
        durationSeconds: run.durationSeconds,
        avgPaceSeconds,
        startTime: run.startTime,
        endTime: run.endTime,
        submittedAt: run.submittedAt,
        validatedAt: run.validatedAt,
      };
    });

    return res.json(response);
  } catch (error) {
    console.error("GET /runs failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to fetch runs",
      },
    });
  }
});

app.get("/events", async (req, res) => {
  try {
    const walletAddress =
      typeof req.query.walletAddress === "string" ? req.query.walletAddress.trim() : "";

    let user = await getUserFromAuthHeader(req);

    if (!user && walletAddress) {
      if (!isValidWalletAddress(walletAddress)) {
        return res.status(400).json({
          error: {
            code: "ERR_BAD_REQUEST",
            message: "walletAddress must be a valid 0x address",
          },
        });
      }

      user = await prisma.user.findUnique({
        where: { walletAddress: normalizeWalletAddress(walletAddress) },
      });
    }

    const events = await prisma.event.findMany({
      orderBy: { startTime: "desc" },
    });

    let participationMap = new Map();
    if (user) {
      const participations = await prisma.eventParticipation.findMany({
        where: { userId: user.id },
        select: { eventId: true, status: true },
      });
      participationMap = new Map(
        participations.map((item) => [item.eventId, item.status]),
      );
    }

    const now = new Date();
    const response = events.map((event) => ({
      eventId: event.eventId,
      name: event.name,
      minTier: event.minTier,
      minTotalDistanceMeters: event.minTotalDistanceMeters,
      targetDistanceMeters: event.targetDistanceMeters,
      expReward: event.expReward,
      startTime: event.startTime,
      endTime: event.endTime,
      active: event.active,
      eligible: user ? isEligibleForEvent(user, event, now) : false,
      status: user ? participationMap.get(event.eventId) ?? null : null,
    }));

    return res.json(response);
  } catch (error) {
    console.error("GET /events failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to fetch events",
      },
    });
  }
});

app.post("/events/:id/join", async (req, res) => {
  try {
    const eventId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const walletAddress = typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";

    if (!isValidEventId(eventId)) {
      return res.status(400).json({
        error: {
          code: "ERR_BAD_REQUEST",
          message: "eventId must be a valid bytes32 hex string",
        },
      });
    }

    let user = await getUserFromAuthHeader(req);

    if (user && walletAddress && normalizeWalletAddress(walletAddress) !== user.walletAddress) {
      return res.status(403).json({
        error: {
          code: "ERR_WALLET_MISMATCH",
          message: "walletAddress does not match authenticated user",
        },
      });
    }

    if (!user) {
      if (!walletAddress || !isValidWalletAddress(walletAddress)) {
        return res.status(400).json({
          error: {
            code: "ERR_BAD_REQUEST",
            message: "walletAddress must be a valid 0x address",
          },
        });
      }

      user = await prisma.user.upsert({
        where: { walletAddress: normalizeWalletAddress(walletAddress) },
        update: {},
        create: { walletAddress: normalizeWalletAddress(walletAddress) },
      });
    }

    const event = await prisma.event.findUnique({ where: { eventId } });
    if (!event) {
      return res.status(404).json({
        error: {
          code: "ERR_NOT_FOUND",
          message: "Event not found",
        },
      });
    }

    if (!isEventOpen(event)) {
      return res.status(400).json({
        error: {
          code: "ERR_EVENT_CLOSED",
          message: "Event is not active",
        },
      });
    }

    if (!isEligibleForEvent(user, event)) {
      return res.status(403).json({
        error: {
          code: "ERR_NOT_ELIGIBLE",
          message: "User is not eligible for this event",
        },
      });
    }

    const existing = await prisma.eventParticipation.findUnique({
      where: {
        userId_eventId: {
          userId: user.id,
          eventId,
        },
      },
    });

    if (existing) {
      if (existing.status === "COMPLETED") {
        return res.status(409).json({
          error: {
            code: "ERR_ALREADY_COMPLETED",
            message: "Event already completed",
          },
        });
      }
      return res.json({ eventId, status: existing.status });
    }

    const participation = await prisma.eventParticipation.create({
      data: {
        userId: user.id,
        eventId,
      },
    });

    return res.json({ eventId, status: participation.status });
  } catch (error) {
    console.error("POST /events/:id/join failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to join event",
      },
    });
  }
});

app.get("/events/:id/status", async (req, res) => {
  try {
    const eventId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const walletAddress =
      typeof req.query.walletAddress === "string" ? req.query.walletAddress.trim() : "";

    if (!isValidEventId(eventId)) {
      return res.status(400).json({
        error: {
          code: "ERR_BAD_REQUEST",
          message: "eventId must be a valid bytes32 hex string",
        },
      });
    }

    let user = await getUserFromAuthHeader(req);

    if (!user) {
      if (!walletAddress || !isValidWalletAddress(walletAddress)) {
        return res.status(400).json({
          error: {
            code: "ERR_BAD_REQUEST",
            message: "walletAddress must be a valid 0x address",
          },
        });
      }

      user = await prisma.user.findUnique({
        where: { walletAddress: normalizeWalletAddress(walletAddress) },
      });
    }

    if (!user) {
      return res.status(404).json({
        error: {
          code: "ERR_NOT_FOUND",
          message: "User not found",
        },
      });
    }

    const participation = await prisma.eventParticipation.findUnique({
      where: {
        userId_eventId: {
          userId: user.id,
          eventId,
        },
      },
    });

    if (!participation) {
      return res.status(404).json({
        error: {
          code: "ERR_NOT_FOUND",
          message: "Event participation not found",
        },
      });
    }

    return res.json({
      eventId,
      status: participation.status,
      completionRunId: participation.completionRunId,
      completedAt: participation.completedAt,
    });
  } catch (error) {
    console.error("GET /events/:id/status failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to fetch event status",
      },
    });
  }
});

app.get("/profile/:address", async (req, res) => {
  res.redirect(301, `/profile/${req.params.address}/metadata`);
});

app.get("/profile/:address/metadata", async (req, res) => {
  try {
    const address = typeof req.params.address === "string" ? req.params.address.trim() : "";
    if (!isValidWalletAddress(address)) {
      return res.status(400).json({
        error: {
          code: "ERR_BAD_REQUEST",
          message: "address must be a valid 0x address",
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { walletAddress: address.toLowerCase() },
      include: { achievements: true },
    });

    if (!user) {
      return res.status(404).json({
        error: {
          code: "ERR_NOT_FOUND",
          message: "User not found",
        },
      });
    }

    return res.json({
      name: `RUNERA Profile - ${getTierName(user.tier)}`,
      description: `Level ${user.level} Runner`,
      image: `${API_BASE_URL}/profile/${address.toLowerCase()}/image`,
      attributes: [
        { trait_type: "Tier", value: getTierName(user.tier) },
        { trait_type: "Level", value: user.level },
        { trait_type: "XP", value: user.exp },
        {
          trait_type: "Total Distance (km)",
          value: user.totalDistanceMeters / 1000,
        },
        { trait_type: "Runs", value: user.runCount },
        { trait_type: "Longest Streak (days)", value: user.longestStreakDays },
        { trait_type: "Achievements", value: user.achievements.length },
      ],
    });
  } catch (error) {
    console.error("GET /profile/:address/metadata failed:", error);
    return res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to fetch profile metadata",
      },
    });
  }
});

// Express error-handling middleware (must be after all routes)
app.use((err, _req, res, _next) => {
  console.error("Unhandled express error:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: {
        code: "ERR_INTERNAL",
        message: "Internal server error",
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

// Prevent server crash on unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Prevent server crash on uncaught exceptions (log and keep running)
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

app.listen(PORT, () => {
  console.log(`Runera backend listening on port ${PORT}`);
});
