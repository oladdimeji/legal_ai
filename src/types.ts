export interface User {
  id: string;
  firm_id: string;
  name: string;
  email: string;
}

export interface Firm {
  id: string;
  name: string;
}

export interface Document {
  id: string;
  firm_id: string;
  case_id: string | null; // nullable, can attach to a case
  title: string;
  source_url: string | null;
  drive_id: string | null;
  extracted_text: string;
  section: string; // category, e.g. "Corporate Law", "Litigation", "IP", "Draft"
  uploaded_at: string;
  source_type?: "Starting Instruction" | "Matter Upload" | "Firm Library Document" | "Client Submission" | "External Legal Source" | "External Web Source";
  origin?: string;
  processing_state?:
    | "Processing" | "Ready" | "Needs Attention"
    | "uploaded" | "scanning" | "extracting" | "needs_ocr"
    | "indexing" | "ready" | "failed" | "cancelled";
  link_origin?: "Manual" | "AI Suggested" | "Starting Input" | "Legacy Link" | null;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_text: string;
  embedding: number[]; // 768 float array
}

export interface Case {
  id: string;
  firm_id: string;
  name: string;
  description: string;
  created_at: string;
  status?: "Open" | "Waiting for Client" | "On Hold" | "Closed";
  client_name?: string | null;
  client_email?: string | null;
  matter_type?: string | null;
  jurisdiction?: string | null;
  preliminary_objectives?: string | null;
  matter_type_suggested?: boolean;
  jurisdiction_suggested?: boolean;
  objectives_suggested?: boolean;
  updated_at?: string;
  last_activity_at?: string;
}

export interface CaseDocument {
  case_id: string;
  document_id: string;
}

export type Scope = "wide" | "case";

export interface Thread {
  id: string;
  user_id: string;
  case_id: string | null;
  scope: Scope;
  title: string;
  created_at: string;
  last_activity_at?: string;
}

export interface Citation {
  id: string; // e.g., "doc_1", "web_1", "court_1"
  type: "workspace" | "connector" | "web";
  title: string;
  url?: string;
  textSnippet: string;
  sourceName: string; // e.g., "Internal Document", "CourtListener", "Google Search"
  provider?: "govinfo";
  providerSourceId?: string;
  publicationDate?: string;
  retrievalDate?: string;
  researchRunId?: string;
  sourceMetadata?: Record<string, string | number | boolean | null>;
}

export type FirmRole = "firm_admin" | "lawyer" | "staff" | "read_only";

export interface FirmMembership {
  id: string;
  role: FirmRole;
  status: "active" | "suspended" | "removed";
}

export interface ResearchStep {
  subQuestion: string;
  retrievedContext: string;
  note: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  steps: ResearchStep[] | null; // log when deep research is run
  created_at: string;
  metadata?: {
    suggestions?: string[];
    attachments?: Array<{ name: string }> | string[];
    [key: string]: unknown;
  };
}

export interface Draft {
  id: string;
  thread_id: string | null;
  case_id: string | null;
  title: string;
  content: string; // markdown or plain text editable
  created_at: string;
  updated_at?: string;
  shared_with_client?: boolean;
  shared_at?: string | null;
  origin?: string;
  parent_draft_id?: string | null;
  revision_type?: "Lawyer Original" | "Duplicate" | "Client Revision" | "Client Response";
}

export interface MatterIntelligenceRecord {
  case_id: string;
  content: string;
  source_snapshot: Array<{ id: string; uploaded_at: string; processing_state: string; link_origin: string | null }>;
  generated_at: string;
  last_edited_at: string;
  version: number;
  sources_changed: boolean;
}

export interface ClientAccess {
  id: string;
  case_id: string;
  client_name: string;
  client_email: string;
  invitation_status: "Pending" | "Active" | "Revoked";
  created_at: string;
  activated_at: string | null;
  revoked_at: string | null;
}

export interface CollaborationResponse {
  id: string;
  request_id: string;
  response_type: string;
  content: string | null;
  document_id: string | null;
  draft_id: string | null;
  is_read: boolean;
  created_at: string;
  attachments?: Array<{
    response_id: string;
    id?: string;
    document_id: string | null;
    draft_id: string | null;
    document_title?: string | null;
    draft_title?: string | null;
    draft_origin?: string | null;
    revision_type?: string | null;
    created_at?: string;
  }>;
}

export interface CollaborationRequest {
  id: string;
  case_id: string;
  request_type: string;
  instruction: string;
  status: string;
  created_at: string;
  updated_at: string;
  documents: Draft[];
  responses: CollaborationResponse[];
}
