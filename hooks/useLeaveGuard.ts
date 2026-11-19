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
  const stageRef = useRef(stage);
  stageRef.current = stage;
  // Entering the editor adds a history entry, so Back stays in the app.
  useEffect(() => {
    if (stage !== "edit") return;
    if (window.history.state?.csg !== "edit") window.history.pushState({ csg: "edit" }, "");
  }, [stage]);
  // One listener for the page's whole life. It used to come and go with the editor, so the Back
  // that dropEditorEntry sends on Start over arrived after it was removed: the skip flag stayed
  // set and swallowed the user's next Back in the editor (and the Back after that left the app
  // without the save prompt).
  useEffect(() => {
    const onPop = () => {
      if (skipPopRef.current) {
        skipPopRef.current = false;
        return;
      }
      if (stageRef.current !== "edit") return;
      window.history.pushState({ csg: "edit" }, ""); // stay until the user decides
      void requestExitRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
