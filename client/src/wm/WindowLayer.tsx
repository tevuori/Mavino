import { useWindows } from "../store/windows";
import Window from "./Window";

export default function WindowLayer() {
  const windows = useWindows((s) => s.windows);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const visible = windows.filter((w) => w.workspaceId === activeWorkspaceId);

  // <Window> is memoized on the win object reference — the store creates a new
  // object only for windows that actually changed, so a drag/resize re-renders
  // just the dragged window's chrome, not every window and its app content.
  return (
    <>
      {visible.map((win) => (
        <Window key={win.id} win={win} />
      ))}
    </>
  );
}
