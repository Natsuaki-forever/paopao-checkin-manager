import { CalendarRange, Filter, RotateCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  RunListResponse,
  RunRecord,
  RunStatus,
  TaskSummary,
} from "../../shared/types";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateTime, formatDuration } from "../utils";

export function RunsPage({ notify }: { notify: (message: string) => void }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [response, setResponse] = useState<RunListResponse>({ items: [], page: 1, pageSize: 20, total: 0 });
  const [selected, setSelected] = useState<RunRecord>();
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ taskId: "", status: "", trigger: "", date: "" });

  const load = async (page = 1) => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (filters.taskId) query.set("taskId", filters.taskId);
    if (filters.status) query.set("status", filters.status);
    if (filters.trigger) query.set("trigger", filters.trigger);
    if (filters.date) {
      query.set("from", new Date(`${filters.date}T00:00:00`).toISOString());
      query.set("to", new Date(`${filters.date}T23:59:59`).toISOString());
    }
    try {
      const [runs, taskResponse] = await Promise.all([
        api<RunListResponse>(`/api/runs?${query}`),
        tasks.length === 0 ? api<{ items: TaskSummary[] }>("/api/tasks") : Promise.resolve({ items: tasks }),
      ]);
      setResponse(runs);
      setTasks(taskResponse.items);
    } catch (error) {
      notify(error instanceof Error ? error.message : "加载运行记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reset = () => {
    setFilters({ taskId: "", status: "", trigger: "", date: "" });
    window.setTimeout(() => void load(1), 0);
  };
  const totalPages = Math.max(1, Math.ceil(response.total / response.pageSize));

  return (
    <div className="page-stack">
      <div className="page-heading"><div><h1>运行记录</h1><p className="page-subtitle">查看每一次定时或手动执行的结果与详细信息。</p></div></div>
      <section className="panel filter-panel">
        <div className="filter-title"><Filter size={19} />筛选记录</div>
        <div className="filters-grid">
          <label><span>站点</span><select value={filters.taskId} onChange={(event) => setFilters((value) => ({ ...value, taskId: event.target.value }))}><option value="">全部站点</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
          <label><span>状态</span><select value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}><option value="">全部状态</option><option value="success">签到成功</option><option value="already_checked">已签到</option><option value="failure">失败</option><option value="challenge">需要验证</option><option value="page_changed">页面变化</option><option value="session_expired">会话失效</option><option value="proxy_failure">代理失败</option></select></label>
          <label><span>触发方式</span><select value={filters.trigger} onChange={(event) => setFilters((value) => ({ ...value, trigger: event.target.value }))}><option value="">全部方式</option><option value="manual">手动执行</option><option value="scheduled">定时执行</option></select></label>
          <label><span>日期</span><div className="input-with-icon"><CalendarRange size={18} /><input type="date" value={filters.date} onChange={(event) => setFilters((value) => ({ ...value, date: event.target.value }))} /></div></label>
          <div className="filter-actions"><button type="button" className="button button-primary" onClick={() => void load(1)}><Search size={18} />查询</button><button type="button" className="button button-neutral" onClick={reset}><RotateCw size={18} />重置</button></div>
        </div>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>完成时间</th><th>站点</th><th>触发方式</th><th>结果</th><th>耗时</th><th>尝试</th><th>通知</th><th>操作</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8}><div className="empty-state">正在加载运行记录…</div></td></tr> : response.items.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.finishedAt)}</td><td><strong>{run.taskName}</strong></td><td>{run.trigger === "manual" ? "手动执行" : "定时执行"}</td><td><StatusBadge status={run.status} /></td><td>{formatDuration(run.durationMs)}</td><td>{run.attempt} 次</td><td>{notificationLabel(run.notificationResult)}</td><td><button type="button" className="text-link" onClick={() => setSelected(run)}>查看详情</button></td>
                </tr>
              ))}
              {!loading && response.items.length === 0 ? <tr><td colSpan={8}><div className="empty-state">没有符合条件的运行记录</div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="pagination"><span>共 {response.total} 条</span><div><button type="button" className="button button-neutral button-small" disabled={response.page <= 1} onClick={() => void load(response.page - 1)}>上一页</button><span>{response.page} / {totalPages}</span><button type="button" className="button button-neutral button-small" disabled={response.page >= totalPages} onClick={() => void load(response.page + 1)}>下一页</button></div></div>
      </section>
      {selected ? <RunDetail run={selected} onClose={() => setSelected(undefined)} /> : null}
    </div>
  );
}

function RunDetail({ run, onClose }: { run: RunRecord; onClose: () => void }) {
  return (
    <Modal title="运行详情" onClose={onClose}>
      <div className="modal-body detail-list">
        <Detail label="站点" value={run.taskName} /><Detail label="结果" value={<StatusBadge status={run.status} />} /><Detail label="触发方式" value={run.trigger === "manual" ? "手动执行" : "定时执行"} />{run.phase ? <Detail label="最终阶段" value={phaseLabel(run.phase)} /> : null}<Detail label="开始时间" value={formatDateTime(run.startedAt)} /><Detail label="完成时间" value={formatDateTime(run.finishedAt)} /><Detail label="耗时" value={formatDuration(run.durationMs)} /><Detail label="尝试次数" value={`${run.attempt} 次`} /><Detail label="通知结果" value={notificationLabel(run.notificationResult)} />{run.hasScreenshot ? <Detail label="失败截图" value={<a className="text-link" href={`/api/runs/${run.id}/screenshot`} target="_blank" rel="noreferrer">查看截图</a>} /> : null}<div className="detail-message"><span>结果信息</span><p>{run.message}</p></div>{run.errorDetail ? <div className="detail-message detail-error"><span>错误详情</span><p>{run.errorDetail}</p></div> : null}<div className="inline-info">记录不包含账号、密码、Cookie 或通知密钥。</div>
      </div>
      <footer className="modal-footer"><span /><button type="button" className="button button-primary" onClick={onClose}>关闭</button></footer>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function notificationLabel(result: RunRecord["notificationResult"]): string {
  if (result === "sent") return "发送成功";
  if (result === "simulated") return "模拟成功";
  if (result === "skipped") return "未启用";
  return "发送失败";
}

function phaseLabel(phase: NonNullable<RunRecord["phase"]>): string {
  if (phase === "queued") return "排队";
  if (phase === "login") return "登录";
  if (phase === "checkin") return "签到";
  return "通知";
}
