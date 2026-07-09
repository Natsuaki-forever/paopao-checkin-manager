import type { FastifyRequest } from "fastify";
import type { UserCapabilities, UserQuotas } from "../shared/types.js";

export interface AuthPrincipal {
  role: "user" | "admin";
  displayName: string;
  userId?: string;
  owner: boolean;
  capabilities: UserCapabilities;
  quotas: UserQuotas;
}


declare module "fastify" {
  interface FastifyInstance {
    isAuthenticated(request: FastifyRequest): boolean;
    getAuthPrincipal(request: FastifyRequest): AuthPrincipal | undefined;
  }
}
