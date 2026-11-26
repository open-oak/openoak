-- Invite URLs now contain only this opaque bearer nonce, so lookups must be
-- both unique and indexed without exposing a list identifier in the URL.
CREATE UNIQUE INDEX "List_inviteNonce_key" ON "List"("inviteNonce");
