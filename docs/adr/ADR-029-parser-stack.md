# ADR-029: Parser Stack

**ADR-ID:** ADR-029
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Knowledge Ingestion** as an "Architecture Contract — NOW" capability (Phase B B4 item #13). Hotel properties ingest a long tail of document formats: PDF, DOCX, XLSX, PPTX, HTML, TXT, Markdown, EML, MSG, RTF, ODT/ODS/ODP, CSV, images (PNG/JPEG/TIFF for scanned docs), legacy .doc/.ppt/.xls (research §3.1). The existing SmartAgentics repository has no `DocumentParser` interface and no parser implementations — research B4 #13.

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §3) surveyed the open-source parser landscape and concluded that no single library covers the full hotel-document format surface with the constraints SmartAgentics imposes (offline-first Windows installer, no Python runtime by default, no JVM by default, permissive licensing only). The recommended architecture is a **two-tier parser strategy** plus an opt-in OCR tier:

- **Tier-1 (Native Node.js, no JVM, no Python)** — `mammoth` (DOCX→HTML), `pdf-parse` / `pdfjs-dist` (PDF text), `officeparser` (DOCX/PPTX/XLSX/ODT/RTF/CSV), `turndown` (HTML→Markdown), `eml-parser` / `mailparser` (EML/MSG), `@langchain/textsplitters` (markdown-aware splitter — also referenced by ADR-026 and ADR-037). Covers **>90% of hotel-document formats** with zero external runtime dependencies; runs inside the Next.js process.
- **Tier-2 (Sidecar, on-demand, opt-in)** — **Apache Tika** (Apache-2.0, Java JAR spawned as a localhost HTTP server) for the "long tail" of formats Tika uniquely supports (legacy .doc/.ppt/.xls, OLE2, RTF, iWorks, WordPerfect, Visio, CAD, audio metadata). Tika requires a JVM; bundled via a portable JRE only when the operator opts in.
- **Tier-3 (OCR for scanned PDFs/images, opt-in)** — **Tesseract.js** (Apache-2.0, pure WASM, runs in the Next.js process, no native deps) for low-volume OCR; **OCRmyPDF** (Mozilla-style license, Python) as a batch sidecar for high-volume scanned-PDF digitization. PaddleOCR and Surya are rejected for Phase 1 (model-weight licensing friction and Python/VLM runtime complexity — research §3.2.10, §3.2.11).

The canonical intermediate representation is **Markdown** — preserves heading hierarchy, lists, tables; optimal input for the markdown-aware recursive chunker (ADR-026). The `DocumentIngester` (ADR-028) calls a `DocumentParser` after file hashing (ADR-034) and before chunking (ADR-026); the parser emits a `ParsedDocument` with `markdown`, `DocumentMetadata`, and `warnings[]` (research §10).

## 2. Problem

The architectural problem: **define a `DocumentParser` SDK interface and a tiered parser strategy that (a) routes each file to the appropriate parser based on format + size + opt-in configuration, (b) makes Tier-1 native Node.js the default with zero external runtime dependencies (no JVM, no Python) for the Phase 1 Windows installer, (c) makes Tier-2 (Apache Tika sidecar) opt-in — properties that never ingest legacy formats never install the JVM, (d) makes Tier-3 (Tesseract.js WASM OCR, OCRmyPDF Python sidecar) opt-in for scanned-image and scanned-PDF ingestion, (e) emits a canonical `ParsedDocument` with `markdown` (the canonical IR), `DocumentMetadata` (title, author, pageCount, language, etc.), and `warnings[]` (e.g., "table extraction failed on page 4"), (f) routes everything to Markdown as the canonical intermediate representation (preserves heading hierarchy for ADR-026 chunking), (g) rejects parsers with non-permissive model-weight licenses (Surya RAIL-M weights — research FC-3.4), (h) rejects frameworks with heavy dependency trees as runtime dependencies (unstructured.io 12 GB Docker footprint; LangChain/LlamaIndex full surface — research §3.5, ADR-037), (i) bundles `@langchain/textsplitters` as the only LangChain-family runtime dependency (small, focused, MIT-licensed — research §4.3), (j) is invoked by the `DocumentIngester` (ADR-028) after raw file hashing and before chunking, and (k) records `parserUsed` + `parseWarnings` on every `KnowledgeDocument` row for auditability.** This ADR defines the parser contract; the ingestion pipeline orchestration is owned by ADR-028.

## 3. Options

### Option A: unstructured.io as the universal parser

Apache-2.0, "60+ file types", Python only with Docker recommended; production users report 12 GB+ memory footprint (Reddit r/Rag self-hosted Unstructured API memory report). Rejected for Phase 1 — Python runtime + Docker footprint violates the offline Windows installer constraints; memory footprint is unacceptable for a hotel server. Research §3.2.1.

### Option B: Apache Tika as the universal parser (single tier)

Apache-2.0, "1000+ file types", stable HTTP server mode, ~300 MB Docker image. Rejected as the Phase 1 default — requires a JVM (operational burden on Windows installer); Tika's PDF text extraction is less layout-aware than Docling; the Tier-1 native Node.js stack covers >90% of hotel formats without a JVM. Reserved as Tier-2 opt-in sidecar for the long tail (research §3.2.2).

### Option C: Docling (IBM) as the universal parser

MIT-licensed, best-in-class layout-aware PDF parsing (RT-DETR model) and table-structure recognition, explicitly supports "local execution capabilities for sensitive data and air-gapped environments" (Docling README). Rejected for Phase 1 — Python only (`pip install docling`, Python 3.10+); the model-weight download and Python runtime violate the Phase 1 installer constraints. Recommended as the Phase 2+ Tier-2 Python sidecar when properties demand complex-PDF ingestion at scale (research §3.2.3, §3.2.12).

### Option D: Surya (OCR + layout VLM)

Apache-2.0 code + modified AI Pubs Open RAIL-M model weights. 650M-param VLM, 83.3% on olmOCR-bench. **Rejected for Phase 1** — research FC-3.4: the RAIL-M weights are "free for research, personal use, and startups under $5M funding/revenue" — SmartAgentics' hotel-chain customers may exceed that threshold, creating a known future licensing cliff. Re-evaluate only if (a) Surya publishes fully-permissive weights, or (b) SmartAgentics negotiates a commercial license. Research §3.2.11.

### Option E: PaddleOCR (OCR alt)

Apache-2.0 code; leads on every test category (96.3% OmniDocBench v1.6). **Rejected for Phase 1** — Python only; PaddlePaddle runtime dependency is heavy; setup complexity exceeds Phase 1 budget. Reserved for Phase 2+ evaluation if Tesseract.js accuracy proves insufficient on real hotel scans (research §3.2.10).

### Option F: LibreOffice headless / Pandoc as runtime converters

LibreOffice headless converts any format LibreOffice can open; Pandoc converts Markdown↔DOCX↔HTML↔LaTeX. **Both rejected as runtime dependencies for Phase 1** — large install footprint (LibreOffice ~700 MB; Pandoc Haskell binary), deployment complexity. Pandoc may be used as a **build-time tool** for shipping pre-converted reference SOPs. LibreOffice headless is reserved for Tier-3 batch conversion of legacy formats when Tika is unavailable (research §3.2.13).

### Option G: Two-tier native Node.js + opt-in sidecars (Tika Tier-2, Tesseract.js + OCRmyPDF Tier-3)

Tier-1 native Node.js (mammoth, pdf-parse, officeparser, turndown, eml-parser, @langchain/textsplitters, tesseract.js) covers >90% of hotel formats with zero external runtime dependencies. Tier-2 (Tika sidecar, JVM) opt-in for the long tail of legacy formats. Tier-3 (Tesseract.js WASM in-process for low-volume OCR; OCRmyPDF Python batch sidecar for high-volume scanned-PDF) opt-in. Canonical IR = Markdown. Per research §3.3 Recommended parser stack and §3.4 ingestion pipeline.

## 4. Decision

Adopt **Option G**. The Parser Stack architectural contract is:

1. **SDK interface** — A `DocumentParser` interface in `packages/sdk/src/ai/knowledge/DocumentParser.ts` (research §10):

   ```
   DocumentParser {
     readonly name: string;
     readonly supportedFormats: readonly string[];  // mime types
     parse(input: Buffer | string, opts: ParseOptions): Promise<ParsedDocument>;
   }

   ParseOptions {
     filename?: string;
     ocrEnabled?: boolean;
     extractTables?: boolean;
     maxPages?: number;
   }

   ParsedDocument {
     markdown: string;            // canonical intermediate representation
     metadata: DocumentMetadata;
     warnings: string[];
   }

   DocumentMetadata {
     title?, author?, subject?, keywords?: string[],
     language?, pageCount?, wordCount?,
     createdAt?: Date, modifiedAt?: Date,
     sourceApplication?: string;
   }
   ```

2. **Tier-1 parsers (Phase 1 must, native Node.js, no JVM/Python)** — Implemented in `packages/sdk/src/ai/knowledge/parsers/`:

   | Parser               | Library                     | License    | Formats                            | Notes                                                                                                                            |
   | -------------------- | --------------------------- | ---------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `MammothParser`      | `mammoth`                   | BSD-2      | DOCX→HTML                          | Mature, popular. Then `turndown` converts HTML→Markdown.                                                                         |
   | `PdfParseParser`     | `pdf-parse`                 | MIT        | PDF text                           | Pure TypeScript, no Node-version friction. `pdfjs-dist` (Mozilla PDF.js) as fallback when image/structured extraction is needed. |
   | `OfficeParserParser` | `officeparser`              | MIT        | DOCX/PPTX/XLSX/ODT/ODP/ODS/RTF/CSV | One library for all Office formats; Tier-1 fallback for PPTX/XLSX where mammoth doesn't reach.                                   |
   | `TurndownParser`     | `turndown`                  | MIT        | HTML→Markdown                      | De facto standard.                                                                                                               |
   | `EmlParserParser`    | `eml-parser` + `mailparser` | MIT        | EML/MSG                            | Extracts headers + attachments.                                                                                                  |
   | `TesseractJsParser`  | `tesseract.js`              | Apache-2.0 | PNG/JPEG/TIFF OCR                  | Pure WASM, no native deps. Opt-in (low-volume scanned-image ingestion).                                                          |
   | (splitter)           | `@langchain/textsplitters`  | MIT        | markdown-aware chunker             | The only LangChain-family runtime dependency (see ADR-037). Also referenced by ADR-026.                                          |

3. **Tier-2 parser (opt-in sidecar)** — `TikaSidecarParser` in `packages/sdk/src/ai/knowledge/parsers/TikaSidecarParser.ts`:
   - **Apache Tika** (Apache-2.0, 1000+ formats) spawned as a localhost HTTP server (`tika-server -spawnChild` mode, the recommended production mode since Tika 2.0 per TIKA-3247).
   - Node.js integrates via HTTP (`@shelf/tika-text-extract` or `node-tika` ICIJ bridge).
   - **Opt-in**: properties that don't ingest legacy formats (.doc/.ppt/.xls, OLE2, RTF, iWorks, WordPerfect, Visio, CAD, audio metadata) never install the JVM.
   - **JVM bundling**: portable JRE included in the installer only when the operator opts in (research risk R-3.5).
   - Footprint: ~300 MB Docker image (vs ~12 GB for Unstructured per Reddit report — research §3.2.1).

4. **Tier-3 parsers (opt-in OCR)** —
   - `TesseractJsParser` (Tier-1 list above) for low-volume scanned-image OCR — runs in the Next.js process, no native deps, no Python.
   - **OCRmyPDF** (Mozilla-style / MPL-2.0 license, Python) as a batch sidecar for high-volume scanned-PDF digitization. Adds an OCR text layer to scanned PDFs (uses Tesseract under the hood). Phase 2+ opt-in for properties that scan paper documents at scale (research §3.2.9).
   - **Critical scope note**: Tesseract.js does NOT support PDF files directly — for scanned PDFs, must convert pages to images first (pdfjs-dist can rasterize) or use OCRmyPDF which does this internally (research §3.2.8).

5. **Format routing** — `DocumentIngester` (ADR-028) determines format from magic bytes (fallback to extension) and routes to the appropriate parser:
   - DOCX → `MammothParser` → HTML → `TurndownParser` → Markdown.
   - PDF (text-based) → `PdfParseParser` → Markdown.
   - PDF (scanned, image-only) → `TesseractJsParser` (rasterize first) or OCRmyPDF batch sidecar (Tier-3 opt-in).
   - PPTX/XLSX/ODT/RTF/CSV → `OfficeParserParser` → Markdown.
   - HTML → `TurndownParser` → Markdown.
   - EML/MSG → `EmlParserParser` → Markdown.
   - PNG/JPEG/TIFF → `TesseractJsParser` → Markdown (OCR).
   - Legacy .doc/.ppt/.xls, OLE2, RTF, iWorks, WordPerfect, Visio, CAD → `TikaSidecarParser` (Tier-2 opt-in) → Markdown.
   - Fallback → `TikaSidecarParser` if available; otherwise mark `parseWarnings` and surface to UI for manual review.

6. **Markdown canonical IR** — Every parser emits Markdown. Rationale (research §0): Markdown preserves heading hierarchy (`#`, `##`, `###`), lists, tables; it's the optimal input for the markdown-aware recursive chunker (ADR-026). Markdown normalization (strip nav cruft, normalize headings, drop empty sections) happens after parsing and before chunking (research §3.4 step 7).

7. **PDF table extraction (Phase 1 mitigation)** — Per research §3.2.12, "no robust pure-Node.js PDF table extractor exists today." Phase 1 mitigation: (a) for native (non-scanned) PDFs, use `pdf.js-extract` to get text + bbox, then run a simple "consecutive cells in same Y-band → row" heuristic for simple tables; (b) for complex tables, mark as "needs manual review" via `parseWarnings` and offer the user a Tier-2 (Docling, Phase 2+) re-parse. Phase 2+: bundle Docling as the proper table-extraction solution (research §3.2.12).

8. **`parserUsed` + `parseWarnings` auditability** — `KnowledgeDocument.parserUsed` (enum: MAMMOTH | PDF_PARSE | OFFICE_PARSER | TURNDOWN | EML_PARSER | TIFF_JS | TIKA | DOCLING | OCRMYPDF | ...) and `KnowledgeDocument.parseWarnings` (JSON array of warnings, e.g., "table extraction failed on page 4") are recorded on every ingested document for auditability and to drive manual-review queues (research §9 Prisma schema).

9. **Tier-2/Tier-3 sidecar lifecycle** — Sidecars (Tika JVM, OCRmyPDF Python) are lazy-started on first need and idle-shutdown after a timeout to avoid consuming RAM on the hotel server when not in use (research risk R-3.13). The installer's `FeatureFlag` system gates whether Tier-2/Tier-3 are installed at all.

10. **Rejected parsers (consolidated)** — Surya (RAIL-M weights, FC-3.4), PaddleOCR (Python + PaddlePaddle runtime, Phase 2+ eval only), unstructured.io (12 GB Docker footprint, Python-only), LangChain.js/LlamaIndex.TS as runtime (heavy dependency trees, silent fallback risk — see ADR-037), AnythingLLM (GUI app, not a library), RAGFlow (server-based, not embedded-friendly), LibreOffice headless as runtime (large footprint), Pandoc as runtime (Haskell binary, build-time only).

## 5. Rationale

- **Tier-1 native Node.js covers >90% of hotel formats with zero external runtime deps** — mammoth + pdf-parse + officeparser + turndown + eml-parser + tesseract.js collectively cover the hotel-document surface with no JVM, no Python, no Docker. Critical for the offline Windows installer (research §3.3).
- **Markdown canonical IR** — Markdown preserves heading hierarchy, lists, tables; optimal input for the markdown-aware recursive chunker (ADR-026). Every parser emits Markdown (research §0, §3.4).
- **Tika as Tier-2 opt-in sidecar** — Best-in-class for the long tail of legacy formats (1000+ formats); Apache-2.0; stable HTTP server mode; ~300 MB footprint (vs 12 GB for Unstructured). JVM is the main drawback, mitigated by making Tier-2 opt-in and bundling a portable JRE only when the operator opts in (research §3.2.2).
- **Tesseract.js for Phase 1 OCR** — Apache-2.0, pure WASM, runs in the Next.js process, no native deps. Scope limitation: doesn't support PDFs directly — must rasterize first or use OCRmyPDF for batch PDF OCR (research §3.2.8).
- **OCRmyPDF for batch scanned-PDF OCR** — Mozilla-style license, Python sidecar, reserved for properties that scan paper documents at scale. Phase 2+ opt-in (research §3.2.9).
- **Docling reserved for Phase 2+** — Best-in-class layout-aware PDF + table extraction (RT-DETR model); MIT-licensed; explicitly supports air-gapped deployment. Python only — rejected for Phase 1 installer, recommended as Phase 2+ Tier-2 Python sidecar (research §3.2.3, §3.2.12).
- **Rejecting Surya (FC-3.4)** — Model weights are under modified AI Pubs Open RAIL-M license; "free for research, personal use, and startups under $5M funding/revenue" — a known licensing cliff for hotel-chain customers. Re-evaluate only if weights are re-licensed permissively or SmartAgentics negotiates a commercial license (research §3.2.11).
- **Rejecting PaddleOCR for Phase 1** — Python only; PaddlePaddle runtime heavy; setup complexity exceeds Phase 1 budget. Reserved for Phase 2+ evaluation if Tesseract.js accuracy proves insufficient (research §3.2.10).
- **Rejecting unstructured.io** — Python only, Docker recommended, 12 GB+ memory footprint in production. Violates the offline Windows installer constraints (research §3.2.1).
- **Rejecting LibreOffice headless / Pandoc as runtime** — Large install footprint, deployment complexity. LibreOffice reserved for Tier-3 batch conversion; Pandoc build-time only (research §3.2.13).
- **`@langchain/textsplitters` is the only LangChain-family runtime dep** — Small, focused, MIT-licensed; the markdown-aware recursive splitter. See ADR-037 for the full framework-policy decision (research §4.3).
- **`parserUsed` + `parseWarnings` auditability** — Every ingested document records which parser produced it and what warnings arose — drives manual-review queues and operational visibility (research §9, risk R-3.2).
- **Tier-2/Tier-3 sidecars are lazy-started + idle-shutdown** — Avoids consuming RAM on the hotel server when not in use (research risk R-3.13).
- **PDF table extraction is a known Phase 1 weakness** — Mitigation: heuristic for simple tables; "needs manual review" for complex tables; Phase 2+ bundle Docling (research §3.2.12, risk R-3.2).

## 6. Consequences

**Positive**:

- Single-process Phase 1 deployment — Tier-1 parsers run inside Next.js, no JVM, no Python.
- > 90% of hotel-document formats covered by Tier-1 with permissive licenses.
- Markdown canonical IR preserves document hierarchy for ADR-026 chunking.
- Tier-2 (Tika) and Tier-3 (OCRmyPDF) are opt-in — properties that don't need them never install the JVM/Python.
- `parserUsed` + `parseWarnings` on every `KnowledgeDocument` row drives auditability and manual-review queues.
- `DocumentParser` interface is swappable — a new parser (Docling Phase 2+) is added behind the same interface.
- Tesseract.js WASM runs in-process — no native compilation, no separate process for low-volume OCR.

**Negative / obligations**:

- Phase 1 must implement 6 Tier-1 parsers (`MammothParser`, `PdfParseParser`, `OfficeParserParser`, `TurndownParser`, `EmlParserParser`, `TesseractJsParser`) — estimated 5–7 days (research §13.3).
- PDF table extraction in pure Node.js is weak — risk R-3.2 (High likelihood, Medium impact). Mitigation: heuristic + manual-review queue + Phase 2+ Docling.
- Tesseract.js OCR accuracy may be insufficient for low-quality scanned hotel docs — risk R-3.1 (Medium/Medium). Mitigation: Tier-3 OCRmyPDF / Docling fallback (Phase 2+); manual review queue.
- Tier-2 Tika sidecar requires a JVM — risk R-3.5 (Medium/Medium). Mitigation: opt-in only; bundle portable JRE only when the operator opts in; document install steps.
- Tier-2/Tier-3 sidecar processes consume RAM on the hotel server when running — risk R-3.13 (Medium/Low). Mitigation: lazy-start on first need; idle-shutdown after timeout; `FeatureFlag` gates installation.
- Tesseract.js does NOT support PDF files directly — for scanned PDFs, must rasterize pages first (pdfjs-dist) or use OCRmyPDF batch sidecar (research §3.2.8).
- `@langchain/textsplitters` is the only LangChain-family runtime dependency — must be pinned to a specific version and audited on upgrade (ADR-037).
- Format detection by magic bytes may mis-classify unusual files — fallback to extension-based detection; `parseWarnings` surfaces mis-classifications.
- Markdown normalization (strip nav cruft, normalize headings) must happen after parsing — an extra pipeline step (research §3.4 step 7).
- Tier-3 OCRmyPDF Python sidecar requires Python on the hotel server — opt-in only; installer must document Python dependency.

**Dependencies on other ADRs**:

- Depends on ADR-028 (Knowledge Base Architecture) — `DocumentIngester` orchestrates parse → chunk → embed → index; `parserUsed` + `parseWarnings` on `KnowledgeDocument`.
- Depends on ADR-026 (Document Chunking) — `MarkdownHeaderChunker` consumes the parser's Markdown output; `@langchain/textsplitters` is shared.
- Depends on ADR-037 (RAG Framework Policy) — `@langchain/textsplitters` is the only LangChain-family runtime dependency.
- Depends on ADR-005 (Prisma) for `KnowledgeDocument.parserUsed` + `parseWarnings` columns.
- Feeds ADR-034 (Versioning & Incremental Re-index) — re-ingestion re-parses via the same `DocumentParser`.
- Feeds ADR-036 (Offline Ingestion Channels) — every channel (UI upload, chokidar watch, batch CLI, USB) calls the same `DocumentParser`.
- Feeds Stream 7 (Offline Sync) — parser output is cached via `contentHash` to avoid re-parsing on sync.
- Feeds Stream 8 (Security & Governance) — `parseWarnings` is an audit surface for ingestion failures.
- Compatible with ADR-013 (Observability Strategy) — parser operations are traced (format, parser, duration, warnings count).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Tesseract.js OCR accuracy proves insufficient on real hotel scans** (<80% accuracy on a sample set) — escalate to PaddleOCR (Phase 2+ eval) or OCRmyPDF batch sidecar as default.
2. **PDF table extraction quality is unacceptable for rate-sheet ingestion** — bundle Docling (Phase 2+) as the proper table-extraction solution.
3. **A hotel-chain customer demands layout-aware PDF parsing at scale** (e.g., 1000+ multi-column PDFs) — bundle Docling as a Tier-2 Python sidecar.
4. **Surya publishes fully-permissive model weights** (or SmartAgentics negotiates a commercial license) — re-evaluate Surya as the OCR + layout engine (research FC-3.4).
5. **A new hotel-document format** becomes primary (e.g., Apple Keynote, Visio diagrams) — add a Tier-1 parser if a permissive Node.js library exists; otherwise route to Tika Tier-2.
6. **Tier-2 Tika adoption is high** (>30% of properties opt in) — consider bundling the portable JRE by default instead of opt-in.
7. **`@langchain/textsplitters` introduces a breaking change or unwanted transitive dependency** — pin to a stable version; evaluate forking the splitter or replacing with a SmartAgentics-owned implementation.
8. **A new OCR engine** (e.g., a permissive VLM-based OCR) becomes viable — extend the `DocumentParser` interface; add as a new Tier.
9. **A format-specific parser** (e.g., a dedicated rate-sheet parser) becomes justified — add as a Tier-1 parser behind the `DocumentParser` interface.
10. **Annually**, as part of the regular ADR review cycle.
