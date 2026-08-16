import type { ReactNode } from "react";
import type { MobileTool } from "./MobileLauncher";
import MobileNotes from "./MobileNotes";
import MobileFlashcards from "./MobileFlashcards";
import MobileHabits from "./MobileHabits";
import MobileReminders from "./MobileReminders";
import MobileStudy from "./MobileStudy";
import MobileTeach from "./MobileTeach";
import MobileFocus from "./MobileFocus";
import MobileFiles from "./MobileFiles";
import MobileVoice from "./MobileVoice";
import MobileGrades from "./MobileGrades";
import MobileWhiteboard from "./MobileWhiteboard";
import MobileBrowser from "./MobileBrowser";
import MobileNtfy from "./MobileNtfy";
import MobileSettings from "./MobileSettings";
import MobileEditor from "./MobileEditor";
import MobileAtlas from "./MobileAtlas";
import MobileCrunch from "./MobileCrunch";
import MobileEcho from "./MobileEcho";
import { MobileContainer, MobileEmpty, MobileHeader } from "./MobileUi";

/** Optional payload carried when opening a tool (e.g. a note source for Study). */
export type MobileToolPayload = {
  // Study source descriptor — opened from Notes "Study" menu etc.
  study?: {
    mode?: "summarize" | "explain" | "flashcards" | "quiz" | "study_guide" | "study";
    sourceKind: "note" | "file" | "paste" | "url";
    sourceId?: string;
    sourceUrl?: string;
    sourceName?: string;
    text?: string;
  };
  // Files: open a specific folder
  files?: { folderId?: string };
};

const SCREENS: Partial<Record<MobileTool, (props: { onClose: () => void; onOpenTool: (tool: MobileTool, payload?: MobileToolPayload) => void; payload?: MobileToolPayload }) => ReactNode>> = {
  notes: (props) => <MobileNotes {...props} />,
  flashcards: (props) => <MobileFlashcards {...props} />,
  habits: (props) => <MobileHabits {...props} />,
  reminders: (props) => <MobileReminders {...props} />,
  study: (props) => <MobileStudy {...props} />,
  teach: (props) => <MobileTeach {...props} />,
  focus: (props) => <MobileFocus {...props} />,
  files: (props) => <MobileFiles {...props} />,
  voice: (props) => <MobileVoice {...props} />,
  grades: (props) => <MobileGrades {...props} />,
  whiteboard: (props) => <MobileWhiteboard {...props} />,
  browser: (props) => <MobileBrowser {...props} />,
  ntfy: (props) => <MobileNtfy {...props} />,
  settings: (props) => <MobileSettings {...props} />,
  editor: (props) => <MobileEditor {...props} />,
  atlas: (props) => <MobileAtlas {...props} />,
  crunch: (props) => <MobileCrunch {...props} />,
  echo: (props) => <MobileEcho {...props} />,
};

export default function MobileToolPage({
  tool,
  payload,
  onClose,
  onOpenTool,
}: {
  tool: MobileTool;
  payload?: MobileToolPayload | null;
  onClose: () => void;
  onOpenTool: (tool: MobileTool, payload?: MobileToolPayload) => void;
}) {
  const Screen = SCREENS[tool];
  if (!Screen) {
    return (
      <MobileContainer>
        <MobileHeader title={tool} subtitle="Coming soon" onClose={onClose} />
        <MobileEmpty text={`This tool is not available on mobile yet.`} />
      </MobileContainer>
    );
  }
  return <>{Screen({ onClose, onOpenTool, payload: payload ?? undefined })}</>;
}
