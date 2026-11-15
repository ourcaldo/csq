-- Inbox sender labels (owner request 2026-11-15): API sends get their own
-- sender type so the conversation panel can label them "API" instead of
-- looking like an unnamed human reply.
ALTER TYPE "MessageSenderType" ADD VALUE IF NOT EXISTS 'API';
