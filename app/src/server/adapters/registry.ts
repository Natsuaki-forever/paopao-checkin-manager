import type { TaskTemplateId } from "../../shared/types.js";
import type { CheckinAdapter } from "./types.js";

export class AdapterRegistry {
  private readonly adapters = new Map<TaskTemplateId, CheckinAdapter>();

  constructor(adapters: CheckinAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: CheckinAdapter): void {
    if (this.adapters.has(adapter.templateId)) {
      throw new Error("执行模板已注册：" + adapter.templateId);
    }
    this.adapters.set(adapter.templateId, adapter);
  }

  get(templateId: TaskTemplateId): CheckinAdapter {
    const adapter = this.adapters.get(templateId);
    if (!adapter) throw new Error("执行模板不可用：" + templateId);
    return adapter;
  }

  has(templateId: TaskTemplateId): boolean {
    return this.adapters.has(templateId);
  }
}