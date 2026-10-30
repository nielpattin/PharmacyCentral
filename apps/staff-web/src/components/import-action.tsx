import { useNavigate } from "@tanstack/react-router";

import { Button } from "@pharmacy/ui";

import { useSession } from "../auth.ts";
import { translateText } from "../i18n.ts";
import { canAccessSection } from "../permissions/section-access.ts";
import { pathForSection, type Section } from "../router.ts";

/**
 * The Data import entry point on the list it fills. Importing is a task on the records, not a place in the sidebar,
 * and only the role that owns that dataset sees the button.
 */
export const ImportAction = ({ section, label }: { section: Section; label: string }): React.JSX.Element | null => {
  const session = useSession();
  const navigate = useNavigate();
  if (!canAccessSection(section, session.roles ?? [])) return null;
  return (
    <Button variant="secondary" size="sm" onClick={() => void navigate({ to: pathForSection(section) })}>
      {translateText(label)}
    </Button>
  );
};
