-- One-time Signal session reset (2026-11-10). Deploy churn left the stored
-- Signal sessions stale: the linked device could not decrypt its own
-- account's messages ("Bad MAC" every few seconds) and recipients showed
-- "Menunggu pesan ini" for every reply. This marker makes loadDbAuthState
-- clear the session records at the next socket connect (creds, pre-keys and
-- app-state keys stay intact, so no QR re-scan); fresh sessions are
-- negotiated automatically on the next message exchange.
INSERT INTO "SystemLock" (key, token, "lockedUntil", "updatedAt")
VALUES ('baileys-session-reset', 'pending', now(), now())
ON CONFLICT (key) DO NOTHING;
