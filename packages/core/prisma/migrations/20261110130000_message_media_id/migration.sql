-- Message.mediaId: outbound media messages reference their MediaAsset so the
-- inbox can render the image instead of a "[image ...]" text placeholder.
-- Campaign image sends are the writer; inbound media keeps using the kind
-- placeholder (no bytes are downloaded for inbound).
ALTER TABLE "Message" ADD COLUMN "mediaId" TEXT;
