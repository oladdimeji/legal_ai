import type { OwnershipContext } from "./db.js";

export function assertGoogleLinkAllowed(
  subjectOwner: { user_id: string; firm_id: string } | undefined,
  userConnection: { provider_subject: string } | undefined,
  context: OwnershipContext,
  providerSubject: string,
): void {
  if (
    subjectOwner
    && (subjectOwner.user_id !== context.userId || subjectOwner.firm_id !== context.firmId)
  ) {
    throw new Error("google_connection_conflict");
  }
  if (userConnection && userConnection.provider_subject !== providerSubject) {
    throw new Error("google_connection_conflict");
  }
}

export function isDriveImportAccessible(
  record: { firm_id: string; user_id: string; case_id: string | null },
  context: OwnershipContext,
  caseId: string | null,
): boolean {
  return record.firm_id === context.firmId
    && record.user_id === context.userId
    && record.case_id === caseId;
}
