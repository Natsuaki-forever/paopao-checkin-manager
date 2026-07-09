import { CalendarDays } from "lucide-react";

const schedulePoints = ["09:00", "12:00", "15:00", "18:00"];

export function AuthVisual() {
  return (
    <section className="auth-visual" aria-label="签到计划示意图">
      <div className="auth-orbit" aria-hidden="true">
        <div className="auth-orbit-ring auth-orbit-ring-outer" />
        <div className="auth-orbit-ring auth-orbit-ring-inner" />
        <div className="auth-orbit-axis auth-orbit-axis-x" />
        <div className="auth-orbit-axis auth-orbit-axis-y" />
        {schedulePoints.map((time, index) => (
          <span className={`auth-time auth-time-${index + 1}`} key={time}>{time}</span>
        ))}
        <div className="auth-calendar-mark"><CalendarDays size={92} strokeWidth={1.35} /></div>
      </div>
    </section>
  );
}
