import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "确认",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <span className={danger ? "confirm-icon confirm-danger" : "confirm-icon"}><AlertTriangle size={22} /></span>
      <div><h2 id="confirm-title">{title}</h2><p id="confirm-message">{message}</p></div>
      <footer><button className="button button-neutral" type="button" onClick={onCancel}>取消</button><button className={`button ${danger ? "button-danger" : "button-primary"}`} type="button" onClick={onConfirm}>{confirmLabel}</button></footer>
    </section>
  </div>;
}
