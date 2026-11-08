-- D6: inbound content kind. TEXT carries a real text body (or a media
-- caption) and drives the agent; MEDIA/OTHER are stored for the inbox as
-- "[image]"-style placeholders and never trigger an LLM turn.
-- Existing rows default to TEXT (historical placeholders in body are
-- cosmetic in the replayed history and are NOT reclassified by heuristic).

-- AlterEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'MEDIA', 'OTHER');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'TEXT';
