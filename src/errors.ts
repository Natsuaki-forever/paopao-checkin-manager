import type { RunStatus } from "./types.js";

export class CheckinError extends Error {
  constructor(
    message: string,
    public readonly status: RunStatus,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AuthRequiredError extends CheckinError {
  constructor(message = "登录会话已失效，需要重新进行人工登录") {
    super(message, "auth_required");
  }
}

export class ChallengeDetectedError extends CheckinError {
  constructor(message = "检测到验证码或人机验证，已停止自动操作") {
    super(message, "challenge");
  }
}

export class PageChangedError extends CheckinError {
  constructor(message = "未找到明确的签到入口，页面结构可能已变化") {
    super(message, "page_changed");
  }
}

export class RetryableCheckinError extends CheckinError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "retryable_failure", true, options);
  }
}

export class SessionExpiredError extends CheckinError {
  constructor(
    message = "浏览器会话已失效，账号密码回退登录失败",
    options?: ErrorOptions,
  ) {
    super(message, "session_expired", false, options);
  }
}

export class ProxyFailureError extends CheckinError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "proxy_failure", true, options);
  }
}

export class CancelledCheckinError extends CheckinError {
  constructor(message = "任务已由管理员停止") {
    super(message, "cancelled");
  }
}
