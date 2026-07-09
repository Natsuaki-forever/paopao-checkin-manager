import type { RunStatus } from "../../shared/types";
import { statusLabels, statusTone } from "../utils";

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`status status-${statusTone(status)}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

