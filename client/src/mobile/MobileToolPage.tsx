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
import MobileVut from "./MobileVut";
import MobileWhiteboard from "./MobileWhiteboard";
import MobileBrowser from "./MobileBrowser";
import MobileNtfy from "./MobileNtfy";
import MobileSettings from "./MobileSettings";
import MobileEditor from "./MobileEditor";
import MobileMoodle from "./MobileMoodle";
import MobileAtlas from "./MobileAtlas";
import { MobileContainer, MobileEmpty, MobileHeader } from "./MobileUi";

const SCREENS: Partial<Record<MobileTool, (props: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) => ReactNode>> = {
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
  vut: (props) => <MobileVut {...props} />,
  whiteboard: (props) => <MobileWhiteboard {...props} />,
  browser: (props) => <MobileBrowser {...props} />,
  ntfy: (props) => <MobileNtfy {...props} />,
  settings: (props) => <MobileSettings {...props} />,
  editor: (props) => <MobileEditor {...props} />,
  moodle: (props) => <MobileMoodle {...props} />,
  atlas: (props) => <MobileAtlas {...props} />,
};

export default function MobileToolPage({
  tool,
  onClose,
  onOpenTool,
}: {
  tool: MobileTool;
  onClose: () => void;
  onOpenTool: (tool: MobileTool) => void;
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
  return <>{Screen({ onClose, onOpenTool })}</>;
}
