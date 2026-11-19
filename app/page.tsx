"use client";

// The app: start screen, "Reading your document…", or the editor. State and actions live in
// hooks/useCaseStudyEditor.ts; the pieces of the screen in components/editor/.

import RevampSheet, { C as SHEET } from "@/components/revamp/RevampSheet";
import DataImport from "@/components/revamp/DataImport";
import { DevKeynote } from "@/components/editor/Brand";
import { AiBanner, CmsBanner, MapErrorBanner, NoticeBanner, TruthBanner } from "@/components/editor/EditorBanners";
import { EditorStyles } from "@/components/editor/EditorStyles";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { SavePrompt } from "@/components/editor/SavePrompt";
import { SheetFooter } from "@/components/editor/SheetFooter";
import { MappingScreen, StartScreen } from "@/components/editor/StartScreen";
import { A4_W, BG, MUTED, TEXT } from "@/components/editor/theme";
import { useCaseStudyEditor } from "@/hooks/useCaseStudyEditor";

export default function Page() {
  const ed = useCaseStudyEditor();

  if (ed.stage === "upload") {
    return <StartScreen mapError={ed.mapError} onStartImport={ed.startFromImport} onStartBlank={ed.startBlank} onFile={ed.handleFile} />;
  }

  if (ed.stage === "mapping") return <MappingScreen />;

  return (
    <div className="app-root" style={{ minHeight: "100vh", background: BG, color: TEXT }}>
      <EditorStyles />

      <EditorToolbar
        cs={ed.cs}
        onStartOver={() => void ed.requestExit()}
        hasImportSource={ed.hasImportSource}
        dirty={ed.dirty}
        saveState={ed.saveState}
        onSave={() => void ed.saveSheetNow()}
        showImport={ed.showImport}
        onToggleImport={() => ed.setShowImport((v) => !v)}
        canDraft={ed.canDraft}
        aiState={ed.aiState}
        onDraft={() => ed.draftWithAi(false)}
        cmsState={ed.cmsState}
        hasCmsDraft={ed.hasCmsDraft}
        onSendToCms={ed.sendToCms}
        onPrint={ed.printNow}
      />

      {ed.showImport && (
        <DataImport
          up={ed.up}
          sheet={ed.cs}
          onClose={() => ed.setShowImport(false)}
          onImported={ed.onImported}
          onSource={ed.onSource}
          onLoadSaved={ed.loadSaved}
          prepareSwitch={ed.prepareSwitch}
        />
      )}

      {ed.saveAsk && <SavePrompt kind={ed.saveAsk.kind} name={ed.saveAsk.name} onChoose={ed.answerSave} />}

      <TruthBanner
        active={ed.truthActive}
        checking={ed.truthChecking}
        findings={ed.truthFindings}
        keptCount={ed.truthKeptCount}
        onRemove={ed.removeTruthFindings}
        onKeep={ed.keepTruthFinding}
        onDismiss={ed.dismissTruthCheck}
      />
      <AiBanner aiState={ed.aiState} aiMsg={ed.aiMsg} aiDrafted={ed.aiDrafted} onMarkReviewed={ed.markReviewed} />
      <CmsBanner cmsState={ed.cmsState} cmsMsg={ed.cmsMsg} cmsLink={ed.cmsLink} />
      <NoticeBanner notice={ed.notice} />
      <MapErrorBanner mapError={ed.mapError} />

      <div
        className="edit-hint"
        style={{ maxWidth: 900, margin: "10px auto 0", padding: "0 16px", fontSize: 12, color: MUTED, textAlign: "center" }}
      >
        Click any text to edit it. Dashed sections are empty and stay out of the PDF and the CMS page until filled. &quot;Download PDF&quot; prints exactly what you see, minus the edit controls.
      </div>

      <div className="app-shell" style={{ padding: "24px 16px 80px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: A4_W }}>
          <div
            ref={ed.pdfPageRef}
            className="pdf-page"
            style={{
              width: A4_W,
              maxWidth: "100%",
              background: SHEET.white,
              boxShadow: "0 4px 40px rgba(0,0,0,0.5)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <RevampSheet r={ed.cs} up={ed.up} pending={ed.pending} />
            <SheetFooter />
          </div>
          {/* Inside the sheet's column (.app-shell is a flex row), outside .pdf-page. */}
          <DevKeynote />
        </div>
      </div>
    </div>
  );
}
