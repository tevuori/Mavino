// ===== Shared PDF.js viewer =====
// Replaces the native browser PDF iframe with Mozilla PDF.js so Teach Me can
// jump to exact pages and search/highlight text reliably. Uses the official
// PDF.js viewer layer (EventBus + PDFLinkService + PDFFindController + PDFViewer)
// which gives us real control over page numbers and find highlighting.

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import * as pdfjsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

// The worker file is copied into public/ by the postinstall script.
pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;

interface PdfJsViewerProps {
  fileUrl: string;
  /** 1-based page to jump to. */
  page?: number;
  /** Text to search/highlight across the document. */
  searchText?: string;
  navigationKey?: number;
  /** Optional classes for the scrollable container. */
  className?: string;
  /** Called when the PDF fails to load. */
  onDocumentError?: (error: string) => void;
}

export function PdfJsViewer({
  fileUrl,
  page,
  searchText,
  navigationKey,
  className = "",
  onDocumentError,
}: PdfJsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const eventBusRef = useRef<any>(null);
  const findControllerRef = useRef<any>(null);
  const onDocumentErrorRef = useRef(onDocumentError);
  const [loaded, setLoaded] = useState(false);
  onDocumentErrorRef.current = onDocumentError;

  // Initialize the PDF.js viewer layer once per document.
  useEffect(() => {
    if (!containerRef.current || !viewerElementRef.current) return;
    const container = containerRef.current;
    const viewerElement = viewerElementRef.current;
    setLoaded(false);

    const eventBus = new pdfjsViewer.EventBus();
    const linkService = new pdfjsViewer.PDFLinkService({ eventBus });
    const findController = new pdfjsViewer.PDFFindController({ eventBus, linkService });
    const pdfViewer = new pdfjsViewer.PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1, // ENABLE
    });
    linkService.setViewer(pdfViewer);

    viewerRef.current = pdfViewer;
    eventBusRef.current = eventBus;
    findControllerRef.current = findController;

    const fitPage = () => {
      pdfViewer.currentScaleValue = "page-fit";
    };
    eventBus.on("pagesinit", fitPage);

    let destroyed = false;
    const loadingTask = pdfjs.getDocument({ url: fileUrl });
    loadingTask.promise
      .then((pdfDocument: any) => {
        if (destroyed) return;
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument);
        findController.setDocument(pdfDocument);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (!destroyed) onDocumentErrorRef.current?.(err instanceof Error ? err.message : String(err));
      });

    return () => {
      destroyed = true;
      eventBus.off("pagesinit", fitPage);
      viewerRef.current = null;
      eventBusRef.current = null;
      findControllerRef.current = null;
      try { loadingTask.destroy(); } catch { /* noop */ }
      try { pdfViewer.setDocument(null as any); } catch { /* noop */ }
      try { findController.setDocument(null as any); } catch { /* noop */ }
      try { linkService.setDocument(null as any); } catch { /* noop */ }
    };
  }, [fileUrl]);

  // Jump to the requested page once the document is loaded.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!loaded || !viewer || typeof page !== "number" || !Number.isInteger(page) || page < 1) return;
    const apply = () => {
      // pagesCount is 0 before pagesinit — setting currentPageNumber then
      // makes PDF.js throw "0 is not a valid page".
      if (viewer.pagesCount) viewer.currentPageNumber = Math.min(page, viewer.pagesCount);
    };
    if (viewer.pagesCount) {
      apply();
      return;
    }
    const bus = eventBusRef.current;
    bus?.on("pagesinit", apply);
    return () => { bus?.off("pagesinit", apply); };
  }, [loaded, page, navigationKey]);

  // Run/clear the find controller when search text changes.
  useEffect(() => {
    if (!loaded || !eventBusRef.current) return;
    const query = searchText?.trim();
    if (query) {
      eventBusRef.current.dispatch("find", {
        type: "",
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        matchDiacritics: false,
        findPrevious: false,
      });
    } else {
      // Clear any active find highlight.
      eventBusRef.current.dispatch("find", {
        type: "",
        query: "",
        highlightAll: false,
      });
    }
  }, [loaded, searchText, navigationKey]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 overflow-auto">
        <div ref={viewerElementRef} className="pdfViewer" />
      </div>
    </div>
  );
}
