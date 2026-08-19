-- Baileys auth state stored in the DB (survives restarts without a disk).
CREATE TABLE "BaileysAuth" (
    "channelId" TEXT NOT NULL,
    "creds" TEXT,
    "keys" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BaileysAuth_pkey" PRIMARY KEY ("channelId")
);
