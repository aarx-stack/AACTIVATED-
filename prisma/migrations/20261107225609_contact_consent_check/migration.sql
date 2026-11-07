-- This is an empty migration.-- Business rule: consented inbound contacts only. A contact without real consent
-- evidence cannot be stored, whatever the application code does.
ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_consent_evidence_present" CHECK (length(btrim("consentEvidence")) >= 5);
