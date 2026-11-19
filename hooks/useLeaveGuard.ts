// Leaving the editor (Start over or the browser's Back button) asks first when there are unsaved
// changes. Back is kept inside the app: it acts like Start over instead of leaving the page.

import { useEffect, useRef } from "react";

export function useLeaveGuard({
  stage,
  requestExit,
  isDirty,
}: {
  stage: "upload" | "mapping" | "edit";
  requestExit: () => Promise<void>;
  isDirty: () => boolean;
}) {
  const skipPopRef = useRef(false);
  const requestExitRef = useRef(requestExit);
  requestExitRef.current = requestExit;
  useEffect(() => {
    if (stage !== "edit") return;
    if (window.history.state?.csg !== "edit") window.history.pushState({ csg: "edit" }, "");
    const onPop = () => {
      if (skipPopRef.current) {
        skipPopRef.current = false;
        return;
      }
      window.history.pushState({ csg: "edit" }, ""); // stay until the user decides
      void requestExitRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stage]);
  // Closing or reloading the tab: browsers only allow their own generic "Leave site?" warning.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drops the history entry the editor added, so the app's own Back handling ignores that move.
  const dropEditorEntry = () => {
    if (typeof window !== "undefined" && window.history.state?.csg === "edit") {
      skipPopRef.current = true;
      window.history.back(); // drop the history entry the editor added
    }
  };

  return { dropEditorEntry };
}
