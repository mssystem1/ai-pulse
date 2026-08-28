import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler {
  return (req, res, next) => { void Promise.resolve(handler(req, res, next)).catch(next); };
}
