import React, { useState, useEffect } from "react";
import { 
  Briefcase, Folder, FileText, Search, Upload, Plus, Trash2, 
  Eye, Check, RefreshCw, FolderOpen, AlertCircle, Database, HelpCircle 
} from "lucide-react";
import { Case, Document } from "../types";

interface WorkspaceViewProps {
  cases: Case[];
  activeCaseId: string | null;
  setActiveCaseId: (id: string | null) => void;
  onRefreshCases: () => void;
}

export default function WorkspaceView({ 
  cases, 
  activeCaseId, 
  setActiveCaseId,
  onRefreshCases
}: WorkspaceViewProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [semanticSearchActive, setSemanticSearchActive] = useState(true);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [manualFolderBrowse, setManualFolderBrowse] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  // Creating a new Case
  const [showCreateCaseModal, setShowCreateCaseModal] = useState(false);
  const [newCaseName, setNewCaseName] = useState("");
  const [newCaseDesc, setNewCaseDesc] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);

  // Document upload states
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [oauthStep, setOauthStep] = useState<"idle" | "connecting" | "ready">("idle");

  // View individual document text
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);

  // Fetch documents on workspace/case change
  useEffect(() => {
    fetchDocuments();
    setSearchResults([]);
    setSearchQuery("");
  }, [activeCaseId]);

  const fetchDocuments = async () => {
    try {
      const url = activeCaseId ? `/api/documents?caseId=${activeCaseId}` : "/api/documents?caseId=null";
      const res = await fetch(url);
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      console.error("Error fetching documents:", err);
    }
  };

  // Semantic Similarity Search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    if (semanticSearchActive) {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery,
            scope: activeCaseId || "wide"
          })
        });
        const data = await res.json();
        setSearchResults(data);
      } catch (err) {
        console.error("Semantic search failed:", err);
      }
    } else {
      // Simple text-based filter on titles/contents
      const filtered = documents.filter(
        (doc) => 
          doc.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
          doc.extracted_text.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(filtered.map((d) => ({ document_id: d.id, chunk_text: d.extracted_text, similarity: 1 })));
    }
  };

  // Live query change search trigger (debounced or on submit, let's trigger on enter / button click)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseName.trim()) return;

    setCreatingCase(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCaseName,
          description: newCaseDesc
        })
      });
      const newCase = await res.json();
      onRefreshCases();
      setActiveCaseId(newCase.id);
      setShowCreateCaseModal(false);
      setNewCaseName("");
      setNewCaseDesc("");
    } catch (err) {
      console.error("Error creating case:", err);
    } finally {
      setCreatingCase(false);
    }
  };

  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to permanently delete this document and its semantic index?")) return;

    try {
      await fetch(`/api/documents/${id}?caseId=${activeCaseId || "null"}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (viewingDoc?.id === id) {
        setViewingDoc(null);
      }
    } catch (err) {
      console.error("Error deleting document:", err);
    }
  };

  // Mock upload action (simulates file select + extraction + embedding categorization)
  const handleMockUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim() || !uploadText.trim()) return;

    setIsUploading(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: uploadTitle,
          text: uploadText,
          caseId: activeCaseId,
          driveId: oauthStep === "ready" ? "drive_file_" + Date.now() : null
        })
      });
      const data = await res.json();
      if (data.id) {
        setDocuments((prev) => [data, ...prev]);
        setUploadTitle("");
        setUploadText("");
        setOauthStep("idle");
        alert(`Successfully index document! Automatically categorized into section: "${data.section}" via vector comparison.`);
      } else {
        alert("Upload failed: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error indexing document: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Google Drive OAuth selection flow simulation
  const handleOauthConnect = () => {
    setOauthStep("connecting");
    setTimeout(() => {
      setOauthStep("ready");
      // Pre-populate template files from Google Drive
      setUploadTitle("Sterling Croft Partnership_Agreement_2025.txt");
      setUploadText(`PARTNERSHIP AGREEMENT
This agreement is made on October 12, 2025, between the senior counsel of Sterling & Croft LLP.
The partners agree to coordinate on all intellectual property litigation matters.
All partners share profits and losses equally (50/50 ratio), unless agreed otherwise in writing.
Section 8 governs dispute resolution, mandating private mediation in the County of San Francisco, California, prior to any public arbitration filing.
No partner may engage in any external legal services that compete directly with the active practice lines of Sterling & Croft LLP during their tenure.`);
    }, 1500);
  };

  // List unique sections in library
  const sections = Array.from(new Set(documents.map((d) => d.section)));

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-white text-zinc-900">
      
      {/* Case Library sidebar */}
      <div className="w-72 border-r border-zinc-100 bg-zinc-50 flex flex-col h-full shrink-0">
        <div className="p-5 border-b border-zinc-200 flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Case Projects</span>
          <button
            onClick={() => setShowCreateCaseModal(true)}
            className="p-1 rounded bg-zinc-900 text-white hover:bg-zinc-800 transition-all"
            title="Create new Case Workspace"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Case List items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Default Wide Library */}
          <button
            onClick={() => {
              setActiveCaseId(null);
              setManualFolderBrowse(false);
            }}
            className={`w-full text-left p-3.5 rounded-lg border transition-all text-xs flex items-center gap-3 ${
              activeCaseId === null
                ? "bg-white border-zinc-900 text-zinc-950 font-bold shadow-sm"
                : "border-transparent text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
            }`}
          >
            <Database className="h-4 w-4 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <p className="uppercase tracking-tight text-[10px] font-mono text-zinc-400">Default Scope</p>
              <p className="truncate font-semibold uppercase">Wide Library</p>
            </div>
          </button>

          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveCaseId(c.id);
                setManualFolderBrowse(false);
              }}
              className={`w-full text-left p-3.5 rounded-lg border transition-all text-xs flex items-start gap-3 ${
                activeCaseId === c.id
                  ? "bg-white border-zinc-900 text-zinc-950 font-bold shadow-sm"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
              }`}
            >
              <Briefcase className="h-4 w-4 mt-0.5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate uppercase">{c.name}</p>
                <p className="text-[10px] text-zinc-400 truncate mt-0.5 font-sans font-normal leading-tight">
                  {c.description || "No description provided."}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Document Grid & Actions */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Workspace Title Header */}
        <div className="px-8 py-5 bg-white border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="font-sans font-bold text-lg text-zinc-900 uppercase tracking-tight">
              {activeCaseId ? cases.find(c => c.id === activeCaseId)?.name : "Wide Firm Library"}
            </h2>
            <p className="text-[11px] font-mono text-zinc-400 uppercase mt-0.5">
              {activeCaseId ? "Case-Specific Workspace Document Repository" : "Universal structured library & semantic indices"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setManualFolderBrowse(!manualFolderBrowse)}
              className={`px-3 py-1.5 text-[10px] font-mono uppercase font-bold border rounded transition-all ${
                manualFolderBrowse 
                  ? "bg-zinc-900 text-white border-zinc-900" 
                  : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              📁 Browse Folders / Sections
            </button>
          </div>
        </div>

        {/* Semantic Search Box */}
        <div className="px-8 py-4 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between gap-4">
          <form onSubmit={handleSearch} className="flex-1 flex items-center bg-white border border-zinc-300 rounded overflow-hidden p-1 shadow-inner max-w-2xl">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents semantically via pgvector similarity (e.g., 'California trade secret laws' or 'limitations of separation of powers')..."
              className="flex-1 text-xs px-3 py-1.5 outline-none text-zinc-900"
            />
            <button
              type="submit"
              className="bg-zinc-900 hover:bg-zinc-800 text-white font-mono uppercase text-[10px] font-bold px-4 py-1.5 rounded"
            >
              Search
            </button>
          </form>

          <div className="flex items-center gap-2 select-none">
            <label className="text-[10px] font-mono uppercase font-semibold text-zinc-500">Method:</label>
            <button
              onClick={() => setSemanticSearchActive(true)}
              className={`px-2 py-1 text-[9px] font-mono uppercase font-bold rounded ${
                semanticSearchActive ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
            >
              Vector Match
            </button>
            <button
              onClick={() => setSemanticSearchActive(false)}
              className={`px-2 py-1 text-[9px] font-mono uppercase font-bold rounded ${
                !semanticSearchActive ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
            >
              Keyword match
            </button>
          </div>
        </div>

        {/* Workspace Display Area */}
        <div className="flex-1 overflow-y-auto p-8 grid grid-cols-3 gap-6">
          
          {/* Folder Browse Panel or Search Results List */}
          <div className="col-span-2 space-y-6">
            
            {searchResults.length > 0 ? (
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold uppercase text-zinc-500 tracking-wider">
                  {semanticSearchActive ? "Semantic Vector Matches" : "Keyword Matches"} ({searchResults.length})
                </h3>
                <div className="space-y-3">
                  {searchResults.map((resItem, i) => {
                    const doc = documents.find((d) => d.id === resItem.document_id);
                    return (
                      <div 
                        key={i} 
                        onClick={() => doc && setViewingDoc(doc)}
                        className="p-4 bg-white border border-zinc-200 rounded-lg hover:border-zinc-500 cursor-pointer transition-all text-xs"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-zinc-950 uppercase truncate max-w-xs block">
                            {doc ? doc.title : "Workspace Excerpt"}
                          </span>
                          {semanticSearchActive && (
                            <span className="font-mono text-[9px] bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200">
                              Sim: {resItem.similarity?.toFixed(4)}
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-600 line-clamp-3 leading-relaxed font-mono text-[11px]">
                          "{resItem.chunk_text}"
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : manualFolderBrowse ? (
              // Folders Browser
              <div className="space-y-6">
                <div>
                  <h3 className="text-[11px] font-mono font-bold uppercase text-zinc-500 tracking-wider mb-3">Folders & Sections</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setSelectedSection(null)}
                      className={`p-3.5 border rounded-lg text-left text-xs transition-all ${
                        selectedSection === null
                          ? "bg-white border-zinc-950 font-semibold"
                          : "bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-600"
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 text-zinc-500 mb-2" />
                      <p className="font-bold uppercase">All Categories</p>
                      <p className="text-[9px] text-zinc-400 uppercase mt-0.5">{documents.length} Files</p>
                    </button>

                    {sections.map((sec) => {
                      const count = documents.filter((d) => d.section === sec).length;
                      return (
                        <button
                          key={sec}
                          onClick={() => setSelectedSection(sec)}
                          className={`p-3.5 border rounded-lg text-left text-xs transition-all ${
                            selectedSection === sec
                              ? "bg-white border-zinc-950 font-semibold"
                              : "bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-600"
                          }`}
                        >
                          <Folder className="h-4 w-4 text-zinc-500 mb-2" />
                          <p className="font-bold uppercase truncate">{sec}</p>
                          <p className="text-[9px] text-zinc-400 uppercase mt-0.5">{count} Files</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Filtered document list */}
                <div>
                  <h3 className="text-[11px] font-mono font-bold uppercase text-zinc-500 tracking-wider mb-3">
                    {selectedSection || "All Available files"}
                  </h3>
                  <div className="space-y-2">
                    {documents
                      .filter((d) => !selectedSection || d.section === selectedSection)
                      .map((d) => (
                        <div
                          key={d.id}
                          onClick={() => setViewingDoc(d)}
                          className="p-3.5 bg-white border border-zinc-200 hover:border-zinc-400 rounded-lg cursor-pointer transition-all flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                            <div className="min-w-0">
                              <p className="font-semibold text-zinc-950 truncate uppercase">{d.title}</p>
                              <p className="text-[9px] text-zinc-400 uppercase mt-0.5 font-mono">
                                Uploaded on {new Date(d.uploaded_at).toLocaleDateString()} • {d.section}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleDeleteDocument(d.id, e)}
                            className="p-1 rounded text-zinc-400 hover:text-red-600 transition-all"
                            title="Delete document index"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              // Standard wide library list of documents
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold uppercase text-zinc-500 tracking-wider">
                  Indexed Library Materials ({documents.length})
                </h3>
                
                {documents.length === 0 ? (
                  <div className="p-8 text-center bg-zinc-50 border border-dashed border-zinc-200 rounded-lg text-xs text-zinc-500">
                    <Database className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
                    No documents indexed in this workspace yet. Create index tags below.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {documents.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => setViewingDoc(d)}
                        className="p-4 bg-white border border-zinc-200 hover:border-zinc-950 rounded-lg cursor-pointer transition-all flex items-center justify-between text-xs"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <FileText className="h-4 w-4 mt-0.5 shrink-0 text-zinc-500" />
                          <div className="min-w-0">
                            <span className="font-semibold text-zinc-950 uppercase truncate block">
                              {d.title}
                            </span>
                            <span className="text-[9px] font-mono text-zinc-400 uppercase block mt-1">
                              Section: {d.section} • {new Date(d.uploaded_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {d.drive_id && (
                            <span className="text-[8px] font-mono uppercase bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded">
                              Google Drive
                            </span>
                          )}
                          <button
                            onClick={(e) => handleDeleteDocument(d.id, e)}
                            className="p-1 text-zinc-400 hover:text-red-600 transition-all"
                            title="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Upload / Indexing Widget */}
          <div className="space-y-6">
            <div className="p-1">
              <h3 className="text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-wider mb-3">Index Legal Document</h3>
              
              <form onSubmit={handleMockUpload} className="space-y-4">
                
                {oauthStep === "idle" && (
                  <button
                    type="button"
                    onClick={handleOauthConnect}
                    className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-zinc-300 hover:border-zinc-600 bg-white hover:bg-zinc-50 text-[10px] font-mono uppercase font-bold rounded text-zinc-700 transition-all"
                  >
                    <Plus className="h-4 w-4 text-zinc-500" />
                    Select from Google Drive (OAuth)
                  </button>
                )}

                {oauthStep === "connecting" && (
                  <div className="py-2.5 flex items-center justify-center gap-2 bg-white border border-zinc-200 rounded text-[10px] font-mono text-zinc-500">
                    <RefreshCw className="h-4 w-4 animate-spin text-zinc-900" />
                    CONNECTING GOOGLE DRIVE OAUTH CLIENT...
                  </div>
                )}

                {oauthStep === "ready" && (
                  <div className="py-2.5 flex items-center justify-center gap-2 bg-green-50 border border-green-300 rounded text-[10px] font-mono font-bold text-green-800">
                    <Check className="h-4 w-4 text-green-700" />
                    CONNECTED TO USER GOOGLE DRIVE
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase font-bold text-zinc-500">Document Title / Citation:</label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g. Non-Disclosure Agreement_Corp_2025"
                    className="w-full p-2 border border-zinc-300 rounded text-xs focus:outline-none focus:border-zinc-800 text-zinc-900 bg-white font-sans"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase font-bold text-zinc-500">Extracted Document Text:</label>
                  <textarea
                    value={uploadText}
                    onChange={(e) => setUploadText(e.target.value)}
                    placeholder="Paste verbatim legal agreement text, contract clauses, or judicial opinions to chunk and index semantically..."
                    className="w-full h-32 p-2 border border-zinc-300 rounded text-xs focus:outline-none focus:border-zinc-800 text-zinc-900 bg-white font-sans resize-none leading-relaxed"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isUploading || !uploadTitle.trim() || !uploadText.trim()}
                  className="w-full py-2 bg-zinc-950 hover:bg-zinc-900 text-white font-mono uppercase text-[10px] font-bold rounded shadow transition-all disabled:opacity-40 cursor-pointer"
                >
                  {isUploading ? "Generating Vector Chunks..." : "Index materials via pgvector"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Document Text Viewer modal */}
      {viewingDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
          <div className="bg-white border border-zinc-300 rounded-lg shadow-xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden animate-fade-in text-zinc-900">
            <div className="px-6 py-4 bg-zinc-950 text-white flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono uppercase text-zinc-400 block">Library Index Reader</span>
                <h3 className="text-xs font-semibold uppercase tracking-wider font-sans mt-0.5">{viewingDoc.title}</h3>
              </div>
              <button 
                onClick={() => setViewingDoc(null)}
                className="text-zinc-400 hover:text-white font-mono text-xs"
              >
                [Close]
              </button>
            </div>

            <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between text-[10px] font-mono text-zinc-500">
              <span>Section: {viewingDoc.section}</span>
              <span>Uploaded: {new Date(viewingDoc.uploaded_at).toLocaleString()}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 select-text bg-white">
              {viewingDoc.extracted_text}
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end">
              <button
                onClick={() => setViewingDoc(null)}
                className="px-4 py-1.5 text-[10px] font-mono uppercase font-bold text-white bg-zinc-950 hover:bg-zinc-900 rounded"
              >
                Close Reader
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Case Modal */}
      {showCreateCaseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateCase} className="bg-white border border-zinc-300 rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-fade-in text-zinc-900">
            <div className="px-6 py-4 bg-zinc-950 text-white flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider font-sans">Create Case Workspace</h3>
              <button 
                type="button"
                onClick={() => setShowCreateCaseModal(false)}
                className="text-zinc-400 hover:text-white font-mono text-xs"
              >
                [Close]
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-zinc-500 leading-relaxed font-sans mb-2">
                Creating a Case initializes a filtered workspace. Upon creation, Legal AI automatically runs a
                wide semantic similarity analysis and auto-attaches relevant wide library agreements based on your case context!
              </p>

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-zinc-500">Case Project Name:</label>
                <input
                  type="text"
                  value={newCaseName}
                  onChange={(e) => setNewCaseName(e.target.value)}
                  placeholder="e.g. Acme Corp Trade Secret Dispute"
                  className="w-full p-2 border border-zinc-300 rounded text-xs focus:outline-none focus:border-zinc-800 text-zinc-900 bg-white font-sans"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-zinc-500">Case Context / Description:</label>
                <textarea
                  value={newCaseDesc}
                  onChange={(e) => setNewCaseDesc(e.target.value)}
                  placeholder="Describe the litigation issues, employment terms, or copyright facts of the case to enable semantic auto-attachment..."
                  className="w-full h-24 p-2 border border-zinc-300 rounded text-xs focus:outline-none focus:border-zinc-800 text-zinc-900 bg-white font-sans resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateCaseModal(false)}
                className="px-4 py-1.5 text-[10px] font-mono uppercase font-bold border border-zinc-200 hover:bg-zinc-100 rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingCase || !newCaseName.trim()}
                className="px-4 py-1.5 text-[10px] font-mono uppercase font-bold text-white bg-zinc-950 hover:bg-zinc-900 rounded disabled:opacity-50"
              >
                {creatingCase ? "Analyzing Library & Creating..." : "Analyze & Create Case"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
